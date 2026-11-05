// Notifications (docs/CLOUD-PLAN.md, Phase 3). Accepted changes become notifications for the other users of the
// clinic: stored per user (the bell), pinged over the WebSocket (open apps, desktop apps in the tray), and sent
// as Web Push to browsers/phones even when the app is closed.
import crypto from 'node:crypto';
import webpush from 'web-push';

export const KINDS = ['appointment', 'visit', 'payment', 'conflict', 'queue'];

// ---------------------------------------------------------------- what happened → notifications
/**
 * @param {import('pg').PoolClient} c
 * @param {string} clinicId
 * @param {{id:string,name:string}} actor
 * @param {{tbl:string,id:string,isNew:boolean,before:object|null,after:object,cols:object}[]} events accepted changes
 * @param {{tbl:string,id:string,col:string,otherUser:string,actorWon:boolean,after:object}[]} conflicts
 */
export async function createNotifications(c, clinicId, actor, events, conflicts, { seenSeq = null, firstSeq = 0 } = {}) {
  const users = (await c.query(
    "SELECT id, data->>'locale' AS locale, data->>'role' AS role, COALESCE(data->>'notify_off', '') AS off FROM rows WHERE clinic_id = $1 AND tbl = 'users' AND NOT deleted AND (data->>'is_active')::int = 1",
    [clinicId],
  )).rows;
  const byId = new Map(users.map((u) => [u.id, u]));
  const wants = (u, kind) => !u.off.split(',').map((s) => s.trim()).includes(kind);
  const petCache = new Map();
  async function pet(petId) {
    if (!petId) return {};
    if (!petCache.has(petId)) {
      const r = (await c.query(
        "SELECT p.data->>'name' AS pet, o.data->>'full_name' AS owner FROM rows p LEFT JOIN rows o ON o.clinic_id = p.clinic_id AND o.tbl = 'owners' AND o.id = p.data->>'owner_id' WHERE p.clinic_id = $1 AND p.tbl = 'pets' AND p.id = $2",
        [clinicId, petId],
      )).rows[0];
      petCache.set(petId, r ?? {});
    }
    return petCache.get(petId);
  }

  const out = [];
  const add = (userId, kind, event, data) => {
    const u = byId.get(userId);
    if (!u || !wants(u, kind)) return;
    out.push({ id: crypto.randomUUID(), user_id: userId, locale: u.locale || 'ar', kind, event, data: { ...data, by: actor.name } });
  };
  const everyoneElse = (kind, event, data) => users.forEach((u) => u.id !== actor.id && add(u.id, kind, event, data));

  for (const e of events) {
    const a = e.after;
    if (e.tbl === 'appointments') {
      const base = { appointment_id: e.id, pet_id: a.pet_id, at: a.scheduled_at, type: a.type, ...(await pet(a.pet_id)) };
      const placed = e.isNew || ('scheduled_at' in e.cols && e.before?.scheduled_at !== a.scheduled_at);
      if (e.isNew) everyoneElse('appointment', 'booked', base);
      else if ('scheduled_at' in e.cols && e.before?.scheduled_at !== a.scheduled_at) everyoneElse('appointment', 'moved', { ...base, from: e.before?.scheduled_at });
      else if ('status' in e.cols && e.before?.status !== a.status) everyoneElse('appointment', String(a.status).toLowerCase(), base);
      // Double booking that no device could warn about (booked on two devices without a connection): the other
      // booking reached the server after this device last synced. Tell both people.
      if (placed && a.status === 'SCHEDULED' && seenSeq !== null && a.scheduled_at) {
        for (const o of await unseenOverlaps(c, clinicId, e.id, a, seenSeq, firstSeq)) {
          const other = { ...(await pet(o.data.pet_id)) };
          add(actor.id, 'appointment', 'overlap', { ...base, other_pet: other.pet, other_at: o.data.scheduled_at, other_id: o.id });
          const booker = stampUser(o.versions?.scheduled_at);
          if (booker && booker !== actor.id) add(booker, 'appointment', 'overlap', { appointment_id: o.id, pet_id: o.data.pet_id, at: o.data.scheduled_at, ...other, other_pet: base.pet, other_at: a.scheduled_at, other_id: e.id });
        }
      }
    } else if (e.tbl === 'visits') {
      // Pre-diagnosis (Phase 5): a patient joins the vet's queue → tell the vets (Admins and Doctors).
      const stage = a.stage ?? 'DONE'; // devices older than schema v4 send no stage
      const stageChanged = e.isNew || ('stage' in e.cols && (e.before?.stage ?? 'DONE') !== stage);
      if (stage === 'WAITING' && stageChanged) {
        const data = { visit_id: e.id, pet_id: a.pet_id, urgency: a.urgency, complaint: a.complaint ?? '', ...(await pet(a.pet_id)) };
        users.forEach((u) => u.id !== actor.id && (u.role === 'ADMIN' || u.role === 'DOCTOR') && add(u.id, 'queue', a.urgency === 'EMERGENCY' ? 'emergency' : 'waiting', data));
      } else if (stage === 'DONE' && stageChanged && (await hasAppointmentToday(c, clinicId, a.pet_id))) {
        // A finished visit, only for a pet booked today (the front desk is waiting for it); others would be noise.
        everyoneElse('visit', 'recorded', { visit_id: e.id, pet_id: a.pet_id, type: a.type, ...(await pet(a.pet_id)) });
      }
    } else if (e.tbl === 'payments' && e.isNew) {
      const inv = (await c.query("SELECT data FROM rows WHERE clinic_id = $1 AND tbl = 'invoices' AND id = $2", [clinicId, a.invoice_id])).rows[0]?.data;
      const owner = inv ? (await c.query("SELECT data->>'full_name' AS n FROM rows WHERE clinic_id = $1 AND tbl = 'owners' AND id = $2", [clinicId, inv.owner_id])).rows[0]?.n : null;
      everyoneElse('payment', 'recorded', { invoice_id: a.invoice_id, amount: a.amount, method: a.method, number: inv?.number, owner });
    }
  }
  for (const k of conflicts) {
    const label = k.tbl === 'owners' ? k.after.full_name : k.tbl === 'pets' ? k.after.name : (await pet(k.after.pet_id)).pet;
    const data = { tbl: k.tbl, id: k.id, col: k.col, label, pet_id: k.tbl === 'pets' ? k.id : k.after.pet_id, owner_id: k.tbl === 'owners' ? k.id : undefined };
    if (k.actorWon) add(k.otherUser, 'conflict', 'replaced', data); // your earlier edit was replaced by the actor's
    else out.push({ id: crypto.randomUUID(), user_id: actor.id, locale: byId.get(actor.id)?.locale || 'ar', kind: 'conflict', event: 'kept', data: { ...data, by: (await nameOf(c, clinicId, k.otherUser)) } });
  }
  for (const n of out) {
    await c.query('INSERT INTO notifications (id, clinic_id, user_id, kind, event, data) VALUES ($1,$2,$3,$4,$5,$6)', [n.id, clinicId, n.user_id, n.kind, n.event, n.data]);
  }
  return out;
}

