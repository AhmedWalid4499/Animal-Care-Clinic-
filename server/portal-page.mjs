// The owner page's HTML (Phase 6): one self-contained page, rendered in the browser from /o/<token>/data.
// Laid out like a small members' portal: a top bar, a welcome banner, and five views (Home, Pets,
// Appointments, Prescriptions, My details) as a bottom tab bar on phones and top tabs on wider screens.
// Everything from the records is added as text nodes, never parsed as HTML. Text comes from src/i18n.
const TZ = 'Africa/Cairo';

import { OWNER_ICON, PET_ICON } from './favicons.mjs';

export function pageHtml({ nonce, text, found }) {
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#2e6f73">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="/icon-192.png">
<title>Animal Care Clinic</title>
<link rel="icon" type="image/svg+xml" href="${OWNER_ICON}">
<style nonce="${nonce}">
@font-face { font-family: 'Plex Arabic'; font-weight: 400; font-display: swap; src: url(/o-font/arabic-400.woff2) format('woff2'); unicode-range: U+0600-06FF, U+0750-077F, U+0870-088E, U+0890-0891, U+0898-08E1, U+08E3-08FF, U+200C-200E, U+2010-2011, U+204F, U+2E41, U+FB50-FDFF, U+FE70-FE74, U+FE76-FEFC; }
@font-face { font-family: 'Plex Arabic'; font-weight: 600; font-display: swap; src: url(/o-font/arabic-600.woff2) format('woff2'); unicode-range: U+0600-06FF, U+0750-077F, U+0870-088E, U+0890-0891, U+0898-08E1, U+08E3-08FF, U+200C-200E, U+2010-2011, U+204F, U+2E41, U+FB50-FDFF, U+FE70-FE74, U+FE76-FEFC; }
@font-face { font-family: 'Plex Arabic'; font-weight: 400; font-display: swap; src: url(/o-font/latin-400.woff2) format('woff2'); unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }
@font-face { font-family: 'Plex Arabic'; font-weight: 600; font-display: swap; src: url(/o-font/latin-600.woff2) format('woff2'); unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }
:root {
  --bg: #f2f5f4; --card: #ffffff; --ink: #142120; --ink-2: #3f4e4c; --ink-3: #6f7d7b; --rule: #e1e7e5;
  --accent: #2e6f73; --accent-2: #1f5457; --accent-soft: #e4f0ef; --on-accent: #ffffff;
  --ok: #2f7a4b; --ok-soft: #e3f2e8; --warn: #9a5f08; --warn-soft: #fbf0dc; --bad: #b3362f; --bad-soft: #fae6e4; --info: #2e6f73;
  --radius: 14px; --radius-sm: 8px; --shadow: 0 1px 2px rgba(20,33,32,.06), 0 4px 16px rgba(20,33,32,.06);
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0d1312; --card: #161e1d; --ink: #e8efee; --ink-2: #b9c5c3; --ink-3: #8a9896; --rule: #26312f;
    --accent: #6fb3b7; --accent-2: #2e6f73; --accent-soft: #1b2e2e; --on-accent: #0b1514;
    --ok: #6cc08d; --ok-soft: #17291f; --warn: #e3a94f; --warn-soft: #2d2414; --bad: #ef7a72; --bad-soft: #321b19; --info: #6fb3b7;
    --shadow: 0 1px 2px rgba(0,0,0,.4); color-scheme: dark;
  }
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; scroll-padding-top: 120px; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 400 16px/1.55 'Plex Arabic', system-ui, -apple-system, 'Segoe UI', Tahoma, sans-serif; -webkit-tap-highlight-color: transparent; }
button { font: inherit; color: inherit; }
a { color: var(--accent); }
svg.i { width: 20px; height: 20px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
[dir="rtl"] svg.flip { transform: scaleX(-1); }
.wrap { max-width: 880px; margin: 0 auto; padding: 0 16px; }
:focus-visible { outline: 3px solid color-mix(in srgb, var(--accent) 55%, transparent); outline-offset: 2px; border-radius: 6px; }

/* top bar */
.topbar { position: sticky; top: 0; z-index: 20; background: color-mix(in srgb, var(--card) 92%, transparent); backdrop-filter: saturate(1.4) blur(10px); -webkit-backdrop-filter: saturate(1.4) blur(10px); border-bottom: 1px solid var(--rule); }
.topbar .wrap { display: flex; align-items: center; gap: 10px; min-height: 60px; padding-top: env(safe-area-inset-top); }
.brand { display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1; }
.brand img { width: 40px; height: 40px; object-fit: contain; border-radius: 10px; background: #fff; border: 1px solid var(--rule); }
.brand .mark { width: 40px; height: 40px; border-radius: 10px; display: grid; place-items: center; background: var(--accent); color: var(--on-accent); font-size: 20px; }
.brand b { display: block; font-weight: 600; line-height: 1.25; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.brand small { display: block; font-size: 12px; color: var(--ink-3); }
.pill { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; padding: 4px 10px; border-radius: 999px; background: var(--bg); color: var(--ink-3); white-space: nowrap; }
.status .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--warn); }
.status.on { color: var(--ok); background: var(--ok-soft); }
.status.on .dot { background: var(--ok); animation: pulse 2.4s ease-in-out infinite; }
@keyframes pulse { 0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--ok) 45%, transparent); } 50% { box-shadow: 0 0 0 5px transparent; } }
.lang { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--rule); background: var(--card); border-radius: 999px; min-height: 36px; padding: 4px 12px; font-size: 14px; font-weight: 600; cursor: pointer; color: var(--ink-2); }
.lang svg.i { width: 16px; height: 16px; }

