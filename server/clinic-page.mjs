// The clinic's own little page (14 Nov 2026, Ahmed): the QR at the bottom left of every printed document opens it.
//   GET /clinic   name, who heads the clinic, address (Directions), phone (Call / WhatsApp) and Pay with InstaPay.
// Public, no token, nothing about any patient or owner. Details from the clinic settings and src/lib/clinic-info.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { clinicAddress } from './clinic.mjs';
import { PET_ICON } from './favicons.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (...p) => path.join(here, '..', 'src', ...p);
const INFO = JSON.parse(fs.readFileSync(src('lib', 'clinic-info.json'), 'utf8'));
const TEXT = {
  ar: JSON.parse(fs.readFileSync(src('i18n', 'ar.json'), 'utf8')).clinicPage,
  en: JSON.parse(fs.readFileSync(src('i18n', 'en.json'), 'utf8')).clinicPage,
};
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const imageOnly = (v) => (typeof v === 'string' && /^data:image\/(png|jpe?g|webp|gif);base64,/.test(v) ? v : null);
const e164 = (p) => {
  const d = String(p ?? '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('20')) return d;
  return d.startsWith('0') ? `20${d.slice(1)}` : d;
};

/** Handles /clinic; returns false for anything else. */
export async function handleClinicPage(pool, req, res, url) {
  if (url.pathname !== '/clinic' && url.pathname !== '/clinic/') return false;
  const s = (await pool.query("SELECT data FROM rows WHERE tbl = 'clinic_settings' AND NOT deleted ORDER BY seq LIMIT 1")).rows[0]?.data ?? {};
  const asked = url.searchParams.get('lang');
  const lang = asked === 'en' || asked === 'ar' ? asked : /^en/i.test(req.headers['accept-language'] ?? '') ? 'en' : 'ar';
  const t = TEXT[lang];
  const name = (lang === 'en' ? s.name_en : s.name_ar) || s.name_en || 'Animal Care Clinic';
  const address = clinicAddress(s.address);
  const phone = s.phone || '';
  const wa = e164(s.whatsapp || s.phone);
  const logo = imageOnly(s.logo_url);
  const ua = req.headers['user-agent'] ?? '';
  const maps = /iPhone|iPad|iPod|Macintosh/.test(ua) ? `https://maps.apple.com/?daddr=${encodeURIComponent(address)}` : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
  const other = lang === 'ar' ? 'en' : 'ar';
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  });
  res.end(req.method === 'HEAD' ? undefined : `<!doctype html>
<html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#2e6f73">
<title>${esc(name)}</title>
<link rel="icon" type="image/svg+xml" href="${PET_ICON}">
<style>
@font-face { font-family: 'Plex Arabic'; font-weight: 400; font-display: swap; src: url(/o-font/arabic-400.woff2) format('woff2'); unicode-range: U+0600-06FF, U+FB50-FDFF, U+FE70-FEFC; }
@font-face { font-family: 'Plex Arabic'; font-weight: 600; font-display: swap; src: url(/o-font/arabic-600.woff2) format('woff2'); unicode-range: U+0600-06FF, U+FB50-FDFF, U+FE70-FEFC; }
@font-face { font-family: 'Plex Arabic'; font-weight: 400; font-display: swap; src: url(/o-font/latin-400.woff2) format('woff2'); unicode-range: U+0000-00FF, U+2000-206F; }
@font-face { font-family: 'Plex Arabic'; font-weight: 600; font-display: swap; src: url(/o-font/latin-600.woff2) format('woff2'); unicode-range: U+0000-00FF, U+2000-206F; }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; background: linear-gradient(180deg, #2e6f73 0 190px, #eef3f2 190px); color: #1b1f23; font-family: 'Plex Arabic', system-ui, 'Segoe UI', Tahoma, sans-serif; font-size: 16px; line-height: 1.5; }
.wrap { max-width: 460px; margin: 0 auto; padding: 18px 16px 32px; }
.top { display: flex; justify-content: flex-end; }
.lang { color: #fff; text-decoration: none; font-weight: 600; font-size: 14px; border: 1px solid rgba(255,255,255,.5); border-radius: 999px; padding: 6px 14px; }
.card { background: #fff; border-radius: 16px; box-shadow: 0 6px 24px rgba(0,0,0,.10); padding: 22px 20px; margin-top: 14px; }
.brand { text-align: center; }
.brand img { max-width: 230px; max-height: 90px; object-fit: contain; }
h1 { font-size: 22px; margin: 8px 0 2px; color: #2e6f73; }
.head { color: #5b636b; margin: 0; }
.head b { color: #1b1f23; }
.row { display: flex; gap: 12px; align-items: flex-start; padding: 14px 0; border-top: 1px solid #e3e6e9; }
.row:first-of-type { border-top: 0; }
.ic { flex: none; width: 38px; height: 38px; border-radius: 10px; background: #e5f0f0; display: grid; place-items: center; font-size: 18px; }
.row small { display: block; color: #5b636b; font-size: 13px; }
.row .val { font-weight: 600; }
.ltr { direction: ltr; unicode-bidi: isolate; }
.btns { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 40px; padding: 0 16px; border-radius: 999px; border: 1px solid #c9d2d1; background: #fff; color: #1b1f23; font-weight: 600; font-size: 14px; text-decoration: none; }
.pay { display: flex; width: 100%; min-height: 56px; border-radius: 14px; background: #2e6f73; border-color: #2e6f73; color: #fff; font-size: 18px; margin-top: 18px; }
.hint { color: #5b636b; font-size: 13px; text-align: center; margin: 8px 0 0; }
</style>
</head>
<body>
<div class="wrap">
<div class="top"><a class="lang" href="/clinic?lang=${other}" lang="${other}">${other === 'en' ? 'English' : 'عربي'}</a></div>
<div class="card">
<div class="brand">
${logo ? `<img src="${esc(logo)}" alt="">` : ''}
<h1>${esc(name)}</h1>
<p class="head">${esc(t.headedBy)} <b>${esc(INFO.headedBy[lang])}</b></p>
</div>
<a class="btn pay" href="${esc(INFO.instapay)}" target="_blank" rel="noopener noreferrer">💳 ${esc(t.pay)}</a>
<p class="hint">${esc(t.payHint)}</p>
</div>
<div class="card">
<div class="row"><div class="ic">📍</div><div><small>${esc(t.address)}</small><div class="val" dir="auto">${esc(address)}</div>
<div class="btns"><a class="btn" href="${esc(maps)}" target="_blank" rel="noopener noreferrer">${esc(t.directions)}</a></div></div></div>
${phone ? `<div class="row"><div class="ic">📞</div><div><small>${esc(t.phone)}</small><div class="val ltr">${esc(phone)}</div>
<div class="btns"><a class="btn" href="tel:${esc(phone.replace(/[^\d+]/g, ''))}">${esc(t.call)}</a>${wa ? `<a class="btn" href="https://wa.me/${esc(wa)}" target="_blank" rel="noopener noreferrer">${esc(t.whatsapp)}</a>` : ''}</div></div></div>` : ''}
</div>
</div>
</body>
</html>`);
  return true;
}
