// The owner's page (Phase 6, docs/CLOUD-PLAN.md). Each owner can have a private link, printed as a QR code:
//   GET /o/<token>                 the page (Arabic / English, phone first, prints cleanly)
//   GET /o/<token>/data            what the page shows, as JSON
//   GET /o/<token>/live            Server-Sent Events: "changed" whenever the clinic's records change
//   GET /o/<token>/calendar.ics    calendar feed: upcoming appointments + vaccination due dates (subscribe once)
//   GET /o/<token>/a/<id>.ics      one appointment, for "add to calendar"
// The token (owners.portal_token, 128 random bits, made on a clinic device) is the only key: no owner login.
// Staff can replace it (old QR stops working) or switch it off. Only what an owner should see leaves the server:
// never staff notes, national ID, diagnoses, money, or other owners' data.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const TOKEN = /^[A-Za-z0-9_-]{20,64}$/;
const TZ = 'Africa/Cairo';

// UI text lives in src/i18n (CLAUDE.md: never hard-code UI text); the page gets the parts it needs.
function loadText() {
  const pick = (d) => ({
    ...d.portal.page, species: d.species, sex: d.sex, visitType: d.visitType, petStatus: d.petStatus, ageValue: d.pets.ageValue,
  });
  const read = (l) => JSON.parse(fs.readFileSync(path.join(here, '..', 'src', 'i18n', `${l}.json`), 'utf8'));
  return { ar: pick(read('ar')), en: pick(read('en')) };
}
const TEXT = loadText();

// ---------------------------------------------------------------- data
async function findOwner(pool, token) {
  if (!TOKEN.test(token)) return null;
  const r = (await pool.query("SELECT clinic_id, id, data FROM rows WHERE tbl = 'owners' AND data->>'portal_token' = $1 AND NOT deleted LIMIT 1", [token])).rows[0];
  // An archived owner's page is off until they are active again.
  if (!r || r.data.portal_token !== token || (r.data.status ?? 'ACTIVE') !== 'ACTIVE') return null;
  return r;
}

const imageOnly = (v) => (typeof v === 'string' && /^data:image\/(png|jpe?g|webp|gif);base64,/.test(v) ? v : null);
const byText = (k) => (a, b) => String(a[k] ?? '').localeCompare(String(b[k] ?? ''));