/* banner */
.hero { background: linear-gradient(135deg, var(--accent) 0%, var(--accent-2) 100%); color: #fff; }
.hero .wrap { padding-top: 26px; padding-bottom: 30px; }
.hero h1 { margin: 0; font-size: clamp(22px, 5.5vw, 30px); font-weight: 600; line-height: 1.25; }
.hero p { margin: 6px 0 0; opacity: .9; max-width: 56ch; }
.hero .idchip { display: inline-block; margin-top: 10px; padding: 3px 12px; border-radius: 999px; background: rgba(255,255,255,.16); font-size: 14px; }
.hero .quick { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 18px; }
.hero .quick a { display: inline-flex; align-items: center; gap: 8px; min-height: 44px; padding: 8px 16px; border-radius: 999px; background: rgba(255,255,255,.16); color: #fff; text-decoration: none; font-weight: 600; font-size: 15px; border: 1px solid rgba(255,255,255,.25); }
.hero .quick a:active { background: rgba(255,255,255,.26); }

/* navigation: top tabs on wide screens, bottom tab bar on phones */
.tabs { position: sticky; top: 60px; z-index: 15; background: var(--card); border-bottom: 1px solid var(--rule); }
.tabs .wrap { display: flex; gap: 4px; overflow-x: auto; scrollbar-width: none; }
.tabs a { display: inline-flex; align-items: center; gap: 8px; padding: 14px 12px 12px; text-decoration: none; color: var(--ink-3); font-weight: 600; font-size: 15px; border-bottom: 3px solid transparent; white-space: nowrap; }
.tabs a.on { color: var(--accent); border-bottom-color: var(--accent); }
.tabs .badge-n { min-width: 20px; height: 20px; padding: 0 6px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); font-size: 12px; display: inline-grid; place-items: center; }
@media (max-width: 719px) {
  .tabs { position: fixed; top: auto; bottom: 0; inset-inline: 0; border-top: 1px solid var(--rule); border-bottom: 0; padding-bottom: env(safe-area-inset-bottom); box-shadow: 0 -2px 12px rgba(0,0,0,.05); }
  .tabs .wrap { padding: 0; gap: 0; justify-content: space-around; }
  .tabs a { flex: 1; flex-direction: column; gap: 2px; padding: 8px 2px 7px; font-size: 11px; border-bottom: 0; border-top: 3px solid transparent; min-width: 0; }
  .tabs a.on { border-top-color: var(--accent); }
  .tabs a svg.i { width: 22px; height: 22px; }
  .tabs .badge-n { display: none; }
  body { padding-bottom: calc(72px + env(safe-area-inset-bottom)); }
}

/* content */
main { padding: 20px 0 40px; }
.view { display: grid; gap: 16px; animation: enter .2s ease-out; }
@keyframes enter { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .view, .status.on .dot { animation: none; } }
.card { background: var(--card); border: 1px solid var(--rule); border-radius: var(--radius); box-shadow: var(--shadow); padding: 18px; min-width: 0; }
.card > h2, .section-title { margin: 0 0 12px; font-size: 17px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
.card > h2 .more, .section-title .more { margin-inline-start: auto; font-size: 14px; font-weight: 600; text-decoration: none; display: inline-flex; align-items: center; gap: 2px; }
.card > h2 .more svg.i { width: 16px; height: 16px; }
.section-title { margin: 6px 2px 0; }
.muted { color: var(--ink-3); }
.small { font-size: 13px; }
.ltr { direction: ltr; unicode-bidi: isolate; }
.grid2 { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }

.btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; padding: 8px 16px; border-radius: 999px; border: 1px solid var(--rule); background: var(--card); color: var(--ink); font-size: 15px; font-weight: 600; text-decoration: none; cursor: pointer; }
.btn.primary { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
.btn.sm { min-height: 38px; padding: 6px 14px; font-size: 14px; }
.btn svg.i { width: 18px; height: 18px; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }

/* next appointment */
.next { display: grid; grid-template-columns: auto 1fr; gap: 16px; align-items: center; background: var(--accent-soft); border-color: transparent; }
.datetile { width: 72px; text-align: center; border-radius: 12px; background: var(--card); border: 1px solid var(--rule); overflow: hidden; }
.datetile .m { display: block; background: var(--accent); color: var(--on-accent); font-size: 12px; font-weight: 600; padding: 3px 0; }
.datetile .d { display: block; font-size: 28px; font-weight: 600; line-height: 1.2; padding-top: 4px; }
.datetile .w { display: block; font-size: 12px; color: var(--ink-3); padding-bottom: 6px; }
.next .label { font-size: 13px; color: var(--accent); font-weight: 600; }
.next .when { font-size: 20px; font-weight: 600; line-height: 1.3; }
.next .actions { grid-column: 1 / -1; margin-top: 0; }

/* stats */
.stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
@media (max-width: 560px) { .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.stat { display: flex; flex-direction: column; gap: 6px; text-align: start; text-decoration: none; color: var(--ink); background: var(--card); border: 1px solid var(--rule); border-radius: var(--radius); padding: 14px; box-shadow: var(--shadow); }
.stat .ic { width: 36px; height: 36px; border-radius: 10px; display: grid; place-items: center; background: var(--accent-soft); color: var(--accent); }
.stat.warn .ic { background: var(--warn-soft); color: var(--warn); }
.stat b { font-size: 26px; font-weight: 600; line-height: 1.1; }
.stat span { font-size: 13px; color: var(--ink-3); }

/* lists */
.rows { list-style: none; margin: 0; padding: 0; }
.rows > li { display: flex; align-items: center; gap: 12px; padding: 12px 0; border-top: 1px solid var(--rule); }
.rows > li:first-child { border-top: 0; padding-top: 0; }
.rows > li:last-child { padding-bottom: 0; }
.rows .grow { flex: 1; min-width: 0; }
.rows .grow b { display: block; font-weight: 600; }
.icobox { width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; background: var(--accent-soft); color: var(--accent); flex: none; }
.icobox.bad { background: var(--bad-soft); color: var(--bad); } .icobox.warn { background: var(--warn-soft); color: var(--warn); } .icobox.ok { background: var(--ok-soft); color: var(--ok); }
.badge { display: inline-flex; align-items: center; font-size: 12px; font-weight: 600; padding: 2px 10px; border-radius: 999px; white-space: nowrap; background: var(--accent-soft); color: var(--info); }
.badge.bad { background: var(--bad-soft); color: var(--bad); } .badge.warn { background: var(--warn-soft); color: var(--warn); } .badge.ok { background: var(--ok-soft); color: var(--ok); } .badge.grey { background: var(--bg); color: var(--ink-3); }
.empty { display: flex; align-items: center; gap: 12px; color: var(--ink-3); }

/* pets */
.petstrip { display: flex; gap: 14px; overflow-x: auto; scrollbar-width: none; padding-bottom: 2px; }
.petstrip a.greyed { opacity: .55; }
.petstrip a { display: flex; flex-direction: column; align-items: center; gap: 6px; text-decoration: none; color: var(--ink); font-weight: 600; font-size: 14px; min-width: 72px; }
.avatar { width: 64px; height: 64px; border-radius: 50%; background: var(--accent-soft); display: grid; place-items: center; overflow: hidden; font-size: 30px; flex: none; border: 2px solid var(--card); box-shadow: 0 0 0 1px var(--rule); }
.avatar.lg { width: 84px; height: 84px; font-size: 40px; }
.avatar img { width: 100%; height: 100%; object-fit: cover; }
.pet-head { display: flex; align-items: center; gap: 16px; }
.pet-head h3 { margin: 0; font-size: 22px; font-weight: 600; line-height: 1.2; }
.pet.greyed .pet-head, .pet.greyed .chips { opacity: .6; }
.chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 14px 0 0; padding: 0; list-style: none; }
.chips li { background: var(--bg); border-radius: 10px; padding: 6px 12px; font-size: 14px; min-width: 0; }
.chips li span { display: block; font-size: 11px; color: var(--ink-3); }
.chips li b { font-weight: 600; }
.subhead { margin: 18px 0 8px; font-size: 14px; font-weight: 600; color: var(--ink-2); display: flex; align-items: center; gap: 6px; }

/* appointments */
.appt { display: grid; grid-template-columns: auto 1fr; gap: 14px; align-items: start; }
.appt .actions { margin-top: 10px; }
.appt .time { font-size: 18px; font-weight: 600; }

/* prescriptions */
.filters { display: flex; gap: 8px; overflow-x: auto; scrollbar-width: none; padding: 2px; }
.filters button { flex: none; border: 1px solid var(--rule); background: var(--card); border-radius: 999px; min-height: 38px; padding: 6px 16px; font-size: 14px; font-weight: 600; color: var(--ink-2); cursor: pointer; }
.filters button.on { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
.rxhead { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.rxhead b { font-size: 16px; }
.drug { display: grid; grid-template-columns: auto 1fr; gap: 12px; padding: 12px 0 0; margin-top: 12px; border-top: 1px dashed var(--rule); }
.drug .name { font-weight: 600; font-size: 16px; overflow-wrap: anywhere; }
.tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.tags span { font-size: 13px; background: var(--bg); border-radius: 8px; padding: 2px 8px; color: var(--ink-2); }
.drug .how { margin-top: 6px; font-size: 14px; color: var(--ink-2); }

/* requests */
.req-tags span { font-size: 13px; }
.xray-gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 12px; }
.xg-item { display: flex; flex-direction: column; gap: 6px; text-decoration: none; color: var(--ink-2); font-size: 13px; }
.xg-item img, .xg-file { width: 100%; aspect-ratio: 1; object-fit: contain; background: #000; border-radius: var(--radius-sm); }
.xg-file { display: grid; place-items: center; align-content: center; gap: 4px; background: var(--bg); color: var(--ink-3); }
.xg-file b { font-size: 13px; color: #d93025; }
.xg-name { font-size: 12px; color: var(--ink-3); overflow-wrap: anywhere; }
@media (max-width: 719px) { .tabs a span:not(.badge-n) { font-size: 10px; } }

/* pet profile */
a.pet-link { text-decoration: none; color: inherit; }
a.pet-link .grow { flex: 1; min-width: 0; }
.avatar.xl { width: 104px; height: 104px; font-size: 52px; }
.profile-name { margin: 0; font-size: 26px; font-weight: 600; line-height: 1.2; }
.back-link { display: inline-flex; align-items: center; gap: 4px; margin: 4px 2px 0; text-decoration: none; font-weight: 600; }
[dir="ltr"] svg.back, [dir="rtl"] svg.flip.back { transform: scaleX(-1); }
.wchart { width: 100%; height: 110px; display: block; margin: 4px 0 8px; }
.wchart polyline { fill: none; stroke: var(--accent); stroke-width: 2.5; stroke-linejoin: round; stroke-linecap: round; }
.wchart circle { fill: var(--accent); }
/* lost & found alert on the owner's page */
.found-alert { background: var(--bad-soft); border-color: var(--bad); }
.found-head { display: flex; gap: 12px; align-items: flex-start; }
.found-head b { font-size: 17px; color: var(--bad); }
.found-icon { font-size: 28px; line-height: 1; }
.found-msg { margin: 10px 0 0; font-size: 15px; }

/* lab results */
details.labday { border-top: 1px solid var(--rule); padding: 10px 0; }
details.labday summary { cursor: pointer; font-weight: 600; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-height: 32px; }
table.labt { width: 100%; border-collapse: collapse; font-size: 14px; margin-top: 8px; }
table.labt th { text-align: start; font-size: 12px; color: var(--ink-3); font-weight: 600; padding: 4px 6px 4px 0; border-bottom: 1px solid var(--rule); }
table.labt td { padding: 6px 6px 6px 0; border-bottom: 1px dashed var(--rule); vertical-align: top; }
table.labt tr.flag td { color: var(--bad); }
table.labt .badge { margin-inline-start: 6px; }

/* diagnoses */
.dx { margin-top: 10px; padding: 8px 12px; border-radius: var(--radius-sm); background: var(--bg); }
.dx span { display: block; font-size: 12px; color: var(--ink-3); }
.dx b { font-weight: 600; overflow-wrap: anywhere; }
details.more-visits { margin-top: 10px; }
details.more-visits summary { cursor: pointer; color: var(--accent); font-weight: 600; font-size: 14px; min-height: 36px; display: flex; align-items: center; }
details.more-visits .rows { margin-top: 8px; }

/* details */
.kv { list-style: none; margin: 0; padding: 0; }
.kv li { display: flex; align-items: center; gap: 12px; padding: 12px 0; border-top: 1px solid var(--rule); }
.kv li:first-child { border-top: 0; padding-top: 0; }
.kv span { display: block; font-size: 12px; color: var(--ink-3); }
.kv b { font-weight: 600; overflow-wrap: anywhere; }
.tip { background: var(--accent-soft); border-color: transparent; box-shadow: none; display: flex; gap: 12px; align-items: flex-start; font-size: 14px; color: var(--ink-2); }
.tip svg.i { color: var(--accent); margin-top: 2px; }

footer.site { padding: 8px 0 28px; font-size: 13px; color: var(--ink-3); text-align: center; }
footer.site b { color: var(--ink-2); }
.gone { min-height: 80vh; display: grid; place-items: center; text-align: center; padding: 24px 16px; }
.gone .avatar { margin: 0 auto 12px; }
.gone h1 { font-size: 22px; margin: 0 0 6px; }
.skeleton { height: 140px; margin: 20px 16px; border-radius: var(--radius); background: linear-gradient(90deg, var(--card), var(--bg), var(--card)); background-size: 200% 100%; animation: shimmer 1.2s linear infinite; }
@keyframes shimmer { to { background-position: -200% 0; } }
@media print {
  :root { --bg: #fff; --card: #fff; --shadow: none; }
  .topbar, .tabs, .hero .quick, .actions, .filters, .no-print, .status { display: none !important; }
  .hero { background: none; color: #000; }
  body { padding: 0; }
  .card { break-inside: avoid; box-shadow: none; }
}
</style>
</head>
<body>
<div id="app"><div class="skeleton"></div></div>
<script nonce="${nonce}">
(() => {
  const TEXT = ${text};
  const FOUND = ${found ? 'true' : 'false'};
  const TZ = '${TZ}';
  const EMOJI = { DOG: '🐕', CAT: '🐈', BIRD: '🐦', RABBIT: '🐇', REPTILE: '🦎', OTHER: '🐾' };
  const ICONS = {
    home: 'M3 11l9-7 9 7M5 10v10h14V10',
    paw: 'M12 13c-3 0-5 3-5 5s2 2.5 5 2.5 5-.5 5-2.5-2-5-5-5zM6 9a2 2 0 100-4 2 2 0 000 4zM18 9a2 2 0 100-4 2 2 0 000 4zM9.5 6a2 2 0 100-4 2 2 0 000 4zM14.5 6a2 2 0 100-4 2 2 0 000 4z',
    calendar: 'M4 5h16v15H4zM4 9h16M9 3v4M15 3v4',
    pill: 'M10.5 20.5a5 5 0 01-7-7l6-6a5 5 0 017 7zM8.5 8.5l7 7',
    user: 'M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z',
    phone: 'M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 012.1 4.2 2 2 0 014.1 2h3a2 2 0 012 1.7c.1 1 .4 1.9.7 2.8a2 2 0 01-.5 2.1L8 9.9a16 16 0 006 6l1.3-1.3a2 2 0 012.1-.5c.9.3 1.8.6 2.8.7a2 2 0 011.7 2z',
    chat: 'M21 11.5a8.4 8.4 0 01-12.3 7.4L3 21l2.1-5.6A8.4 8.4 0 1121 11.5z',
    print: 'M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6z',
    syringe: 'M18 2l4 4M17 7l3-3M19 9L9 19l-4 1 1-4L16 6zM14 8l2 2M11 11l2 2',
    check: 'M20 6L9 17l-5-5',
    alert: 'M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z',
    chevron: 'M9 18l6-6-6-6',
    download: 'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3',
    globe: 'M12 22a10 10 0 100-20 10 10 0 000 20zM2 12h20M12 2a15 15 0 010 20M12 2a15 15 0 000 20',
    mail: 'M4 4h16v16H4zM4 6l8 7 8-7',
    pin: 'M12 22s-7-6.1-7-12a7 7 0 0114 0c0 5.9-7 12-7 12zM12 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z',
    shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
    eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 100-6 3 3 0 000 6z',
    clip: 'M9 4h6v3H9zM9 5H6a1 1 0 00-1 1v14a1 1 0 001 1h12a1 1 0 001-1V6a1 1 0 00-1-1h-3M9 12h6M9 16h4',
    flask: 'M9 3h6M10 3v6L4.5 18.5A1.7 1.7 0 006 21h12a1.7 1.7 0 001.5-2.5L14 9V3M7.5 15h9',
    steth: 'M5 3v6a5 5 0 0010 0V3M10 14v2a5 5 0 0010 0v-2M20 11a2 2 0 100 4 2 2 0 000-4z',
    chart: 'M3 3v18h18M7 15l4-4 3 3 5-6',
    star: 'M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z',
  };
  const VIEWS = ['home', 'pets', 'appointments', 'prescriptions', 'requests', 'details'];
  const NAV_ICON = { home: 'home', pets: 'paw', appointments: 'calendar', prescriptions: 'pill', requests: 'clip', details: 'user' };
  const base = location.pathname.replace(/\\/+$/, '');
  let lang = null;
  try { lang = localStorage.getItem('owner-page-lang'); } catch (e) {}
  let d = null;
  let petFilter = 'all';
  let connected = true;
  let gone = !FOUND;

  const L = () => lang || (d && d.clinic.locale) || 'ar';
  const T = () => TEXT[L()];
  const fill = (s, v) => Object.keys(v || {}).reduce((a, k) => a.split('{' + k + '}').join(String(v[k])), s || '');
  const t = (k, v) => fill(k.split('.').reduce((o, p) => (o ? o[p] : undefined), T()) || k, v);
  // '#pet:<id>' is a pet's own profile (shown under the Pets tab).
  const profileId = () => (location.hash.startsWith('#pet:') ? decodeURIComponent(location.hash.slice(5)) : null);
  const view = () => { if (profileId()) return 'pets'; const v = location.hash.slice(1); return VIEWS.includes(v) ? v : 'home'; };

  // Elements are built from text nodes only: nothing from the records is ever parsed as HTML.
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
    return el;
  }
  function icon(name, cls) {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('class', 'i' + (cls ? ' ' + cls : ''));
    s.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', ICONS[name] || '');
    s.append(p);
    return s;
  }

  // ---- formatting (clinic time: Cairo; vaccination dates are calendar days)
  const tag = () => (L() === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB');
  const isDay = (s) => typeof s === 'string' && s.length === 10;
  const asDate = (s) => (isDay(s) ? new Date(s + 'T00:00:00Z') : new Date(s));
  const zone = (s) => (isDay(s) ? 'UTC' : TZ);
  const f = (s, o) => new Intl.DateTimeFormat(tag(), Object.assign({ timeZone: zone(s) }, o)).format(asDate(s));
  const fmtDate = (s) => (s ? f(s, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
  const fmtLong = (s) => f(s, { weekday: 'long', day: 'numeric', month: 'long' });
  const fmtTime = (s) => f(s, { hour: 'numeric', minute: '2-digit' });
  const fmtNum = (n, digits) => new Intl.NumberFormat(tag(), { maximumFractionDigits: digits }).format(n);
  const dayOf = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });
  const todayStr = () => dayOf(new Date().toISOString());
  const daysUntil = (day) => Math.round((Date.parse(day + 'T00:00:00Z') - Date.parse(todayStr() + 'T00:00:00Z')) / 86400000);
  function age(dob) {
    const [y, m, dd] = dob.split('-').map(Number);
    const [ty, tm, td] = todayStr().split('-').map(Number);
    let months = (ty - y) * 12 + (tm - m) - (td < dd ? 1 : 0);
    if (months < 0) months = 0;
    return { y: Math.floor(months / 12), m: months % 12 };
  }
  const e164 = (raw) => {
    if (!raw) return null;
    let n = String(raw).replace(/[^\\d+]/g, '');
    if (n.startsWith('+')) n = n.slice(1); else if (n.startsWith('00')) n = n.slice(2); else if (n.startsWith('0')) n = '20' + n.slice(1);
    return n.length >= 10 ? n : null;
  };
  const clinicName = () => (L() === 'en' ? d.clinic.name_en : d.clinic.name_ar) || d.clinic.name_en || d.clinic.name_ar || '';
  const firstName = () => String(d.owner.full_name || '').trim().split(/\\s+/)[0];
  const activePets = () => d.pets.filter((p) => p.status === 'ACTIVE');
  function greeting() {
    const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: TZ }).format(new Date()));
    return t(hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening', { name: firstName() });
  }
  function relDay(iso) {
    const n = daysUntil(dayOf(iso));
    if (n <= 0) return t('today');
    if (n === 1) return t('tomorrow');
    return t('inDays', { n });
  }
  function vaccState(v) {
    if (!v.next_due_at) return { cls: 'grey', text: null, n: null };
    const n = daysUntil(v.next_due_at);
    if (n < 0) return { cls: 'bad', text: t('overdue'), n };
    if (n === 0) return { cls: 'warn', text: t('dueToday'), n };
    if (n <= 7) return { cls: 'warn', text: t('dueIn', { n }), n };
    if (n <= 30) return { cls: 'info', text: t('dueIn', { n }), n };
    return { cls: 'ok', text: t('upToDate'), n };
  }
  const attention = () => activePets().flatMap((p) => p.vaccinations.map((v) => ({ p, v, s: vaccState(v) })))
    .filter((x) => x.s.n != null && x.s.n <= 30).sort((a, b) => a.s.n - b.s.n);

  // ---- calendar links
  function googleLink(a) {
    const start = new Date(a.scheduled_at);
    const end = new Date(start.getTime() + a.duration_min * 60000);
    const z = (x) => x.toISOString().replace(/[-:]/g, '').replace(/\\.\\d{3}/, '');
    const q = new URLSearchParams({
      action: 'TEMPLATE',
      text: t('eventTitle', { pet: a.pet_name, type: t('visitType.' + a.type), clinic: clinicName() }),
      dates: z(start) + '/' + z(end),
      details: [[d.clinic.phone, d.clinic.whatsapp].filter(Boolean).filter((v, i, xs) => xs.indexOf(v) === i).join(' · '),
        d.clinic.address ? t('directionsIcs', { url: 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(d.clinic.address) }) : ''].filter(Boolean).join('\\n'),
      location: [clinicName(), d.clinic.address].filter(Boolean).join(', '),
      ctz: TZ,
    });
    return 'https://calendar.google.com/calendar/render?' + q.toString();
  }
  // Directions to the clinic: Apple Maps on iPhone / iPad / Mac, Google Maps everywhere else.
  const directionsUrl = (addr) => {
    const q = encodeURIComponent(addr);
    return /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent) ? 'https://maps.apple.com/?daddr=' + q : 'https://www.google.com/maps/dir/?api=1&destination=' + q;
  };
  const feed = () => location.host + base + '/calendar.ics?lang=' + L();
  const calButtons = (a) => h('div', { class: 'actions' },
    h('a', { class: 'btn sm', href: googleLink(a), target: '_blank', rel: 'noopener noreferrer' }, icon('calendar'), t('addGoogle')),
    h('a', { class: 'btn sm', href: base + '/a/' + encodeURIComponent(a.id) + '.ics?lang=' + L(), download: '' }, icon('download'), t('addIcs')),
    d.clinic.address ? h('a', { class: 'btn sm directions', href: directionsUrl(d.clinic.address), target: '_blank', rel: 'noopener noreferrer' }, icon('pin'), t('directions')) : null);
  const waClinic = () => e164(d.clinic.whatsapp || d.clinic.phone);
  const petName = (id) => (d.pets.find((p) => p.id === id) || {}).name || '';
  const avatar = (p, cls) => h('div', { class: 'avatar' + (cls ? ' ' + cls : '') }, p.photo ? h('img', { src: p.photo, alt: '' }) : EMOJI[p.species] || '🐾');
  const go = (v) => ({ href: '#' + v });

  // ---- chrome
  function topbar() {
    const other = L() === 'ar' ? 'en' : 'ar';
    return h('header', { class: 'topbar' }, h('div', { class: 'wrap' },
      h('div', { class: 'brand' },
        d.clinic.logo ? h('img', { src: d.clinic.logo, alt: '' }) : h('div', { class: 'mark' }, '🐾'),
        h('div', { class: 'grow' }, h('b', null, clinicName()), h('small', null, t('portalName')))),
      statusPill(),
      h('button', { class: 'lang', type: 'button', lang: other, onclick: () => setLang(other) }, icon('globe'), other === 'en' ? 'English' : 'عربي')));
  }
  function statusPill() {
    return h('span', { class: 'pill status ' + (connected ? 'on' : 'off'), role: 'status', 'aria-live': 'polite', title: connected ? t('updated', { time: fmtTime(d.at) }) : t('reconnecting') },
      h('span', { class: 'dot' }), connected ? t('live') : t('offline'));
  }
  function hero() {
    const phone = d.clinic.phone || d.clinic.whatsapp;
    const wa = waClinic();
    return h('section', { class: 'hero' }, h('div', { class: 'wrap' },
      h('h1', { class: 'hello' }, greeting()),
      h('p', null, t('lead', { clinic: clinicName() })),
      d.owner.code ? h('div', { class: 'idchip' }, t('customerId'), ' ', h('b', { class: 'ltr' }, d.owner.code)) : null,
      h('div', { class: 'quick' },
        phone ? h('a', { href: 'tel:' + String(phone).replace(/[^\\d+]/g, '') }, icon('phone'), t('callClinic')) : null,
        wa ? h('a', { href: 'https://wa.me/' + wa, target: '_blank', rel: 'noopener noreferrer' }, icon('chat'), t('whatsappClinic')) : null,
        d.clinic.address ? h('a', { class: 'directions', href: directionsUrl(d.clinic.address), target: '_blank', rel: 'noopener noreferrer' }, icon('pin'), t('directions')) : null)));
  }
  function tabs() {
    const counts = { appointments: d.appointments.length, prescriptions: d.prescriptions.length, pets: d.pets.length, requests: (d.requests || []).length };
    return h('nav', { class: 'tabs', 'aria-label': clinicName() }, h('div', { class: 'wrap' },
      VIEWS.map((v) => h('a', { href: '#' + v, class: view() === v ? 'on' : null, 'aria-current': view() === v ? 'page' : null },
        icon(NAV_ICON[v]), h('span', null, t('nav.' + v)), counts[v] ? h('span', { class: 'badge-n' }, counts[v]) : null))));
  }

  // ---- views
  function nextCard() {
    const a = d.appointments[0];
    if (!a) {
      const wa = waClinic();
      return h('div', { class: 'card next' },
        h('div', { class: 'icobox' }, icon('calendar')),
        h('div', null, h('div', { class: 'label' }, t('nextAppointment')), h('b', null, t('noNext')), h('div', { class: 'muted small' }, t('bookHint'))),
        wa ? h('div', { class: 'actions' }, h('a', { class: 'btn sm primary', href: 'https://wa.me/' + wa, target: '_blank', rel: 'noopener noreferrer' }, icon('chat'), t('book'))) : null);
    }
    return h('div', { class: 'card next' },
      dateTile(a.scheduled_at),
      h('div', null,
        h('div', { class: 'label' }, t('nextAppointment'), ' · ', relDay(a.scheduled_at)),
        h('div', { class: 'when' }, fmtLong(a.scheduled_at), ' · ', h('bdi', null, fmtTime(a.scheduled_at))),
        h('div', { class: 'muted' }, a.pet_name, ' · ', t('visitType.' + a.type), ' · ', t('minutes', { n: a.duration_min }))),
      calButtons(a));
  }
  function dateTile(iso) {
    return h('div', { class: 'datetile', 'aria-hidden': 'true' },
      h('span', { class: 'm' }, f(iso, { month: 'short' })),
      h('span', { class: 'd' }, f(iso, { day: 'numeric' })),
      h('span', { class: 'w' }, f(iso, { weekday: 'short' })));
  }
  function stats() {
    const due = attention().filter((x) => x.s.n <= 7).length;
    const tile = (v, ic, n, label, warn) => h('a', Object.assign({ class: 'stat' + (warn ? ' warn' : '') }, go(v)),
      h('span', { class: 'ic' }, icon(ic)), h('b', null, n), h('span', null, label));
    return h('div', { class: 'stats' },
      tile('pets', 'paw', activePets().length, t('statPets')),
      tile('appointments', 'calendar', d.appointments.length, t('statAppointments')),
      tile('pets', 'syringe', due, t('statDue'), due > 0),
      tile('prescriptions', 'pill', d.prescriptions.length, t('statRx')));
  }
  function attentionCard() {
    const list = attention();
    return h('div', { class: 'card' },
      h('h2', null, icon('syringe'), t('attention')),
      list.length ? h('ul', { class: 'rows' }, list.map(({ p, v, s }) => h('li', null,
        h('div', { class: 'icobox ' + (s.cls === 'bad' ? 'bad' : s.cls === 'warn' ? 'warn' : '') }, icon(s.cls === 'bad' ? 'alert' : 'syringe')),
        h('div', { class: 'grow' }, h('b', null, v.name + ' · ' + p.name), h('span', { class: 'muted small' }, t('nextDue', { date: fmtDate(v.next_due_at) }))),
        h('span', { class: 'badge ' + s.cls }, s.text))))
        : h('div', { class: 'empty' }, h('div', { class: 'icobox ok' }, icon('check')), t('allGood')));
  }
  function latestRxCard() {
    const v = d.prescriptions[0];
    return h('div', { class: 'card' },
      h('h2', null, icon('pill'), t('latestRx'), d.prescriptions.length ? h('a', Object.assign({ class: 'more' }, go('prescriptions')), t('seeAll'), icon('chevron', 'flip')) : null),
      v ? [h('div', { class: 'muted small' }, fmtDate(v.visited_at) + ' · ' + v.pet_name + (v.vet_name ? ' · ' + t('byVet', { name: v.vet_name }) : '')),
        v.diagnosis ? h('div', { class: 'dx' }, h('span', null, t('diagnosis')), h('b', null, v.diagnosis)) : null, v.items.map(drug)]
        : h('div', { class: 'empty' }, t('noPrescriptions')));
  }
  function petStrip() {
    return h('div', { class: 'card' },
      h('h2', null, icon('paw'), t('pets'), h('a', Object.assign({ class: 'more' }, go('pets')), t('seeAll'), icon('chevron', 'flip'))),
      d.pets.length ? h('div', { class: 'petstrip' }, activePets().concat(d.pets.filter((p) => p.status !== 'ACTIVE')).map((p) =>
        h('a', { class: p.status !== 'ACTIVE' ? 'greyed' : null, href: '#pet:' + encodeURIComponent(p.id) }, avatar(p), p.name)))
        : h('div', { class: 'empty' }, t('noPets')));
  }
  function homeView() {
    return [foundBanner(), nextCard(), stats(), h('div', { class: 'grid2' }, attentionCard(), latestRxCard()), petStrip()];
  }

  function petsView() {
    if (!d.pets.length) return [h('div', { class: 'card empty' }, h('div', { class: 'icobox' }, icon('paw')), t('noPets'))];
    return d.pets.map((p) => {
      const a = p.date_of_birth ? age(p.date_of_birth) : null;
      const chips = [
        [t('sexLabel'), t('sex.' + p.sex) + (p.is_neutered ? ' · ' + t('neutered') : '')],
        a ? [t('age'), fill(T().ageValue, { y: a.y, m: a.m }) + (p.dob_is_estimate ? ' (' + t('estimate') + ')' : '')] : null,
        p.weight ? [t('weight'), fmtNum(p.weight.kg, 2) + ' ' + t('kg')] : null,
        p.color ? [t('color'), p.color] : null,
        p.microchip_no ? [t('microchip'), p.microchip_no, true] : null,
      ].filter(Boolean);
      return h('article', { class: 'card pet' + (p.status !== 'ACTIVE' ? ' greyed' : ''), id: 'pet-' + p.id },
        h('a', { class: 'pet-head pet-link', href: '#pet:' + encodeURIComponent(p.id) }, avatar(p, 'lg'),
          h('div', { class: 'grow' },
            h('h3', null, p.name),
            h('div', { class: 'muted' }, t('species.' + p.species), p.breed ? ' · ' + p.breed : ''),
            p.status !== 'ACTIVE' ? h('span', { class: 'badge grey' }, t('petStatus.' + p.status)) : null),
          h('span', { class: 'btn sm' }, t('openProfile'), icon('chevron', 'flip'))),
        h('ul', { class: 'chips' }, chips.map(([k, v, ltr]) => h('li', null, h('span', null, k), h('b', ltr ? { class: 'ltr' } : null, v)))),
        h('div', { class: 'subhead' }, icon('syringe'), t('vaccinations')),
        p.vaccinations.length ? h('ul', { class: 'rows' }, p.vaccinations.map((v) => {
          const s = vaccState(v);
          return h('li', null,
            h('div', { class: 'icobox ' + (s.cls === 'bad' ? 'bad' : s.cls === 'warn' ? 'warn' : s.cls === 'ok' ? 'ok' : '') }, icon(s.cls === 'ok' ? 'check' : s.cls === 'bad' ? 'alert' : 'syringe')),
            h('div', { class: 'grow' }, h('b', null, v.name),
              h('span', { class: 'muted small' }, t('given', { date: fmtDate(v.administered_at) }), v.next_due_at ? ' · ' + t('nextDue', { date: fmtDate(v.next_due_at) }) : '')),
            s.text && p.status === 'ACTIVE' ? h('span', { class: 'badge ' + s.cls }, s.text) : null);
        })) : h('div', { class: 'muted small' }, t('noVaccinations')),
        labSection(p),
        visitHistory(p));
    });
  }

  function labSection(p) {
    const days = p.labs || [];
    if (!days.length) return null;
    const rng = (r) => (r.ref_low != null && r.ref_high != null ? r.ref_low + '–' + r.ref_high : r.ref_low != null ? '≥ ' + r.ref_low : r.ref_high != null ? '≤ ' + r.ref_high : '');
    const table = (day) => h('table', { class: 'labt' },
      h('thead', null, h('tr', null, h('th', null, t('labTest')), h('th', null, t('labResult')), h('th', null, t('labRange')))),
      h('tbody', null, day.items.map((r) => h('tr', { class: r.flag ? 'flag' : null },
        h('td', null, r.panel ? h('span', { class: 'muted small' }, r.panel + ' · ') : null, r.analyte),
        h('td', { class: 'ltr' }, h('b', null, r.value != null ? fmtNum(r.value, 2) : r.value_text || '—'), r.unit ? ' ' + r.unit : '',
          r.flag ? h('span', { class: 'badge bad' }, t(r.flag === 'H' ? 'labHigh' : 'labLow')) : null),
        h('td', { class: 'ltr muted' }, rng(r))))));
    return [
      h('div', { class: 'subhead' }, icon('flask'), t('labResults')),
      days.map((day, i) => h('details', { class: 'labday', open: i === 0 ? true : null },
        h('summary', null, fmtDate(day.date), ' · ', t('labCount', { n: day.items.length }),
          day.items.some((r) => r.flag) ? h('span', { class: 'badge warn' }, t('labFlagged')) : null),
        table(day))),
    ];
  }

  function visitHistory(p) {
    const list = p.visits || [];
    const row = (v) => h('li', null,
      h('div', { class: 'icobox' }, icon('steth')),
      h('div', { class: 'grow' },
        h('b', null, v.diagnosis || t('noDiagnosis')),
        h('span', { class: 'muted small' }, fmtDate(v.visited_at) + ' · ' + t('visitType.' + v.type) + (v.vet_name ? ' · ' + t('byVet', { name: v.vet_name }) : ''))));
    return [
      h('div', { class: 'subhead' }, icon('steth'), t('visitHistory')),
      !list.length ? h('div', { class: 'muted small' }, t('noVisits'))
        : list.length <= 3 ? h('ul', { class: 'rows' }, list.map(row))
        : [h('ul', { class: 'rows' }, list.slice(0, 3).map(row)),
          h('details', { class: 'more-visits' }, h('summary', null, t('allVisits', { n: list.length })), h('ul', { class: 'rows' }, list.slice(3).map(row)))],
    ];
  }

  function appointmentsView() {
    const list = d.appointments;
    return [
      list.length ? list.map((a) => h('article', { class: 'card appt' },
        dateTile(a.scheduled_at),
        h('div', null,
          h('div', { class: 'time' }, h('bdi', null, fmtTime(a.scheduled_at)), ' · ', h('span', { class: 'muted' }, relDay(a.scheduled_at))),
          h('div', null, h('b', null, a.pet_name), ' · ', t('visitType.' + a.type)),
          h('div', { class: 'muted small' }, fmtLong(a.scheduled_at), ' · ', t('minutes', { n: a.duration_min })),
          calButtons(a))))
        : h('div', { class: 'card' }, h('div', { class: 'empty' }, h('div', { class: 'icobox' }, icon('calendar')), h('div', null, h('b', null, t('noAppointments')), h('div', { class: 'small' }, t('bookHint'))))),
      h('div', { class: 'card tip no-print' }, icon('star'),
        h('div', null,
          h('b', null, t('subscribe')),
          h('div', null, t('subscribeHint')),
          h('div', { class: 'actions' },
            h('a', { class: 'btn sm primary', href: 'webcal://' + feed() }, icon('calendar'), t('subscribeApple')),
            h('a', { class: 'btn sm', href: 'https://calendar.google.com/calendar/render?cid=' + encodeURIComponent('webcal://' + feed()), target: '_blank', rel: 'noopener noreferrer' }, icon('calendar'), t('subscribeGoogle'))))),
    ];
  }

  function drug(r) {
    const tags = [r.dose, r.frequency, r.duration_days ? t('days', { n: r.duration_days }) : null].filter(Boolean);
    return h('div', { class: 'drug' },
      h('div', { class: 'icobox' }, icon('pill')),
      h('div', null,
        h('div', { class: 'name' }, r.drug),
        tags.length ? h('div', { class: 'tags' }, tags.map((x) => h('span', null, x))) : null,
        r.instructions ? h('div', { class: 'how' }, r.instructions) : null));
  }
  function prescriptionsView() {
    const all = d.prescriptions;
    if (!all.length) return [h('div', { class: 'card' }, h('div', { class: 'empty' }, h('div', { class: 'icobox' }, icon('pill')), t('noPrescriptions')))];
    const petIds = [...new Set(all.map((v) => v.pet_id))];
    if (petFilter !== 'all' && !petIds.includes(petFilter)) petFilter = 'all';
    const list = petFilter === 'all' ? all : all.filter((v) => v.pet_id === petFilter);
    return [
      petIds.length > 1 ? h('div', { class: 'filters', role: 'group' },
        h('button', { type: 'button', class: petFilter === 'all' ? 'on' : null, onclick: () => { petFilter = 'all'; render(); } }, t('allPets')),
        petIds.map((id) => h('button', { type: 'button', class: petFilter === id ? 'on' : null, onclick: () => { petFilter = id; render(); } }, petName(id) || '—'))) : null,
      list.map((v) => h('article', { class: 'card' },
        h('div', { class: 'rxhead' }, h('b', null, fmtDate(v.visited_at)), h('span', { class: 'badge' }, v.pet_name), h('span', { class: 'muted small' }, t('visitType.' + v.type) + (v.vet_name ? ' · ' + t('byVet', { name: v.vet_name }) : ''))),
        v.diagnosis ? h('div', { class: 'dx' }, h('span', null, t('diagnosis')), h('b', null, v.diagnosis)) : null,
        v.items.map(drug))),
      h('div', { class: 'actions no-print' }, h('button', { type: 'button', class: 'btn', onclick: () => window.print() }, icon('print'), t('print'))),
    ];
  }

  // ---- requests: X-ray and lab requests from the vet, and the pet's X-ray images
  let reqPet = 'all';
  function itemLabel(kind, key) {
    if (kind === 'LAB') return (T().labTests || {})[key] || key;
    const p = key.split('.');
    if (p[0] === 'opt') return t('xray.opt.' + p[1]);
    return t('xray.region.' + p[0]) + ': ' + t('xray.view.' + p[1]) + (p[2] ? ' (' + t(p[2] === 'L' ? 'xray.left' : 'xray.right') + ')' : '');
  }
  function requestCard(r) {
    return h('article', { class: 'card req-card' },
      h('div', { class: 'rxhead' },
        h('b', null, fmtDate(r.requested_at)), h('span', { class: 'badge' }, r.pet_name),
        h('span', { class: 'badge ' + (r.status === 'DONE' ? 'ok' : 'info') }, t('reqStatus.' + r.status)),
        r.by ? h('span', { class: 'muted small' }, t('requestedBy', { name: r.by })) : null),
      r.items.length ? h('div', { class: 'tags req-tags' }, r.items.map((k) => h('span', { dir: r.kind === 'LAB' ? 'ltr' : null }, itemLabel(r.kind, k)))) : null,
      r.other ? h('div', { class: 'dx' }, h('span', null, t('otherTests')), h('b', null, r.other)) : null,
      r.notes ? h('div', { class: 'dx' }, h('span', null, t('vetNotes')), h('b', null, r.notes)) : null);
  }
  function fileGallery(list) {
    return h('div', { class: 'card xray-gallery' }, list.map((x) => h('a', { href: base + '/f/' + encodeURIComponent(x.id), target: '_blank', rel: 'noopener', class: 'xg-item' },
      x.image ? h('img', { src: base + '/f/' + encodeURIComponent(x.id), alt: x.file_name, loading: 'lazy' }) : h('div', { class: 'xg-file' }, icon('download'), h('b', null, (x.file_name.split('.').pop() || '').toUpperCase())),
      h('span', null, fmtDate(x.at) + ' · ' + x.pet_name),
      h('span', { class: 'xg-name', dir: 'auto' }, x.file_name))));
  }
  function requestsView() {
    const reqs = d.requests || [];
    const xr = d.xrays || [];
    if (!reqs.length && !xr.length) return [h('div', { class: 'card' }, h('div', { class: 'empty' }, h('div', { class: 'icobox' }, icon('clip')), t('noRequests')))];
    const petIds = [...new Set([...reqs.map((r) => r.pet_id), ...xr.map((x) => x.pet_id)])];
    if (reqPet !== 'all' && !petIds.includes(reqPet)) reqPet = 'all';
    const mine = (x) => reqPet === 'all' || x.pet_id === reqPet;
    const xrayReqs = reqs.filter((r) => r.kind === 'XRAY' && mine(r));
    const labReqs = reqs.filter((r) => r.kind === 'LAB' && mine(r));
    const imgs = xr.filter((x) => x.kind !== 'LAB' && mine(x));
    const labFiles = xr.filter((x) => x.kind === 'LAB' && mine(x));
    return [
      petIds.length > 1 ? h('div', { class: 'filters', role: 'group' },
        h('button', { type: 'button', class: reqPet === 'all' ? 'on' : null, onclick: () => { reqPet = 'all'; render(); } }, t('allPets')),
        petIds.map((id) => h('button', { type: 'button', class: reqPet === id ? 'on' : null, onclick: () => { reqPet = id; render(); } }, petName(id) || '—'))) : null,
      xrayReqs.length ? [h('h2', { class: 'section-title' }, icon('clip'), t('xrayRequests')), xrayReqs.map(requestCard)] : null,
      imgs.length ? [h('h2', { class: 'section-title' }, icon('eye'), t('xrayImages')), fileGallery(imgs)] : null,
      labReqs.length ? [h('h2', { class: 'section-title' }, icon('flask'), t('labRequests')), labReqs.map(requestCard)] : null,
      labFiles.length ? [h('h2', { class: 'section-title' }, icon('download'), t('labFiles')), fileGallery(labFiles)] : null,
    ];
  }

  function detailsView() {
    const o = d.owner;
    const row = (ic, label, value, ltr) => (value ? h('li', null, h('div', { class: 'icobox' }, icon(ic)), h('div', null, h('span', null, label), h('b', ltr ? { class: 'ltr' } : null, value))) : null);
    const wa = waClinic();
    return [
      h('div', { class: 'card' },
        h('h2', null, icon('user'), t('yourDetails')),
        h('ul', { class: 'kv' },
          row('shield', t('customerId'), o.code, true),
          row('user', t('name'), o.full_name),
          row('phone', t('phone'), o.phone, true),
          o.whatsapp && o.whatsapp !== o.phone ? row('chat', t('whatsapp'), o.whatsapp, true) : null,
          row('mail', t('email'), o.email, true),
          row('pin', t('address'), o.address)),
        h('div', { class: 'actions' },
          h('span', { class: 'muted small' }, t('detailsHint')),
          wa ? h('a', { class: 'btn sm', href: 'https://wa.me/' + wa, target: '_blank', rel: 'noopener noreferrer' }, icon('chat'), t('whatsappClinic')) : null)),
      h('div', { class: 'card' },
        h('h2', null, icon('home'), t('contactTitle')),
        h('ul', { class: 'kv' },
          row('home', t('name'), clinicName()),
          row('phone', t('phone'), d.clinic.phone, true),
          d.clinic.whatsapp && d.clinic.whatsapp !== d.clinic.phone ? row('chat', t('whatsapp'), d.clinic.whatsapp, true) : null,
          row('pin', t('address'), d.clinic.address)),
        d.clinic.address ? h('div', { class: 'actions' }, h('a', { class: 'btn sm primary directions', href: directionsUrl(d.clinic.address), target: '_blank', rel: 'noopener noreferrer' }, icon('pin'), t('directions'))) : null),
      h('div', { class: 'card tip' }, icon('download'), h('div', null, t('installHint'))),
      h('div', { class: 'card tip' }, icon('shield'), h('div', null, t('privacy'))),
    ];
  }

  // ---- lost & found: someone scanned a collar tag and pressed Alert
  function mapLink(f) { return 'https://www.google.com/maps?q=' + f.lat + ',' + f.lng; }
  function foundBanner(petId) {
    const list = (d.found || []).filter((f) => !petId || f.pet_id === petId);
    if (!list.length) return null;
    return list.map((f) => {
      const wa = e164(f.finder_phone);
      return h('div', { class: 'card found-alert', role: 'alert' },
        h('div', { class: 'found-head' }, h('span', { class: 'found-icon' }, '🚨'),
          h('div', null, h('b', null, t('foundTitle', { pet: f.pet_name })), h('div', { class: 'small' }, t('foundWhen', { time: fmtLong(f.at) + ' · ' + fmtTime(f.at) })))),
        f.message ? h('p', { class: 'found-msg' }, '“', f.message, '”') : null,
        f.finder_name ? h('div', { class: 'small' }, t('foundBy', { name: f.finder_name })) : null,
        h('div', { class: 'actions' },
          f.lat != null ? h('a', { class: 'btn sm primary', href: mapLink(f), target: '_blank', rel: 'noopener noreferrer' }, icon('pin'), t('foundMap')) : h('span', { class: 'small' }, t('foundNoLocation')),
          f.finder_phone ? h('a', { class: 'btn sm', href: 'tel:' + String(f.finder_phone).replace(/[^\d+]/g, '') }, icon('phone'), t('foundCall')) : null,
          wa ? h('a', { class: 'btn sm', href: 'https://wa.me/' + wa, target: '_blank', rel: 'noopener noreferrer' }, icon('chat'), 'WhatsApp') : null),
        h('div', { class: 'small muted' }, t('foundClinicKnows')));
    });
  }

  // ---- a pet's own profile ('#pet:<id>')
  function weightChart(ws) {
    if (ws.length < 2) return null;
    const W = 300, H = 90, pad = 6;
    const xs = ws.map((w) => Date.parse(w.at)), ys = ws.map((w) => w.kg);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const X = (x) => pad + (x1 === x0 ? 0.5 : (x - x0) / (x1 - x0)) * (W - 2 * pad);
    const Y = (y) => H - pad - (y1 === y0 ? 0.5 : (y - y0) / (y1 - y0)) * (H - 2 * pad);
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('class', 'wchart');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', t('weightHistory'));
    const line = document.createElementNS(NS, 'polyline');
    line.setAttribute('points', ws.map((w) => X(Date.parse(w.at)).toFixed(1) + ',' + Y(w.kg).toFixed(1)).join(' '));
    svg.append(line);
    for (const w of ws) {
      const c = document.createElementNS(NS, 'circle');
      c.setAttribute('cx', X(Date.parse(w.at)).toFixed(1)); c.setAttribute('cy', Y(w.kg).toFixed(1)); c.setAttribute('r', '3.5');
      svg.append(c);
    }
    return svg;
  }
  function petProfile(p) {
    const a = p.date_of_birth ? age(p.date_of_birth) : null;
    const chips = [
      [t('sexLabel'), t('sex.' + p.sex) + (p.is_neutered ? ' · ' + t('neutered') : '')],
      a ? [t('age'), fill(T().ageValue, { y: a.y, m: a.m }) + (p.dob_is_estimate ? ' (' + t('estimate') + ')' : '')] : null,
      p.date_of_birth ? [t('born'), fmtDate(p.date_of_birth)] : null,
      p.weight ? [t('weight'), fmtNum(p.weight.kg, 2) + ' ' + t('kg')] : null,
      p.color ? [t('color'), p.color] : null,
      p.microchip_no ? [t('microchip'), p.microchip_no, true] : null,
    ].filter(Boolean);
    const appts = d.appointments.filter((x) => x.pet_id === p.id);
    const rx = d.prescriptions.filter((x) => x.pet_id === p.id);
    const reqs = (d.requests || []).filter((x) => x.pet_id === p.id);
    const imgs = (d.xrays || []).filter((x) => x.pet_id === p.id);
    const ws = p.weights || [];
    return [
      foundBanner(p.id),
      h('article', { class: 'card profile-head' + (p.status !== 'ACTIVE' ? ' greyed' : '') },
        h('div', { class: 'pet-head' }, avatar(p, 'xl'),
          h('div', null,
            h('h1', { class: 'profile-name' }, p.name),
            h('div', { class: 'muted' }, t('species.' + p.species), p.breed ? ' · ' + p.breed : ''),
            p.status !== 'ACTIVE' ? h('span', { class: 'badge grey' }, t('petStatus.' + p.status)) : null,
            p.tag ? h('span', { class: 'badge ok' }, '🏷 ', t('tagActive')) : null)),
        h('ul', { class: 'chips' }, chips.map(([k, v, ltr]) => h('li', null, h('span', null, k), h('b', ltr ? { class: 'ltr' } : null, v))))),
      ws.length ? h('section', { class: 'card' },
        h('h2', null, icon('chart'), t('weightHistory')),
        weightChart(ws),
        h('ul', { class: 'rows' }, ws.slice().reverse().slice(0, 6).map((w) => h('li', null, h('div', { class: 'grow' }, fmtDate(w.at)), h('b', { class: 'ltr' }, fmtNum(w.kg, 2) + ' ' + t('kg')))))) : null,
      appts.length ? [h('h2', { class: 'section-title' }, icon('calendar'), t('appointments')), appts.map((x) => h('article', { class: 'card appt' }, dateTile(x.scheduled_at),
        h('div', null, h('div', { class: 'time' }, h('bdi', null, fmtTime(x.scheduled_at)), ' · ', h('span', { class: 'muted' }, relDay(x.scheduled_at))),
          h('div', null, t('visitType.' + x.type)), calButtons(x))))] : null,
      h('section', { class: 'card' },
        h('h2', null, icon('syringe'), t('vaccinations')),
        p.vaccinations.length ? h('ul', { class: 'rows' }, p.vaccinations.map((v) => {
          const s = vaccState(v);
          return h('li', null,
            h('div', { class: 'icobox ' + (s.cls === 'bad' ? 'bad' : s.cls === 'warn' ? 'warn' : s.cls === 'ok' ? 'ok' : '') }, icon(s.cls === 'ok' ? 'check' : s.cls === 'bad' ? 'alert' : 'syringe')),
            h('div', { class: 'grow' }, h('b', null, v.name), h('span', { class: 'muted small' }, t('given', { date: fmtDate(v.administered_at) }), v.next_due_at ? ' · ' + t('nextDue', { date: fmtDate(v.next_due_at) }) : '')),
            s.text && p.status === 'ACTIVE' ? h('span', { class: 'badge ' + s.cls }, s.text) : null);
        })) : h('div', { class: 'muted small' }, t('noVaccinations'))),
      (p.labs || []).length ? h('section', { class: 'card' }, labSection(p)) : null,
      h('section', { class: 'card' }, visitHistory(p)),
      rx.length ? [h('h2', { class: 'section-title' }, icon('pill'), t('prescriptions')), rx.map((v) => h('article', { class: 'card' },
        h('div', { class: 'rxhead' }, h('b', null, fmtDate(v.visited_at)), h('span', { class: 'muted small' }, t('visitType.' + v.type) + (v.vet_name ? ' · ' + t('byVet', { name: v.vet_name }) : ''))),
        v.diagnosis ? h('div', { class: 'dx' }, h('span', null, t('diagnosis')), h('b', null, v.diagnosis)) : null,
        v.items.map(drug)))] : null,
      reqs.length ? [h('h2', { class: 'section-title' }, icon('clip'), t('requestsTitle')), reqs.map(requestCard)] : null,
      imgs.filter((x) => x.kind !== 'LAB').length ? [h('h2', { class: 'section-title' }, icon('eye'), t('xrayImages')), fileGallery(imgs.filter((x) => x.kind !== 'LAB'))] : null,
      imgs.filter((x) => x.kind === 'LAB').length ? [h('h2', { class: 'section-title' }, icon('download'), t('labFiles')), fileGallery(imgs.filter((x) => x.kind === 'LAB'))] : null,
    ];
  }

  // ---- render
  function render() {
    const app = document.getElementById('app');
    document.documentElement.lang = L();
    document.documentElement.dir = L() === 'ar' ? 'rtl' : 'ltr';
    if (gone) {
      document.title = t('goneTitle');
      app.replaceChildren(h('div', { class: 'gone' }, h('div', null, h('div', { class: 'avatar lg' }, '🐾'), h('h1', null, t('goneTitle')), h('p', { class: 'muted' }, t('goneBody')))));
      return;
    }
    if (!d) return;
    document.title = clinicName() + ' — ' + d.owner.full_name;
    // A pet's profile wears the paw; the rest of the owner's page the person.
    const fav = document.querySelector('link[rel=icon]');
    const favWant = profileId() ? ${JSON.stringify(PET_ICON)} : ${JSON.stringify(OWNER_ICON)};
    if (fav && fav.getAttribute('href') !== favWant) fav.setAttribute('href', favWant);
    const v = view();
    const pid = profileId();
    const profilePet = pid ? d.pets.find((p) => p.id === pid) : null;
    const body = profilePet ? petProfile(profilePet) : { home: homeView, pets: petsView, appointments: appointmentsView, prescriptions: prescriptionsView, requests: requestsView, details: detailsView }[v]();
    app.replaceChildren(...[
      topbar(),
      v === 'home' ? hero() : null,
      tabs(),
      h('main', { class: 'wrap' },
        profilePet ? h('a', { class: 'back-link', href: '#pets' }, icon('chevron', 'back'), t('nav.pets'))
          : v !== 'home' ? h('h1', { class: 'section-title' }, icon(NAV_ICON[v]), t('nav.' + v)) : null,
        h('div', { class: 'view view-' + v }, body)),
      h('footer', { class: 'site wrap' }, h('b', null, clinicName()), d.clinic.address ? ' · ' + d.clinic.address : '', h('div', null, t('updated', { time: fmtTime(d.at) }))),
    ].filter(Boolean));
  }
  function refreshStatus() {
    const s = document.querySelector('.status');
    if (s && d) s.replaceWith(statusPill());
  }
  function setLang(l) {
    lang = l;
    try { localStorage.setItem('owner-page-lang', l); } catch (e) {}
    render();
  }
  window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });

  let loading = null;
  async function load() {
    if (loading) return loading;
    loading = (async () => {
      try {
        const r = await fetch(base + '/data', { cache: 'no-store' });
        if (r.status === 404) { gone = true; if (es) es.close(); render(); return; }
        if (!r.ok) throw new Error(String(r.status));
        const next = await r.json();
        const changed = !d || next.version !== d.version;
        d = next;
        if (changed) render(); else refreshStatus();
      } catch (e) {
        connected = false;
        refreshStatus();
      } finally {
        loading = null;
      }
    })();
    return loading;
  }

  // Live: the server says "changed" the moment the clinic saves anything; the page fetches again.
  let es = null;
  let timer = null;
  function connect() {
    if (gone || !('EventSource' in window)) return;
    es = new EventSource(base + '/live');
    es.onopen = () => { connected = true; load(); };
    es.onmessage = () => { clearTimeout(timer); timer = setTimeout(load, 400); };
    es.onerror = () => {
      connected = false;
      refreshStatus();
      if (es.readyState === 2) load(); // the server refused the stream: the link may have been replaced
    };
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !gone) load(); });
  setInterval(() => { if (!gone) load(); }, 120000);

  if (gone) render();
  else { load(); connect(); }
})();
</script>
</body>
</html>`;
}
