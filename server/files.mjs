// Clinic files (X-rays, lab PDFs, photos) on the server (docs/CLOUD-PLAN.md, Phase 4). The attachment rows sync
// like any other table; the bytes live here, one file per attachment, on the Railway volume (FILES_DIR=/data).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const MAX_FILE = 25 * 1024 * 1024; // same limit as the app (repo.ts MAX_ATTACHMENT_BYTES)
const SAFE_ID = /^[A-Za-z0-9-]{8,64}$/;

export function filesDir() {
  return path.resolve(process.env.FILES_DIR || path.join(process.cwd(), 'data-files'));
}
/** Where files are kept, and whether that survives a redeploy (Railway volume attached). */
export function storageInfo() {
  const onRailway = !!process.env.RAILWAY_ENVIRONMENT || !!process.env.RAILWAY_PROJECT_ID;
  const volume = process.env.RAILWAY_VOLUME_MOUNT_PATH || null;
  const dir = filesDir();
  return { dir, onRailway, volume, persistent: !onRailway || (!!volume && (dir === volume || dir.startsWith(`${volume}${path.sep}`))) };
}
export const validFileId = (id) => SAFE_ID.test(id);
const fileOf = (clinicId, id) => path.join(filesDir(), 'files', clinicId, id);

export function readBody(req, max = MAX_FILE) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > max) {
        reject(Object.assign(new Error('file too large'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function saveFile(pool, clinicId, id, bytes) {
  const file = fileOf(clinicId, id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, bytes);
  fs.renameSync(tmp, file);
  const sha = crypto.createHash('sha256').update(bytes).digest('hex');
  await pool.query(
    `INSERT INTO files (clinic_id, id, size, sha256) VALUES ($1, $2, $3, $4)
     ON CONFLICT (clinic_id, id) DO UPDATE SET size = EXCLUDED.size, sha256 = EXCLUDED.sha256,
       backed_up_at = CASE WHEN files.sha256 = EXCLUDED.sha256 THEN files.backed_up_at ELSE NULL END`,
    [clinicId, id, bytes.length, sha],
  );
  return { size: bytes.length, sha256: sha };
}
export function fileBytes(clinicId, id) {
  const file = fileOf(clinicId, id);
  return fs.existsSync(file) ? fs.readFileSync(file) : null;
}
export function writeRestoredFile(clinicId, id, bytes) {
  const file = fileOf(clinicId, id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
}
