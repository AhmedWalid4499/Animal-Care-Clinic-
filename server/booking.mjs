// Public booking page (change request, 25 Nov 2026). People with no account pick a free slot at /book; the
// booking is stored as a guest appointment with status REQUESTED and every staff member is notified. Staff
// accept it (→ SCHEDULED) or decline it (→ deleted) in the app. Nothing here needs a sign-in, so nothing here
// reveals who else is booked: the page only learns which times are free.
import crypto from 'node:crypto';
import { inTx } from './db.mjs';
import { createNotifications } from './notify.mjs';

const TZ = process.env.CLINIC_TZ || 'Africa/Cairo';
// Same hours as the calendar in the app (src/screens/Appointments.tsx): slots from 9:00, the last one at 21:40.
const OPEN_HOUR = 9;
const CLOSE_HOUR = 22;
const SLOT_MIN = 20;
const DAYS_AHEAD = 30;
const LEAD_MIN = 60; // the earliest slot offered is at least an hour from now
const MAX_PENDING_PER_PHONE = 2;
const MAX_PENDING_TOTAL = 60; // a flood of fake requests can't bury the calendar
export const PUBLIC_TYPES = ['CHECKUP', 'VACCINATION', 'FOLLOW_UP', 'OTHER'];
const SPECIES = ['DOG', 'CAT', 'BIRD', 'RABBIT', 'REPTILE', 'OTHER'];

// ---------------------------------------------------------------- clinic time zone
const partsFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
function tzOffset(ms) {
  const p = Object.fromEntries(partsFmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000;
}
/** Wall-clock time at the clinic → UTC milliseconds (summer time included). */
export function clinicTimeToUtc(date, hh, mm) {
  const [y, m, d] = date.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const first = guess - tzOffset(guess);
  return guess - tzOffset(first);
}
export const clinicToday = (ms = Date.now()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
const validDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

// ---------------------------------------------------------------- abuse brakes (per internet address)
const hits = new Map(); // `${kind}|${ip}` -> timestamps
function limited(kind, ip, max, windowMs) {
  const key = `${kind}|${ip}`;
  const now = Date.now();
  const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (list.length >= max) {
    hits.set(key, list);
    return true;
  }
  list.push(now);
  hits.set(key, list);
  return false;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, list] of hits) if (!list.some((t) => now - t < 24 * 3_600_000)) hits.delete(k);
}, 3_600_000).unref();

// ---------------------------------------------------------------- data
async function clinicAndSettings(pool) {
  const clinic = (await pool.query('SELECT id FROM clinics ORDER BY created_at LIMIT 1')).rows[0];
  if (!clinic) return { clinicId: null, settings: {} };
  const s = (await pool.query("SELECT data FROM rows WHERE clinic_id = $1 AND tbl = 'clinic_settings' AND NOT deleted ORDER BY id LIMIT 1", [clinic.id])).rows[0];
  return { clinicId: clinic.id, settings: s?.data ?? {} };
}

/** Appointments that hold a time (scheduled, or requested and not answered yet) around one clinic day. */
async function busy(c, clinicId, date) {
  const from = new Date(clinicTimeToUtc(date, 0, 0) - 12 * 3_600_000).toISOString();
  const to = new Date(clinicTimeToUtc(date, 0, 0) + 36 * 3_600_000).toISOString();
  const r = await c.query(
    `SELECT data->>'scheduled_at' AS at, data->>'duration_min' AS dur FROM rows
      WHERE clinic_id = $1 AND tbl = 'appointments' AND NOT deleted AND data->>'status' IN ('SCHEDULED','REQUESTED')
        AND data->>'scheduled_at' >= $2 AND data->>'scheduled_at' < $3`,
    [clinicId, from, to],
  );
  return r.rows.map((x) => {
    const s = Date.parse(x.at);
    return [s, s + (Number(x.dur) || SLOT_MIN) * 60_000];
  }).filter(([s]) => Number.isFinite(s));
}

/** Free slot times ('HH:MM', clinic time) on one day. */
async function slotsFor(c, clinicId, date, now = Date.now()) {
  const taken = await busy(c, clinicId, date);
  const out = [];
  for (let m = OPEN_HOUR * 60; m + SLOT_MIN <= CLOSE_HOUR * 60; m += SLOT_MIN) {
    const hh = Math.floor(m / 60);
    const mm = m % 60;
    const s = clinicTimeToUtc(date, hh, mm);
    const e = s + SLOT_MIN * 60_000;
    if (s < now + LEAD_MIN * 60_000) continue;
    if (taken.some(([bs, be]) => bs < e && be > s)) continue;
    out.push(`${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`);
  }
  return out;
}

const digits = (s) => String(s ?? '').replace(/\D/g, '');
// Text from strangers: no control characters, trimmed, capped.
const clean = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');

// ---------------------------------------------------------------- routes
// The address the proxy in front of us saw (the last X-Forwarded-For entry): earlier entries are whatever the
// visitor chose to send, so they can't be used to dodge the brakes.
const ipOf = (req) => req.headers['x-forwarded-for']?.split(',').pop().trim() || req.socket.remoteAddress || '';

/**
 * Handle /api/public/*. Returns true if it answered. `after(clinicId, notifications)` tells open apps and
 * phones about a new request.
 */
