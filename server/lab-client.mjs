// Lab extranet app (served as /lab/app.mjs by server/lab.mjs). Plain DOM, no framework: sign in, change the temporary
// password, see the vets' lab requests, find a patient, upload a report. A PDF with text is read with pdf.js; a photo or
// scan (or a PDF without text) goes through Tesseract OCR here in the browser; /lab/parse.mjs turns the text into rows
// the lab doctor checks and corrects. Every value from the server is put on the page as text, never as HTML.
import { buildCatalogue, linesFromPdfItems, parseLabText } from './parse.mjs';

const TEXT = JSON.parse(document.getElementById('lab-text').textContent);
const LAB_TESTS = JSON.parse(document.getElementById('lab-tests').textContent);
const CATALOGUE = buildCatalogue(LAB_TESTS);
const TEST_NAMES = [...new Set(LAB_TESTS.groups.flatMap((g) => g.tests.map((x) => x.label)).concat(['WBC', 'RBC', 'HCT', 'MCV', 'MCH', 'MCHC', 'RDW', 'PLT', 'Neutrophils', 'Lymphocytes', 'Monocytes', 'Eosinophils', 'Basophils']))];
const EMOJI = { DOG: '🐕', CAT: '🐈', BIRD: '🐦', RABBIT: '🐇', REPTILE: '🦎', HAMSTER: '🐹', TURTLE: '🐢', OTHER: '🐾' };

let lang = (() => {
  try {
    return localStorage.getItem('lab-lang') || 'ar';
  } catch {
    return 'ar';
  }
})();
let user = null;
const t = (key, vars) => {
  let s = key.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), TEXT[lang]) ?? key.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), TEXT.en) ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = String(s).split(`{${k}}`).join(String(v));
  return s;
};
function setLang(l) {
  lang = l;
  try {
    localStorage.setItem('lab-lang', l);
  } catch { /* private window */ }
  document.documentElement.lang = l;
  document.documentElement.dir = l === 'ar' ? 'rtl' : 'ltr';
  route();
}

