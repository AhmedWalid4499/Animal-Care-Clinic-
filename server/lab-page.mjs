// The lab extranet's page (server/lab.mjs): a shell with the purple theme; the app itself is /lab/app.mjs.
// UI text (src/i18n lab.*) and the clinic's lab test list are embedded as JSON data blocks (not scripts), so the page's
// Content-Security-Policy can allow only scripts from this server.
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const data = (id, v) => `<script type="application/json" id="${id}">${JSON.stringify(v).replace(/</g, '\\u003c')}</script>`;

export function labPageHtml(text, labTests, clinic) {
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#5b2d91">
<title>${esc(text.en.title)} · ${esc(text.ar.title)}</title>
<style>
:root {
  --lab: #5b2d91; --lab-2: #7a45b8; --lab-ink: #ffffff; --lab-soft: #f2ecfa; --lab-line: #e4d9f2;
  --bg: #ffffff; --bg-2: #f7f5fa; --ink: #1f1a26; --ink-2: #5d5568; --ink-3: #8c8496; --rule: #e7e3ec;
  --ok: #1d7a4a; --ok-soft: #e4f4ea; --warn: #9a5b00; --warn-soft: #fdf1dc; --bad: #b3261e; --bad-soft: #fbe9e7;
  --radius: 6px; --font: 'IBM Plex Sans Arabic', system-ui, 'Segoe UI', Tahoma, sans-serif; color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root { --lab: #9b6fd6; --lab-2: #b48be6; --lab-ink: #140a20; --lab-soft: #251a33; --lab-line: #3a2c4d;
    --bg: #15121a; --bg-2: #1d1924; --ink: #ece8f2; --ink-2: #b2a9bf; --ink-3: #847b90; --rule: #2e2838;
    --ok: #5cc98f; --ok-soft: #14291e; --warn: #f0b45a; --warn-soft: #2d2212; --bad: #f2867c; --bad-soft: #351816; color-scheme: dark; }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg-2); color: var(--ink); font: 400 15px/1.5 var(--font); -webkit-font-smoothing: antialiased; }
button, input, select, textarea { font: inherit; color: inherit; }
a { color: var(--lab); }
.top { background: linear-gradient(120deg, var(--lab), var(--lab-2)); color: var(--lab-ink); }
.top .in { max-width: 1100px; margin: 0 auto; padding: 12px 16px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.top .brand { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 200px; }
.top .mark { width: 34px; height: 34px; border-radius: 50%; background: rgba(255,255,255,.18); display: grid; place-items: center; font-size: 18px; }
.top b { font-size: 16px; display: block; }
.top small { opacity: .85; font-size: 12px; }
.top button { background: rgba(255,255,255,.14); border: 1px solid rgba(255,255,255,.35); color: var(--lab-ink); border-radius: var(--radius); padding: 6px 10px; cursor: pointer; font-weight: 600; font-size: 13px; }
.top button:hover { background: rgba(255,255,255,.24); }
main { max-width: 1100px; margin: 0 auto; padding: 18px 16px 60px; }
.card { background: var(--bg); border: 1px solid var(--rule); border-radius: var(--radius); padding: 16px; margin-bottom: 16px; }
.card h2 { margin: 0 0 10px; font-size: 17px; color: var(--lab); }
.card h3 { margin: 14px 0 6px; font-size: 15px; }
.muted { color: var(--ink-2); } .faint { color: var(--ink-3); } .small { font-size: 13px; }
.row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.grow { flex: 1; min-width: 180px; }
input[type=text], input[type=email], input[type=password], input[type=search], input[type=date], input[type=number], select, textarea {
  width: 100%; min-height: 40px; padding: 8px 10px; border: 1px solid var(--lab-line); border-radius: var(--radius); background: var(--bg); }
textarea { min-height: 70px; }
input:focus, select:focus, textarea:focus, button:focus-visible { outline: 2px solid var(--lab); outline-offset: 1px; }
label.f { display: flex; flex-direction: column; gap: 4px; font-size: 13px; font-weight: 600; color: var(--ink-2); margin-bottom: 10px; }
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 40px; padding: 0 16px; border-radius: var(--radius); border: 1px solid var(--lab-line); background: var(--bg); font-weight: 600; cursor: pointer; color: var(--lab); }
.btn:hover { background: var(--lab-soft); }
.btn.primary { background: var(--lab); border-color: var(--lab); color: var(--lab-ink); }
.btn.primary:hover { background: var(--lab-2); }
.btn:disabled { opacity: .55; cursor: default; }
.btn.sm { min-height: 32px; padding: 0 10px; font-size: 13px; }
.btn.ghost { border-color: transparent; background: none; }
.login { max-width: 400px; margin: 8vh auto; }
.login .card { padding: 24px; }
.err { background: var(--bad-soft); color: var(--bad); border-radius: var(--radius); padding: 8px 10px; font-size: 14px; margin-bottom: 10px; }
.okmsg { background: var(--ok-soft); color: var(--ok); border-radius: var(--radius); padding: 8px 10px; font-size: 14px; margin-bottom: 10px; }
.note { background: var(--lab-soft); border-inline-start: 3px solid var(--lab); padding: 8px 12px; border-radius: 0 var(--radius) var(--radius) 0; font-size: 14px; }
.list { list-style: none; margin: 0; padding: 0; }
.list li { border-bottom: 1px solid var(--rule); }
.list li:last-child { border-bottom: 0; }
.list button.item { display: flex; gap: 12px; align-items: flex-start; width: 100%; text-align: start; background: none; border: 0; padding: 10px 4px; cursor: pointer; }
.list button.item:hover { background: var(--lab-soft); }
.emoji { font-size: 22px; width: 32px; text-align: center; }
.chips { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 4px; }
.chip { background: var(--lab-soft); color: var(--lab); border-radius: 999px; padding: 1px 9px; font-size: 12px; font-weight: 600; }
.badge { display: inline-block; border-radius: 999px; padding: 1px 8px; font-size: 12px; font-weight: 600; background: var(--bg-2); color: var(--ink-2); }
.badge.ok { background: var(--ok-soft); color: var(--ok); } .badge.warn { background: var(--warn-soft); color: var(--warn); } .badge.bad { background: var(--bad-soft); color: var(--bad); }
.code { font-family: ui-monospace, monospace; direction: ltr; unicode-bidi: isolate; }
.grid2 { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; }
@media (max-width: 860px) { .grid2 { grid-template-columns: minmax(0, 1fr); } }
.drop { border: 2px dashed var(--lab-line); border-radius: var(--radius); padding: 18px; text-align: center; background: var(--lab-soft); }
.preview { margin-top: 10px; border: 1px solid var(--rule); border-radius: var(--radius); overflow: hidden; background: var(--bg-2); }
.preview img { display: block; max-width: 100%; max-height: 520px; margin: 0 auto; }
.preview iframe { display: block; width: 100%; height: 520px; border: 0; }
.progress { height: 6px; background: var(--lab-soft); border-radius: 999px; overflow: hidden; margin: 8px 0; }
.progress i { display: block; height: 100%; background: var(--lab); width: 0; transition: width .2s; }
table.t { width: 100%; border-collapse: collapse; font-size: 14px; }
table.t th { text-align: start; font-size: 12px; color: var(--ink-2); padding: 6px; border-bottom: 2px solid var(--lab); white-space: nowrap; }
table.t td { padding: 4px 6px; border-bottom: 1px solid var(--rule); vertical-align: middle; }
table.t td input { min-height: 34px; padding: 4px 6px; }
table.t td.num input { direction: ltr; text-align: end; }
table.t tr.unmatched td:first-child input { border-color: var(--warn); }
.tablewrap { overflow-x: auto; }
.flag-H { color: var(--bad); font-weight: 700; } .flag-L { color: #2a62c9; font-weight: 700; }
.savebar { border-top: 1px solid var(--rule); padding: 12px 0 0; margin-top: 12px; }
table.t.edit td:first-child { min-width: 170px; }
table.t.edit td.num { width: 84px; }
table.t.edit td.unit { width: 96px; }
@media (max-width: 640px) { .hide-sm { display: none; } }
/* Sign-in: the same layout as the clinic app's login (src/screens/Login.tsx), in the lab's purple, with lab glassware
   instead of paw prints. */
.signin-page { min-height: 100vh; display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr); background: var(--bg); }
.signin-page .art { position: relative; overflow: hidden; background: linear-gradient(150deg, #4a2178, #5b2d91 45%, #7a45b8); color: #fff; padding: 44px 48px 28px; display: flex; flex-direction: column; justify-content: space-between; gap: 24px; }
.signin-page .art::after { content: ""; position: absolute; inset: auto -20% -45% auto; width: 70%; aspect-ratio: 1; border-radius: 50%; background: radial-gradient(closest-side, rgba(255,255,255,.12), transparent); pointer-events: none; }
.logo-plate { background: #fff; border-radius: var(--radius); display: inline-block; }
.signin-page .art .logo-plate { max-width: 320px; padding: 14px 18px; box-shadow: 0 10px 30px rgba(0,0,0,.22); }
.signin-page .art .logo-plate img { display: block; max-height: 130px; max-width: 100%; }
.signin-page .badge-lab { display: inline-flex; align-items: center; gap: 8px; margin-top: 18px; background: rgba(255,255,255,.14); border: 1px solid rgba(255,255,255,.3); border-radius: 999px; padding: 4px 12px; font-size: 13px; font-weight: 600; }
.signin-page .art h1 { font-size: 40px; line-height: 1.15; max-width: 460px; margin: 0 0 18px; text-wrap: balance; }
.signin-page .art-bottom { display: flex; flex-direction: column; gap: 6px; position: relative; z-index: 1; }
.signin-page .art-bottom small { opacity: .8; }
.slides { max-width: 430px; }
.slide-stage { min-height: 92px; }
.slide b { display: block; font-size: 18px; margin-bottom: 4px; }
.slide p { margin: 0; opacity: .9; line-height: 1.55; }
.slide { animation: slide-in .5s ease both; }
.dots { display: flex; gap: 8px; margin-top: 14px; }
.dots button { width: 22px; height: 4px; border-radius: 2px; border: 0; padding: 0; cursor: pointer; background: rgba(255,255,255,.35); transition: width .25s ease, background-color .25s ease; }
.dots button.on { width: 40px; background: #fff; }
.dots button:focus-visible { outline: 2px solid #fff; outline-offset: 3px; }
.lab-trail { width: 100%; max-width: 560px; height: auto; fill: #fff; stroke: #fff; }
.lab-trail .gl { opacity: 0; animation: glass-step 6s ease-in-out infinite; }
.signin-page .pane { display: grid; place-items: center; padding: 32px 20px; background: var(--bg); }
.signin-page form { width: min(380px, 100%); display: flex; flex-direction: column; gap: 16px; }
.signin-page .tools { display: flex; justify-content: flex-end; }
.lang-pill { border: 1px solid var(--lab-line); background: var(--bg); border-radius: 999px; padding: 4px 14px; font-weight: 600; font-size: 13px; color: var(--lab); cursor: pointer; }
.lang-pill:hover { background: var(--lab-soft); border-color: var(--lab); }
.signin-page .mobile-logo { display: none; }
.greeting { margin: 0 0 2px; color: var(--lab); font-weight: 600; font-size: 14px; }
.signin-page h2.title { margin: 0; font-size: 26px; color: var(--ink); }
.fields { display: flex; flex-direction: column; gap: 12px; }
.float { position: relative; display: block; }
.float input { min-height: 54px; padding: 22px 12px 6px; font-size: 15px; border: 1px solid var(--lab-line); border-radius: var(--radius); width: 100%; background: var(--bg); }
.float > span { position: absolute; inset-inline-start: 13px; top: 17px; color: var(--ink-3); font-size: 15px; pointer-events: none; transition: top .15s ease, font-size .15s ease, color .15s ease; }
.float input:focus + span, .float input:not(:placeholder-shown) + span { top: 7px; font-size: 11.5px; font-weight: 600; color: var(--lab); }
.float input:focus { outline: none; border-color: var(--lab); box-shadow: 0 0 0 3px rgba(91,45,145,.18); }
.has-eye input { padding-left: 12px; padding-right: 46px; }
[dir='rtl'] .has-eye input { padding-left: 46px; padding-right: 12px; }
.eye { position: absolute; inset-inline-end: 6px; top: 50%; transform: translateY(-50%); border: 0; background: none; width: 36px; height: 36px; border-radius: var(--radius); color: var(--ink-2); cursor: pointer; display: grid; place-items: center; }
.eye:hover { background: var(--bg-2); color: var(--ink); }
.eye svg { width: 18px; height: 18px; }
.login-msg { min-height: 20px; font-size: 13px; font-weight: 600; }
.login-msg .err { color: var(--bad); background: none; padding: 0; } .login-msg .warn { color: var(--warn); }
.fields.shake { animation: shake .42s cubic-bezier(.36,.07,.19,.97) both; }
.btn.signin { min-height: 48px; font-size: 15px; width: 100%; }
.spinner { width: 16px; height: 16px; border-radius: 50%; border: 2px solid rgba(255,255,255,.4); border-top-color: #fff; animation: spin .8s linear infinite; display: inline-block; }
.signin-foot { border-top: 1px solid var(--rule); padding-top: 12px; font-size: 12.5px; color: var(--ink-3); }
.enter { animation: rise .5s cubic-bezier(.2,.7,.2,1) both; animation-delay: var(--d, 0ms); }
@keyframes rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
@keyframes slide-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@keyframes shake { 10%, 90% { transform: translateX(-1px); } 20%, 80% { transform: translateX(3px); } 30%, 50%, 70% { transform: translateX(-6px); } 40%, 60% { transform: translateX(6px); } }
/* Opacity only: a CSS transform here would replace each glyph's SVG transform (its place on the trail). */
@keyframes glass-step { 0% { opacity: 0; } 8% { opacity: .3; } 50% { opacity: .3; } 64%, 100% { opacity: 0; } }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .enter, .slide, .lab-trail .gl { animation: none; } .lab-trail .gl { opacity: .2; } }
@media (max-width: 900px) {
  .signin-page { grid-template-columns: 1fr; }
  .signin-page .art { display: none; }
  .signin-page .mobile-logo { display: block; max-width: 240px; padding: 8px 12px; border: 1px solid var(--rule); }
  .signin-page .mobile-logo img { display: block; max-width: 100%; }
  .signin-page .mobile-badge { display: inline-flex; }
}
.mobile-badge { display: none; align-items: center; gap: 6px; color: var(--lab); font-weight: 700; font-size: 14px; }
.hidden { display: none !important; }
@media (max-width: 640px) {
  table.t.edit thead { display: none; }
  table.t.edit tr { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 4px; padding: 8px 0; border-bottom: 1px solid var(--rule); }
  table.t.edit td { border: 0; padding: 0; }
  table.t.edit td:first-child { grid-column: 1 / -1; min-width: 0; }
  table.t.edit td.num, table.t.edit td.unit { width: auto; }
}
</style>
</head>
<body>
<div id="app"><p style="padding:20px">…</p></div>
${data('lab-text', text)}
${data('lab-tests', labTests)}
${data('lab-clinic', clinic ?? {})}
<script type="module" src="/lab/app.mjs"></script>
</body>
</html>`;
}
