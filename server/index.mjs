// Animal Care Clinic sync server (docs/CLOUD-PLAN.md). Runs on Railway (railway.json) or locally:
//   DATABASE_URL=postgres://… ADMIN_EMAIL=… ADMIN_PASSWORD=… node server/index.mjs
// Serves the web app from dist-cloud/, the sync API under /api, and live change pings on /api/live.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { WebSocketServer } from 'ws';
import { createPool, migrate } from './db.mjs';
import { applyChanges, assignOwnerCodes, bootstrapRows, pullSince } from './sync.mjs';
import { sendPush, setupPush } from './notify.mjs';
import { backupStatus, dump, restore, runBackup, scheduleBackups } from './backup.mjs';
import { MAX_FILE, fileBytes, readBody, saveFile, storageInfo, validFileId } from './files.mjs';
import { handleOwnerPage, ownerPagesChanged } from './portal.mjs';
import { handleTag } from './tags.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8080);
const STATIC_DIR = path.resolve(process.env.STATIC_DIR || path.join(here, '..', 'dist-cloud'));
const MAX_BODY = 30 * 1024 * 1024;

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. On Railway: Variables → DATABASE_URL=${{Postgres.DATABASE_URL}}');
  process.exit(1);
}
const pool = createPool(process.env.DATABASE_URL);

// ---------------------------------------------------------------- startup
let vapidPublic = null;
let epoch = null; // changes when the database is restored from a backup (devices then resend what is newer)
async function bootstrapServer() {
  await migrate(pool);
  // Disaster recovery: an empty database and RESTORE_FROM=latest (or a date) → load the nightly backup first.
  const from = process.env.RESTORE_FROM?.trim();
  if (from && !(await pool.query('SELECT 1 FROM clinics LIMIT 1')).rowCount) await restore(pool, from);
  epoch = (await pool.query("SELECT value FROM server_meta WHERE key = 'epoch'")).rows[0]?.value ?? null;
  vapidPublic = await setupPush(pool);
  let clinic = (await pool.query('SELECT * FROM clinics ORDER BY created_at LIMIT 1')).rows[0];
  if (!clinic) {
    const id = crypto.randomUUID();
    await pool.query('INSERT INTO clinics (id, name) VALUES ($1, $2)', [id, process.env.CLINIC_NAME || 'Animal Care Clinic']);
    clinic = { id };
    console.log(`created clinic ${id}`);
  }
  const email = process.env.ADMIN_EMAIL?.trim();
  const password = process.env.ADMIN_PASSWORD;
  const admins = (await pool.query("SELECT 1 FROM rows WHERE clinic_id = $1 AND tbl = 'users' AND data->>'role' = 'ADMIN' AND NOT deleted", [clinic.id])).rowCount;
  if (!admins) {
    if (!email || !password || password.length < 8) {
      console.warn('No Admin yet: set ADMIN_EMAIL and ADMIN_PASSWORD (8+ characters) and restart to create the first one.');
    } else {
      const now = new Date().toISOString();
      const id = crypto.randomUUID();
      const data = { id, name: 'Admin', email, password_hash: bcrypt.hashSync(password, 10), role: 'ADMIN', locale: 'ar', is_active: 1, created_at: now, updated_at: now };
      const versions = Object.fromEntries(Object.keys(data).map((k) => [k, `${now}|server`]));
      await pool.query("INSERT INTO rows (clinic_id, tbl, id, data, versions, deleted, seq) VALUES ($1, 'users', $2, $3, $4, false, nextval('change_seq'))", [clinic.id, id, data, versions]);
      console.log(`created first Admin ${email}`);
    }
  }
  await adminRecovery(clinic.id, email);
  for (const { id } of (await pool.query('SELECT id FROM clinics')).rows) {
    const n = await assignOwnerCodes(pool, id);
    if (n) console.log(`gave ${n} owner(s) a customer ID`);
  }
}

