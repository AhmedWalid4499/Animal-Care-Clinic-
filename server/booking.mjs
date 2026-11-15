// Online booking from the owner's page (15 Nov 2026, Ahmed: change request). The owner sees the clinic's opening
// times (src/lib/clinic-info.json → hours: Saturday to Wednesday, 5–10 PM, clinic time) for the next two weeks, each
// time only as free or booked (nothing about who), picks one for one of their pets and books it. The server checks the
// time again under a lock (two owners can't take the same time), writes the appointment like a device would, and the
// clinic is told (bell, tray, phones). Emergencies: the page asks to call Dr. Waleed instead.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inTx } from './db.mjs';
import { createOnlineBookingNotifications } from './notify.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const HOURS = JSON.parse(fs.readFileSync(path.join(here, '..', 'src', 'lib', 'clinic-info.json'), 'utf8')).hours;
const TZ = 'Africa/Cairo';
export const BOOKABLE_TYPES = ['CHECKUP', 'VACCINATION', 'FOLLOW_UP', 'OTHER'];

const fmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
function cairoParts(ms) {
  const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).filter((x) => x.type !== 'literal').map((x) => [x.type, Number(x.value)]));
  return { y: p.year, m: p.month, d: p.day, hh: p.hour % 24, mm: p.minute };
}
/** Minutes Cairo is ahead of UTC at that moment (2 or 3). */
function offsetMs(ms) {
  const p = cairoParts(ms);
  return Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm) - Math.floor(ms / 60_000) * 60_000;
}
/** A Cairo wall-clock time as a moment. */
function cairoToMs(y, m, d, hh, mm) {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let t = guess - offsetMs(guess);
  const again = guess - offsetMs(t);
  if (again !== t) t = again;
  return t;
}
const hm = (s) => s.split(':').map(Number);

/** Every bookable start time (ms) from now (plus the notice) for the next `daysAhead` days. */
export function openSlots(now = Date.now()) {
  const today = cairoParts(now);
  const [fh, fm] = hm(HOURS.from);
  const [th, tm] = hm(HOURS.to);
  const days = [];
  for (let i = 0; i < HOURS.daysAhead; i++) {
    const day = new Date(Date.UTC(today.y, today.m - 1, today.d + i));
    if (!HOURS.days.includes(day.getUTCDay())) continue;
    const y = day.getUTCFullYear();
    const m = day.getUTCMonth() + 1;
    const d = day.getUTCDate();
    const starts = [];
    for (let min = fh * 60 + fm; min + HOURS.slotMin <= th * 60 + tm; min += HOURS.slotMin) {
      const t = cairoToMs(y, m, d, Math.floor(min / 60), min % 60);
      if (t >= now + HOURS.minNoticeMin * 60_000) starts.push(t);
    }
    if (starts.length) days.push({ date: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, starts });
  }
  return days;
}

async function busy(q, clinicId, fromMs, toMs) {
  const rows = (await q.query(
    `SELECT data->>'scheduled_at' AS at, COALESCE((data->>'duration_min')::int, 20) AS dur FROM rows
     WHERE clinic_id = $1 AND tbl = 'appointments' AND NOT deleted AND data->>'status' = 'SCHEDULED'
       AND (data->>'scheduled_at')::timestamptz < $3::timestamptz AND (data->>'scheduled_at')::timestamptz > $2::timestamptz - interval '1 day'`,
    [clinicId, new Date(fromMs).toISOString(), new Date(toMs).toISOString()],
  )).rows;
  return rows.map((r) => [Date.parse(r.at), Date.parse(r.at) + r.dur * 60_000]).filter(([s]) => Number.isFinite(s));
}
const taken = (b, start) => b.some(([s, e]) => s < start + HOURS.slotMin * 60_000 && start < e);