// ---------------------------------------------------------------- tiny DOM helpers
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
const app = document.getElementById('app');
function render(...nodes) {
  app.replaceChildren(...nodes);
  window.scrollTo(0, 0);
}
const fmtDate = (d) => {
  if (!d) return '—';
  const x = d.length === 10 ? new Date(`${d}T00:00:00`) : new Date(d);
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(x);
};
function age(dob) {
  if (!dob) return null;
  const a = new Date(`${dob}T00:00:00`);
  const b = new Date();
  let m = (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth() - (b.getDate() < a.getDate() ? 1 : 0);
  m = Math.max(0, m);
  return t('ageValue', { y: Math.floor(m / 12), m: m % 12 });
}
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// ---------------------------------------------------------------- server
async function api(path, { method = 'GET', body } = {}) {
  const r = await fetch(`/lab/api/${path}`, {
    method, credentials: 'same-origin',
    headers: { 'x-lab': '1', ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && path !== 'login') {
    user = null;
    showLogin(path === 'me' ? undefined : t('signedOut'));
    throw Object.assign(new Error('signed_out'), { quiet: true });
  }
  if (r.status === 403 && data.error === 'change_password') {
    showPassword(true);
    throw Object.assign(new Error('change_password'), { quiet: true });
  }
  if (!r.ok) throw Object.assign(new Error(data.error || 'error'), { status: r.status, code: data.error });
  return data;
}

// ---------------------------------------------------------------- frame
function topBar() {
  return h('header', { class: 'top' },
    h('div', { class: 'in' },
      h('div', { class: 'brand' },
        h('span', { class: 'mark', 'aria-hidden': 'true' }, '🧪'),
        h('div', {}, h('b', {}, t('title')), h('small', {}, user ? `${user.name}${user.lab_name ? ` · ${user.lab_name}` : ''}` : t('subtitle')))),
      h('button', { type: 'button', onclick: () => setLang(lang === 'ar' ? 'en' : 'ar') }, lang === 'ar' ? 'English' : 'العربية'),
      user && !user.must_change_password ? h('button', { type: 'button', onclick: () => showPassword(false) }, t('changePassword')) : null,
      user ? h('button', { type: 'button', onclick: logout }, t('signOut')) : null));
}
async function logout() {
  await api('logout', { method: 'POST' }).catch(() => {});
  user = null;
  location.hash = '';
  showLogin();
}
function route() {
  if (!user) return showLogin();
  if (user.must_change_password) return showPassword(true);
  const m = /^#\/pet\/([A-Za-z0-9-]+)(?:\?req=([A-Za-z0-9-]+))?$/.exec(location.hash);
  if (m) return showPet(m[1], m[2]);
  return showHome();
}
window.addEventListener('hashchange', () => user && route());

// ---------------------------------------------------------------- sign in / password
function showLogin(message) {
  const err = h('div', { class: message ? 'note' : 'err hidden', role: 'alert' }, message ?? '');
  const email = h('input', { type: 'email', autocomplete: 'username', required: true, dir: 'ltr' });
  const pw = h('input', { type: 'password', autocomplete: 'current-password', required: true, dir: 'ltr' });
  const btn = h('button', { class: 'btn primary', type: 'submit' }, t('signIn'));
  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      btn.disabled = true;
      try {
        const r = await api('login', { method: 'POST', body: { email: email.value, password: pw.value } });
        user = r.user;
        if (!localStorageLang()) setLang(user.locale);
        else route();
      } catch (x) {
        err.className = 'err';
        err.textContent = x.code === 'too_many' ? t('tooMany') : t('wrongLogin');
      } finally {
        btn.disabled = false;
      }
    },
  },
  err,
  h('label', { class: 'f' }, t('email'), email),
  h('label', { class: 'f' }, t('password'), pw),
  h('div', { class: 'row' }, btn));
  render(topBar(), h('main', {}, h('div', { class: 'login' }, h('div', { class: 'card' }, h('h2', {}, t('signInTitle')), h('p', { class: 'muted small' }, t('signInHint')), form))));
  email.focus();
}
function localStorageLang() {
  try {
    return localStorage.getItem('lab-lang');
  } catch {
    return null;
  }
}
function showPassword(forced) {
  const err = h('div', { class: 'err hidden', role: 'alert' });
  const cur = h('input', { type: 'password', autocomplete: 'current-password', required: true, dir: 'ltr' });
  const pw = h('input', { type: 'password', autocomplete: 'new-password', required: true, minlength: '8', dir: 'ltr' });
  const pw2 = h('input', { type: 'password', autocomplete: 'new-password', required: true, dir: 'ltr' });
  const btn = h('button', { class: 'btn primary', type: 'submit' }, t('savePassword'));
  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      const fail = (m) => {
        err.className = 'err';
        err.textContent = m;
      };
      if (pw.value.length < 8) return fail(t('pwShort'));
      if (pw.value !== pw2.value) return fail(t('pwMismatch'));
      btn.disabled = true;
      try {
        const r = await api('password', { method: 'POST', body: { current: cur.value, password: pw.value } });
        user = r.user;
        location.hash = '';
        route();
      } catch (x) {
        fail(x.code === 'current' ? t('pwCurrentWrong') : x.code === 'same' ? t('pwSame') : x.code === 'short' ? t('pwShort') : t('error'));
      } finally {
        btn.disabled = false;
      }
    },
  },
  err,
  h('label', { class: 'f' }, forced ? t('tempPassword') : t('currentPassword'), cur),
  h('label', { class: 'f' }, t('newPassword'), pw),
  h('label', { class: 'f' }, t('repeatPassword'), pw2),
  h('p', { class: 'faint small' }, t('pwRule')),
  h('div', { class: 'row' }, btn, forced ? null : h('button', { class: 'btn ghost', type: 'button', onclick: () => route() }, t('cancel'))));
  render(topBar(), h('main', {}, h('div', { class: 'login' }, h('div', { class: 'card' }, h('h2', {}, t('choosePassword')), forced ? h('p', { class: 'muted small' }, t('choosePasswordHint')) : null, form))));
  cur.focus();
}

