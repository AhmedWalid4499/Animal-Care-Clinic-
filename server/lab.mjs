// Lab extranet (change request, 20 Nov 2026, Ahmed). A web page on the clinic server for the lab's doctor:
//   GET  /lab                      the page (server/lab-page.mjs; purple; Arabic / English)
//   GET  /lab/app.mjs, /lab/parse.mjs, /lab/vendor/…   its code, PDF reader (pdf.js) and OCR (Tesseract), all served here
//   POST /lab/api/login · logout · password    GET /lab/api/me
//   GET  /lab/api/home             open lab requests from the vets, and the lab's recent uploads
//   GET  /lab/api/search?q=        active patients by customer ID, owner phone, pet or owner name
//   GET  /lab/api/pet/:id          one patient: details, lab requests, earlier results, lab documents
//   GET  /lab/api/file/:id         a lab document (LAB attachment) of an active patient
//   POST /lab/api/upload           a report (PDF / photo) + the results read from it → attachment + lab_results rows
// The lab doctor's account is a users row with role LAB (schema v24), made by the clinic's Admin with a temporary
// password. It can never sign in to the app or the sync API (server/index.mjs, server/rules.mjs); its session lives
// in lab_sessions behind an HttpOnly cookie limited to /lab. A lab sees no visits, notes, invoices or addresses.
// Uploads are written here like a device would write them (rows + versions + seq under numberingLock), so they reach
// every laptop, the pet's record (Labs and Files tabs) and the owner's page.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { inTx, numberingLock } from './db.mjs';
import { MAX_FILE, fileBytes, saveFile } from './files.mjs';
import { createLabNotifications } from './notify.mjs';
import { labPageHtml } from './lab-page.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const IDLE_HOURS = 12;
const COOKIE = 'lab_session';

// ---------------------------------------------------------------- static code: the page's own, pdf.js, Tesseract
const pkgDir = (name) => path.dirname(require.resolve(`${name}/package.json`));
function vendorFile(rel) {
  const files = {
    'pdf.mjs': [pkgDir('pdfjs-dist'), 'build/pdf.min.mjs'],
    'pdf.worker.mjs': [pkgDir('pdfjs-dist'), 'build/pdf.worker.min.mjs'],
    'tesseract.js': [pkgDir('tesseract.js'), 'dist/tesseract.min.js'],
    'tesseract.worker.js': [pkgDir('tesseract.js'), 'dist/worker.min.js'],
    'lang/eng.traineddata.gz': [pkgDir('@tesseract.js-data/eng'), '4.0.0_best_int/eng.traineddata.gz'],
  };
  if (files[rel]) return path.join(...files[rel]);
  const core = /^core\/(tesseract-core(?:-simd|-relaxedsimd)?(?:-lstm)?\.wasm(?:\.js)?)$/.exec(rel);
  return core ? path.join(pkgDir('tesseract.js-core'), core[1]) : null;
}
const OWN = { 'app.mjs': 'lab-client.mjs', 'parse.mjs': 'lab-parse.mjs' };
const TYPES = { '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.wasm': 'application/wasm', '.gz': 'application/gzip' };

// The lab test names the parser looks for (the clinic's own request sheet), by key.
const LAB_TESTS = JSON.parse(fs.readFileSync(path.join(here, '..', 'src', 'lib', 'lab-tests.json'), 'utf8'));
const TEST_LABEL = Object.fromEntries(LAB_TESTS.groups.flatMap((g) => g.tests.map((x) => [x.key, x.label])));
const TEST_GROUP = Object.fromEntries(LAB_TESTS.groups.flatMap((g) => g.tests.map((x) => [x.key, g.key])));

// UI text from src/i18n (never hard-coded): the lab.* part plus species / sex names.
function loadText() {
  const read = (l) => JSON.parse(fs.readFileSync(path.join(here, '..', 'src', 'i18n', `${l}.json`), 'utf8'));
  const en = read('en');
  // Panels are stored in English whatever language the lab doctor uses, like the clinic's test names (lab-tests.json).
  const pick = (d) => ({ ...d.lab, species: d.species, sex: d.sex, labGroup: en.labReq?.group ?? {} });
  return { ar: pick(read('ar')), en: pick(en) };
}
const TEXT = loadText();