const stampUser = (s) => (s ? s.split('|')[2] || null : null);
/** Scheduled appointments overlapping `a` that arrived after `seenSeq` (not from this same push). */
async function unseenOverlaps(c, clinicId, id, a, seenSeq, firstSeq) {
  const start = new Date(a.scheduled_at);
  if (Number.isNaN(start.getTime())) return [];
  const end = new Date(start.getTime() + Number(a.duration_min || 20) * 60_000);
  return (await c.query(
    `SELECT id, data, versions FROM rows WHERE clinic_id = $1 AND tbl = 'appointments' AND NOT deleted AND id <> $2
       AND data->>'status' = 'SCHEDULED' AND seq > $3 AND ($6 = 0 OR seq < $6)
       AND (data->>'scheduled_at')::timestamptz < $5
       AND (data->>'scheduled_at')::timestamptz + make_interval(mins => COALESCE(NULLIF(data->>'duration_min', '')::int, 20)) > $4`,
    [clinicId, id, seenSeq, start.toISOString(), end.toISOString(), firstSeq],
  )).rows;
}

async function hasAppointmentToday(c, clinicId, petId) {
  const r = await c.query(
    `SELECT 1 FROM rows WHERE clinic_id = $1 AND tbl = 'appointments' AND NOT deleted AND data->>'pet_id' = $2
       AND data->>'status' <> 'CANCELLED'
       AND ((data->>'scheduled_at')::timestamptz AT TIME ZONE 'Africa/Cairo')::date = (now() AT TIME ZONE 'Africa/Cairo')::date LIMIT 1`,
    [clinicId, petId],
  );
  return r.rowCount > 0;
}

async function nameOf(c, clinicId, userId) {
  return (await c.query("SELECT data->>'name' AS n FROM rows WHERE clinic_id = $1 AND tbl = 'users' AND id = $2", [clinicId, userId])).rows[0]?.n ?? '';
}