// ---------------------------------------------------------------- home: requests + search
function petLine(p, extra) {
  return h('div', { class: 'grow' },
    h('b', {}, p.name), ' ', h('span', { class: 'muted small' }, `${t(`species.${p.species}`)}${p.breed ? ` · ${p.breed}` : ''}`),
    h('div', { class: 'small muted' }, p.owner?.name ?? '', p.owner?.code ? [' · ', h('span', { class: 'code' }, p.owner.code)] : null, p.owner?.phone ? [' · ', h('span', { class: 'code' }, p.owner.phone)] : null),
    extra);
}
async function showHome() {
  const results = h('ul', { class: 'list' });
  const box = h('input', { type: 'search', placeholder: t('searchPlaceholder'), 'aria-label': t('search') });
  let timer = null;
  box.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const q = box.value.trim();
      if (q.length < 2) return results.replaceChildren();
      const r = await api(`search?q=${encodeURIComponent(q)}`).catch(() => ({ pets: [] }));
      results.replaceChildren(...(r.pets.length ? r.pets.map((p) => h('li', {}, h('button', { class: 'item', type: 'button', onclick: () => (location.hash = `#/pet/${p.id}`) },
        h('span', { class: 'emoji', 'aria-hidden': 'true' }, EMOJI[p.species] ?? '🐾'), petLine(p)))) : [h('li', { class: 'faint small', style: 'padding:10px 4px' }, t('noMatches'))]));
    }, 250);
  });
  const reqList = h('ul', { class: 'list' }, h('li', { class: 'faint small', style: 'padding:10px 4px' }, '…'));
  const recentList = h('ul', { class: 'list' });
  render(topBar(), h('main', {},
    h('div', { class: 'card' }, h('h2', {}, t('findPatient')), box, h('p', { class: 'faint small', style: 'margin:6px 0 0' }, t('searchHint')), results),
    h('div', { class: 'card' }, h('h2', {}, t('requestsTitle')), h('p', { class: 'muted small', style: 'margin-top:0' }, t('requestsHint')), reqList),
    h('div', { class: 'card' }, h('h2', {}, t('recentTitle')), recentList)));
  box.focus();
  try {
    const d = await api('home');
    reqList.replaceChildren(...(d.requests.length ? d.requests.map((r) => h('li', {}, h('button', { class: 'item', type: 'button', onclick: () => (location.hash = `#/pet/${r.pet.id}?req=${r.id}`) },
      h('span', { class: 'emoji', 'aria-hidden': 'true' }, EMOJI[r.pet.species] ?? '🐾'),
      petLine(r.pet, [
        h('div', { class: 'small faint' }, t('requestedBy', { date: fmtDate(r.requested_at), by: r.requested_by ?? '—' })),
        h('div', { class: 'chips' }, r.items.map((i) => h('span', { class: 'chip' }, i.label)), r.other ? h('span', { class: 'chip' }, r.other) : null),
        r.notes ? h('div', { class: 'small muted' }, `${t('vetNotes')}: ${r.notes}`) : null,
      ])))) : [h('li', { class: 'faint small', style: 'padding:10px 4px' }, t('noRequests'))]));
    recentList.replaceChildren(...(d.recent.length ? d.recent.map((p) => h('li', {}, h('button', { class: 'item', type: 'button', onclick: () => (location.hash = `#/pet/${p.id}`) },
      h('span', { class: 'emoji', 'aria-hidden': 'true' }, EMOJI[p.species] ?? '🐾'), petLine(p, h('div', { class: 'small faint' }, t('recentLine', { date: fmtDate(p.taken_at), n: p.n })))))) : [h('li', { class: 'faint small', style: 'padding:10px 4px' }, t('noRecent'))]));
  } catch (x) {
    if (!x.quiet) reqList.replaceChildren(h('li', { class: 'err' }, t('error')));
  }
}

