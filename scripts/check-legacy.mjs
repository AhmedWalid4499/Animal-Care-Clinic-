// Guards for the 32-bit / Windows 7 build (electron-builder.ia32.cjs, Electron 22, Chromium 108).
// Usage: node scripts/check-legacy.mjs [path\to\Animal Care Clinic.exe]
//  1. src/styles.css: every color-mix() has a plain colour for the same property just before it (Chromium 108 has no
//     color-mix() and drops the whole declaration — the sticky save bar turned see-through, focus rings vanished).
//  2. With an exe: its PE header must allow Windows 7 (6.1). Electron 23+ marks the exe "Windows 10 or later", and
//     Windows 7 then refuses to start it with "... is not a valid Win32 application" (14 Nov 2026).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];

// 1. CSS fallbacks. Rule bodies are the innermost {...}; declarations are separated by ';'.
const css = fs.readFileSync(path.join(root, 'src/styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
let mixes = 0;
for (const [, body] of css.matchAll(/\{([^{}]*)\}/g)) {
  const decls = body.split(';').map((d) => d.trim()).filter(Boolean);
  decls.forEach((d, i) => {
    if (!d.includes('color-mix(')) return;
    mixes++;
    const prop = d.slice(0, d.indexOf(':')).trim();
    const prev = decls[i - 1] || '';
    const ok = prev.slice(0, prev.indexOf(':')).trim() === prop && !prev.includes('color-mix(');
    if (!ok) problems.push(`styles.css: "${d.slice(0, 90)}" needs a plain "${prop}: …" just before it`);
  });
}
console.log(`styles.css: ${mixes} color-mix() declaration(s) checked`);

// 2. Minimum Windows version in the exe.
const exe = process.argv[2];
if (exe) {
  const b = fs.readFileSync(exe);
  const pe = b.readUInt32LE(0x3c);
  if (b.toString('latin1', pe, pe + 4) !== 'PE\0\0') throw new Error(`${exe}: not a PE file`);
  const opt = pe + 24;
  const ver = (o) => [b.readUInt16LE(opt + o), b.readUInt16LE(opt + o + 2)];
  const [osMaj, osMin] = ver(40); // MajorOperatingSystemVersion
  const [subMaj, subMin] = ver(48); // MajorSubsystemVersion
  const tooNew = (maj, min) => maj > 6 || (maj === 6 && min > 1);
  console.log(`${path.basename(exe)}: needs Windows ${osMaj}.${osMin} (subsystem ${subMaj}.${subMin}); Windows 7 is 6.1`);
  if (tooNew(osMaj, osMin) || tooNew(subMaj, subMin)) {
    problems.push(`${exe} needs Windows ${subMaj}.${subMin}: Windows 7 will say "not a valid Win32 application"`);
  }
}

if (problems.length) {
  for (const p of problems) console.error('FAIL', p);
  process.exit(1);
}
console.log('legacy checks OK');
