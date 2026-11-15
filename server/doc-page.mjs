// Documents on the owner's page (14 Nov 2026, Ahmed): the prescription, X-ray request and lab request exactly as the
// clinic prints them — logo, clinic name and phone, customer ID, patient, the ticked boxes, signature line, the
// address along the bottom — as a page the owner can save as a PDF or print from their phone.
// Same words (src/i18n), same boxes (src/lib/xray-menu.json, src/lib/lab-tests.json) and the app's own sheet styles
// (the one-line rules of src/styles.css), so a change to a document in the app shows here too.
// Never shown here, as on the rest of the owner page: treatment notes, staff notes, money.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PET_ICON } from './favicons.mjs';
import { qrSvg } from './qr.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (...p) => path.join(here, '..', 'src', ...p);
const DICT = { ar: JSON.parse(fs.readFileSync(src('i18n', 'ar.json'), 'utf8')), en: JSON.parse(fs.readFileSync(src('i18n', 'en.json'), 'utf8')) };
const XRAY = JSON.parse(fs.readFileSync(src('lib', 'xray-menu.json'), 'utf8'));
const LAB = JSON.parse(fs.readFileSync(src('lib', 'lab-tests.json'), 'utf8')).groups;

// The app's sheet styles: every one-line rule for the printed documents, taken from src/styles.css at start-up.
const SHEET_CSS = (() => {
  const css = fs.readFileSync(src('styles.css'), 'utf8');
  const want = /^(\.sheet|\.rx-sheet|\.doc[ .]|\.xray-sheet|\.xray-grid|\.xbox|\.xside|\.xray-opts|\.xray-write|\.lab-request|\.lab-grid)/;
  return css.split('\n').filter((l) => want.test(l) && l.trim().endsWith('}') && !l.includes('var(--accent)')).join('\n');
})();

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function translator(lang) {
  return (key, vars) => {
    let s = key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), DICT[lang]);
    if (typeof s !== 'string') s = key;
    for (const [k, v] of Object.entries(vars ?? {})) s = s.split(`{${k}}`).join(String(v));
    return s;
  };
}
const tag = (lang) => (lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB');
const dateIn = (lang, iso) => (iso
  ? new Intl.DateTimeFormat(tag(lang), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Cairo' }).format(new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso))
  : '');
const num = (lang, n, digits) => new Intl.NumberFormat(tag(lang), { maximumFractionDigits: digits }).format(n);
function ageParts(dob, at) {
  const [y1, m1, d1] = dob.split('-').map(Number);
  const [y2, m2, d2] = at.split('-').map(Number);
  let months = (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0);
  if (months < 0) months = 0;
  return { years: Math.floor(months / 12), months: months % 12 };
}
const shownCode = (c) => (c && !String(c).startsWith('TMP-') ? c : null);

function head(d, lang) {
  const name = (lang === 'ar' ? d.clinic.name_ar : d.clinic.name_en) || d.clinic.name_en || d.clinic.name_ar || '';
  return `<div class="head"><div><b style="font-size:15px">${esc(name)}</b><div style="font-size:10px">${d.clinic.phone ? `<span class="ltr">${esc(d.clinic.phone)}</span>` : ''}</div></div>${d.clinic.logo ? `<img src="${esc(d.clinic.logo)}" alt="">` : ''}</div>`;
}
// The address and, at the bottom left, the QR to the clinic's own page (as on the documents printed in the app).
const addressFoot = (d) => `<div class="foot addr-foot" dir="auto">${esc(d.clinic.address ?? '')}<span class="sheet-qr" dir="ltr">${qrSvg(`${d.site}/clinic`, { size: 48, label: 'Animal Care Clinic' })}</span></div>`;

/** Owner (with customer ID) and patient facts, as on the app's documents (Who in src/screens/Documents.tsx). */
function who(d, pet, lang, at, weight) {
  const t = translator(lang);
  const age = pet.date_of_birth ? ageParts(pet.date_of_birth, (at ?? new Date().toISOString()).slice(0, 10)) : null;
  const code = shownCode(d.owner.code);
  return `<div class="doc-facts">
<span>${esc(t('docs.owner'))}: <b>${esc(d.owner.full_name)}</b></span>
${code ? `<span>${esc(t('owners.code'))}: <b class="ltr">${esc(code)}</b></span>` : ''}
<span>${esc(t('owners.phone'))}: <b class="ltr">${esc(d.owner.phone)}</b></span>
<span>${esc(t('docs.pet'))}: <b>${esc(pet.name)}</b> (${esc(t(`species.${pet.species}`))}${pet.breed ? ` · ${esc(pet.breed)}` : ''})</span>
<span>${esc(t('pets.sex'))}: <b>${esc(t(`sex.${pet.sex}`))}${pet.is_neutered ? ` · ${esc(t('pets.neutered'))}` : ''}</b></span>
<span>${esc(t('pets.age'))}: <b>${age ? esc(t('pets.ageValue', { y: age.years, m: age.months })) : '—'}</b></span>
${weight != null ? `<span>${esc(t('visits.weight'))}: <b class="ltr">${esc(num(lang, weight, 2))} ${esc(t('common.kg'))}</b></span>` : ''}
${pet.microchip_no ? `<span>${esc(t('pets.microchip'))}: <b class="ltr">${esc(pet.microchip_no)}</b></span>` : ''}
</div>`;
}

/** A visit's prescription (PrescriptionPrint in src/screens/Prescription.tsx), without the treatment notes. */
export function prescriptionSheet(d, v, lang) {
  const t = translator(lang);
  const pet = d.pets.find((p) => p.id === v.pet_id) ?? { name: v.pet_name, species: 'OTHER' };
  const code = shownCode(d.owner.code);
  const rows = v.items.length
    ? v.items.map((r) => `<tr><td><b dir="auto">${esc(r.drug)}</b>${r.instructions ? `<div class="small" dir="auto">${esc(r.instructions)}</div>` : ''}</td><td><span dir="auto">${esc(r.dose || '—')}</span></td><td><span dir="auto">${esc(r.frequency || '—')}</span></td><td>${r.duration_days ? esc(t('rxSheet.forDays', { n: r.duration_days })) : '—'}</td></tr>`).join('')
    : `<tr><td colspan="4">${esc(t('rxSheet.none'))}</td></tr>`;
  return `<div class="sheet a5 rx-sheet" dir="${lang === 'ar' ? 'rtl' : 'ltr'}" lang="${lang}">
${head(d, lang)}
<h2 class="rx-title">${esc(t('rxSheet.title'))}</h2>
<div class="rx-facts">
<span>${esc(t('rxSheet.pet'))}: <b>${esc(pet.name)}</b> (${esc(t(`species.${pet.species}`))})</span>
${v.weight_kg != null ? `<span>${esc(t('visits.weight'))}: <b class="ltr">${esc(v.weight_kg)}</b></span>` : ''}
<span>${esc(t('rxSheet.owner'))}: <b>${esc(d.owner.full_name)}</b></span>
${code ? `<span>${esc(t('owners.code'))}: <b class="ltr">${esc(code)}</b></span>` : ''}
<span>${esc(t('common.date'))}: <b>${esc(dateIn(lang, v.visited_at))}</b></span>
${v.vet_name ? `<span>${esc(t('rxSheet.vet'))}: <b>${esc(v.vet_name)}</b></span>` : ''}
</div>
${v.diagnosis ? `<p class="small">${esc(t('visits.diagnosis'))}: ${esc(v.diagnosis)}</p>` : ''}
<table><thead><tr><th>${esc(t('rxSheet.rx'))}</th><th>${esc(t('visits.dose'))}</th><th>${esc(t('rxSheet.howOften'))}</th><th>${esc(t('rxSheet.howLong'))}</th></tr></thead><tbody>${rows}</tbody></table>
${v.follow_up_at ? `<p class="rx-next">↻ ${esc(t('rxSheet.next', { date: dateIn(lang, v.follow_up_at) }))}</p>` : ''}
<div class="rx-sign"><div class="line"></div>${esc(t('certificate.signature'))}</div>
<div class="foot">${esc(t('rxSheet.foot'))}</div>
${addressFoot(d)}
</div>`;
}

/** A saved X-ray or lab request (RequestForm in src/screens/Documents.tsx), boxes ticked as the vet ticked them. */
export function requestSheet(d, r, lang) {
  const t = translator(lang);
  const pet = d.pets.find((p) => p.id === r.pet_id) ?? { name: r.pet_name, species: 'OTHER', sex: 'UNKNOWN' };
  const on = new Set(r.items);
  const box = (k, label) => `<label class="xbox${on.has(k) ? ' on' : ''}"><span class="sq" aria-hidden="true">${on.has(k) ? '✓' : ''}</span><span>${esc(label)}</span></label>`;
  const prefix = r.kind === 'LAB' ? 'labReq' : 'xray';
  const grid = r.kind === 'XRAY'
    ? `<div class="xray-grid">${XRAY.regions.map((g) => `<fieldset><legend>${esc(t(`xray.region.${g.region}`))}</legend>${g.views.map((v) => (g.sides
      ? `<div class="xside"><span class="xside-name">${esc(t(`xray.view.${v}`))}</span>${box(`${g.region}.${v}.L`, t('xray.left'))}${box(`${g.region}.${v}.R`, t('xray.right'))}</div>`
      : box(`${g.region}.${v}`, t(`xray.view.${v}`)))).join('')}</fieldset>`).join('')}</div>
<div class="xray-opts">${XRAY.options.map((o) => box(`opt.${o}`, t(`xray.opt.${o}`))).join('')}</div>`
    : `<div class="xray-grid lab-grid" dir="ltr">${LAB.map((g) => `<fieldset><legend dir="auto">${esc(t(`labReq.group.${g.key}`))}</legend>${g.tests.map((x) => box(x.key, x.label)).join('')}</fieldset>`).join('')}</div>`;
  return `<div class="sheet ${r.kind === 'LAB' ? 'a4 lab-request' : 'a5 xray-sheet'} doc" dir="${lang === 'ar' ? 'rtl' : 'ltr'}" lang="${lang}">
${head(d, lang)}
<h2 class="doc-title">${esc(t(`${prefix}.title`))}</h2>
${r.kind === 'LAB' && r.by ? `<div class="doc-facts"><span>${esc(t('labReq.referredBy'))}: <b>${esc(r.by)}</b></span></div>` : ''}
${who(d, pet, lang, r.requested_at, pet.weight ? pet.weight.kg : null)}
<div class="doc-facts">
<span>${esc(t('common.date'))}: <b>${esc(dateIn(lang, r.requested_at))}</b></span>
${r.kind === 'LAB' && pet.date_of_birth ? `<span>${esc(t('pets.dob'))}: <b>${esc(dateIn(lang, pet.date_of_birth))}</b></span>` : ''}
${r.kind === 'XRAY' && r.by ? `<span>${esc(t('xray.requestedBy'))}: <b>${esc(r.by)}</b></span>` : ''}
</div>
${grid}
<div class="xray-write">
<div class="xw-label">${esc(t(`${prefix}.otherViews`))}</div><div class="lines">${esc(r.other ?? '')}</div>
<div class="xw-label">${esc(t('xray.notes'))}</div><div class="lines tall">${esc(r.notes ?? '')}</div>
</div>
<div class="doc-sign"><div class="line"></div>${esc(t('certificate.signature'))}</div>
<div class="foot">${esc(t(`${prefix}.foot`))}</div>
${addressFoot(d)}
</div>`;
}

/** The whole page: a bar (back, language, save as PDF) above the sheet; only the sheet prints. */
export function docPageHtml({ nonce, lang, title, sheet, back, other }) {
  const t = translator(lang);
  const p = t('portal.page.docSave');
  return `<!doctype html>
<html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#2e6f73">
<title>${esc(title)}</title>
<link rel="icon" type="image/svg+xml" href="${PET_ICON}">
<style nonce="${nonce}">
@font-face { font-family: 'Plex Arabic'; font-weight: 400; font-display: swap; src: url(/o-font/arabic-400.woff2) format('woff2'); unicode-range: U+0600-06FF, U+0750-077F, U+FB50-FDFF, U+FE70-FEFC; }
@font-face { font-family: 'Plex Arabic'; font-weight: 600; font-display: swap; src: url(/o-font/arabic-600.woff2) format('woff2'); unicode-range: U+0600-06FF, U+0750-077F, U+FB50-FDFF, U+FE70-FEFC; }
@font-face { font-family: 'Plex Arabic'; font-weight: 400; font-display: swap; src: url(/o-font/latin-400.woff2) format('woff2'); unicode-range: U+0000-00FF, U+2000-206F, U+2190-2193, U+2212; }
@font-face { font-family: 'Plex Arabic'; font-weight: 600; font-display: swap; src: url(/o-font/latin-600.woff2) format('woff2'); unicode-range: U+0000-00FF, U+2000-206F, U+2190-2193, U+2212; }
* { box-sizing: border-box; }
body { margin: 0; background: #e9eeed; color: #111; font-family: 'Plex Arabic', system-ui, 'Segoe UI', Tahoma, sans-serif; font-size: 14px; line-height: 1.5; }
.bar { position: sticky; top: 0; z-index: 2; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 10px 16px; background: #fff; border-bottom: 1px solid #d5dcdb; }
.bar .grow { flex: 1; }
.bar a, .bar button { display: inline-flex; align-items: center; gap: 6px; min-height: 40px; padding: 0 14px; border-radius: 999px; border: 1px solid #c9d2d1; background: #fff; color: #1b1f23; font: inherit; font-weight: 600; text-decoration: none; cursor: pointer; }
.bar button.primary { background: #2e6f73; border-color: #2e6f73; color: #fff; }
.hint { margin: 10px 16px 0; color: #5b636b; font-size: 13px; }
.sheet-wrap { padding: 16px; display: grid; justify-items: center; overflow-x: auto; }
.small { font-size: 13px; }
.ltr { direction: ltr; unicode-bidi: isolate; }
[dir='rtl'] .ltr { text-align: right; }
h2 { font-weight: 600; }
${SHEET_CSS}
.sheet .addr-foot { font-size: 8.5pt; }
.sheet .foot + .addr-foot { border-top: 0; margin-top: 2px; padding-top: 0; }
.xbox { cursor: default; }
@media (max-width: 600px) { .sheet-wrap { padding: 8px; } }
@media print {
  @page { size: auto; margin: 10mm; }
  body { background: #fff; }
  .bar, .hint { display: none !important; }
  .sheet-wrap { padding: 0; display: block; overflow: visible; }
  .sheet.a5, .sheet.a4 { width: 100%; min-height: 0; padding: 0; box-shadow: none; }
  .xbox .sq { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
@media print and (min-width: 160mm) { .sheet.a5 { zoom: 1.35; } }
</style>
</head>
<body>
<div class="bar">
<a href="${esc(back)}">${lang === 'ar' ? '→' : '←'} ${esc(t('app.back'))}</a>
<span class="grow"></span>
<a href="${esc(other.href)}" lang="${other.lang}">${esc(other.label)}</a>
<button type="button" class="primary" id="save">${esc(p)}</button>
</div>
<p class="hint">${esc(t('portal.page.docHint'))}</p>
<div class="sheet-wrap">${sheet}</div>
<script nonce="${nonce}">
document.getElementById('save').addEventListener('click', function () { window.print(); });
// On a phone the A5 / A4 sheet is wider than the screen: shrink it to fit (printing uses the full size again).
(function () {
  var sheet = document.querySelector('.sheet');
  function fit() {
    sheet.style.zoom = '';
    var room = document.documentElement.clientWidth - 16;
    var w = sheet.offsetWidth;
    if (w > room) sheet.style.zoom = String(room / w);
  }
  window.addEventListener('resize', fit);
  window.addEventListener('beforeprint', function () { sheet.style.zoom = ''; });
  window.addEventListener('afterprint', fit);
  fit();
})();
</script>
</body>
</html>`;
}