// ---------------------------------------------------------------- one patient
async function showPet(id, reqId) {
  render(topBar(), h('main', {}, h('p', {}, '…')));
  let d;
  try {
    d = await api(`pet/${id}`);
  } catch (x) {
    if (!x.quiet) render(topBar(), h('main', {}, h('div', { class: 'card' }, h('p', { class: 'err' }, t('notFound')), h('a', { href: '#/' }, t('back')))));
    return;
  }
  const p = d.pet;
  const open = d.requests.filter((r) => r.status === 'REQUESTED');
  const head = h('div', { class: 'card' },
    h('div', { class: 'row' }, h('a', { href: '#/', class: 'small' }, `← ${t('back')}`)),
    h('div', { class: 'row', style: 'margin-top:8px' },
      h('span', { class: 'emoji', style: 'font-size:34px;width:44px', 'aria-hidden': 'true' }, EMOJI[p.species] ?? '🐾'),
      h('div', { class: 'grow' },
        h('h2', { style: 'margin:0' }, p.name),
        h('div', { class: 'muted' }, [t(`species.${p.species}`), p.breed, p.sex ? t(`sex.${p.sex}`) : null, age(p.date_of_birth)].filter(Boolean).join(' · ')),
        h('div', { class: 'small muted' }, t('ownerLine', { name: p.owner?.name ?? '—' }), p.owner?.code ? [' · ', h('span', { class: 'code' }, p.owner.code)] : null))),
    d.alerts.length ? h('div', { class: 'chips', style: 'margin-top:8px' }, d.alerts.map((a) => h('span', { class: 'badge bad' }, t(`alerts.${a}`)))) : null);

  const reqBox = h('div', { class: 'card' }, h('h2', {}, t('vetRequests')),
    d.requests.length ? h('ul', { class: 'list' }, d.requests.map((r) => h('li', { style: 'padding:8px 0' },
      h('div', { class: 'row' }, h('b', {}, fmtDate(r.requested_at)), h('span', { class: `badge ${r.status === 'DONE' ? 'ok' : 'warn'}` }, t(`status.${r.status}`)), h('span', { class: 'small faint' }, r.requested_by ?? '')),
      h('div', { class: 'chips' }, r.items.map((i) => h('span', { class: 'chip' }, i.label)), r.other ? h('span', { class: 'chip' }, r.other) : null),
      r.notes ? h('div', { class: 'small muted' }, `${t('vetNotes')}: ${r.notes}`) : null))) : h('p', { class: 'faint small' }, t('noPetRequests')));

  const history = h('div', { class: 'card' }, h('h2', {}, t('earlierResults')),
    d.results.length ? d.results.map((day) => [
      h('h3', {}, fmtDate(day.date)),
      h('div', { class: 'tablewrap' }, h('table', { class: 't' },
        h('thead', {}, h('tr', {}, h('th', {}, t('col.test')), h('th', {}, t('col.value')), h('th', {}, t('col.unit')), h('th', {}, t('col.range')), h('th', { class: 'hide-sm' }, t('col.by')))),
        h('tbody', {}, day.items.map((x) => h('tr', {},
          h('td', {}, x.analyte),
          h('td', { class: x.flag ? `flag-${x.flag}` : '', dir: 'ltr' }, `${x.value ?? x.value_text ?? '—'}${x.flag ? ` ${x.flag}` : ''}`),
          h('td', { dir: 'ltr' }, x.unit ?? ''),
          h('td', { dir: 'ltr' }, x.ref_low != null || x.ref_high != null ? `${x.ref_low ?? ''} – ${x.ref_high ?? ''}` : ''),
          h('td', { class: 'small faint hide-sm' }, x.by ?? '')))))),
    ]) : h('p', { class: 'faint small' }, t('noResults')),
    h('h3', {}, t('documents')),
    d.documents.length ? h('ul', { class: 'list' }, d.documents.map((doc) => h('li', { class: 'row', style: 'padding:6px 0' },
      h('span', { class: 'grow' }, doc.name, h('div', { class: 'small faint' }, `${fmtDate(doc.at)}${doc.by ? ` · ${doc.by}` : ''}`)),
      doc.ready ? h('a', { class: 'btn sm', href: `/lab/api/file/${doc.id}`, target: '_blank', rel: 'noopener' }, t('open')) : h('span', { class: 'small faint' }, t('notOnServer'))))) : h('p', { class: 'faint small' }, t('noDocuments')));

  render(topBar(), h('main', {}, head, uploadCard(d, open, reqId), h('div', { class: 'grid2' }, reqBox, history)));
}