/**
 * Lost Admin password: set ADMIN_RESET_PASSWORD (8+ characters) in Railway and restart. The account ADMIN_EMAIL
 * gets that password as a temporary one (the Admin must choose a new one at sign-in), is made an active Admin,
 * and is signed out everywhere. Each value is used once, so a later restart doesn't reset it again; remove the
 * variable afterwards.
 */
async function adminRecovery(clinicId, email) {
  const reset = process.env.ADMIN_RESET_PASSWORD;
  if (!reset) return;
  if (!email || reset.length < 8) return console.warn('ADMIN_RESET_PASSWORD needs ADMIN_EMAIL and at least 8 characters; nothing reset.');
  const fingerprint = sha256(`${email.toLowerCase()}|${reset}`);
  const used = (await pool.query("SELECT 1 FROM server_meta WHERE key = 'admin_reset_used' AND value = $1", [fingerprint])).rowCount;
  if (used) return console.log('ADMIN_RESET_PASSWORD was already used; remove it from the variables.');
  const now = new Date().toISOString();
  const found = (await pool.query("SELECT id, data, versions FROM rows WHERE clinic_id = $1 AND tbl = 'users' AND lower(data->>'email') = lower($2) AND NOT deleted", [clinicId, email])).rows[0];
  const patch = { password_hash: bcrypt.hashSync(reset, 10), must_change_password: 1, is_active: 1, role: 'ADMIN', updated_at: now };
  if (found) {
    const versions = { ...found.versions, ...Object.fromEntries(Object.keys(patch).map((k) => [k, `${now}|server`])) };
    await pool.query("UPDATE rows SET data = data || $3::jsonb, versions = $4, seq = nextval('change_seq') WHERE clinic_id = $1 AND tbl = 'users' AND id = $2", [clinicId, found.id, patch, versions]);
    await pool.query('DELETE FROM sessions WHERE clinic_id = $1 AND user_id = $2', [clinicId, found.id]);
  } else {
    const id = crypto.randomUUID();
    const data = { id, name: 'Admin', email, locale: 'ar', created_at: now, ...patch };
    const versions = Object.fromEntries(Object.keys(data).map((k) => [k, `${now}|server`]));
    await pool.query("INSERT INTO rows (clinic_id, tbl, id, data, versions, deleted, seq) VALUES ($1, 'users', $2, $3, $4, false, nextval('change_seq'))", [clinicId, id, data, versions]);
  }
  await pool.query("INSERT INTO server_meta (key, value) VALUES ('admin_reset_used', $1) ON CONFLICT (key) DO UPDATE SET value = excluded.value", [fingerprint]);
  console.log(`Admin password reset for ${email}: sign in with ADMIN_RESET_PASSWORD, choose a new password, then remove the variable.`);
}

// ---------------------------------------------------------------- helpers
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
function send(res, status, body, headers = {}) {
  const json = body === undefined ? '' : JSON.stringify(body);
  // X-Server-Time: devices measure how far their clock is off (edit times decide which of two edits wins).
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Server-Time': new Date().toISOString(), ...cors, ...headers });
  res.end(json);
}
// The desktop app calls from file:// (origin "null") and the web app from its own origin; auth is a bearer
// token, never a cookie, so allowing any origin does not expose a session.
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS', 'Access-Control-Expose-Headers': 'X-Server-Time' };

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('body too large'), { status: 413 }));
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

async function findUserByEmail(email) {
  return (await pool.query("SELECT clinic_id, data FROM rows WHERE tbl = 'users' AND lower(data->>'email') = lower($1) AND NOT deleted LIMIT 1", [email])).rows[0];
}

/** Session from the bearer token; re-reads the user so role changes and deactivation apply at once. */
async function auth(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : new URL(req.url, 'http://x').searchParams.get('token');
  if (!token) return null;
  const s = (await pool.query('UPDATE sessions SET last_seen = now() WHERE token_hash = $1 RETURNING *', [sha256(token)])).rows[0];
  if (!s) return null;
  const u = (await pool.query("SELECT data FROM rows WHERE clinic_id = $1 AND tbl = 'users' AND id = $2 AND NOT deleted", [s.clinic_id, s.user_id])).rows[0];
  if (!u || !Number(u.data.is_active)) return null;
  return { clinicId: s.clinic_id, user: u.data, deviceId: s.device_id, tokenHash: s.token_hash };
}