// ---------------------------------------------------------------- helpers
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const clean = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const headers = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
};
function json(res, status, body, extra = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers, ...extra });
  res.end(JSON.stringify(body));
}
function readJson(req, max) {
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
const cookieOf = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((x) => x.trim().split('=')).filter((x) => x.length === 2))[COOKIE];
const secure = (req) => req.headers['x-forwarded-proto'] === 'https' || !!req.socket.encrypted;
const ipOf = (req) => req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;

// Wrong passwords: 8 per 15 minutes per address and per account.
const fails = new Map();
const recentFails = (k) => (fails.get(k) || []).filter((t) => Date.now() - t < 15 * 60_000);
const blocked = (...keys) => keys.some((k) => recentFails(k).length >= 8);
const failed = (...keys) => keys.forEach((k) => fails.set(k, [...recentFails(k), Date.now()]));
setInterval(() => {
  for (const [k, v] of fails) if (!v.some((t) => Date.now() - t < 15 * 60_000)) fails.delete(k);
}, 600_000).unref();

/** The signed-in lab doctor, re-read on every request (deactivation, reset or a new password ends the session). */
async function session(pool, req) {
  const token = cookieOf(req);
  if (!token) return null;
  const s = (await pool.query(
    `UPDATE lab_sessions SET last_seen = now() WHERE token_hash = $1 AND last_seen > now() - make_interval(hours => $2) RETURNING *`,
    [sha256(token), IDLE_HOURS],
  )).rows[0];
  if (!s) return null;
  const u = (await pool.query("SELECT id, data, versions FROM rows WHERE clinic_id = $1 AND tbl = 'users' AND id = $2 AND NOT deleted", [s.clinic_id, s.user_id])).rows[0];
  if (!u || u.data.role !== 'LAB' || !Number(u.data.is_active) || sha256(String(u.data.password_hash)) !== s.pw) {
    await pool.query('DELETE FROM lab_sessions WHERE token_hash = $1', [s.token_hash]);
    return null;
  }
  return { clinicId: s.clinic_id, user: u.data, versions: u.versions, tokenHash: s.token_hash };
}
const me = (u) => ({ id: u.id, name: u.name, email: u.email, lab_name: u.lab_name ?? null, locale: u.locale === 'en' ? 'en' : 'ar', must_change_password: !!Number(u.must_change_password) });

/** Write a row the way a device would (all columns versioned now, by this lab account). */
async function insertRow(c, clinicId, tbl, data, stamp, userId) {
  const versions = Object.fromEntries(Object.keys(data).map((k) => [k, `${stamp}|lab|${userId}`]));
  await c.query("INSERT INTO rows (clinic_id, tbl, id, data, versions, deleted, seq) VALUES ($1, $2, $3, $4, $5, false, nextval('change_seq'))", [clinicId, tbl, data.id, data, versions]);
}
async function patchRow(c, clinicId, tbl, id, patch, versions, stamp, userId) {
  const v = { ...versions, ...Object.fromEntries(Object.keys(patch).map((k) => [k, `${stamp}|lab|${userId}`])) };
  await c.query("UPDATE rows SET data = data || $4::jsonb, versions = $5, seq = nextval('change_seq') WHERE clinic_id = $1 AND tbl = $2 AND id = $3", [clinicId, tbl, id, patch, v]);
}
async function audit(c, clinicId, userId, table, recordId, action, diff, stamp) {
  await insertRow(c, clinicId, 'audit_log', { id: crypto.randomUUID(), user_id: userId, table_name: table, record_id: recordId, action, diff: diff ? JSON.stringify(diff) : null, at: stamp }, stamp, userId);
}

