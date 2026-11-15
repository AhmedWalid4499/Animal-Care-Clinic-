// Collar tags and lost & found (14 Nov 2026, schema v18). Each pet can have its own QR on the collar:
//   GET  /t/<token>          the "found me?" page (server/tag-page.mjs): the pet, its owner's name and phone, the clinic
//   GET  /t/<token>/data     what that page shows, as JSON
//   POST /t/<token>/alert    the finder presses Alert: a found report (with their location if they allowed it) is
//                            stored, everyone at the clinic is notified, and the owner's own page shows it
// The tag token (pets.tag_token) is separate from the owner page's token: a lost collar never opens the owner's page.
// Only what a finder needs leaves the server: no address, email, history, notes or money.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inTx } from './db.mjs';
import { clinicAddress } from './clinic.mjs';
import { createFoundNotifications } from './notify.mjs';
import { tagPageHtml } from './tag-page.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const TOKEN = /^[A-Za-z0-9_-]{20,64}$/;
const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff' };

function loadText() {
  const pick = (d) => ({ ...d.tag.page, species: d.species, sex: d.sex, alertFlag: d.alerts.flag, neutered: d.pets.neutered });
  const read = (l) => JSON.parse(fs.readFileSync(path.join(here, '..', 'src', 'i18n', `${l}.json`), 'utf8'));
  return { ar: pick(read('ar')), en: pick(read('en')) };
}
const TEXT = loadText();
const imageOnly = (v) => (typeof v === 'string' && /^data:image\/(png|jpe?g|webp|gif);base64,/.test(v) ? v : null);

async function findPet(pool, token) {
  if (!TOKEN.test(token)) return null;
  const p = (await pool.query("SELECT clinic_id, id, data FROM rows WHERE tbl = 'pets' AND data->>'tag_token' = $1 AND NOT deleted LIMIT 1", [token])).rows[0];
  if (!p || p.data.tag_token !== token || (p.data.status ?? 'ACTIVE') !== 'ACTIVE') return null;
  const o = (await pool.query("SELECT id, data FROM rows WHERE clinic_id = $1 AND tbl = 'owners' AND id = $2 AND NOT deleted", [p.clinic_id, String(p.data.owner_id)])).rows[0];
  return { clinicId: p.clinic_id, id: p.id, data: p.data, owner: o ? { id: o.id, data: o.data } : null };
}

async function tagData(pool, pet) {
  const s = (await pool.query("SELECT data FROM rows WHERE clinic_id = $1 AND tbl = 'clinic_settings' AND NOT deleted LIMIT 1", [pet.clinicId])).rows[0]?.data ?? {};
  const d = pet.data;
  return {
    clinic: { name_ar: s.name_ar ?? null, name_en: s.name_en ?? null, phone: s.phone ?? null, whatsapp: s.whatsapp ?? null, address: clinicAddress(s.address), logo: imageOnly(s.logo_url), locale: s.locale_default === 'en' ? 'en' : 'ar' },
    pet: {
      name: d.name, species: d.species, breed: d.breed ?? null, sex: d.sex, neutered: Number(d.is_neutered) === 1, color: d.color ?? null,
      microchip_no: d.microchip_no ?? null, photo: imageOnly(d.photo_url),
      // Medical alerts help whoever is holding the animal (diabetic, epilepsy, aggressive…).
      alerts: String(d.alert_flags ?? '').split(',').map((x) => x.trim()).filter(Boolean), alert_note: d.alert_note ?? null,
    },
    owner: pet.owner && (pet.owner.data.status ?? 'ACTIVE') === 'ACTIVE'
      ? { name: pet.owner.data.full_name, phone: pet.owner.data.phone ?? null, whatsapp: pet.owner.data.whatsapp ?? null }
      : null,
  };
}

// Brakes: wrong links per address, and alerts per address and per tag (each alert reaches every phone at the clinic).
const hits = new Map();
function over(key, max, windowMs) {
  const list = (hits.get(key) || []).filter((t) => Date.now() - t < windowMs);
  hits.set(key, list);
  if (list.length >= max) return true;
  list.push(Date.now());
  return false;
}
setInterval(() => {
  for (const [k, v] of hits) if (!v.some((t) => Date.now() - t < 3600_000)) hits.delete(k);
}, 600_000).unref();

const clean = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) || null : null);
const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null);

function readBody(req, max = 4096) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > max) {
        reject(Object.assign(new Error('too large'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(Object.assign(new Error('invalid JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function json(res, status, body) {
  res.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
  return true;
}

/**
 * Handles /t/…; returns false for anything else.
 * @param {{ afterReport: (clinicId: string, notifications: object[]) => void }} hooks how the server tells devices
 */
export async function handleTag(pool, req, res, url, hooks) {
  const m = /^\/t\/([^/]+)(\/data|\/alert)?\/?$/.exec(url.pathname);
  if (!m) return false;
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
  const token = decodeURIComponent(m[1]);
  const sub = m[2] ?? '';
  const pet = await findPet(pool, token);
  if (!pet) {
    if (over(`miss:${ip}`, 30, 600_000)) return json(res, 429, { error: 'too many tries' });
    if (sub === '') return page(res, false);
    return json(res, 404, { error: 'not found' });
  }
  if (sub === '' && req.method === 'GET') return page(res, true);
  if (sub === '/data' && req.method === 'GET') return json(res, 200, await tagData(pool, pet));
  if (sub === '/alert' && req.method === 'POST') {
    if (over(`ip:${ip}`, 6, 600_000) || over(`tag:${token}`, 5, 3600_000)) return json(res, 429, { error: 'too many alerts' });
    const b = await readBody(req);
    const lat = num(b.lat, -90, 90);
    const lng = num(b.lng, -180, 180);
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const data = {
      id, pet_id: String(pet.id), owner_id: pet.owner ? String(pet.owner.id) : null, reported_at: now,
      lat: lat != null && lng != null ? lat : null, lng: lat != null && lng != null ? lng : null, accuracy_m: lat != null && lng != null ? num(b.accuracy, 0, 1e6) : null,
      finder_name: clean(b.name, 80), finder_phone: clean(b.phone, 30), message: clean(b.message, 500),
      status: 'NEW', handled_by: null, handled_at: null, created_at: now, updated_at: now,
    };
    const notifications = await inTx(pool, async (c) => {
      const versions = Object.fromEntries(Object.keys(data).map((k) => [k, `${now}|server`]));
      await c.query("INSERT INTO rows (clinic_id, tbl, id, data, versions, deleted, seq) VALUES ($1, 'found_reports', $2, $3, $4, false, nextval('change_seq'))", [pet.clinicId, id, data, versions]);
      return createFoundNotifications(c, pet.clinicId, { report_id: id, pet_id: String(pet.id), pet: pet.data.name, owner: pet.owner?.data.full_name ?? '', located: data.lat != null });
    });
    hooks.afterReport(pet.clinicId, notifications);
    return json(res, 200, { ok: true });
  }
  return json(res, 404, { error: 'not found' });
}

const esc = (v) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
function page(res, found) {
  const nonce = crypto.randomBytes(16).toString('base64');
  res.writeHead(found ? 200 : 404, {
    ...headers,
    'Content-Type': 'text/html; charset=utf-8',
    // Geolocation is asked for only when the finder presses Alert.
    'Permissions-Policy': 'geolocation=(self)',
    'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
  });
  res.end(tagPageHtml({ nonce, text: esc(TEXT), found }));
  return true;
}