// ---------------------------------------------------------------- push text (the app renders its own from i18n)
const T = {
  en: {
    title: { appointment: 'Appointment', visit: 'Visit', payment: 'Payment', conflict: 'Edit replaced', queue: 'Waiting for the vet' },
    queue: { waiting: '{by} sent {pet} ({owner}) to the vet: {complaint}', emergency: '🚨 Emergency: {pet} ({owner}) is waiting for the vet: {complaint}' },
    appointment: {
      booked: '{by} booked {pet} ({owner}) for {at}',
      moved: '{by} moved {pet}’s appointment to {at}',
      cancelled: '{by} cancelled {pet}’s appointment ({at})',
      no_show: '{pet} was marked no-show ({at})',
      done: '{by} marked {pet}’s appointment done',
      scheduled: '{by} reopened {pet}’s appointment ({at})',
      overlap: 'Double booking: {pet} ({at}) overlaps {other_pet} ({other_at}); they were booked on two devices without a connection',
    },
    visit: { recorded: '{by} recorded a visit for {pet} ({owner})' },
    payment: { recorded: '{by} recorded a payment of {amount} for {owner} ({number})' },
    conflict: { replaced: '{by} changed {label} after you; your edit was replaced', kept: 'Your change to {label} was not applied: {by} changed it later' },
  },
  ar: {
    title: { appointment: 'موعد', visit: 'زيارة', payment: 'دفعة', conflict: 'تعديل استُبدل', queue: 'في انتظار الطبيب' },
    queue: { waiting: '{by} أرسل {pet} ({owner}) إلى الطبيب: {complaint}', emergency: '🚨 حالة طارئة: {pet} ({owner}) في انتظار الطبيب: {complaint}' },
    appointment: {
      booked: '{by} حجز موعداً لـ {pet} ({owner}) يوم {at}',
      moved: '{by} غيّر موعد {pet} إلى {at}',
      cancelled: '{by} ألغى موعد {pet} ({at})',
      no_show: '{pet} لم يحضر موعده ({at})',
      done: '{by} أنهى موعد {pet}',
      scheduled: '{by} أعاد فتح موعد {pet} ({at})',
      overlap: 'حجز مزدوج: {pet} ({at}) يتداخل مع {other_pet} ({other_at})؛ حُجزا على جهازين دون اتصال',
    },
    visit: { recorded: '{by} سجّل زيارة لـ {pet} ({owner})' },
    payment: { recorded: '{by} سجّل دفعة {amount} من {owner} ({number})' },
    conflict: { replaced: '{by} عدّل {label} بعدك، فاستُبدل تعديلك', kept: 'لم يُحفظ تعديلك على {label}: {by} عدّله لاحقاً' },
  },
};
const TZ = 'Africa/Cairo';
function fmtWhen(iso, locale) {
  if (!iso) return '';
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}
function cairoDate(iso) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}
export function urlFor(n) {
  const d = n.data;
  if (n.kind === 'appointment') return `/#/appointments?view=day&date=${d.at ? cairoDate(d.at) : ''}&open=${d.appointment_id}`;
  if (n.kind === 'visit') return `/#/pets/${d.pet_id}`;
  if (n.kind === 'payment') return `/#/invoices/${d.invoice_id}`;
  if (n.kind === 'queue') return '/#/';
  if (n.kind === 'conflict') return d.tbl === 'appointments' ? `/#/appointments?open=${d.id}` : d.owner_id ? `/#/owners/${d.owner_id}` : d.pet_id ? `/#/pets/${d.pet_id}` : '/#/';
  return '/#/';
}
export function pushText(n) {
  const L = T[n.locale === 'en' ? 'en' : 'ar'];
  const tpl = L[n.kind]?.[n.event] ?? '';
  const amount = n.data.amount != null ? new Intl.NumberFormat(n.locale === 'en' ? 'en-GB' : 'ar-EG-u-nu-latn', { style: 'currency', currency: 'EGP' }).format(Number(n.data.amount) / 100) : '';
  const vars = { ...n.data, at: fmtWhen(n.data.at, n.locale), other_at: fmtWhen(n.data.other_at, n.locale), amount, label: n.data.label ?? '' };
  const body = tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? '') + '').replace(/\(\s*\)/g, '').replace(/[:：]\s*$/, '').trim();
  return { title: L.title[n.kind] ?? 'Animal Care Clinic', body, url: urlFor(n), tag: n.id, id: n.id };
}

// ---------------------------------------------------------------- Web Push
export async function setupPush(pool) {
  let pub = (await pool.query("SELECT value FROM server_meta WHERE key = 'vapid_public'")).rows[0]?.value;
  let priv = (await pool.query("SELECT value FROM server_meta WHERE key = 'vapid_private'")).rows[0]?.value;
  if (!pub || !priv) {
    const k = webpush.generateVAPIDKeys();
    pub = k.publicKey;
    priv = k.privateKey;
    await pool.query("INSERT INTO server_meta (key, value) VALUES ('vapid_public', $1), ('vapid_private', $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [pub, priv]);
  }
  webpush.setVapidDetails(`mailto:${process.env.ADMIN_EMAIL || 'admin@animal-care-clinic.local'}`, pub, priv);
  return pub;
}

/** Send each notification to its user's browsers/phones. Dead subscriptions are removed. */
export async function sendPush(pool, notifications) {
  for (const n of notifications) {
    const subs = (await pool.query('SELECT endpoint, keys FROM push_subscriptions WHERE user_id = $1', [n.user_id])).rows;
    for (const s of subs) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify(pushText(n)), { TTL: 24 * 3600 });
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [s.endpoint]);
        else console.warn('push failed', e.statusCode ?? e.message);
      }
    }
  }
}