// Brute-force brake on sign-in: 10 wrong passwords per 5 minutes per address. Only failures count, because
// every device of a clinic usually shares one internet address (any number of laptops signing in at 9am is fine).
const failures = new Map();
const recent = (ip) => (failures.get(ip) || []).filter((t) => Date.now() - t < 5 * 60_000);
function tooManyTries(ip) {
  return recent(ip).length >= 10;
}
function failedTry(ip) {
  const list = recent(ip);
  list.push(Date.now());
  failures.set(ip, list);
}

// ---------------------------------------------------------------- live pings
const sockets = new Map(); // clinicId -> Set<ws>
function broadcast(clinicId, msg, exceptDevice) {
  for (const ws of sockets.get(clinicId) || []) if (ws.readyState === 1 && ws.deviceId !== exceptDevice) ws.send(JSON.stringify(msg));
}
/** Sessions ended on the server (device signed out by the Admin, password reset, user deactivated): tell their open apps. */
function endSockets(tokenHashes) {
  const ended = new Set(tokenHashes);
  if (!ended.size) return;
  for (const set of sockets.values()) for (const ws of set) {
    if (!ended.has(ws.tokenHash)) continue;
    if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'revoked' }));
    ws.close();
  }
}
/**
 * After a push: a password that really changed, or a user who was deactivated, ends that person's sessions
 * (except the one that made the change). Resending a user row unchanged (e.g. after a restore) ends nothing.
 */
async function endSessionsAfter(s, userIds) {
  for (const id of userIds) {
    const r = await pool.query('DELETE FROM sessions WHERE clinic_id = $1 AND user_id = $2 AND token_hash <> $3 RETURNING token_hash', [s.clinicId, String(id), s.tokenHash]);
    endSockets(r.rows.map((x) => x.token_hash));
  }
}
/** Ping every open app (incl. desktop apps in the tray) of the people notified, then push to their phones/browsers. */
function deliver(clinicId, notifications) {
  if (!notifications.length) return;
  const users = new Set(notifications.map((n) => n.user_id));
  for (const ws of sockets.get(clinicId) || []) if (ws.readyState === 1 && users.has(ws.userId)) ws.send(JSON.stringify({ type: 'notify' }));
  sendPush(pool, notifications).catch((e) => console.warn('push', e.message));
}