// ---------------------------------------------------------------- what a lab may see
const maskPhone = (p) => {
  const d = String(p ?? '').replace(/\D/g, '');
  return d.length > 5 ? `${d.slice(0, 3)}${'•'.repeat(d.length - 6)}${d.slice(-3)}` : '';
};
function petCard(pet, owner) {
  return {
    id: pet.id, name: pet.name, species: pet.species, breed: pet.breed ?? null, sex: pet.sex, is_neutered: !!Number(pet.is_neutered),
    date_of_birth: pet.date_of_birth ?? null, dob_is_estimate: !!Number(pet.dob_is_estimate),
    owner: owner ? { name: owner.full_name, code: owner.code ?? null, phone: maskPhone(owner.phone) } : null,
  };
}
const itemsOf = (r) => String(r.items ?? '').split(',').filter(Boolean).map((k) => ({ key: k, label: TEST_LABEL[k] ?? k, group: TEST_GROUP[k] ?? null }));
async function names(pool, clinicId, ids) {
  const list = [...new Set(ids.filter(Boolean).map(String))];
  if (!list.length) return {};
  const r = await pool.query("SELECT id, data->>'name' AS name, data->>'lab_name' AS lab FROM rows WHERE clinic_id = $1 AND tbl = 'users' AND id = ANY($2::text[])", [clinicId, list]);
  return Object.fromEntries(r.rows.map((u) => [u.id, u.lab ? `${u.name} (${u.lab})` : u.name]));
}
async function activePet(pool, clinicId, petId) {
  const r = (await pool.query(
    `SELECT p.id, p.data AS pet, o.data AS owner FROM rows p JOIN rows o ON o.clinic_id = p.clinic_id AND o.tbl = 'owners' AND o.id = p.data->>'owner_id' AND NOT o.deleted
      WHERE p.clinic_id = $1 AND p.tbl = 'pets' AND p.id = $2 AND NOT p.deleted AND COALESCE(p.data->>'status', 'ACTIVE') = 'ACTIVE'`,
    [clinicId, String(petId)],
  )).rows[0];
  return r ? { pet: r.pet, owner: r.owner } : null;
}

async function home(pool, s) {
  const reqs = (await pool.query(
    `SELECT r.data AS req, p.data AS pet, o.data AS owner FROM rows r
       JOIN rows p ON p.clinic_id = r.clinic_id AND p.tbl = 'pets' AND p.id = r.data->>'pet_id' AND NOT p.deleted AND COALESCE(p.data->>'status', 'ACTIVE') = 'ACTIVE'
       JOIN rows o ON o.clinic_id = r.clinic_id AND o.tbl = 'owners' AND o.id = p.data->>'owner_id' AND NOT o.deleted
      WHERE r.clinic_id = $1 AND r.tbl = 'test_requests' AND NOT r.deleted AND r.data->>'kind' = 'LAB' AND r.data->>'status' = 'REQUESTED'
      ORDER BY r.data->>'requested_at' DESC LIMIT 200`,
    [s.clinicId],
  )).rows;
  const who = await names(pool, s.clinicId, reqs.map((x) => x.req.requested_by));
  const mine = (await pool.query(
    `SELECT r.data->>'pet_id' AS pet_id, r.data->>'taken_at' AS taken_at, MAX(r.data->>'created_at') AS at, COUNT(*) AS n FROM rows r
      WHERE r.clinic_id = $1 AND r.tbl = 'lab_results' AND NOT r.deleted AND r.data->>'user_id' = $2
      GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 15`,
    [s.clinicId, String(s.user.id)],
  )).rows;
  const recent = [];
  for (const m of mine) {
    const p = await activePet(pool, s.clinicId, m.pet_id);
    if (p) recent.push({ ...petCard(p.pet, p.owner), taken_at: m.taken_at, n: Number(m.n) });
  }
  return {
    requests: reqs.map((x) => ({
      id: x.req.id, requested_at: x.req.requested_at, requested_by: who[x.req.requested_by] ?? null, items: itemsOf(x.req),
      other: x.req.other ?? null, notes: x.req.notes ?? null, pet: petCard(x.pet, x.owner),
    })),
    recent,
  };
}