// ---------------------------------------------------------------- upload + scan
function uploadCard(d, open, reqId) {
  const p = d.pet;
  let file = null;
  let rows = [];
  const msg = h('div', { role: 'status' });
  const bar = h('i');
  const progress = h('div', { class: 'progress hidden' }, bar);
  const status = h('p', { class: 'small muted', style: 'margin:4px 0' });
  const preview = h('div', { class: 'preview hidden' });
  const reqSelect = h('select', {},
    h('option', { value: '' }, t('noRequest')),
    open.map((r) => h('option', { value: r.id }, `${fmtDate(r.requested_at)} — ${r.items.map((i) => i.label).join(', ') || r.other || ''}`.slice(0, 120))));
  reqSelect.value = open.some((r) => r.id === reqId) ? reqId : open[0]?.id ?? '';
  const date = h('input', { type: 'date', value: today(), max: today() });
  const note = h('textarea', { placeholder: t('notePlaceholder') });
  const tbody = h('tbody');
  const datalist = h('datalist', { id: 'lab-names' }, TEST_NAMES.map((n) => h('option', { value: n })));
  const table = h('div', { class: 'tablewrap hidden' }, datalist, h('table', { class: 't edit' },
    h('thead', {}, h('tr', {}, h('th', {}, t('col.test')), h('th', {}, t('col.value')), h('th', {}, t('col.unit')), h('th', {}, t('col.low')), h('th', {}, t('col.high')), h('th', {}, ''))),
    tbody));
  const addBtn = h('button', { class: 'btn sm hidden', type: 'button', onclick: () => { rows.push(blankRow()); drawRows(); } }, `+ ${t('addRow')}`);
  const saveBtn = h('button', { class: 'btn primary', type: 'button', disabled: true, onclick: () => save() }, t('save'));
  const requested = () => {
    const r = open.find((x) => x.id === reqSelect.value);
    return r ? r.items.filter((i) => !/^haematology\.(cbc|wbcs)/.test(i.key)) : [];
  };
  const blankRow = (analyte = '') => ({ analyte, value: '', unit: '', ref_low: '', ref_high: '', matched: true });

  function drawRows() {
    tbody.replaceChildren(...rows.map((r, i) => {
      const cell = (k, cls, type = 'text') => h('td', { class: cls }, h('input', {
        type, value: r[k] ?? '', inputmode: cls === 'num' ? 'decimal' : null, list: k === 'analyte' ? 'lab-names' : null, 'aria-label': t(`col.${k === 'analyte' ? 'test' : k === 'ref_low' ? 'low' : k === 'ref_high' ? 'high' : k}`),
        oninput: (e) => { r[k] = e.target.value; },
      }));
      return h('tr', { class: r.matched ? '' : 'unmatched', title: r.matched ? '' : t('unmatched') },
        cell('analyte'), cell('value', 'num'), cell('unit', 'unit'), cell('ref_low', 'num'), cell('ref_high', 'num'),
        h('td', {}, h('button', { class: 'btn ghost sm', type: 'button', 'aria-label': t('removeRow'), onclick: () => { rows.splice(i, 1); drawRows(); } }, '✕')));
    }));
    table.classList.toggle('hidden', !rows.length && !file);
    addBtn.classList.toggle('hidden', !file);
  }

  async function pick(f) {
    msg.replaceChildren();
    if (!f) return;
    if (f.size > 25 * 1024 * 1024) return msg.replaceChildren(h('div', { class: 'err' }, t('tooLarge')));
    if (!/^(application\/pdf|image\/(png|jpeg|webp))$/.test(f.type)) return msg.replaceChildren(h('div', { class: 'err' }, t('fileType')));
    file = f;
    const url = URL.createObjectURL(f);
    preview.replaceChildren(f.type === 'application/pdf' ? h('iframe', { src: url, title: f.name }) : h('img', { src: url, alt: f.name }));
    preview.classList.remove('hidden');
    saveBtn.disabled = true;
    rows = [];
    drawRows();
    let text = '';
    try {
      text = await scan(f, (fraction, what) => {
        progress.classList.remove('hidden');
        bar.style.width = `${Math.round(fraction * 100)}%`;
        status.textContent = what;
      });
    } catch (e) {
      console.warn('scan', e);
      status.textContent = t('scanFailed');
    }
    progress.classList.add('hidden');
    const found = parseLabText(text, CATALOGUE);
    const have = new Set(found.map((r) => r.key).filter(Boolean));
    rows = found.map((r) => ({
      analyte: r.analyte, value: r.value ?? r.value_text ?? '', unit: r.unit ?? '', ref_low: r.ref_low ?? '', ref_high: r.ref_high ?? '', matched: r.matched, panel: r.group ? t(`labGroup.${r.group}`) : '',
    }));
    // Tests the vet asked for that the scan didn't find: empty rows to fill in by hand.
    for (const i of requested()) if (!have.has(i.key)) rows.push({ ...blankRow(i.label), panel: i.group ? t(`labGroup.${i.group}`) : '' });
    if (!rows.length) rows.push(blankRow());
    status.textContent = found.length ? t('scanFound', { n: found.length }) : text.trim() ? t('scanNone') : t('scanNoText');
    saveBtn.disabled = false;
    drawRows();
  }

  async function save() {
    const out = rows.filter((r) => String(r.analyte).trim() && String(r.value).trim()).map((r) => {
      const v = String(r.value).trim().replace(',', '.');
      const isNum = /^-?\d+(\.\d+)?$/.test(v);
      const n = (x) => (String(x ?? '').trim() === '' ? null : Number(String(x).replace(',', '.')));
      return { analyte: r.analyte.trim(), value: isNum ? Number(v) : null, value_text: isNum ? null : String(r.value).trim(), unit: String(r.unit).trim() || null, ref_low: n(r.ref_low), ref_high: n(r.ref_high), panel: r.panel || null };
    });
    if (!file) return;
    if (!out.length && !confirm(t('saveNoResults'))) return;
    if (out.length && !confirm(t('saveConfirm', { n: out.length, pet: p.name }))) return;
    saveBtn.disabled = true;
    status.textContent = t('saving');
    try {
      const data = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result).split(',')[1] ?? '');
        fr.onerror = reject;
        fr.readAsDataURL(file);
      });
      const r = await api('upload', { method: 'POST', body: { pet_id: p.id, request_id: reqSelect.value || null, taken_at: date.value, note: note.value, file: { name: file.name, mime: file.type, data }, results: out } });
      status.textContent = '';
      showPet(p.id);
      setTimeout(() => {
        const ok = h('div', { class: 'okmsg', role: 'status' }, t('saved', { n: r.results }));
        app.querySelector('main')?.prepend(ok);
      }, 50);
    } catch (x) {
      if (!x.quiet) msg.replaceChildren(h('div', { class: 'err' }, x.code === 'file_too_large' ? t('tooLarge') : x.code === 'file_type' ? t('fileType') : x.code === 'date' ? t('badDate') : t('error')));
      saveBtn.disabled = false;
      status.textContent = '';
    }
  }

  const input = h('input', { type: 'file', accept: 'application/pdf,image/png,image/jpeg,image/webp', class: 'hidden', onchange: (e) => pick(e.target.files[0]) });
  const camera = h('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'hidden', onchange: (e) => pick(e.target.files[0]) });
  const drop = h('div', {
    class: 'drop',
    ondragover: (e) => e.preventDefault(),
    ondrop: (e) => {
      e.preventDefault();
      pick(e.dataTransfer.files[0]);
    },
  },
  h('p', { style: 'margin:0 0 8px' }, t('dropHint')),
  h('div', { class: 'row', style: 'justify-content:center' },
    h('button', { class: 'btn primary', type: 'button', onclick: () => input.click() }, t('chooseFile')),
    h('button', { class: 'btn', type: 'button', onclick: () => camera.click() }, t('takePhoto'))),
  input, camera);
  reqSelect.addEventListener('change', () => {
    if (!file) return;
    const names = new Set(rows.map((r) => r.analyte));
    for (const i of requested()) if (!names.has(i.label)) rows.push(blankRow(i.label));
    drawRows();
  });
  drawRows();
  return h('div', { class: 'card' },
    h('h2', {}, t('uploadTitle', { pet: p.name })),
    h('p', { class: 'muted small', style: 'margin-top:0' }, t('uploadHint')),
    h('div', { class: 'grid2' },
      h('div', {},
        h('label', { class: 'f' }, t('forRequest'), reqSelect),
        h('label', { class: 'f' }, t('sampleDate'), date),
        drop, preview),
      h('div', {},
        progress, status, msg,
        table, h('div', { class: 'row', style: 'margin:8px 0' }, addBtn),
        h('label', { class: 'f' }, t('note'), note),
        h('div', { class: 'savebar row' }, saveBtn, h('span', { class: 'small faint' }, t('saveHint'))))));
}

