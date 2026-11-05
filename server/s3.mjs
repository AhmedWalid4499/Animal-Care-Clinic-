// Minimal S3-compatible storage client for the nightly off-site backup (Cloudflare R2, Backblaze B2, AWS S3…).
// Requests are signed with AWS Signature V4 by the small `aws4` library; path-style addressing works on all three.
//   BACKUP_S3_ENDPOINT   e.g. https://<account>.r2.cloudflarestorage.com
//   BACKUP_S3_BUCKET     e.g. animal-care-clinic-backups
//   BACKUP_S3_KEY_ID / BACKUP_S3_SECRET   an access key limited to that bucket
//   BACKUP_S3_REGION     "auto" for R2 (default), the bucket's region for B2 / S3
import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import aws4 from 'aws4';

export function s3Config(env = process.env) {
  const { BACKUP_S3_ENDPOINT: endpoint, BACKUP_S3_BUCKET: bucket, BACKUP_S3_KEY_ID: accessKeyId, BACKUP_S3_SECRET: secretAccessKey } = env;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  return { endpoint: endpoint.replace(/\/+$/, ''), bucket, accessKeyId, secretAccessKey, region: env.BACKUP_S3_REGION || 'auto' };
}

const encodeKey = (key) => key.split('/').map(encodeURIComponent).join('/');

/** One signed request. Resolves { status, body: Buffer }. */
function request(cfg, method, key, body) {
  const u = new URL(cfg.endpoint);
  const payload = body ?? Buffer.alloc(0);
  const opts = {
    protocol: u.protocol,
    host: u.host,
    hostname: u.hostname,
    port: u.port || undefined,
    path: `${u.pathname.replace(/\/$/, '')}/${encodeURIComponent(cfg.bucket)}/${encodeKey(key)}`,
    method,
    service: 's3',
    region: cfg.region,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': payload.length,
      'x-amz-content-sha256': crypto.createHash('sha256').update(payload).digest('hex'),
    },
    body: payload,
  };
  aws4.sign(opts, { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey });
  const lib = u.protocol === 'http:' ? http : https;
  return new Promise((resolve, reject) => {
    const req = lib.request({ protocol: opts.protocol, hostname: opts.hostname, port: opts.port, path: opts.path, method, headers: opts.headers, timeout: 120_000 }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    });
    req.on('timeout', () => req.destroy(new Error('storage timeout')));
    req.on('error', reject);
    req.end(payload.length ? payload : undefined);
  });
}

function check(r, what) {
  if (r.status >= 200 && r.status < 300) return r;
  const msg = /<Message>([^<]*)<\/Message>/.exec(r.body.toString('utf8'))?.[1] ?? r.body.toString('utf8').slice(0, 200);
  throw new Error(`${what}: storage answered ${r.status} ${msg}`.trim());
}

export async function s3Put(cfg, key, body) {
  check(await request(cfg, 'PUT', key, body), `upload ${key}`);
}
/** null when the object does not exist. */
export async function s3Get(cfg, key) {
  const r = await request(cfg, 'GET', key);
  if (r.status === 404) return null;
  return check(r, `download ${key}`).body;
}
export async function s3Delete(cfg, key) {
  const r = await request(cfg, 'DELETE', key);
  if (r.status !== 404) check(r, `delete ${key}`);
}
