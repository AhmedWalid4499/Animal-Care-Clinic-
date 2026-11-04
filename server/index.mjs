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
import { applyChanges, bootstrapRows, pullSince } from './sync.mjs';

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
async function bootstrapServer() {
  await migrate(pool);
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
}

// ---------------------------------------------------------------- helpers
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
function send(res, status, body, headers = {}) {
  const json = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors, ...headers });
  res.end(json);
}
// The desktop app calls from file:// (origin "null") and the web app from its own origin; auth is a bearer
// token, never a cookie, so allowing any origin does not expose a session.
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };

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

// Simple brute-force brake on sign-in: 10 tries per 5 minutes per address.
const tries = new Map();
function tooManyTries(ip) {
  const now = Date.now();
  const list = (tries.get(ip) || []).filter((t) => now - t < 5 * 60_000);
  list.push(now);
  tries.set(ip, list);
  return list.length > 10;
}

// ---------------------------------------------------------------- live pings
const sockets = new Map(); // clinicId -> Set<ws>
function broadcast(clinicId, msg, exceptDevice) {
  for (const ws of sockets.get(clinicId) || []) if (ws.readyState === 1 && ws.deviceId !== exceptDevice) ws.send(JSON.stringify(msg));
}

// ---------------------------------------------------------------- routes
async function api(req, res, url) {
  const p = url.pathname;
  if (p === '/api/login' && req.method === 'POST') {
    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
    if (tooManyTries(ip)) return send(res, 429, { error: 'Too many attempts. Wait a few minutes.' });
    const { email, password, deviceId, deviceName } = await readJson(req);
    const found = email && password ? await findUserByEmail(String(email)) : null;
    if (!found || !Number(found.data.is_active) || !bcrypt.compareSync(String(password), String(found.data.password_hash))) {
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
    const { changes } = await readJson(req);
    if (!Array.isArray(changes) || changes.length > 2000) return send(res, 400, { error: 'changes must be an array of at most 2000' });
    const r = await applyChanges(pool, { clinicId: s.clinicId, user: s.user, deviceId: s.deviceId, changes });
    if (r.seq) broadcast(s.clinicId, { type: 'changed', seq: r.seq }, s.deviceId);
    return send(res, 200, r);
  }
  if (p === '/api/sync/pull' && req.method === 'GET') {
    const since = Math.max(0, Number(url.searchParams.get('since') || 0));
    const limit = Math.min(2000, Math.max(1, Number(url.searchParams.get('limit') || 1000)));
    return send(res, 200, await pullSince(pool, s.clinicId, since, limit));
  }
  if (p === '/api/sync/bootstrap' && req.method === 'POST') {
    if (s.user.role !== 'ADMIN') return send(res, 403, { error: 'admins only' });
    const { rows, done } = await readJson(req);
    if (!Array.isArray(rows)) return send(res, 400, { error: 'rows must be an array' });
    const r = await bootstrapRows(pool, { clinicId: s.clinicId, deviceId: s.deviceId, rows, done: !!done });
    if (r.error) return send(res, 409, r);
    if (done) broadcast(s.clinicId, { type: 'changed' });
    return send(res, 200, r);
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
  .then(() => server.listen(PORT, () => console.log(`clinic server on :${PORT} (web app from ${STATIC_DIR})`)))
  .catch((e) => {
    console.error('startup failed', e);
    process.exit(1);
  });