// ---------------------------------------------------------------- routes
async function api(req, res, url) {
  const p = url.pathname;
  if (p === '/api/login' && req.method === 'POST') {
    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
    if (tooManyTries(ip)) return send(res, 429, { error: 'Too many attempts. Wait a few minutes.' });
    const { email, password, deviceId, deviceName } = await readJson(req);
    const found = email && password ? await findUserByEmail(String(email).trim()) : null;
    if (!found || !Number(found.data.is_active) || !bcrypt.compareSync(String(password), String(found.data.password_hash))) {
      failedTry(ip);
      return send(res, 401, { error: 'Wrong email or password' });
    }
    const token = crypto.randomBytes(32).toString('base64url');
    const dev = typeof deviceId === 'string' && deviceId.length <= 64 ? deviceId : crypto.randomUUID();
    await pool.query('INSERT INTO sessions (token_hash, clinic_id, user_id, device_id, device_name) VALUES ($1,$2,$3,$4,$5)', [sha256(token), found.clinic_id, found.data.id, dev, deviceName ? String(deviceName).slice(0, 80) : null]);
    const clinic = (await pool.query('SELECT id, name, bootstrapped FROM clinics WHERE id = $1', [found.clinic_id])).rows[0];
    const seq = Number((await pool.query('SELECT COALESCE(MAX(seq), 0) AS s FROM rows WHERE clinic_id = $1', [found.clinic_id])).rows[0].s);
    const { password_hash: _ph, ...user } = found.data;
    return send(res, 200, { token, deviceId: dev, user, clinic: { id: clinic.id, name: clinic.name }, needsBootstrap: !clinic.bootstrapped, seq });
  }

  const s = await auth(req);
  if (!s) return send(res, 401, { error: 'Signed out. Sign in again.' });

  if (p === '/api/me' && req.method === 'GET') return send(res, 200, { user: s.user, clinicId: s.clinicId });
  if (p === '/api/logout' && req.method === 'POST') {
    await pool.query('DELETE FROM sessions WHERE token_hash = $1', [s.tokenHash]);
    return send(res, 200, { ok: true });
  }
  if (p === '/api/sync/push' && req.method === 'POST') {
    const { changes, cursor } = await readJson(req);
    if (!Array.isArray(changes) || changes.length > 2000) return send(res, 400, { error: 'changes must be an array of at most 2000' });
    const seenSeq = Number.isFinite(Number(cursor)) && cursor !== undefined && cursor !== null ? Number(cursor) : null;
    const r = await applyChanges(pool, { clinicId: s.clinicId, user: s.user, deviceId: s.deviceId, changes, seenSeq });
    if (r.seq) {
      broadcast(s.clinicId, { type: 'changed', seq: r.seq }, s.deviceId);
      ownerPagesChanged(s.clinicId); // owners' pages open on their phones fetch again (Phase 6)
    }
    deliver(s.clinicId, r.notifications);
    await endSessionsAfter(s, r.endSessions);
    return send(res, 200, { rejected: r.rejected, reverts: r.reverts, failed: r.failed, seq: r.seq });
  }
  if (p === '/api/sync/pull' && req.method === 'GET') {
    const since = Math.max(0, Number(url.searchParams.get('since') || 0));
    const limit = Math.min(2000, Math.max(1, Number(url.searchParams.get('limit') || 1000)));
    return send(res, 200, { ...(await pullSince(pool, s.clinicId, since, limit)), epoch });
  }
  if (p === '/api/sync/bootstrap' && req.method === 'POST') {
    if (s.user.role !== 'ADMIN') return send(res, 403, { error: 'admins only' });
    const { rows, done } = await readJson(req);
    if (!Array.isArray(rows)) return send(res, 400, { error: 'rows must be an array' });
    const r = await bootstrapRows(pool, { clinicId: s.clinicId, deviceId: s.deviceId, rows, done: !!done });
    if (r.error) return send(res, 409, r);
    if (done) {
      await assignOwnerCodes(pool, s.clinicId);
      broadcast(s.clinicId, { type: 'changed' });
      ownerPagesChanged(s.clinicId);
    }
    return send(res, 200, r);
  }
  if (p === '/api/notifications' && req.method === 'GET') {
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') || 50)));
    const items = (await pool.query(
      'SELECT id, kind, event, data, created_at, read_at FROM notifications WHERE clinic_id = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT $3',
      [s.clinicId, s.user.id, limit],
    )).rows;
    const unread = Number((await pool.query('SELECT COUNT(*) n FROM notifications WHERE clinic_id = $1 AND user_id = $2 AND read_at IS NULL', [s.clinicId, s.user.id])).rows[0].n);
    return send(res, 200, { items, unread });
  }
  if (p === '/api/notifications/read' && req.method === 'POST') {
    const { ids, all } = await readJson(req);
    if (all) await pool.query('UPDATE notifications SET read_at = now() WHERE clinic_id = $1 AND user_id = $2 AND read_at IS NULL', [s.clinicId, s.user.id]);
    else if (Array.isArray(ids) && ids.length) await pool.query('UPDATE notifications SET read_at = now() WHERE clinic_id = $1 AND user_id = $2 AND id = ANY($3::uuid[]) AND read_at IS NULL', [s.clinicId, s.user.id, ids.slice(0, 500)]);
    return send(res, 200, { ok: true });
  }
  if (p === '/api/push/key' && req.method === 'GET') return send(res, 200, { publicKey: vapidPublic });
  if (p === '/api/push/subscribe' && req.method === 'POST') {
    const { subscription } = await readJson(req);
    const endpoint = subscription?.endpoint;
    if (typeof endpoint !== 'string' || !/^https?:\/\//.test(endpoint) || !subscription.keys?.p256dh || !subscription.keys?.auth) return send(res, 400, { error: 'invalid subscription' });
    await pool.query(
      'INSERT INTO push_subscriptions (endpoint, clinic_id, user_id, keys) VALUES ($1,$2,$3,$4) ON CONFLICT (endpoint) DO UPDATE SET clinic_id = EXCLUDED.clinic_id, user_id = EXCLUDED.user_id, keys = EXCLUDED.keys',
      [endpoint, s.clinicId, s.user.id, { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth }],
    );
    return send(res, 200, { ok: true });
  }
  // Files (Phase 4): the bytes of an attachment row, kept on the volume.
  const fm = /^\/api\/files\/([^/]+)$/.exec(p);
  if (fm) {
    const id = decodeURIComponent(fm[1]);
    if (!validFileId(id)) return send(res, 400, { error: 'bad file id' });
    const row = (await pool.query("SELECT deleted FROM rows WHERE clinic_id = $1 AND tbl = 'attachments' AND id = $2", [s.clinicId, id])).rows[0];
    if (req.method === 'PUT') {
      if (!row) return send(res, 409, { error: 'send the attachment record first' });
      const bytes = await readBody(req, MAX_FILE);
      const saved = await saveFile(pool, s.clinicId, id, bytes);
      broadcast(s.clinicId, { type: 'files', id }, s.deviceId); // other devices can fetch it now
      return send(res, 200, { ok: true, ...saved });
    }
    if (req.method === 'GET') {
      const bytes = row && !row.deleted ? fileBytes(s.clinicId, id) : null;
      if (!bytes) return send(res, 404, { error: 'file not on the server (yet)' });
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': bytes.length, 'Cache-Control': 'private, max-age=31536000, immutable', 'X-Server-Time': new Date().toISOString(), ...cors });
      return res.end(bytes);
    }
  }
  // Backups (Phase 4): status, "Back up now", and a copy to keep (Admin only).
  if (p.startsWith('/api/backup/')) {
    if (s.user.role !== 'ADMIN') return send(res, 403, { error: 'admins only' });
    if (p === '/api/backup/status' && req.method === 'GET') return send(res, 200, await backupStatus(pool));
    if (p === '/api/backup/run' && req.method === 'POST') return send(res, 200, { ...(await runBackup(pool)), status: await backupStatus(pool) });
    if (p === '/api/backup/download' && req.method === 'GET') {
      const gz = await dump(pool);
      res.writeHead(200, { 'Content-Type': 'application/gzip', 'Content-Length': gz.length, 'Content-Disposition': `attachment; filename="clinic-server-backup-${new Date().toISOString().slice(0, 10)}.json.gz"`, 'Cache-Control': 'no-store', ...cors });
      return res.end(gz);
    }
  }
  // Devices (Phase 5): every signed-in laptop / phone / browser of the clinic; the Admin can sign one out.
  if (p === '/api/devices' && req.method === 'GET') {
    if (s.user.role !== 'ADMIN') return send(res, 403, { error: 'admins only' });
    const live = new Set();
    for (const ws of sockets.get(s.clinicId) || []) if (ws.readyState === 1) live.add(ws.tokenHash);
    const rows = (await pool.query(
      `SELECT x.token_hash, x.device_id, x.device_name, x.created_at, x.last_seen, x.user_id, u.data->>'name' AS user_name, u.data->>'role' AS role
         FROM sessions x LEFT JOIN rows u ON u.clinic_id = x.clinic_id AND u.tbl = 'users' AND u.id = x.user_id
        WHERE x.clinic_id = $1 ORDER BY x.last_seen DESC`,
      [s.clinicId],
    )).rows;
    return send(res, 200, {
      devices: rows.map((r) => ({
        id: r.token_hash, device_id: r.device_id, device_name: r.device_name, user_id: r.user_id, user_name: r.user_name, role: r.role,
        created_at: r.created_at, last_seen: r.last_seen, online: live.has(r.token_hash), current: r.token_hash === s.tokenHash,
      })),
    });
  }
  if (p === '/api/devices/revoke' && req.method === 'POST') {
    if (s.user.role !== 'ADMIN') return send(res, 403, { error: 'admins only' });
    const { id } = await readJson(req);
    const r = await pool.query('DELETE FROM sessions WHERE clinic_id = $1 AND token_hash = $2 RETURNING token_hash', [s.clinicId, String(id ?? '')]);
    endSockets(r.rows.map((x) => x.token_hash));
    return send(res, 200, { ok: true, signedOut: r.rowCount });
  }
  if (p === '/api/push/unsubscribe' && req.method === 'POST') {
    const { endpoint } = await readJson(req);
    await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2', [String(endpoint ?? ''), s.user.id]);
    return send(res, 200, { ok: true });
  }
  return send(res, 404, { error: 'not found' });
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };
function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || !path.extname(rel)) rel = '/index.html';
  const file = path.join(STATIC_DIR, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(STATIC_DIR) || !fs.existsSync(file)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end(fs.existsSync(STATIC_DIR) ? 'Not found' : 'Web app not built (npm run build:cloud)');
  }
  const immutable = rel.startsWith('/assets/');
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'OPTIONS') return send(res, 204);
    if (url.pathname === '/health') {
      await pool.query('SELECT 1');
      return send(res, 200, { ok: true });
    }
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    // An owner's page from their QR code (server/portal.mjs): public, the link itself is the key.
    if ((url.pathname.startsWith('/o/') || url.pathname.startsWith('/o-font/')) && (await handleOwnerPage(pool, req, res, url))) return;
    // A pet's collar tag (server/tags.mjs): public; a finder's Alert becomes a found report everyone at the clinic sees.
    if (url.pathname.startsWith('/t/') && (await handleTag(pool, req, res, url, {
      afterReport: (clinicId, notifications) => {
        broadcast(clinicId, { type: 'changed' }); // devices pull the report into Lost & found
        ownerPagesChanged(clinicId); // the owner's open page shows the alert
        deliver(clinicId, notifications); // bell, tray, phones
      },
    }))) return;
    return serveStatic(req, res, url);
  } catch (e) {
    console.error(req.method, url.pathname, e);
    if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : 'server error' });
  }
});