/** Everything the owner's page shows, from the clinic server's copy of the records. */
export async function ownerPageData(pool, owner) {
  const cid = owner.clinic_id;
  const rows = async (sql, params) => (await pool.query(sql, params)).rows.map((x) => x.data);
  const forPets = (tbl, ids) => (ids.length
    ? rows(`SELECT data FROM rows WHERE clinic_id = $1 AND tbl = '${tbl}' AND data->>'pet_id' = ANY($2::text[]) AND NOT deleted`, [cid, ids])
    : []);
  const settings = (await rows("SELECT data FROM rows WHERE clinic_id = $1 AND tbl = 'clinic_settings' AND NOT deleted LIMIT 1", [cid]))[0] ?? {};
  const pets = await rows("SELECT data FROM rows WHERE clinic_id = $1 AND tbl = 'pets' AND data->>'owner_id' = $2 AND NOT deleted", [cid, String(owner.id)]);
  const petIds = pets.map((p) => String(p.id));
  const [visitsAll, vaccinations, appointments] = await Promise.all([forPets('visits', petIds), forPets('vaccinations', petIds), forPets('appointments', petIds)]);
  // A visit still in the vet's queue isn't finished: its prescriptions appear once the vet saves it.
  const visits = visitsAll.filter((v) => (v.stage ?? 'DONE') === 'DONE');
  const visitIds = visits.map((v) => String(v.id));
  const rx = visitIds.length
    ? await rows("SELECT data FROM rows WHERE clinic_id = $1 AND tbl = 'prescriptions' AND data->>'visit_id' = ANY($2::text[]) AND NOT deleted", [cid, visitIds])
    : [];
  const vaccineTypes = new Map((await rows("SELECT data FROM rows WHERE clinic_id = $1 AND tbl = 'vaccine_types' AND NOT deleted", [cid])).map((t) => [String(t.id), t.name]));
  const vetIds = [...new Set(visits.map((v) => v.vet_id).filter(Boolean).map(String))];
  const vets = new Map(vetIds.length
    ? (await pool.query("SELECT id, data->>'name' AS name FROM rows WHERE clinic_id = $1 AND tbl = 'users' AND id = ANY($2::text[])", [cid, vetIds])).rows.map((u) => [u.id, u.name])
    : []);
  const petName = new Map(pets.map((p) => [String(p.id), p.name]));

  // Latest vaccination per (pet, vaccine), as on the clinic's dashboard.
  const latest = new Map();
  for (const x of [...vaccinations].sort((a, b) => byText('administered_at')(b, a) || byText('created_at')(b, a))) {
    const k = `${x.pet_id}|${x.vaccine_type_id}`;
    if (!latest.has(k)) latest.set(k, x);
  }
  const weightOf = (petId) => visits
    .filter((v) => String(v.pet_id) === petId && v.weight_kg != null)
    .sort(byText('visited_at')).pop();

  const status = (p) => (p.status === 'ACTIVE' ? 0 : 1);
  const now = Date.now();
  const data = {
    clinic: {
      name_ar: settings.name_ar ?? null, name_en: settings.name_en ?? null, phone: settings.phone ?? null, whatsapp: settings.whatsapp ?? null,
      address: settings.address ?? null, logo: imageOnly(settings.logo_url), locale: settings.locale_default === 'en' ? 'en' : 'ar',
    },
    owner: { full_name: owner.data.full_name, phone: owner.data.phone, whatsapp: owner.data.whatsapp ?? null, email: owner.data.email ?? null, address: owner.data.address ?? null },
    pets: [...pets].sort((a, b) => status(a) - status(b) || byText('name')(a, b)).map((p) => {
      const w = weightOf(String(p.id));
      return {
        id: String(p.id), name: p.name, species: p.species, breed: p.breed ?? null, sex: p.sex, is_neutered: Number(p.is_neutered) === 1,
        date_of_birth: p.date_of_birth ?? null, dob_is_estimate: Number(p.dob_is_estimate) === 1, color: p.color ?? null, microchip_no: p.microchip_no ?? null,
        photo: imageOnly(p.photo_url), status: p.status,
        weight: w ? { kg: Number(w.weight_kg), at: w.visited_at } : null,
        vaccinations: [...latest.values()].filter((x) => String(x.pet_id) === String(p.id))
          .map((x) => ({ name: vaccineTypes.get(String(x.vaccine_type_id)) ?? '—', administered_at: x.administered_at, next_due_at: x.next_due_at ?? null }))
          .sort((a, b) => byText('next_due_at')(a, b)),
      };
    }),
    appointments: appointments
      .filter((a) => a.status === 'SCHEDULED' && Date.parse(a.scheduled_at) + (Number(a.duration_min) || 20) * 60_000 > now)
      .sort(byText('scheduled_at'))
      .map((a) => ({ id: String(a.id), pet_id: String(a.pet_id), pet_name: petName.get(String(a.pet_id)) ?? '', scheduled_at: a.scheduled_at, duration_min: Number(a.duration_min) || 20, type: a.type })),
    prescriptions: visits
      .map((v) => ({
        visit_id: String(v.id), pet_id: String(v.pet_id), pet_name: petName.get(String(v.pet_id)) ?? '', visited_at: v.visited_at, type: v.type,
        vet_name: v.vet_id ? vets.get(String(v.vet_id)) ?? null : null,
        items: rx.filter((r) => String(r.visit_id) === String(v.id)).sort(byText('created_at'))
          .map((r) => ({ drug: r.drug, dose: r.dose ?? null, frequency: r.frequency ?? null, duration_days: r.duration_days ?? null, instructions: r.instructions ?? null })),
      }))
      .filter((v) => v.items.length)
      .sort((a, b) => byText('visited_at')(b, a)),
  };
  return { ...data, version: crypto.createHash('sha1').update(JSON.stringify(data)).digest('hex').slice(0, 16), at: new Date().toISOString() };
}

// ---------------------------------------------------------------- calendar (RFC 5545)
const icsText = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const icsTime = (iso) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsDay = (d) => d.replace(/-/g, '');
/** Lines longer than 75 bytes are folded (UTF-8 safe: Arabic names are 2 bytes a letter). */
function fold(line) {
  const out = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch);
    if (bytes + n > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = '';
      bytes = 0;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}
