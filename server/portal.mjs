// The owner's page (Phase 6, docs/CLOUD-PLAN.md). Each owner can have a private link, printed as a QR code:
//   GET /o/<token>                 the page (server/portal-page.mjs: Arabic / English, phone first, prints cleanly)
//   GET /o/<token>/manifest.webmanifest   so the owner can add the page to their home screen
//   GET /o/<token>/data            what the page shows, as JSON
//   GET /o/<token>/live            Server-Sent Events: "changed" whenever the clinic's records change
//   GET /o/<token>/calendar.ics    calendar feed: upcoming appointments + vaccination due dates (subscribe once)
//   GET /o/<token>/a/<id>.ics      one appointment, for "add to calendar"
// The token (owners.portal_token, 128 random bits, made on a clinic device) is the only key: no owner login.
// Staff can replace it (old QR stops working) or switch it off. Only what an owner should see leaves the server:
// diagnoses (Dr. Waleed, 14 Nov), never staff notes, treatment notes, national ID, money, or other owners' data.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pageHtml } from './portal-page.mjs';
import { fileBytes } from './files.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const TOKEN = /^[A-Za-z0-9_-]{20,64}$/;
const TZ = 'Africa/Cairo';

// UI text lives in src/i18n (CLAUDE.md: never hard-code UI text); the page gets the parts it needs.
function loadText() {
  // Lab test names stay in English, as on the clinic's request sheet (src/lib/lab-tests.json).
  const labTests = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(here, '..', 'src', 'lib', 'lab-tests.json'), 'utf8')).groups
    .flatMap((g) => g.tests.map((x) => [x.key, x.label])));
  const pick = (d) => ({
    ...d.portal.page, species: d.species, sex: d.sex, visitType: d.visitType, petStatus: d.petStatus, ageValue: d.pets.ageValue,
    xray: { region: d.xray.region, view: d.xray.view, opt: d.xray.opt, left: d.xray.left, right: d.xray.right, title: d.xray.title },
    labReq: { title: d.labReq.title }, labTests,
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

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
function labDays(rows) {
  const days = new Map();
  for (const r of [...rows].sort((a, b) => byText('taken_at')(b, a) || byText('panel')(a, b) || byText('created_at')(a, b))) {
    const key = String(r.taken_at);
    if (!days.has(key)) days.set(key, { date: key, items: [] });
    const value = num(r.value);
    const lo = num(r.ref_low);
    const hi = num(r.ref_high);
    days.get(key).items.push({
      panel: r.panel ?? null, analyte: r.analyte, value, value_text: r.value_text ?? null, unit: r.unit ?? null, ref_low: lo, ref_high: hi,
      flag: value == null ? null : hi != null && value > hi ? 'H' : lo != null && value < lo ? 'L' : null,
    });
  }
  return [...days.values()];
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
  const [visitsAll, vaccinations, appointments, labRows, requestRows, files] = await Promise.all([
    forPets('visits', petIds), forPets('vaccinations', petIds), forPets('appointments', petIds), forPets('lab_results', petIds),
    forPets('test_requests', petIds), forPets('attachments', petIds),
  ]);
  // Lost & found (schema v18): someone scanned one of this owner's collar tags and pressed Alert; shown until the clinic
  // marks it handled (and for 30 days at most).
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  const found = petIds.length
    ? (await pool.query("SELECT data FROM rows WHERE clinic_id = $1 AND tbl = 'found_reports' AND NOT deleted AND data->>'pet_id' = ANY($2::text[]) AND data->>'status' = 'NEW' AND data->>'reported_at' > $3", [cid, petIds, since])).rows.map((r) => r.data)
    : [];
  // X-ray images and lab result files whose bytes are on the server's volume (one still on the laptop that added it waits
  // for its upload). Other files (documents, photos) stay with the clinic.
  const xrayFiles = files.filter((a) => a.kind === 'XRAY' || a.kind === 'LAB');
  const onServer = new Set(xrayFiles.length
    ? (await pool.query('SELECT id FROM files WHERE clinic_id = $1 AND id = ANY($2::text[])', [cid, xrayFiles.map((a) => String(a.id))])).rows.map((r) => r.id)
    : []);
  // A visit still in the vet's queue isn't finished: its prescriptions appear once the vet saves it.
  const visits = visitsAll.filter((v) => (v.stage ?? 'DONE') === 'DONE');
  const visitIds = visits.map((v) => String(v.id));
  const rx = visitIds.length
    ? await rows("SELECT data FROM rows WHERE clinic_id = $1 AND tbl = 'prescriptions' AND data->>'visit_id' = ANY($2::text[]) AND NOT deleted", [cid, visitIds])
    : [];
  const vaccineTypes = new Map((await rows("SELECT data FROM rows WHERE clinic_id = $1 AND tbl = 'vaccine_types' AND NOT deleted", [cid])).map((t) => [String(t.id), t.name]));
  const vetIds = [...new Set([...visits.map((v) => v.vet_id), ...requestRows.map((r) => r.requested_by)].filter(Boolean).map(String))];
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
    owner: { code: typeof owner.data.code === 'string' && /^AC-\d+$/.test(owner.data.code) ? owner.data.code : null, full_name: owner.data.full_name, phone: owner.data.phone, whatsapp: owner.data.whatsapp ?? null, email: owner.data.email ?? null, address: owner.data.address ?? null },
    pets: [...pets].sort((a, b) => status(a) - status(b) || byText('name')(a, b)).map((p) => {
      const w = weightOf(String(p.id));
      return {
        id: String(p.id), name: p.name, species: p.species, breed: p.breed ?? null, sex: p.sex, is_neutered: Number(p.is_neutered) === 1,
        date_of_birth: p.date_of_birth ?? null, dob_is_estimate: Number(p.dob_is_estimate) === 1, color: p.color ?? null, microchip_no: p.microchip_no ?? null,
        photo: imageOnly(p.photo_url), status: p.status,
        weight: w ? { kg: Number(w.weight_kg), at: w.visited_at } : null,
        // Lab results by test day, newest first, flagged high / low against the range the clinic recorded.
        labs: labDays(labRows.filter((r) => String(r.pet_id) === String(p.id))),
        tag: !!p.tag_token,
        weights: visits.filter((v) => String(v.pet_id) === String(p.id) && v.weight_kg != null).sort(byText('visited_at')).map((v) => ({ at: v.visited_at, kg: Number(v.weight_kg) })),
        // Finished visits with what the vet found (diagnosis only: complaint and treatment notes stay with the clinic).
        visits: visits.filter((v) => String(v.pet_id) === String(p.id)).sort((a, b) => byText('visited_at')(b, a))
          .map((v) => ({ visited_at: v.visited_at, type: v.type, diagnosis: v.diagnosis ?? null, vet_name: v.vet_id ? vets.get(String(v.vet_id)) ?? null : null })),
        vaccinations: [...latest.values()].filter((x) => String(x.pet_id) === String(p.id))
          .map((x) => ({ name: vaccineTypes.get(String(x.vaccine_type_id)) ?? '—', administered_at: x.administered_at, next_due_at: x.next_due_at ?? null }))
          .sort((a, b) => byText('next_due_at')(a, b)),
      };
    }),
    appointments: appointments
      .filter((a) => a.status === 'SCHEDULED' && Date.parse(a.scheduled_at) + (Number(a.duration_min) || 20) * 60_000 > now)
      .sort(byText('scheduled_at'))
      .map((a) => ({ id: String(a.id), pet_id: String(a.pet_id), pet_name: petName.get(String(a.pet_id)) ?? '', scheduled_at: a.scheduled_at, duration_min: Number(a.duration_min) || 20, type: a.type })),
    found: found.sort((a, b) => byText('reported_at')(b, a)).map((f) => ({
      id: String(f.id), pet_id: String(f.pet_id), pet_name: petName.get(String(f.pet_id)) ?? '', at: f.reported_at,
      lat: f.lat ?? null, lng: f.lng ?? null, accuracy_m: f.accuracy_m ?? null, finder_name: f.finder_name ?? null, finder_phone: f.finder_phone ?? null, message: f.message ?? null,
    })),
    // X-ray and lab requests the vet gave (cancelled ones left out), newest first; items are keys the page labels.
    requests: requestRows
      .filter((r) => r.status !== 'CANCELLED')
      .sort((a, b) => byText('requested_at')(b, a))
      .map((r) => ({
        id: String(r.id), pet_id: String(r.pet_id), pet_name: petName.get(String(r.pet_id)) ?? '', kind: r.kind, status: r.status, requested_at: r.requested_at,
        items: String(r.items ?? '').split(',').filter(Boolean), other: r.other ?? null, notes: r.notes ?? null,
        by: r.requested_by ? vets.get(String(r.requested_by)) ?? null : null,
      })),
    xrays: xrayFiles
      .filter((a) => onServer.has(String(a.id)))
      .sort((a, b) => byText('created_at')(b, a))
      .map((a) => ({
        id: String(a.id), pet_id: String(a.pet_id), pet_name: petName.get(String(a.pet_id)) ?? '', at: a.created_at, file_name: a.file_name, kind: a.kind,
        image: /^image\/(png|jpe?g|gif|webp|bmp)$/i.test(a.mime_type ?? '') || /\.(png|jpe?g|gif|webp|bmp)$/i.test(a.file_name ?? ''),
      })),
    prescriptions: visits
      .map((v) => ({
        visit_id: String(v.id), pet_id: String(v.pet_id), pet_name: petName.get(String(v.pet_id)) ?? '', visited_at: v.visited_at, type: v.type, diagnosis: v.diagnosis ?? null,
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
    // Phone, and directions to the clinic (the address is the event's location too).
    description: [[d.clinic.phone, d.clinic.whatsapp].filter(Boolean).filter((v, i, xs) => xs.indexOf(v) === i).join(' · '),
      d.clinic.address ? fill(T.directionsIcs, { url: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(d.clinic.address)}` }) : ''].filter(Boolean).join('\n'),
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
  const m = /^\/o\/([^/]+)(\/data|\/live|\/calendar\.ics|\/manifest\.webmanifest|\/a\/([^/]+)\.ics|\/f\/([^/]+))?\/?$/.exec(p);
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
    if (sub === '') return page(res, null, 404, null);
    return notFound(res);
  }
  if (sub === '') return page(res, owner, 200, token);
  if (sub === '/live') return live(req, res, owner);
  const d = await ownerPageData(pool, owner);
  // An X-ray image of one of this owner's pets (only those listed in their data), from the server's volume.
  if (sub.startsWith('/f/')) {
    const x = d.xrays.find((f) => f.id === decodeURIComponent(m[4]));
    const bytes = x ? fileBytes(owner.clinic_id, x.id) : null;
    if (!bytes) return notFound(res);
    const ext = (x.file_name.split('.').pop() || '').toLowerCase();
    const type = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', pdf: 'application/pdf' }[ext] ?? 'application/octet-stream';
    res.writeHead(200, { ...baseHeaders, 'Content-Type': type, 'Content-Length': bytes.length, 'Cache-Control': 'private, max-age=3600', 'Content-Disposition': `inline; filename="${encodeURIComponent(x.file_name)}"` });
    res.end(req.method === 'HEAD' ? undefined : bytes);
    return true;
  }
  if (sub === '/manifest.webmanifest') {
    const name = (d.clinic.locale === 'en' ? d.clinic.name_en : d.clinic.name_ar) || d.clinic.name_en || 'Animal Care Clinic';
    res.writeHead(200, { ...baseHeaders, 'Content-Type': 'application/manifest+json; charset=utf-8' });
    res.end(JSON.stringify({
      name, short_name: name.length > 12 ? name.split(' ').slice(0, 2).join(' ') : name, start_url: `/o/${token}`, scope: `/o/${token}`, display: 'standalone',
      background_color: '#f2f5f4', theme_color: '#2e6f73', dir: d.clinic.locale === 'en' ? 'ltr' : 'rtl', lang: d.clinic.locale,
      icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png' }],
    }));
    return true;
  }
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
function page(res, owner, status, token) {
  const nonce = crypto.randomBytes(16).toString('base64');
  res.writeHead(status, {
    ...baseHeaders,
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; img-src 'self' data:; font-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
  });
  // The manifest link carries the token (already checked against TOKEN), so "Add to Home Screen" opens this owner's page.
  const html = pageHtml({ nonce, text: json(TEXT), found: !!owner });
  res.end(owner ? html.replace('href="manifest.webmanifest"', `href="/o/${token}/manifest.webmanifest"`) : html.replace('<link rel="manifest" href="manifest.webmanifest">\n', ''));
  return true;
}