export async function publicApi(pool, req, res, url, { send, readJson, after }) {
  const p = url.pathname;
  if (!p.startsWith('/api/public/')) return false;
  const ip = ipOf(req);

  if (p === '/api/public/booking' && req.method === 'GET') {
    if (limited('info', ip, 120, 60_000)) return send(res, 429, { error: 'busy' }), true;
    const { settings } = await clinicAndSettings(pool);
    const logo = typeof settings.logo_url === 'string' && settings.logo_url.length < 300_000 ? settings.logo_url : null;
    const today = clinicToday();
    send(res, 200, {
      enabled: Number(settings.online_booking) === 1,
      name_en: settings.name_en ?? 'Animal Care Clinic', name_ar: settings.name_ar ?? '', phone: settings.phone ?? null,
      whatsapp: settings.whatsapp ?? null, address: settings.address ?? null, logo,
      today, last: addDays(today, DAYS_AHEAD), types: PUBLIC_TYPES, species: SPECIES, slot_min: SLOT_MIN,
    });
    return true;
  }

  if (p === '/api/public/slots' && req.method === 'GET') {
    if (limited('slots', ip, 60, 60_000)) return send(res, 429, { error: 'busy' }), true;
    const { clinicId, settings } = await clinicAndSettings(pool);
    if (!clinicId || Number(settings.online_booking) !== 1) return send(res, 403, { error: 'closed' }), true;
    const date = url.searchParams.get('date');
    const today = clinicToday();
    if (!validDate(date) || date < today || date > addDays(today, DAYS_AHEAD)) return send(res, 400, { error: 'date' }), true;
    send(res, 200, { date, slots: await slotsFor(pool, clinicId, date) });
    return true;
  }

  if (p === '/api/public/book' && req.method === 'POST') {
    const b = await readJson(req);
    // Bots fill every field, people never see this one: pretend it worked and store nothing.
    if (b && typeof b.website === 'string' && b.website.trim()) return send(res, 200, { ok: true }), true;
    if (limited('book', ip, 8, 3_600_000) || limited('book-day', ip, 20, 24 * 3_600_000)) return send(res, 429, { error: 'too_many' }), true;
    const { clinicId, settings } = await clinicAndSettings(pool);
    if (!clinicId || Number(settings.online_booking) !== 1) return send(res, 403, { error: 'closed' }), true;

    const name = clean(b?.name, 80);
    const phone = clean(b?.phone, 25);
    const petName = clean(b?.pet_name, 60);
    const notes = clean(b?.notes, 300);
    const species = SPECIES.includes(b?.species) ? b.species : null;
    const type = PUBLIC_TYPES.includes(b?.type) ? b.type : 'CHECKUP';
    const date = b?.date;
    const time = typeof b?.time === 'string' && /^\d{2}:\d{2}$/.test(b.time) ? b.time : null;
    const today = clinicToday();
    if (name.length < 2) return send(res, 400, { error: 'name' }), true;
    if (digits(phone).length < 8 || digits(phone).length > 15) return send(res, 400, { error: 'phone' }), true;
    if (!validDate(date) || date < today || date > addDays(today, DAYS_AHEAD) || !time) return send(res, 400, { error: 'slot' }), true;

    const r = await inTx(pool, async (c) => {
      // One booking at a time per clinic, so two people can't take the same slot.
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`booking:${clinicId}`]);
      const [hh, mm] = time.split(':').map(Number);
      const onGrid = hh * 60 + mm >= OPEN_HOUR * 60 && hh * 60 + mm + SLOT_MIN <= CLOSE_HOUR * 60 && mm % SLOT_MIN === 0;
      if (!onGrid) return { status: 400, body: { error: 'slot' } };
      if (!(await slotsFor(c, clinicId, date)).includes(time)) return { status: 409, body: { error: 'taken' } };
      const pending = (await c.query(
        `SELECT data->>'guest_phone' AS ph FROM rows WHERE clinic_id = $1 AND tbl = 'appointments' AND NOT deleted
           AND data->>'status' IN ('REQUESTED','SCHEDULED') AND data->>'pet_id' IS NULL AND data->>'scheduled_at' >= $2`,
        [clinicId, new Date().toISOString()],
      )).rows;
      const key = digits(phone).slice(-9);
      if (pending.filter((x) => digits(x.ph).slice(-9) === key).length >= MAX_PENDING_PER_PHONE) return { status: 409, body: { error: 'phone_limit' } };
      const waiting = Number((await c.query("SELECT COUNT(*) n FROM rows WHERE clinic_id = $1 AND tbl = 'appointments' AND NOT deleted AND data->>'status' = 'REQUESTED'", [clinicId])).rows[0].n);
      if (waiting >= MAX_PENDING_TOTAL) return { status: 503, body: { error: 'full' } };

      const now = new Date().toISOString();
      const id = crypto.randomUUID();
      const data = {
        id, pet_id: null, owner_id: null, scheduled_at: new Date(clinicTimeToUtc(date, hh, mm)).toISOString(), duration_min: SLOT_MIN, type,
        status: 'REQUESTED', notes: notes || null, visit_id: null, reminder_sent_at: null,
        guest_name: name, guest_phone: phone, guest_pet_name: petName || null, guest_species: species, source: 'ONLINE', created_at: now, updated_at: now,
      };
      const versions = Object.fromEntries(Object.keys(data).map((k) => [k, `${now}|server|`]));
      const seq = Number((await c.query("SELECT nextval('change_seq') AS s")).rows[0].s);
      await c.query("INSERT INTO rows (clinic_id, tbl, id, data, versions, deleted, seq) VALUES ($1, 'appointments', $2, $3, $4, false, $5)", [clinicId, id, data, versions, seq]);
      const notifications = await createNotifications(c, clinicId, { id: '', name: 'Online booking' }, [{ tbl: 'appointments', id, isNew: true, before: null, after: data, cols: data }], []);
      return { status: 200, body: { ok: true, at: data.scheduled_at }, seq, notifications };
    });
    if (r.seq) after(clinicId, r.seq, r.notifications);
    send(res, r.status, r.body);
    return true;
  }
  send(res, 404, { error: 'not found' });
  return true;
}