/** The next two weeks' opening times, each free or booked (no names, no pets). */
export async function slotsFor(pool, clinicId, now = Date.now()) {
  const days = openSlots(now);
  if (!days.length) return { days: [], hours: publicHours() };
  const b = await busy(pool, clinicId, days[0].starts[0], days[days.length - 1].starts.at(-1) + HOURS.slotMin * 60_000);
  return {
    hours: publicHours(),
    days: days.map((d) => ({ date: d.date, slots: d.starts.map((s) => ({ at: new Date(s).toISOString(), free: !taken(b, s) })) })),
  };
}
const publicHours = () => ({ days: HOURS.days, from: HOURS.from, to: HOURS.to, slotMin: HOURS.slotMin });

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

/**
 * Book `at` for one of the owner's pets. Returns { status, body }: 200 booked, 400 not a bookable time / pet,
 * 409 just taken, 429 too many.
 */
export async function bookSlot(pool, owner, input, now = Date.now()) {
  const petId = String(input?.pet_id ?? '');
  const at = String(input?.at ?? '');
  const type = BOOKABLE_TYPES.includes(input?.type) ? input.type : 'CHECKUP';
  const note = typeof input?.note === 'string' ? input.note.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 300) : '';
  if (over(`book:${owner.id}`, 6, 3600_000)) return { status: 429, body: { error: 'too_many_tries' } };
  const pet = (await pool.query("SELECT id, data FROM rows WHERE clinic_id = $1 AND tbl = 'pets' AND id = $2 AND NOT deleted", [owner.clinic_id, petId])).rows[0];
  if (!pet || String(pet.data.owner_id) !== String(owner.id) || (pet.data.status ?? 'ACTIVE') !== 'ACTIVE') return { status: 400, body: { error: 'pet' } };
  const start = Date.parse(at);
  const allowed = openSlots(now).some((d) => d.starts.includes(start));
  if (!Number.isFinite(start) || !allowed) return { status: 400, body: { error: 'time' } };
  return inTx(pool, async (c) => {
    // One booking at a time per clinic, so the check below and the insert can't interleave with another owner's.
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`book:${owner.clinic_id}`]);
    const upcoming = Number((await c.query(
      `SELECT COUNT(*) n FROM rows WHERE clinic_id = $1 AND tbl = 'appointments' AND NOT deleted AND data->>'owner_id' = $2
         AND data->>'status' = 'SCHEDULED' AND (data->>'scheduled_at')::timestamptz > now() AND data->>'notes' LIKE '🌐%'`,
      [owner.clinic_id, String(owner.id)],
    )).rows[0].n);
    // At most a few upcoming online bookings per owner (appointments the clinic made don't count).
    if (upcoming >= HOURS.maxUpcoming) return { status: 429, body: { error: 'too_many', n: upcoming } };
    if (taken(await busy(c, owner.clinic_id, start, start + HOURS.slotMin * 60_000), start)) return { status: 409, body: { error: 'taken' } };
    const stamp = new Date(now).toISOString();
    const id = crypto.randomUUID();
    const data = {
      id, pet_id: String(pet.id), owner_id: String(owner.id), scheduled_at: new Date(start).toISOString(), duration_min: HOURS.slotMin, type,
      status: 'SCHEDULED', notes: `🌐 ${input?.label || 'Booked online by the owner'}${note ? `: ${note}` : ''}`, visit_id: null, reminder_sent_at: null,
      created_at: stamp, updated_at: stamp,
    };
    const versions = Object.fromEntries(Object.keys(data).map((k) => [k, `${stamp}|server`]));
    await c.query("INSERT INTO rows (clinic_id, tbl, id, data, versions, deleted, seq) VALUES ($1, 'appointments', $2, $3, $4, false, nextval('change_seq'))", [owner.clinic_id, id, data, versions]);
    const notifications = await createOnlineBookingNotifications(c, owner.clinic_id, {
      appointment_id: id, pet_id: String(pet.id), at: data.scheduled_at, type, pet: pet.data.name, owner: owner.data.full_name,
    });
    return { status: 200, body: { ok: true, appointment: { id, at: data.scheduled_at, pet: pet.data.name, type } }, notifications };
  });
}
