// Automatic WhatsApp reminders (16 Nov 2026, change request; SCOPE §5 lists the Business API as an add-on): the clinic
// server sends them itself through the WhatsApp Business Cloud API, once a day, even when every computer is off.
// Off until it is set up on Railway (docs/WHATSAPP-SETUP.md) and the Admin switches it on (Settings → WhatsApp):
//   WHATSAPP_TOKEN            permanent access token of the Meta system user (secret)
//   WHATSAPP_PHONE_NUMBER_ID  the clinic number's id in WhatsApp Manager
//   WHATSAPP_DISPLAY_NUMBER   optional, shown in Settings (e.g. +20 122 700 7428)
//   WHATSAPP_TEMPLATE_VACCINE / WHATSAPP_TEMPLATE_APPOINTMENT / WHATSAPP_TEMPLATE_LANG   approved template names + language
//   WHATSAPP_API_BASE         optional, default https://graph.facebook.com/v21.0 (the sync test points it at a fake)
// Reminders sent by WhatsApp outside a conversation the owner started must be approved message templates (Meta's rule),
// so the wording lives in WhatsApp Manager; the server only fills the parameters, in the order docs/WHATSAPP-SETUP.md
// lists. Every message sent or failed is a wa_messages row (synced to devices, which only read it); a sent reminder
// stamps reminder_sent_at like the WhatsApp button does, so it is sent once and the Reminders screen shows it done.
import crypto from 'node:crypto';
import { inTx, numberingLock } from './db.mjs';

const TZ = 'Africa/Cairo';
const cairoDay = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const cairoHour = (d = new Date()) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(d));
const addDays = (day, n) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
/** Reminders are not sent late at night: a server that starts after this hour waits for the next day. */
const LAST_HOUR = 21;
const DEFAULT_HOUR = 10;

export function waConfig(env = process.env) {
  const token = env.WHATSAPP_TOKEN?.trim();
  const phoneId = env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  if (!token || !phoneId) return null;
  return {
    token, phoneId,
    base: (env.WHATSAPP_API_BASE?.trim() || 'https://graph.facebook.com/v21.0').replace(/\/+$/, ''),
    display: env.WHATSAPP_DISPLAY_NUMBER?.trim() || null,
    lang: env.WHATSAPP_TEMPLATE_LANG?.trim() || 'ar',
    templates: {
      VACCINE: env.WHATSAPP_TEMPLATE_VACCINE?.trim() || 'vaccine_reminder',
      APPOINTMENT: env.WHATSAPP_TEMPLATE_APPOINTMENT?.trim() || 'appointment_reminder',
      TEST: env.WHATSAPP_TEMPLATE_TEST?.trim() || 'hello_world',
    },
  };
}

