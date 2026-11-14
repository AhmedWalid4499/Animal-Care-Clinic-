// The page behind a pet's collar tag (server/tags.mjs): who the animal is, who to call, and one big button that
// alerts the owner and the clinic (with the finder's location if they allow it). Phone first, Arabic / English.
// Everything from the records is added as text nodes, never parsed as HTML. Text comes from src/i18n (tag.page).
export function tagPageHtml({ nonce, text, found }) {
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#2e6f73">
<title>Animal Care Clinic</title>
<style nonce="${nonce}">
@font-face { font-family: 'Plex Arabic'; font-weight: 400; font-display: swap; src: url(/o-font/arabic-400.woff2) format('woff2'); unicode-range: U+0600-06FF, U+0750-077F, U+FB50-FDFF, U+FE70-FEFC, U+200C-200E; }
@font-face { font-family: 'Plex Arabic'; font-weight: 600; font-display: swap; src: url(/o-font/arabic-600.woff2) format('woff2'); unicode-range: U+0600-06FF, U+0750-077F, U+FB50-FDFF, U+FE70-FEFC, U+200C-200E; }
@font-face { font-family: 'Plex Arabic'; font-weight: 400; font-display: swap; src: url(/o-font/latin-400.woff2) format('woff2'); unicode-range: U+0000-00FF, U+2000-206F, U+20AC, U+2122; }
@font-face { font-family: 'Plex Arabic'; font-weight: 600; font-display: swap; src: url(/o-font/latin-600.woff2) format('woff2'); unicode-range: U+0000-00FF, U+2000-206F, U+20AC, U+2122; }
:root { --bg: #f2f5f4; --card: #fff; --ink: #142120; --ink-2: #3f4e4c; --ink-3: #6f7d7b; --rule: #e1e7e5; --accent: #2e6f73; --accent-2: #1f5457; --accent-soft: #e4f0ef; --bad: #b3362f; --bad-soft: #fae6e4; --warn: #9a5f08; --warn-soft: #fbf0dc; --ok: #2f7a4b; --ok-soft: #e3f2e8; --radius: 14px; color-scheme: light; }
@media (prefers-color-scheme: dark) { :root { --bg: #0d1312; --card: #161e1d; --ink: #e8efee; --ink-2: #b9c5c3; --ink-3: #8a9896; --rule: #26312f; --accent: #6fb3b7; --accent-2: #2e6f73; --accent-soft: #1b2e2e; --bad: #ef7a72; --bad-soft: #321b19; --warn: #e3a94f; --warn-soft: #2d2414; --ok: #6cc08d; --ok-soft: #17291f; color-scheme: dark; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 400 16px/1.55 'Plex Arabic', system-ui, -apple-system, 'Segoe UI', Tahoma, sans-serif; }
.wrap { max-width: 560px; margin: 0 auto; padding: 0 16px 40px; }
.top { display: flex; align-items: center; gap: 10px; padding: 14px 0; }
.top img { width: 36px; height: 36px; object-fit: contain; border-radius: 8px; background: #fff; }
.top b { flex: 1; font-weight: 600; }
.lang { border: 1px solid var(--rule); background: var(--card); color: var(--ink-2); border-radius: 999px; min-height: 36px; padding: 4px 12px; font: inherit; font-size: 14px; font-weight: 600; cursor: pointer; }
.hero { text-align: center; background: linear-gradient(135deg, var(--accent), var(--accent-2)); color: #fff; border-radius: var(--radius); padding: 24px 16px 20px; }
.hero .photo { width: 132px; height: 132px; margin: 0 auto 10px; border-radius: 50%; border: 4px solid rgba(255,255,255,.85); background: rgba(255,255,255,.15); display: grid; place-items: center; overflow: hidden; font-size: 64px; }
.hero .photo img { width: 100%; height: 100%; object-fit: cover; }
.hero h1 { margin: 0; font-size: 28px; line-height: 1.25; font-weight: 600; }
.hero p { margin: 6px 0 0; opacity: .92; }
.card { background: var(--card); border: 1px solid var(--rule); border-radius: var(--radius); padding: 16px; margin-top: 14px; }
.card h2 { margin: 0 0 10px; font-size: 16px; font-weight: 600; }
.chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 0; padding: 0; list-style: none; }
.chips li { background: var(--bg); border-radius: 10px; padding: 6px 12px; font-size: 14px; }
.chips li span { display: block; font-size: 11px; color: var(--ink-3); }
.chips li b { font-weight: 600; }
.alerts { background: var(--warn-soft); border-color: transparent; }
.alerts .flag { display: inline-block; margin: 0 0 6px; margin-inline-end: 6px; padding: 3px 10px; border-radius: 999px; background: var(--card); color: var(--warn); font-weight: 600; font-size: 14px; }
.btn { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; min-height: 50px; padding: 10px 16px; border-radius: 12px; border: 1px solid var(--rule); background: var(--card); color: var(--ink); font: inherit; font-size: 16px; font-weight: 600; text-decoration: none; cursor: pointer; }
.btn + .btn { margin-top: 8px; }
.btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.btn.alert { background: var(--bad); border-color: var(--bad); color: #fff; font-size: 18px; min-height: 58px; }
.btn[disabled] { opacity: .6; }
.row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.row2 .btn + .btn { margin-top: 0; }
label { display: block; font-size: 14px; color: var(--ink-2); margin: 10px 0 4px; }
input[type=text], input[type=tel], textarea { width: 100%; font: inherit; font-size: 16px; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--rule); background: var(--card); color: var(--ink); }
.check { display: flex; align-items: center; gap: 8px; margin: 12px 0; font-size: 15px; color: var(--ink); }
.check input { width: 20px; height: 20px; }
.muted { color: var(--ink-3); font-size: 14px; }
.done { background: var(--ok-soft); border-color: transparent; text-align: center; }
.done b { display: block; font-size: 18px; color: var(--ok); }
.owner-line { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 12px; margin: 0 0 12px; font-size: 17px; }
.owner-phone { font-weight: 600; letter-spacing: .3px; }
.err { color: var(--bad); font-size: 14px; margin-top: 8px; }
.gone { text-align: center; padding: 80px 16px; }
.ltr { direction: ltr; unicode-bidi: isolate; }
</style>
</head>
<body>
<main class="wrap" id="app"></main>
<script nonce="${nonce}">
(() => {
  const TEXT = ${text};
  const FOUND = ${found ? 'true' : 'false'};
  const EMOJI = { DOG: '🐕', CAT: '🐈', BIRD: '🐦', RABBIT: '🐇', REPTILE: '🦎', OTHER: '🐾' };
  const base = location.pathname.replace(/\\/+$/, '');
  let lang = null;
  try { lang = localStorage.getItem('tag-page-lang'); } catch (e) {}
  let d = null;
  let state = 'idle'; // idle | form | sending | sent | error
  let errText = '';
  const L = () => lang || (d && d.clinic.locale) || 'ar';
  const T = () => TEXT[L()];
  const fill = (s, v) => Object.keys(v || {}).reduce((a, k) => a.split('{' + k + '}').join(String(v[k])), s || '');
  const t = (k, v) => fill(k.split('.').reduce((o, p) => (o ? o[p] : undefined), T()) || k, v);
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
  const e164 = (raw) => {
    if (!raw) return null;
    let n = String(raw).replace(/[^\\d+]/g, '');
    if (n.startsWith('+')) n = n.slice(1); else if (n.startsWith('00')) n = n.slice(2); else if (n.startsWith('0')) n = '20' + n.slice(1);
    return n.length >= 10 ? n : null;
  };
  const tel = (p) => 'tel:' + String(p).replace(/[^\\d+]/g, '');
  const clinicName = () => (L() === 'en' ? d.clinic.name_en : d.clinic.name_ar) || d.clinic.name_en || d.clinic.name_ar || '';
  const form = { name: '', phone: '', message: '', share: true };

  function send() {
    state = 'sending'; errText = ''; render();
    const post = (pos) => fetch(base + '/alert', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: form.name, phone: form.phone, message: form.message, lat: pos ? pos.coords.latitude : undefined, lng: pos ? pos.coords.longitude : undefined, accuracy: pos ? pos.coords.accuracy : undefined }),
    }).then((r) => { if (!r.ok) throw new Error(r.status === 429 ? t('tooMany') : t('sendFailed')); state = 'sent'; render(); })
      .catch((e) => { state = 'error'; errText = e.message || t('sendFailed'); render(); });
    if (form.share && 'geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition((pos) => post(pos), () => post(null), { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
    } else post(null);
  }

  function render() {
    const app = document.getElementById('app');
    document.documentElement.lang = L();
    document.documentElement.dir = L() === 'ar' ? 'rtl' : 'ltr';
    if (!FOUND || !d) {
      if (!FOUND) app.replaceChildren(h('div', { class: 'gone' }, h('div', { class: 'hero' }, h('h1', null, '🐾'), h('p', null, t('gone')))));
      return;
    }
    const p = d.pet;
    const o = d.owner;
    const other = L() === 'ar' ? 'en' : 'ar';
    document.title = t('title', { pet: p.name });
    const wa = o && e164(o.whatsapp || o.phone);
    const waText = encodeURIComponent(t('waText', { pet: p.name }));
    const facts = [
      [t('speciesLabel'), t('species.' + p.species) + (p.breed ? ' · ' + p.breed : '')],
      [t('sexLabel'), t('sex.' + p.sex) + (p.neutered ? ' · ' + T().neutered : '')],
      p.color ? [t('color'), p.color] : null,
      p.microchip_no ? [t('microchip'), p.microchip_no, true] : null,
    ].filter(Boolean);
    // Sections that don't apply are null and left out (replaceChildren would print "null").
    app.replaceChildren(...[
      h('header', { class: 'top' },
        d.clinic.logo ? h('img', { src: d.clinic.logo, alt: '' }) : null,
        h('b', null, clinicName()),
        h('button', { class: 'lang', type: 'button', onclick: () => { lang = other; try { localStorage.setItem('tag-page-lang', other); } catch (e) {} render(); } }, other === 'en' ? 'English' : 'عربي')),
      h('section', { class: 'hero' },
        h('div', { class: 'photo' }, p.photo ? h('img', { src: p.photo, alt: '' }) : EMOJI[p.species] || '🐾'),
        h('h1', null, t('hello', { pet: p.name })),
        h('p', null, t('lead'))),
      (p.alerts.length || p.alert_note) ? h('section', { class: 'card alerts' },
        h('h2', null, '⚠ ' + t('alertsTitle')),
        p.alerts.map((f) => h('span', { class: 'flag' }, (T().alertFlag || {})[f] || f)),
        p.alert_note ? h('div', null, p.alert_note) : null) : null,
      h('section', { class: 'card' }, h('ul', { class: 'chips' }, facts.map(([k, v, ltr]) => h('li', null, h('span', null, k), h('b', ltr ? { class: 'ltr' } : null, v))))),
      o ? h('section', { class: 'card' },
        h('h2', null, t('ownerTitle')),
        h('p', { class: 'owner-line' }, h('b', null, o.name), o.phone ? h('span', { class: 'ltr owner-phone' }, o.phone) : null),
        h('div', { class: 'row2' },
          o.phone ? h('a', { class: 'btn primary', href: tel(o.phone) }, '📞 ', t('callOwner')) : null,
          wa ? h('a', { class: 'btn', href: 'https://wa.me/' + wa + '?text=' + waText, target: '_blank', rel: 'noopener noreferrer' }, '💬 ', t('whatsappOwner')) : null)) : null,
      alertSection(),
      h('section', { class: 'card' },
        h('h2', null, t('clinicTitle')),
        h('p', { class: 'muted' }, clinicName() + (d.clinic.address ? ' · ' + d.clinic.address : '')),
        d.clinic.phone ? h('a', { class: 'btn', href: tel(d.clinic.phone) }, '📞 ', t('callClinic')) : null),
      h('p', { class: 'muted' }, t('privacy')),
    ].filter(Boolean));
  }

  function alertSection() {
    if (state === 'sent') return h('section', { class: 'card done', role: 'status' }, h('b', null, '✓ ' + t('sentTitle')), h('p', null, t('sentBody')));
    if (state === 'idle') return h('section', { class: 'card' }, h('button', { type: 'button', class: 'btn alert', onclick: () => { state = 'form'; render(); } }, '🚨 ', t('alertButton')), h('p', { class: 'muted' }, t('alertHint')));
    const busy = state === 'sending';
    return h('section', { class: 'card alert-form' },
      h('h2', null, t('formTitle')),
      h('label', { for: 'fn' }, t('yourName')), h('input', { id: 'fn', type: 'text', value: form.name, autocomplete: 'name', oninput: (e) => (form.name = e.target.value) }),
      h('label', { for: 'fp' }, t('yourPhone')), h('input', { id: 'fp', type: 'tel', value: form.phone, autocomplete: 'tel', oninput: (e) => (form.phone = e.target.value) }),
      h('label', { for: 'fm' }, t('message')), h('textarea', { id: 'fm', rows: '2', placeholder: t('messagePh'), oninput: (e) => (form.message = e.target.value) }, form.message),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: form.share, onchange: (e) => (form.share = e.target.checked) }), t('shareLocation')),
      h('button', { type: 'button', class: 'btn alert send-alert', disabled: busy, onclick: send }, busy ? t('sending') : '🚨 ' + t('send')),
      state === 'error' ? h('div', { class: 'err' }, errText) : null);
  }

  if (FOUND) fetch(base + '/data', { cache: 'no-store' }).then((r) => r.json()).then((x) => { d = x; render(); }).catch(() => {});
  else render();
})();
</script>
</body>
</html>`;
}