/** Text of the report: the PDF's own text when it has some, otherwise OCR of the image / rendered pages. */
async function scan(file, onProgress) {
  if (file.type === 'application/pdf') {
    onProgress(0.05, t('readingPdf'));
    const pdfjs = await import('/lab/vendor/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = '/lab/vendor/pdf.worker.mjs';
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
    const pages = Math.min(doc.numPages, 6);
    let text = '';
    for (let i = 1; i <= pages; i++) {
      const page = await doc.getPage(i);
      text += `${linesFromPdfItems((await page.getTextContent()).items)}\n`;
      onProgress(0.05 + 0.25 * (i / pages), t('readingPdf'));
    }
    if (text.replace(/\s/g, '').length > 40) return text;
    // A scanned PDF: draw each page and read it like a photo.
    const canvases = [];
    for (let i = 1; i <= pages; i++) {
      const page = await doc.getPage(i);
      const vp = page.getViewport({ scale: 2 });
      const c = document.createElement('canvas');
      c.width = vp.width;
      c.height = vp.height;
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      canvases.push(c);
    }
    return ocr(canvases, onProgress);
  }
  return ocr([file], onProgress);
}
let workerPromise = null;
/** A photo or page as Tesseract reads it best: at least ~2400 px wide (small photos lose decimal points), in grey. */
async function forOcr(img) {
  const bmp = img instanceof HTMLCanvasElement ? img : await createImageBitmap(img);
  const w = bmp.width;
  const scale = Math.min(3, Math.max(1, 2400 / w));
  if (scale === 1 && img instanceof HTMLCanvasElement) return img;
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale);
  c.height = Math.round(bmp.height * scale);
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.filter = 'grayscale(1) contrast(1.15)';
  g.drawImage(bmp, 0, 0, c.width, c.height);
  return c;
}
// Where OCR progress goes (the worker is made once and reused for every report).
const ocrState = { current: 0, total: 1, report: () => {} };
async function ocr(images, onProgress) {
  onProgress(0.3, t('loadingOcr'));
  if (!window.Tesseract) {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '/lab/vendor/tesseract.js';
      s.onload = resolve;
      s.onerror = reject;
      document.head.append(s);
    });
  }
  Object.assign(ocrState, { current: 0, total: images.length, report: onProgress });
  workerPromise ??= window.Tesseract.createWorker('eng', 1, {
    workerPath: '/lab/vendor/tesseract.worker.js', corePath: '/lab/vendor/core', langPath: '/lab/vendor/lang', gzip: true, workerBlobURL: false,
    logger: (m) => {
      const { current, total, report } = ocrState;
      if (m.status === 'recognizing text') report(0.35 + 0.65 * ((current + m.progress) / total), t('readingImage', { page: current + 1, pages: total }));
    },
  });
  const worker = await workerPromise;
  const ready = [];
  for (const img of images) ready.push(await forOcr(img));
  images = ready;
  let text = '';
  for (let i = 0; i < images.length; i++) {
    ocrState.current = i;
    const { data } = await worker.recognize(images[i]);
    text += `${data.text}\n`;
  }
  return text;
}

// ---------------------------------------------------------------- start
document.documentElement.lang = lang;
document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
api('me')
  .then((r) => {
    user = r.user;
    route();
  })
  .catch(() => {
    if (!user) showLogin();
  });