/** Egyptian numbers: 010… → 2010…; already-international numbers are kept (same rule as src/lib/whatsapp.ts). */
export function toE164(raw) {
  if (!raw) return null;
  let d = String(raw).replace(/[^\d+]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  else if (d.startsWith('00')) d = d.slice(2);
  else if (d.startsWith('0')) d = `20${d.slice(1)}`;
  return d.length >= 10 ? d : null;
}

/** One template message. Returns { ok, id } or { ok: false, error }. */
export async function sendTemplate(cfg, to, name, lang, params) {
  try {
    const r = await fetch(`${cfg.base}/${encodeURIComponent(cfg.phoneId)}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp', to, type: 'template',
        template: { name, language: { code: lang }, ...(params.length ? { components: [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text: String(text) })) }] } : {}) },
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: String(body?.error?.message || `HTTP ${r.status}`).slice(0, 300) };
    return { ok: true, id: body?.messages?.[0]?.id ?? null };
  } catch (e) {
    return { ok: false, error: String(e.message || e).slice(0, 300) };
  }
}

const dateText = (iso, lang) => {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00Z`) : new Date(iso);
  return new Intl.DateTimeFormat(lang.startsWith('ar') ? 'ar-EG-u-nu-latn' : 'en-GB', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' }).format(d);
};
const timeText = (iso, lang) =>
  new Intl.DateTimeFormat(lang.startsWith('ar') ? 'ar-EG-u-nu-latn' : 'en-GB', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso));

async function clinicSettings(q, clinicId) {
  return (await q.query("SELECT data FROM rows WHERE clinic_id = $1 AND tbl = 'clinic_settings' AND NOT deleted LIMIT 1", [clinicId])).rows[0]?.data ?? {};
}
const kindsOf = (s) => (s.wa_auto_kinds ? String(s.wa_auto_kinds).split(',') : ['VACCINE', 'APPOINTMENT']);

/**
 * What is due today: the latest vaccination per pet and vaccine with its next dose from 14 days ago to 7 days ahead and
 * no reminder yet; tomorrow's scheduled appointments with no reminder yet. Active pets and owners, owner not opted out.
 */
async function dueReminders(q, clinicId, kinds, today) {
  const out = [];
  const owner = `JOIN rows p ON p.clinic_id = v.clinic_id AND p.tbl = 'pets' AND p.id = v.data->>'pet_id' AND NOT p.deleted AND COALESCE(p.data->>'status', 'ACTIVE') = 'ACTIVE'
     JOIN rows o ON o.clinic_id = v.clinic_id AND o.tbl = 'owners' AND o.id = p.data->>'owner_id' AND NOT o.deleted AND COALESCE(o.data->>'status', 'ACTIVE') = 'ACTIVE'
       AND COALESCE((o.data->>'wa_opt_out')::int, 0) = 0`;
  if (kinds.includes('VACCINE')) {
    const rows = (await q.query(
      `SELECT v.id, v.data->>'next_due_at' due, vt.data->>'name' vaccine, p.id pet_id, p.data->>'name' pet, o.id owner_id, o.data->>'full_name' owner,
              COALESCE(NULLIF(o.data->>'whatsapp', ''), o.data->>'phone') phone
       FROM rows v ${owner}
       LEFT JOIN rows vt ON vt.clinic_id = v.clinic_id AND vt.tbl = 'vaccine_types' AND vt.id = v.data->>'vaccine_type_id'
       WHERE v.clinic_id = $1 AND v.tbl = 'vaccinations' AND NOT v.deleted AND v.data->>'reminder_sent_at' IS NULL
         AND v.data->>'next_due_at' BETWEEN $2 AND $3
         AND NOT EXISTS (SELECT 1 FROM rows n WHERE n.clinic_id = v.clinic_id AND n.tbl = 'vaccinations' AND NOT n.deleted
           AND n.data->>'pet_id' = v.data->>'pet_id' AND n.data->>'vaccine_type_id' = v.data->>'vaccine_type_id'
           AND (n.data->>'administered_at', n.id) > (v.data->>'administered_at', v.id))
       ORDER BY due`,
      [clinicId, addDays(today, -14), addDays(today, 7)],
    )).rows;
    for (const r of rows) out.push({ kind: 'VACCINE', tbl: 'vaccinations', ...r });
  }
  if (kinds.includes('APPOINTMENT')) {
    const rows = (await q.query(
      `SELECT v.id, v.data->>'scheduled_at' scheduled_at, p.id pet_id, p.data->>'name' pet, o.id owner_id, o.data->>'full_name' owner,
              COALESCE(NULLIF(o.data->>'whatsapp', ''), o.data->>'phone') phone
       FROM rows v ${owner}
       WHERE v.clinic_id = $1 AND v.tbl = 'appointments' AND NOT v.deleted AND v.data->>'status' = 'SCHEDULED' AND v.data->>'reminder_sent_at' IS NULL
         AND ((v.data->>'scheduled_at')::timestamptz AT TIME ZONE '${TZ}')::date = $2::date
       ORDER BY scheduled_at`,
      [clinicId, addDays(today, 1)],
    )).rows;
    for (const r of rows) out.push({ kind: 'APPOINTMENT', tbl: 'appointments', ...r });
  }
  return out;
}

/** Insert or patch a synced row as the server (the same per-column versions a device change gets). */
async function writeRow(c, clinicId, tbl, id, patch) {
  const now = new Date().toISOString();
  const v = Object.fromEntries(Object.keys(patch).map((k) => [k, `${now}|server`]));
  await c.query(
    `INSERT INTO rows (clinic_id, tbl, id, data, versions, deleted, seq) VALUES ($1, $2, $3, $4, $5, false, nextval('change_seq'))
     ON CONFLICT (clinic_id, tbl, id) DO UPDATE SET data = rows.data || EXCLUDED.data, versions = rows.versions || EXCLUDED.versions, seq = nextval('change_seq')`,
    [clinicId, tbl, id, patch, v],
  );
}

async function logMessage(c, clinicId, m) {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await writeRow(c, clinicId, 'wa_messages', id, {
    id, kind: m.kind, owner_id: m.owner_id ?? null, pet_id: m.pet_id ?? null, ref_id: m.ref_id ?? null, phone: m.phone ?? null, template: m.template ?? null,
    status: m.status, error: m.error ?? null, wa_id: m.wa_id ?? null, sent_at: now, created_at: now, updated_at: now,
  });
}

/**
 * Send what is due for one clinic. `force` (Settings → "Send due reminders now") ignores the switch's hour and the
 * once-a-day rule, but never sends a reminder twice. Returns { sent, failed, skipped, changed }.
 */
export async function runReminders(pool, clinicId, { cfg = waConfig(), force = false, now = new Date() } = {}) {
  const res = { sent: 0, failed: 0, skipped: 0, changed: false, at: now.toISOString() };
  if (!cfg) return { ...res, error: 'not_configured' };
  const s = await clinicSettings(pool, clinicId);
  if (!force && Number(s.wa_auto) !== 1) return { ...res, error: 'off' };
  const clinic = (cfg.lang.startsWith('ar') ? s.name_ar : s.name_en) || s.name_en || s.name_ar || 'Animal Care Clinic';
  const due = await dueReminders(pool, clinicId, kindsOf(s), cairoDay(now));
  for (const r of due) {
    const to = toE164(r.phone);
    if (!to) {
      res.skipped++;
      continue;
    }
    const params = r.kind === 'VACCINE'
      ? [r.owner, r.pet, r.vaccine ?? '', dateText(r.due, cfg.lang), clinic]
      : [r.owner, r.pet, dateText(r.scheduled_at, cfg.lang), timeText(r.scheduled_at, cfg.lang), clinic];
    const template = cfg.templates[r.kind];
    const sent = await sendTemplate(cfg, to, template, cfg.lang, params);
    await inTx(pool, async (c) => {
      await numberingLock(c, clinicId);
      // Someone may have sent it by hand meanwhile: the stamp stays the first one.
      if (sent.ok) {
        const cur = (await c.query('SELECT data FROM rows WHERE clinic_id = $1 AND tbl = $2 AND id = $3', [clinicId, r.tbl, r.id])).rows[0]?.data;
        if (cur && !cur.reminder_sent_at) await writeRow(c, clinicId, r.tbl, r.id, { reminder_sent_at: new Date().toISOString(), updated_at: new Date().toISOString() });
      }
      await logMessage(c, clinicId, {
        kind: r.kind, owner_id: r.owner_id, pet_id: r.pet_id, ref_id: r.id, phone: to, template,
        status: sent.ok ? 'SENT' : 'FAILED', error: sent.ok ? null : sent.error, wa_id: sent.ok ? sent.id : null,
      });
    });
    res.changed = true;
    if (sent.ok) res.sent++;
    else res.failed++;
  }
  await pool.query("INSERT INTO server_meta (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [`wa_last_run:${clinicId}`, JSON.stringify(res)]);
  return res;
}

/** A test message (Settings → Send a test): Meta's own hello_world template unless WHATSAPP_TEMPLATE_TEST says otherwise. */
export async function sendTest(pool, clinicId, phone, cfg = waConfig()) {
  if (!cfg) return { ok: false, error: 'not_configured' };
  const to = toE164(phone);
  if (!to) return { ok: false, error: 'number' };
  const template = cfg.templates.TEST;
  const r = await sendTemplate(cfg, to, template, template === 'hello_world' ? 'en_US' : cfg.lang, []);
  await inTx(pool, async (c) => {
    await numberingLock(c, clinicId);
    await logMessage(c, clinicId, { kind: 'TEST', phone: to, template, status: r.ok ? 'SENT' : 'FAILED', error: r.ok ? null : r.error, wa_id: r.ok ? r.id : null });
  });
  return r;
}

export async function waStatus(pool, clinicId, cfg = waConfig()) {
  const last = (await pool.query('SELECT value FROM server_meta WHERE key = $1', [`wa_last_run:${clinicId}`])).rows[0]?.value;
  return {
    configured: !!cfg, number: cfg?.display ?? null, templates: cfg ? [cfg.templates.VACCINE, cfg.templates.APPOINTMENT] : [], lang: cfg?.lang ?? null,
    lastRun: last ? JSON.parse(last) : null,
  };
}

/** Every 10 minutes: once a day per clinic, from the Admin's hour (default 10:00 clinic time) until 21:00. */
export function scheduleWhatsApp(pool, onChanged) {
  const tick = async () => {
    const cfg = waConfig();
    if (!cfg) return;
    try {
      const day = cairoDay();
      const hour = cairoHour();
      for (const { id } of (await pool.query('SELECT id FROM clinics')).rows) {
        const s = await clinicSettings(pool, id);
        if (Number(s.wa_auto) !== 1) continue;
        const from = Number.isFinite(Number(s.wa_auto_hour)) && s.wa_auto_hour != null ? Number(s.wa_auto_hour) : DEFAULT_HOUR;
        if (hour < from || hour >= LAST_HOUR) continue;
        const key = `wa_last_day:${id}`;
        if ((await pool.query('SELECT value FROM server_meta WHERE key = $1', [key])).rows[0]?.value === day) continue;
        await pool.query('INSERT INTO server_meta (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [key, day]);
        const r = await runReminders(pool, id, { cfg });
        if (r.sent || r.failed) console.log(`whatsapp: sent ${r.sent}, failed ${r.failed}, skipped ${r.skipped}`);
        if (r.changed) onChanged(id);
      }
    } catch (e) {
      console.warn('whatsapp schedule:', e.message);
    }
  };
  setTimeout(tick, 45_000).unref();
  setInterval(tick, 10 * 60_000).unref();
}