function nextDay(d) {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
}
function calendar(name, events) {
  const stamp = icsTime(new Date().toISOString());
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Animal Care Clinic//Owner page//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsText(name)}`, `X-WR-TIMEZONE:${TZ}`, 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H'];
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${stamp}`);
    if (e.day) lines.push(`DTSTART;VALUE=DATE:${icsDay(e.day)}`, `DTEND;VALUE=DATE:${icsDay(nextDay(e.day))}`);
    else lines.push(`DTSTART:${icsTime(e.start)}`, `DTEND:${icsTime(e.end)}`);
    lines.push(`SUMMARY:${icsText(e.summary)}`);
    if (e.location) lines.push(`LOCATION:${icsText(e.location)}`);
    if (e.description) lines.push(`DESCRIPTION:${icsText(e.description)}`);
    if (!e.day) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-PT2H', `DESCRIPTION:${icsText(e.summary)}`, 'END:VALARM');
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
const fill = (s, vars) => Object.entries(vars).reduce((acc, [k, v]) => acc.split(`{${k}}`).join(String(v ?? '')), s);
function appointmentEvent(d, a, T) {
  const clinic = (d.clinic.locale === 'en' ? d.clinic.name_en : d.clinic.name_ar) || d.clinic.name_en || '';
  const start = new Date(a.scheduled_at);
  return {
    uid: `appt-${a.id}@animal-care-clinic`,
    start: start.toISOString(),
    end: new Date(start.getTime() + a.duration_min * 60_000).toISOString(),
    summary: fill(T.eventTitle, { pet: a.pet_name, type: T.visitType[a.type] ?? a.type, clinic }),
    location: [clinic, d.clinic.address].filter(Boolean).join(', '),
    description: [d.clinic.phone, d.clinic.whatsapp].filter(Boolean).filter((v, i, xs) => xs.indexOf(v) === i).join(' · '),
  };
}
function feedEvents(d, T) {
  const events = d.appointments.map((a) => appointmentEvent(d, a, T));
  const today = new Date().toLocaleDateString('en-CA', { timeZone: TZ });
  for (const p of d.pets.filter((x) => x.status === 'ACTIVE')) {
    for (const v of p.vaccinations) {
      if (!v.next_due_at || v.next_due_at < today) continue;
      events.push({ uid: `vacc-${p.id}-${crypto.createHash('sha1').update(v.name).digest('hex').slice(0, 8)}-${v.next_due_at}@animal-care-clinic`, day: v.next_due_at, summary: fill(T.vaccineDue, { pet: p.name, vaccine: v.name }) });
    }
  }
  return events;
}

// ---------------------------------------------------------------- live
const listeners = new Map(); // clinicId -> Set<res>
const MAX_LISTENERS = 500;
/** The clinic's records changed (a device pushed, a backup was restored): open owner pages fetch again. */
export function ownerPagesChanged(clinicId) {
  for (const res of listeners.get(String(clinicId)) || []) res.write('data: changed\n\n');
}
setInterval(() => {
  for (const set of listeners.values()) for (const res of set) res.write(': keep-alive\n\n');
}, 25_000).unref();

// Wrong links: a brake per address, so nobody can try link after link (they are unguessable anyway).
const misses = new Map();
function tooManyMisses(ip) {
  const list = (misses.get(ip) || []).filter((t) => Date.now() - t < 10 * 60_000);
  misses.set(ip, list);
  return list.length >= 30;
}

// ---------------------------------------------------------------- routes
const fontDir = path.join(here, '..', 'node_modules', '@fontsource', 'ibm-plex-sans-arabic', 'files');
const FONTS = new Set(['arabic-400', 'arabic-600', 'latin-400', 'latin-600']);
const baseHeaders = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff' };

/** Handles /o/… and /o-font/…; returns false for anything else. */
export async function handleOwnerPage(pool, req, res, url) {
  const p = url.pathname;
  const font = /^\/o-font\/([a-z]+-\d00)\.woff2$/.exec(p);
  if (font && FONTS.has(font[1])) {
    const file = path.join(fontDir, `ibm-plex-sans-arabic-${font[1]}-normal.woff2`);
    if (!fs.existsSync(file)) return notFound(res);
    res.writeHead(200, { 'Content-Type': 'font/woff2', 'Cache-Control': 'public, max-age=31536000, immutable' });
    fs.createReadStream(file).pipe(res);
    return true;
  }
  const m = /^\/o\/([^/]+)(\/data|\/live|\/calendar\.ics|\/a\/([^/]+)\.ics)?\/?$/.exec(p);
  if (!m) return false;
  if (req.method !== 'GET' && req.method !== 'HEAD') return notFound(res);
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
  if (tooManyMisses(ip)) {
    res.writeHead(429, { ...baseHeaders, 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '600' });
    res.end('Too many tries. Wait a few minutes.');
    return true;
  }
  const token = decodeURIComponent(m[1]);
  const sub = m[2] ?? '';
  const owner = await findOwner(pool, token);
  if (!owner) {
    misses.get(ip).push(Date.now());
    if (sub === '') return page(res, null, 404);
    return notFound(res);
  }
  if (sub === '') return page(res, owner, 200);
  if (sub === '/live') return live(req, res, owner);
  const d = await ownerPageData(pool, owner);
  if (sub === '/data') {
    res.writeHead(200, { ...baseHeaders, 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(d));
    return true;
  }
  const lang = url.searchParams.get('lang') === 'en' ? 'en' : url.searchParams.get('lang') === 'ar' ? 'ar' : d.clinic.locale;
  const T = TEXT[lang];
  const clinic = (lang === 'en' ? d.clinic.name_en : d.clinic.name_ar) || d.clinic.name_en || '';
  let body;
  let filename;
  if (sub === '/calendar.ics') {
    body = calendar(fill(T.calendarName, { clinic, owner: d.owner.full_name }), feedEvents(d, T));
    filename = 'clinic-appointments.ics';
  } else {
    const a = d.appointments.find((x) => x.id === decodeURIComponent(m[3]));
    if (!a) return notFound(res);
    body = calendar(clinic, [appointmentEvent(d, a, T)]);
    filename = `appointment-${a.scheduled_at.slice(0, 10)}.ics`;
  }
  res.writeHead(200, { ...baseHeaders, 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': `${sub === '/calendar.ics' ? 'inline' : 'attachment'}; filename="${filename}"` });
  res.end(req.method === 'HEAD' ? undefined : body);
  return true;
}

function notFound(res) {
  res.writeHead(404, { ...baseHeaders, 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
  return true;
}

function live(req, res, owner) {
  const key = String(owner.clinic_id);
  const set = listeners.get(key) || new Set();
  if (set.size >= MAX_LISTENERS) {
    res.writeHead(503, { ...baseHeaders, 'Retry-After': '60' });
    res.end();
    return true;
  }
  res.writeHead(200, { ...baseHeaders, 'Content-Type': 'text/event-stream; charset=utf-8', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 5000\n\n');
  set.add(res);
  listeners.set(key, set);
  req.on('close', () => set.delete(res));
  return true;
}

// ---------------------------------------------------------------- the page
const json = (v) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
function page(res, owner, status) {
  const nonce = crypto.randomBytes(16).toString('base64');
  res.writeHead(status, {
    ...baseHeaders,
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
  });
  res.end(PAGE.replaceAll('__NONCE__', nonce).replace('__TEXT__', json(TEXT)).replace('__FOUND__', owner ? 'true' : 'false'));
  return true;
}

const PAGE = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#2e6f73">
<title>Animal Care Clinic</title>
<style nonce="__NONCE__">
@font-face { font-family: 'Plex Arabic'; font-weight: 400; font-display: swap; src: url(/o-font/arabic-400.woff2) format('woff2'); unicode-range: U+0600-06FF, U+0750-077F, U+0870-088E, U+0890-0891, U+0898-08E1, U+08E3-08FF, U+200C-200E, U+2010-2011, U+204F, U+2E41, U+FB50-FDFF, U+FE70-FE74, U+FE76-FEFC; }
@font-face { font-family: 'Plex Arabic'; font-weight: 600; font-display: swap; src: url(/o-font/arabic-600.woff2) format('woff2'); unicode-range: U+0600-06FF, U+0750-077F, U+0870-088E, U+0890-0891, U+0898-08E1, U+08E3-08FF, U+200C-200E, U+2010-2011, U+204F, U+2E41, U+FB50-FDFF, U+FE70-FE74, U+FE76-FEFC; }
@font-face { font-family: 'Plex Arabic'; font-weight: 400; font-display: swap; src: url(/o-font/latin-400.woff2) format('woff2'); unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }
@font-face { font-family: 'Plex Arabic'; font-weight: 600; font-display: swap; src: url(/o-font/latin-600.woff2) format('woff2'); unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }
:root { --bg: #fbfbfa; --bg-2: #f1f2f0; --ink: #16201f; --ink-2: #44504f; --ink-3: #74807e; --rule: #dfe3e1; --accent: #2e6f73; --accent-ink: #fff; --ok: #2f7a4b; --warn: #a3650b; --bad: #b3362f; --radius: 4px; color-scheme: light; }
@media (prefers-color-scheme: dark) { :root { --bg: #111615; --bg-2: #1a2120; --ink: #e8edec; --ink-2: #b9c3c1; --ink-3: #8b9694; --rule: #2b3533; --accent: #6fb3b7; --accent-ink: #0d1514; --ok: #6cc08d; --warn: #e0a64a; --bad: #ef7a72; color-scheme: dark; } }
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 400 16px/1.55 'Plex Arabic', system-ui, -apple-system, 'Segoe UI', Tahoma, sans-serif; }
main { max-width: 720px; margin: 0 auto; padding: 0 16px 48px; }
a { color: var(--accent); }
.ltr { direction: ltr; unicode-bidi: isolate; }
.top { display: flex; align-items: center; gap: 12px; padding: 18px 0 14px; border-bottom: 2px solid var(--ink); }
.top img { width: 52px; height: 52px; object-fit: contain; border-radius: var(--radius); background: #fff; }
.top .name { font-weight: 600; font-size: 17px; line-height: 1.3; }
.top .sub { font-size: 13px; color: var(--ink-3); }
.top .grow { flex: 1; min-width: 0; }
.lang { border: 1px solid var(--rule); background: none; color: var(--ink-2); font: inherit; font-size: 14px; padding: 6px 10px; border-radius: var(--radius); cursor: pointer; }
.hello { margin: 22px 0 4px; font-size: 24px; font-weight: 600; line-height: 1.3; }
.lead { margin: 0; color: var(--ink-2); }
.status { display: flex; align-items: center; gap: 8px; margin-top: 10px; font-size: 13px; color: var(--ink-3); }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--ink-3); flex: none; }
.status.on .dot { background: var(--ok); box-shadow: 0 0 0 3px color-mix(in srgb, var(--ok) 25%, transparent); }
.status.off .dot { background: var(--warn); }
.actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 44px; padding: 8px 14px; border-radius: var(--radius); border: 1px solid var(--rule); background: var(--bg); color: var(--ink); font: inherit; font-size: 15px; font-weight: 600; text-decoration: none; cursor: pointer; }
.btn.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }
.btn.sm { min-height: 36px; padding: 6px 10px; font-size: 14px; }
section { margin-top: 30px; }
h2 { margin: 0; padding-bottom: 8px; border-bottom: 2px solid var(--ink); font-size: 18px; font-weight: 600; display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
h2 .count { color: var(--ink-3); font-weight: 400; font-size: 14px; }
.facts { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px 20px; margin: 12px 0 0; }
.facts div { min-width: 0; overflow-wrap: anywhere; }
.facts span { display: block; font-size: 12px; color: var(--ink-3); }
.facts b { font-weight: 600; font-size: 15px; }
ul.list { list-style: none; margin: 0; padding: 0; }
ul.list > li { padding: 14px 0; border-bottom: 1px solid var(--rule); }
.row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.when { font-weight: 600; font-size: 17px; }
.muted { color: var(--ink-3); }
.small { font-size: 13px; }
.pet { display: grid; grid-template-columns: 64px 1fr; gap: 14px; }
.pet.greyed { opacity: .6; }
.avatar { width: 64px; height: 64px; border-radius: 50%; background: var(--bg-2); display: grid; place-items: center; overflow: hidden; font-size: 30px; }
.avatar img { width: 100%; height: 100%; object-fit: cover; }
.pet h3 { margin: 0; font-size: 18px; font-weight: 600; }
.badge { display: inline-block; font-size: 12px; font-weight: 600; padding: 1px 8px; border-radius: 999px; border: 1px solid currentColor; line-height: 1.6; white-space: nowrap; }
.badge.bad { color: var(--bad); } .badge.warn { color: var(--warn); } .badge.ok { color: var(--ok); } .badge.info { color: var(--accent); }
.vx { margin: 10px 0 0; padding: 0; list-style: none; font-size: 14px; }
.vx li { display: flex; justify-content: space-between; gap: 10px; padding: 5px 0; border-top: 1px dashed var(--rule); flex-wrap: wrap; }
.rx { margin: 8px 0 0; padding: 0; list-style: none; }
.rx li { padding: 6px 0; border-top: 1px dashed var(--rule); }
.rx b { font-size: 16px; }
.chips { display: flex; gap: 6px; flex-wrap: wrap; margin: 12px 0 0; }
.chip { border: 1px solid var(--rule); background: none; color: var(--ink-2); font: inherit; font-size: 14px; min-height: 36px; padding: 4px 12px; border-radius: 999px; cursor: pointer; }
.chip.on { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }
.empty { color: var(--ink-3); padding: 14px 0; }
.note { margin-top: 12px; padding: 10px 12px; background: var(--bg-2); border-radius: var(--radius); font-size: 14px; color: var(--ink-2); }
footer { margin-top: 36px; padding-top: 12px; border-top: 1px solid var(--rule); font-size: 13px; color: var(--ink-3); }
.gone { text-align: center; padding: 80px 16px; }
.gone h1 { font-size: 22px; }
.skeleton { height: 120px; margin-top: 24px; border-radius: var(--radius); background: var(--bg-2); }
@media print {
  :root { --bg: #fff; --ink: #000; --ink-2: #222; --ink-3: #555; --rule: #ccc; }
  .lang, .actions, .status, .chips, .no-print { display: none !important; }
  main { max-width: none; padding: 0; }
  section { break-inside: avoid-page; }
}
</style>
</head>
<body>
<main id="app"><div class="skeleton"></div></main>
<script nonce="__NONCE__">
(() => {
  const TEXT = __TEXT__;
  const FOUND = __FOUND__;
  const EMOJI = { DOG: '🐕', CAT: '🐈', BIRD: '🐦', RABBIT: '🐇', REPTILE: '🦎', OTHER: '🐾' };
  const base = location.pathname.replace(/\\/+$/, '');
  let lang = null;
  try { lang = localStorage.getItem('owner-page-lang'); } catch (e) {}
  let d = null;
  let petFilter = 'all';
  let connected = true;
  let gone = !FOUND;

  const T = () => TEXT[lang || (d && d.clinic.locale) || 'ar'];
  const fill = (s, v) => Object.keys(v || {}).reduce((a, k) => a.split('{' + k + '}').join(String(v[k])), s || '');
  const t = (k, v) => fill(k.split('.').reduce((o, p) => (o ? o[p] : undefined), T()) || k, v);
  const L = () => lang || (d && d.clinic.locale) || 'ar';

  // Elements are built from text nodes only: nothing from the records is ever parsed as HTML.
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
    return el;
  }

  const tag = () => (L() === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB');
  const isDay = (s) => typeof s === 'string' && s.length === 10;
  const asDate = (s) => (isDay(s) ? new Date(s + 'T00:00:00Z') : new Date(s));
  const zone = (s) => (isDay(s) ? 'UTC' : '${TZ}');
  const fmtDate = (s) => (s ? new Intl.DateTimeFormat(tag(), { day: 'numeric', month: 'short', year: 'numeric', timeZone: zone(s) }).format(asDate(s)) : '—');
  const fmtLong = (s) => new Intl.DateTimeFormat(tag(), { weekday: 'long', day: 'numeric', month: 'long', timeZone: '${TZ}' }).format(new Date(s));
  const fmtTime = (s) => new Intl.DateTimeFormat(tag(), { hour: 'numeric', minute: '2-digit', timeZone: '${TZ}' }).format(new Date(s));
  const fmtNum = (n, digits) => new Intl.NumberFormat(tag(), { maximumFractionDigits: digits }).format(n);
  const todayStr = () => new Date().toLocaleDateString('en-CA', { timeZone: '${TZ}' });
  const daysUntil = (day) => Math.round((Date.parse(day + 'T00:00:00Z') - Date.parse(todayStr() + 'T00:00:00Z')) / 86400000);
  function age(dob) {
    const [y, m, dd] = dob.split('-').map(Number);
    const [ty, tm, td] = todayStr().split('-').map(Number);
    let months = (ty - y) * 12 + (tm - m) - (td < dd ? 1 : 0);
    if (months < 0) months = 0;
    return { y: Math.floor(months / 12), m: months % 12 };
  }
  const e164 = (raw) => {
    if (!raw) return null;
    let n = String(raw).replace(/[^\\d+]/g, '');
    if (n.startsWith('+')) n = n.slice(1); else if (n.startsWith('00')) n = n.slice(2); else if (n.startsWith('0')) n = '20' + n.slice(1);
    return n.length >= 10 ? n : null;
  };
  const clinicName = () => (L() === 'en' ? d.clinic.name_en : d.clinic.name_ar) || d.clinic.name_en || d.clinic.name_ar || '';

  function googleLink(a) {
    const start = new Date(a.scheduled_at);
    const end = new Date(start.getTime() + a.duration_min * 60000);
    const z = (x) => x.toISOString().replace(/[-:]/g, '').replace(/\\.\\d{3}/, '');
    const q = new URLSearchParams({
      action: 'TEMPLATE',
      text: t('eventTitle', { pet: a.pet_name, type: t('visitType.' + a.type), clinic: clinicName() }),
      dates: z(start) + '/' + z(end),
      details: [d.clinic.phone, d.clinic.whatsapp].filter(Boolean).filter((v, i, xs) => xs.indexOf(v) === i).join(' · '),
      location: [clinicName(), d.clinic.address].filter(Boolean).join(', '),
      ctz: '${TZ}',
    });
    return 'https://calendar.google.com/calendar/render?' + q.toString();
  }
  const feed = () => location.host + base + '/calendar.ics?lang=' + L();

  function header() {
    const other = L() === 'ar' ? 'en' : 'ar';
    return h('header', { class: 'top' },
      d.clinic.logo ? h('img', { src: d.clinic.logo, alt: '' }) : null,
      h('div', { class: 'grow' },
        h('div', { class: 'name' }, clinicName()),
        d.clinic.address ? h('div', { class: 'sub' }, d.clinic.address) : null),
      h('button', { class: 'lang', type: 'button', lang: other, onclick: () => setLang(other) }, other === 'en' ? 'English' : 'عربي'));
  }

  function statusLine() {
    return h('div', { class: 'status ' + (connected ? 'on' : 'off'), role: 'status', 'aria-live': 'polite' },
      h('span', { class: 'dot' }),
      connected ? t('live') + ' · ' + t('updated', { time: fmtTime(d.at) }) : t('reconnecting'));
  }

  function contact() {
    const phone = d.clinic.phone || d.clinic.whatsapp;
    const wa = e164(d.clinic.whatsapp || d.clinic.phone);
    return h('div', { class: 'actions' },
      phone ? h('a', { class: 'btn', href: 'tel:' + String(phone).replace(/[^\\d+]/g, '') }, '📞 ', t('callClinic')) : null,
      wa ? h('a', { class: 'btn', href: 'https://wa.me/' + wa, target: '_blank', rel: 'noopener noreferrer' }, '💬 ', t('whatsappClinic')) : null);
  }

  function detailsSection() {
    const o = d.owner;
    const fact = (label, value, ltr) => (value ? h('div', null, h('span', null, label), h('b', ltr ? { class: 'ltr' } : null, value)) : null);
    return h('section', null, h('h2', null, t('yourDetails')),
      h('div', { class: 'facts' },
        fact(t('name'), o.full_name),
        fact(t('phone'), o.phone, true),
        o.whatsapp && o.whatsapp !== o.phone ? fact(t('whatsapp'), o.whatsapp, true) : null,
        fact(t('email'), o.email, true),
        fact(t('address'), o.address)),
      h('p', { class: 'small muted' }, t('detailsHint')));
  }

  function appointmentsSection() {
    const list = d.appointments;
    return h('section', null,
      h('h2', null, t('appointments'), h('span', { class: 'count' }, list.length)),
      h('ul', { class: 'list' },
        list.length ? list.map((a) => h('li', null,
          h('div', { class: 'when' }, fmtLong(a.scheduled_at), ' · ', h('bdi', null, fmtTime(a.scheduled_at))),
          h('div', { class: 'muted' }, a.pet_name, ' · ', t('visitType.' + a.type), ' · ', t('minutes', { n: a.duration_min })),
          h('div', { class: 'actions' },
            h('a', { class: 'btn sm', href: googleLink(a), target: '_blank', rel: 'noopener noreferrer' }, '📅 ', t('addGoogle')),
            h('a', { class: 'btn sm', href: base + '/a/' + encodeURIComponent(a.id) + '.ics?lang=' + L(), download: '' }, '🗓 ', t('addIcs')))))
          : h('li', { class: 'empty' }, t('noAppointments'))),
      h('div', { class: 'note no-print' },
        h('div', null, t('subscribeHint')),
        h('div', { class: 'actions' },
          h('a', { class: 'btn sm primary', href: 'webcal://' + feed() }, t('subscribe')),
          h('a', { class: 'btn sm', href: 'https://calendar.google.com/calendar/render?cid=' + encodeURIComponent('webcal://' + feed()), target: '_blank', rel: 'noopener noreferrer' }, t('subscribeGoogle')))));
  }

  function vaccinationBadge(v) {
    if (!v.next_due_at) return null;
    const n = daysUntil(v.next_due_at);
    if (n < 0) return h('span', { class: 'badge bad' }, t('overdue'));
    if (n <= 7) return h('span', { class: 'badge warn' }, n === 0 ? t('dueToday') : t('dueIn', { n }));
    return null;
  }

  function petsSection() {
    return h('section', null,
      h('h2', null, t('pets'), h('span', { class: 'count' }, d.pets.length)),
      h('ul', { class: 'list' },
        d.pets.length ? d.pets.map((p) => {
          const a = p.date_of_birth ? age(p.date_of_birth) : null;
          const facts = [
            [t('sexLabel'), t('sex.' + p.sex) + (p.is_neutered ? ' · ' + t('neutered') : '')],
            a ? [t('age'), fill(T().ageValue, { y: a.y, m: a.m }) + (p.dob_is_estimate ? ' (' + t('estimate') + ')' : '')] : null,
            p.weight ? [t('weight'), fmtNum(p.weight.kg, 2) + ' ' + t('kg') + ' · ' + fmtDate(p.weight.at)] : null,
            p.color ? [t('color'), p.color] : null,
            p.microchip_no ? [t('microchip'), p.microchip_no, true] : null,
          ].filter(Boolean);
          return h('li', { class: 'pet' + (p.status !== 'ACTIVE' ? ' greyed' : '') },
            h('div', { class: 'avatar' }, p.photo ? h('img', { src: p.photo, alt: '' }) : EMOJI[p.species] || '🐾'),
            h('div', null,
              h('div', { class: 'row' }, h('h3', null, p.name), p.status !== 'ACTIVE' ? h('span', { class: 'badge' }, t('petStatus.' + p.status)) : null),
              h('div', { class: 'muted' }, t('species.' + p.species), p.breed ? ' · ' + p.breed : ''),
              h('div', { class: 'facts' }, facts.map(([k, v, ltr]) => h('div', null, h('span', null, k), h('b', ltr ? { class: 'ltr' } : null, v)))),
              p.vaccinations.length ? h('ul', { class: 'vx' }, p.vaccinations.map((v) => h('li', null,
                h('span', null, '💉 ', h('b', null, v.name), ' · ', h('span', { class: 'muted' }, t('given', { date: fmtDate(v.administered_at) }))),
                h('span', null, v.next_due_at ? t('nextDue', { date: fmtDate(v.next_due_at) }) + ' ' : '', vaccinationBadge(v))))) : null));
        }) : h('li', { class: 'empty' }, t('noPets'))));
  }

  function prescriptionsSection() {
    const all = d.prescriptions;
    const petsWithRx = d.pets.filter((p) => all.some((v) => v.pet_id === p.id));
    if (petFilter !== 'all' && !petsWithRx.some((p) => p.id === petFilter)) petFilter = 'all';
    const list = petFilter === 'all' ? all : all.filter((v) => v.pet_id === petFilter);
    const line = (r) => [r.dose, r.frequency, r.duration_days ? t('days', { n: r.duration_days }) : null].filter(Boolean).join(' · ');
    return h('section', null,
      h('h2', null, t('prescriptions'), h('span', { class: 'count' }, all.length)),
      petsWithRx.length > 1 ? h('div', { class: 'chips' },
        h('button', { type: 'button', class: 'chip' + (petFilter === 'all' ? ' on' : ''), onclick: () => { petFilter = 'all'; render(); } }, t('allPets')),
        petsWithRx.map((p) => h('button', { type: 'button', class: 'chip' + (petFilter === p.id ? ' on' : ''), onclick: () => { petFilter = p.id; render(); } }, p.name))) : null,
      h('ul', { class: 'list' },
        list.length ? list.map((v) => h('li', null,
          h('div', { class: 'row' }, h('b', null, fmtDate(v.visited_at)), h('span', { class: 'muted' }, v.pet_name + ' · ' + t('visitType.' + v.type) + (v.vet_name ? ' · ' + t('byVet', { name: v.vet_name }) : ''))),
          h('ul', { class: 'rx' }, v.items.map((r) => h('li', null,
            '💊 ', h('b', null, r.drug), line(r) ? h('span', null, ' — ', line(r)) : null,
            r.instructions ? h('div', { class: 'small muted' }, r.instructions) : null)))))
          : h('li', { class: 'empty' }, t('noPrescriptions'))),
      all.length ? h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn sm', onclick: () => window.print() }, '🖨 ', t('print'))) : null);
  }

  function render() {
    const app = document.getElementById('app');
    document.documentElement.lang = L();
    document.documentElement.dir = L() === 'ar' ? 'rtl' : 'ltr';
    if (gone) {
      document.title = t('goneTitle');
      app.replaceChildren(h('div', { class: 'gone' }, h('div', { class: 'avatar' }, '🐾'), h('h1', null, t('goneTitle')), h('p', { class: 'muted' }, t('goneBody'))));
      return;
    }
    if (!d) return;
    document.title = clinicName() + ' — ' + d.owner.full_name;
    app.replaceChildren(
      header(),
      h('h1', { class: 'hello' }, t('hello', { name: d.owner.full_name.split(' ')[0] })),
      h('p', { class: 'lead' }, t('lead', { clinic: clinicName() })),
      statusLine(),
      contact(),
      appointmentsSection(),
      petsSection(),
      prescriptionsSection(),
      detailsSection(),
      h('footer', null, t('privacy')));
  }
  function setLang(l) {
    lang = l;
    try { localStorage.setItem('owner-page-lang', l); } catch (e) {}
    render();
  }

  let loading = null;
  async function load() {
    if (loading) return loading;
    loading = (async () => {
      try {
        const r = await fetch(base + '/data', { cache: 'no-store' });
        if (r.status === 404) { gone = true; es && es.close(); render(); return; }
        if (!r.ok) throw new Error(r.status);
        const next = await r.json();
        const changed = !d || next.version !== d.version;
        d = next;
        if (changed) render(); else { const s = document.querySelector('.status'); if (s) s.replaceWith(statusLine()); }
      } catch (e) {
        connected = false;
        if (d) render();
      } finally {
        loading = null;
      }
    })();
    return loading;
  }

  // Live: the server says "changed" the moment the clinic saves anything; the page fetches again.
  let es = null;
  let timer = null;
  function connect() {
    if (gone || !('EventSource' in window)) return;
    es = new EventSource(base + '/live');
    es.onopen = () => { connected = true; load(); };
    es.onmessage = () => { clearTimeout(timer); timer = setTimeout(load, 400); };
    es.onerror = () => {
      connected = false;
      if (d) { const s = document.querySelector('.status'); if (s) s.replaceWith(statusLine()); }
      if (es.readyState === 2) load(); // the server refused the stream: the link may have been replaced
    };
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !gone) load(); });
  setInterval(() => { if (!gone) load(); }, 120000);

  if (gone) render();
  else { load(); connect(); }
})();
</script>
</body>
</html>`;