async function search(pool, s, q) {
  const text = clean(q, 60);
  if (text.length < 2) return { pets: [] };
  const digits = text.replace(/\D/g, '');
  const code = /^(ac-?|#)?\s*0*(\d{1,6})$/i.exec(text);
  const r = (await pool.query(
    `SELECT p.data AS pet, o.data AS owner FROM rows p
       JOIN rows o ON o.clinic_id = p.clinic_id AND o.tbl = 'owners' AND o.id = p.data->>'owner_id' AND NOT o.deleted AND COALESCE(o.data->>'status', 'ACTIVE') = 'ACTIVE'
      WHERE p.clinic_id = $1 AND p.tbl = 'pets' AND NOT p.deleted AND COALESCE(p.data->>'status', 'ACTIVE') = 'ACTIVE'
        AND (lower(p.data->>'name') LIKE $2 OR lower(o.data->>'full_name') LIKE $2
             OR ($3 <> '' AND o.data->>'code' = $3)
             OR (length($4) >= 6 AND (regexp_replace(COALESCE(o.data->>'phone', ''), '\\D', '', 'g') LIKE '%' || $4 || '%'
                                   OR regexp_replace(COALESCE(o.data->>'whatsapp', ''), '\\D', '', 'g') LIKE '%' || $4 || '%')))
      ORDER BY o.data->>'full_name', p.data->>'name' LIMIT 25`,
    [s.clinicId, `%${text.toLowerCase()}%`, code ? `AC-${code[2].padStart(5, '0')}` : '', digits],
  )).rows;
  return { pets: r.map((x) => petCard(x.pet, x.owner)) };
}

async function petDetail(pool, s, petId) {
  const p = await activePet(pool, s.clinicId, petId);
  if (!p) return null;
  const rowsOf = async (tbl, extra = '') => (await pool.query(
    `SELECT data FROM rows WHERE clinic_id = $1 AND tbl = '${tbl}' AND NOT deleted AND data->>'pet_id' = $2 ${extra}`,
    [s.clinicId, String(p.pet.id)],
  )).rows.map((x) => x.data);
  const [reqs, results, docs] = await Promise.all([
    rowsOf('test_requests', "AND data->>'kind' = 'LAB' AND data->>'status' <> 'CANCELLED'"),
    rowsOf('lab_results'),
    rowsOf('attachments', "AND data->>'kind' = 'LAB'"),
  ]);
  const onServer = new Set((await pool.query('SELECT id FROM files WHERE clinic_id = $1 AND id = ANY($2::text[])', [s.clinicId, docs.map((d) => String(d.id))])).rows.map((x) => x.id));
  const who = await names(pool, s.clinicId, [...reqs.map((r) => r.requested_by), ...results.map((r) => r.user_id), ...docs.map((d) => d.uploaded_by)]);
  const days = new Map();
  for (const r of results.sort((a, b) => String(b.taken_at).localeCompare(String(a.taken_at)) || String(a.created_at).localeCompare(String(b.created_at)))) {
    if (!days.has(r.taken_at)) days.set(r.taken_at, []);
    const v = num(r.value);
    const lo = num(r.ref_low);
    const hi = num(r.ref_high);
    days.get(r.taken_at).push({
      analyte: r.analyte, panel: r.panel ?? null, value: v, value_text: r.value_text ?? null, unit: r.unit ?? null, ref_low: lo, ref_high: hi,
      flag: v == null ? null : hi != null && v > hi ? 'H' : lo != null && v < lo ? 'L' : null, by: who[r.user_id] ?? null, document: r.attachment_id ?? null,
    });
  }
  return {
    pet: petCard(p.pet, p.owner),
    alerts: p.pet.alert_flags ? String(p.pet.alert_flags).split(',').filter(Boolean) : [],
    requests: reqs.sort((a, b) => String(b.requested_at).localeCompare(String(a.requested_at))).map((r) => ({
      id: r.id, status: r.status, requested_at: r.requested_at, requested_by: who[r.requested_by] ?? null, items: itemsOf(r), other: r.other ?? null, notes: r.notes ?? null,
    })),
    results: [...days.entries()].map(([date, items]) => ({ date, items })),
    documents: docs.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).map((d) => ({
      id: d.id, name: d.file_name, mime: d.mime_type ?? null, size: d.size_bytes ?? null, at: d.created_at, by: who[d.uploaded_by] ?? null, ready: onServer.has(String(d.id)),
    })),
  };
}