const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', async (req, socket, head) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/api/live') return socket.destroy();
  const s = await auth(req).catch(() => null);
  if (!s) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    return socket.destroy();
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.deviceId = s.deviceId;
    ws.userId = s.user.id;
    ws.tokenHash = s.tokenHash;
    ws.alive = true;
    ws.on('pong', () => (ws.alive = true));
    const set = sockets.get(s.clinicId) || new Set();
    set.add(ws);
    sockets.set(s.clinicId, set);
    ws.on('close', () => set.delete(ws));
    ws.send(JSON.stringify({ type: 'hello' }));
  });
});
setInterval(() => {
  for (const set of sockets.values()) for (const ws of set) {
    if (!ws.alive) ws.terminate();
    else {
      ws.alive = false;
      ws.ping();
    }
  }
}, 30_000).unref();

bootstrapServer()
  .then(() => {
    const st = storageInfo();
    if (!st.persistent) console.warn(`FILES ARE NOT ON A VOLUME (${st.dir}): X-rays and backups are lost at the next deploy. Railway: add a Volume mounted at /data and set FILES_DIR=/data.`);
    scheduleBackups(pool);
    server.listen(PORT, () => console.log(`clinic server on :${PORT} (web app from ${STATIC_DIR}, files in ${st.dir})`));
  })
  .catch((e) => {
    console.error('startup failed', e);
    process.exit(1);
  });