// ---------------------------------------------------------------- upload
const MIMES = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
function sniff(b) {
  if (b.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (b[0] === 0x89 && b.subarray(1, 4).toString('latin1') === 'PNG') return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}
const DAY = /^\d{4}-\d{2}-\d{2}$/;
function cairoToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

/** Store the report and its results. Returns { status, body, notifications }. */
async function upload(pool, s, input) {
  const p = await activePet(pool, s.clinicId, input?.pet_id);
  if (!p) return { status: 400, body: { error: 'pet' } };
  const takenAt = String(input?.taken_at ?? '');
  if (!DAY.test(takenAt) || takenAt > cairoToday() || takenAt < '2000-01-01') return { status: 400, body: { error: 'date' } };
  const b64 = String(input?.file?.data ?? '');
  const bytes = Buffer.from(b64, 'base64');
  if (!bytes.length) return { status: 400, body: { error: 'file' } };
  if (bytes.length > MAX_FILE) return { status: 413, body: { error: 'file_too_large' } };
  const mime = sniff(bytes);
  if (!mime) return { status: 400, body: { error: 'file_type' } };
  const base = clean(input?.file?.name, 120).replace(/[\\/:*?"<>|]/g, '_').replace(/\.[A-Za-z0-9]{1,5}$/, '') || 'lab-report';
  const fileName = `${base}.${MIMES[mime]}`;
  const list = Array.isArray(input?.results) ? input.results.slice(0, 200) : [];
  const results = [];
  for (const r of list) {
    const analyte = clean(r?.analyte, 80);
    const value = num(r?.value);
    const valueText = value == null ? clean(r?.value_text ?? r?.value, 40) : '';
    if (!analyte || (value == null && !valueText)) continue;
    results.push({
      analyte, value, value_text: valueText || null, unit: clean(r?.unit, 20) || null, ref_low: num(r?.ref_low), ref_high: num(r?.ref_high), panel: clean(r?.panel, 60) || null,
    });
  }
  const note = clean(input?.note, 500) || null;
  const reqId = input?.request_id ? String(input.request_id) : null;
  return inTx(pool, async (c) => {
    await numberingLock(c, s.clinicId);
    let req = null;
    if (reqId) {
      req = (await c.query("SELECT data, versions FROM rows WHERE clinic_id = $1 AND tbl = 'test_requests' AND id = $2 AND NOT deleted", [s.clinicId, reqId])).rows[0];
      if (!req || String(req.data.pet_id) !== String(p.pet.id) || req.data.kind !== 'LAB' || req.data.status === 'CANCELLED') return { status: 400, body: { error: 'request' } };
    }
    const stamp = new Date().toISOString();
    const uid = String(s.user.id);
    const attId = crypto.randomUUID();
    const att = {
      id: attId, pet_id: String(p.pet.id), visit_id: req?.data.visit_id ?? null, kind: 'LAB', file_url: `db://attachments/${attId}`, file_name: fileName,
      mime_type: mime, size_bytes: bytes.length, uploaded_by: uid, created_at: stamp, updated_at: stamp,
    };
    await insertRow(c, s.clinicId, 'attachments', att, stamp, uid);
    await audit(c, s.clinicId, uid, 'attachments', attId, 'CREATE', { kind: 'LAB', file_name: fileName, size_bytes: bytes.length, via: 'lab extranet' }, stamp);
    const ids = [];
    for (const [i, r] of results.entries()) {
      const id = crypto.randomUUID();
      ids.push(id);
      const row = {
        id, pet_id: String(p.pet.id), visit_id: req?.data.visit_id ?? null, taken_at: takenAt, panel: r.panel, analyte: r.analyte, value: r.value, value_text: r.value_text,
        unit: r.unit, ref_low: r.ref_low, ref_high: r.ref_high, note: i === 0 ? note : null, user_id: uid, attachment_id: attId, request_id: reqId,
        created_at: stamp, updated_at: stamp,
      };
      await insertRow(c, s.clinicId, 'lab_results', row, stamp, uid);
      await audit(c, s.clinicId, uid, 'lab_results', id, 'CREATE', { analyte: r.analyte, value: r.value ?? r.value_text, unit: r.unit, via: 'lab extranet' }, stamp);
    }
    if (req && req.data.status !== 'DONE') {
      await patchRow(c, s.clinicId, 'test_requests', reqId, { status: 'DONE', updated_at: stamp }, req.versions, stamp, uid);
      await audit(c, s.clinicId, uid, 'test_requests', reqId, 'UPDATE', { status: [req.data.status, 'DONE'] }, stamp);
    }
    await saveFile(c, s.clinicId, attId, bytes);
    const notifications = await createLabNotifications(c, s.clinicId, {
      pet_id: String(p.pet.id), pet: p.pet.name, owner: p.owner.full_name, lab: s.user.lab_name || s.user.name, n: results.length, attachment_id: attId,
    });
    return { status: 200, body: { ok: true, attachment_id: attId, results: ids.length, request_done: !!req }, notifications };
  });
}

// ---------------------------------------------------------------- routes
/** Handles /lab…; returns false for anything else. `after` tells devices, owner pages and staff about an upload. */
export async function handleLab(pool, req, res, url, { afterUpload }) {
  const p = url.pathname;
  if (p !== '/lab' && !p.startsWith('/lab/')) return false;

  // The clinic's logo for the sign-in panel: the one in clinic settings, else the logo shipped with the app.
  if (req.method === 'GET' && p === '/lab/logo') {
    const st = (await pool.query("SELECT data->>'logo_url' AS logo FROM rows WHERE tbl = 'clinic_settings' AND NOT deleted ORDER BY seq DESC LIMIT 1")).rows[0];
    const m = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(st?.logo ?? '');
    const bytes = m ? Buffer.from(m[2], 'base64') : fs.readFileSync(path.join(here, '..', 'src', 'assets', 'clinic-logo.png'));
    res.writeHead(200, { 'Content-Type': m ? m[1] : 'image/png', 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' });
    res.end(bytes);
    return true;
  }
  if (req.method === 'GET' && (p === '/lab' || p === '/lab/')) {
    const csp = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self' data: blob:; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; object-src 'none'; frame-src 'self' blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...headers, 'Content-Security-Policy': csp });
    // The clinic's name, address and phone for the sign-in panel's footer (public details, as on the clinic's own page).
    const st = (await pool.query("SELECT data FROM rows WHERE tbl = 'clinic_settings' AND NOT deleted ORDER BY seq DESC LIMIT 1")).rows[0]?.data ?? {};
    const clinic = { name_en: st.name_en ?? 'Animal Care Clinic', name_ar: st.name_ar ?? 'عيادة رعاية الحيوان', address: st.address ?? null, phone: st.phone ?? null };
    res.end(labPageHtml(TEXT, LAB_TESTS, clinic));
    return true;
  }
  const own = /^\/lab\/(app\.mjs|parse\.mjs)$/.exec(p);
  const vend = /^\/lab\/vendor\/(.+)$/.exec(p);
  if (req.method === 'GET' && (own || vend)) {
    const file = own ? path.join(here, OWN[own[1]]) : vendorFile(vend[1]);
    if (!file || !fs.existsSync(file)) return json(res, 404, { error: 'not found' }), true;
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff',
      'Cache-Control': own ? 'no-cache' : 'public, max-age=604800',
    });
    fs.createReadStream(file).pipe(res);
    return true;
  }
  if (!p.startsWith('/lab/api/')) return json(res, 404, { error: 'not found' }), true;
  // Every POST must come from the page itself: a custom header (no other site can send one without CORS, which /lab
  // never allows) and, when the browser says where it comes from, our own host.
  if (req.method === 'POST') {
    const origin = req.headers.origin;
    if (req.headers['x-lab'] !== '1' || (origin && new URL(origin).host !== req.headers.host)) return json(res, 403, { error: 'forbidden' }), true;
  }

  if (p === '/lab/api/login' && req.method === 'POST') {
    const ip = ipOf(req);
    const { email, password } = await readJson(req, 10_000);
    const mail = clean(email, 120).toLowerCase();
    if (blocked(`ip:${ip}`, `u:${mail}`)) return json(res, 429, { error: 'too_many' }), true;
    const u = mail && typeof password === 'string'
      ? (await pool.query("SELECT clinic_id, id, data, versions FROM rows WHERE tbl = 'users' AND lower(data->>'email') = $1 AND NOT deleted LIMIT 1", [mail])).rows[0]
      : null;
    if (!u || u.data.role !== 'LAB' || !Number(u.data.is_active) || !bcrypt.compareSync(password, String(u.data.password_hash))) {
      failed(`ip:${ip}`, `u:${mail}`);
      return json(res, 401, { error: 'wrong' }), true;
    }
    const token = crypto.randomBytes(32).toString('base64url');
    await pool.query('INSERT INTO lab_sessions (token_hash, clinic_id, user_id, pw) VALUES ($1, $2, $3, $4)', [sha256(token), u.clinic_id, u.id, sha256(String(u.data.password_hash))]);
    await inTx(pool, async (c) => {
      await numberingLock(c, u.clinic_id);
      await audit(c, u.clinic_id, u.id, 'users', u.id, 'LOGIN', { via: 'lab extranet' }, new Date().toISOString());
    });
    json(res, 200, { user: me(u.data) }, {
      'Set-Cookie': `${COOKIE}=${token}; Path=/lab; HttpOnly; SameSite=Strict; Max-Age=${IDLE_HOURS * 3600}${secure(req) ? '; Secure' : ''}`,
    });
    return true;
  }

  const s = await session(pool, req);
  if (!s) return json(res, 401, { error: 'signed_out' }), true;
  if (p === '/lab/api/logout' && req.method === 'POST') {
    await pool.query('DELETE FROM lab_sessions WHERE token_hash = $1', [s.tokenHash]);
    return json(res, 200, { ok: true }, { 'Set-Cookie': `${COOKIE}=; Path=/lab; HttpOnly; SameSite=Strict; Max-Age=0` }), true;
  }
  if (p === '/lab/api/me' && req.method === 'GET') return json(res, 200, { user: me(s.user) }), true;
  if (p === '/lab/api/password' && req.method === 'POST') {
    const { current, password } = await readJson(req, 10_000);
    if (typeof password !== 'string' || password.length < 8 || password.length > 200) return json(res, 400, { error: 'short' }), true;
    if (typeof current !== 'string' || !bcrypt.compareSync(current, String(s.user.password_hash))) return json(res, 400, { error: 'current' }), true;
    if (current === password) return json(res, 400, { error: 'same' }), true;
    const hash = bcrypt.hashSync(password, 10);
    await inTx(pool, async (c) => {
      await numberingLock(c, s.clinicId);
      const stamp = new Date().toISOString();
      await patchRow(c, s.clinicId, 'users', String(s.user.id), { password_hash: hash, must_change_password: 0, updated_at: stamp }, s.versions, stamp, String(s.user.id));
      await audit(c, s.clinicId, String(s.user.id), 'users', String(s.user.id), 'UPDATE', { password_hash: '***', via: 'lab extranet' }, stamp);
      // Other browsers of this lab account are signed out; this one carries on.
      await c.query('DELETE FROM lab_sessions WHERE user_id = $1 AND token_hash <> $2', [String(s.user.id), s.tokenHash]);
      await c.query('UPDATE lab_sessions SET pw = $2 WHERE token_hash = $1', [s.tokenHash, sha256(hash)]);
    });
    afterUpload(s.clinicId, []);
    return json(res, 200, { user: { ...me(s.user), must_change_password: false } }), true;
  }
  // Until the temporary password is replaced, nothing else.
  if (Number(s.user.must_change_password)) return json(res, 403, { error: 'change_password' }), true;

  if (p === '/lab/api/home' && req.method === 'GET') return json(res, 200, await home(pool, s)), true;
  if (p === '/lab/api/search' && req.method === 'GET') return json(res, 200, await search(pool, s, url.searchParams.get('q'))), true;
  const pm = /^\/lab\/api\/pet\/([A-Za-z0-9-]{8,64})$/.exec(p);
  if (pm && req.method === 'GET') {
    const d = await petDetail(pool, s, pm[1]);
    return d ? json(res, 200, d) : json(res, 404, { error: 'not found' }), true;
  }
  const fm = /^\/lab\/api\/file\/([A-Za-z0-9-]{8,64})$/.exec(p);
  if (fm && req.method === 'GET') {
    const a = (await pool.query("SELECT data FROM rows WHERE clinic_id = $1 AND tbl = 'attachments' AND id = $2 AND NOT deleted", [s.clinicId, fm[1]])).rows[0]?.data;
    const ok = a && a.kind === 'LAB' && (await activePet(pool, s.clinicId, a.pet_id));
    const bytes = ok ? fileBytes(s.clinicId, fm[1]) : null;
    if (!bytes) return json(res, 404, { error: 'not found' }), true;
    const type = MIMES[a.mime_type] ? a.mime_type : 'application/octet-stream';
    const dl = url.searchParams.get('download') === '1';
    res.writeHead(200, {
      'Content-Type': type, 'Content-Length': bytes.length, ...headers, 'Cache-Control': 'private, no-store',
      'Content-Disposition': `${dl ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(a.file_name)}`,
      'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
    });
    res.end(bytes);
    return true;
  }
  if (p === '/lab/api/upload' && req.method === 'POST') {
    const input = await readJson(req, Math.ceil(MAX_FILE * 1.4) + 200_000);
    const r = await upload(pool, s, input);
    if (r.status === 200) afterUpload(s.clinicId, r.notifications ?? [], r.body.attachment_id);
    return json(res, r.status, r.body), true;
  }
  return json(res, 404, { error: 'not found' }), true;
}
