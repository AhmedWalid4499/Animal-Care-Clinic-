// Surgery / anaesthesia consent (7 Nov 2026 change request). The owner reads the form on screen (Arabic and English
// together, whatever the app language) and signs with a finger, pen or mouse; the signed form is kept with the pet
// (consents, append-only, synced) and prints on A5 any time. The wording is a starting point for Dr. Waleed to confirm.
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useApp, useQuery } from '../lib/app';
import { getConsent, getPet, getSettings, saveConsent } from '../db/repo';
import { platform } from '../lib/platform';
import { Field, Icon, SheetAddress } from '../components/ui';
import { PageHead } from '../components/Layout';
import ar from '../i18n/ar.json';
import en from '../i18n/en.json';

type Dict = Record<string, unknown>;
const pick = (m: Dict, key: string, vars: Record<string, string> = {}) => {
  let s = (key.split('.').reduce<unknown>((o, k) => (o as Dict | undefined)?.[k], m) as string | undefined) ?? key;
  for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
  return s;
};
/** The same sentence in English and Arabic, one under the other. */
function Both({ k, vars, block }: { k: string; vars?: Record<string, string>; block?: boolean }) {
  return block ? (
    <>
      <p className="en" dir="ltr">{pick(en as Dict, k, vars)}</p>
      <p className="ar" dir="rtl" lang="ar">{pick(ar as Dict, k, vars)}</p>
    </>
  ) : (
    <><span dir="ltr">{pick(en as Dict, k, vars)}</span> · <span dir="rtl" lang="ar">{pick(ar as Dict, k, vars)}</span></>
  );
}

/** A canvas you sign on. Returns a PNG data URL (null while empty). */
function SignaturePad({ onChange }: { onChange: (png: string | null) => void }) {
  const { t } = useApp();
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);
  useEffect(() => {
    const c = ref.current!;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.clientWidth * ratio;
    c.height = c.clientHeight * ratio;
    const g = c.getContext('2d')!;
    g.scale(ratio, ratio);
    g.lineWidth = 2.2;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.strokeStyle = '#111';
  }, []);
  const at = (e: React.PointerEvent) => {
    const b = ref.current!.getBoundingClientRect();
    return [e.clientX - b.left, e.clientY - b.top] as const;
  };
  const clear = () => {
    const c = ref.current!;
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
    dirty.current = false;
    onChange(null);
  };
  return (
    <div className="sigpad">
      <canvas
        ref={ref}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drawing.current = true;
          const g = ref.current!.getContext('2d')!;
          const [x, y] = at(e);
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(x + 0.1, y + 0.1);
          g.stroke();
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const g = ref.current!.getContext('2d')!;
          const [x, y] = at(e);
          g.lineTo(x, y);
          g.stroke();
          dirty.current = true;
        }}
        onPointerUp={() => {
          drawing.current = false;
          if (dirty.current) onChange(ref.current!.toDataURL('image/png'));
        }}
      />
      <button type="button" className="btn ghost sm" onClick={clear}>{t('consent.clear')}</button>
    </div>
  );
}

export function ConsentNew() {
  const { id = '' } = useParams();
  const [sp] = useSearchParams();
  const { t, toast, user } = useApp();
  const nav = useNavigate();
  const pet = useQuery(() => getPet(id), [id]);
  const [f, setF] = useState({ procedure: '', anaesthesia: true, estimate: '', notes: '', signer: '' });
  const [sig, setSig] = useState<string | null>(null);
  const [agree, setAgree] = useState(false);
  useEffect(() => { if (pet && !f.signer) setF((x) => ({ ...x, signer: pet.owner_name })); }, [pet]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!pet) return null;
  const egp = Number(f.estimate.replace(',', '.'));
  const valid = f.procedure.trim() && f.signer.trim() && sig && agree;
  const save = () => {
    const cid = saveConsent({
      pet_id: id, visit_id: sp.get('visit'), procedure: f.procedure, anaesthesia: f.anaesthesia,
      estimate: f.estimate.trim() && Number.isFinite(egp) ? Math.round(egp * 100) : null, notes: f.notes, signer_name: f.signer, signature: sig!,
    }, user?.id ?? null);
    toast(t('consent.saved'));
    nav(`/consents/${cid}`, { replace: true });
  };
  const vars = { owner: f.signer || '…', pet: pet.name, procedure: f.procedure || '…' };
  return (
    <div className="page narrow consent-form">
      <PageHead title={t('consent.title')} crumb={{ to: `/pets/${id}`, label: pet.name }} />
      <div className="grid g2">
        <Field label={t('consent.procedure')} className="span2"><input type="text" value={f.procedure} placeholder={t('consent.procedurePh')} onChange={(e) => setF({ ...f, procedure: e.target.value })} autoFocus /></Field>
        <Field label={t('consent.estimate')} optional><input type="number" min="0" step="any" inputMode="decimal" value={f.estimate} onChange={(e) => setF({ ...f, estimate: e.target.value })} /></Field>
        <label className="check" style={{ alignSelf: 'end' }}><input type="checkbox" checked={f.anaesthesia} onChange={(e) => setF({ ...f, anaesthesia: e.target.checked })} /> {t('consent.anaesthesia')}</label>
        <Field label={t('common.notes')} className="span2" optional><input type="text" value={f.notes} placeholder={t('consent.notesPh')} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
      <div className="consent-text">
        <Both k="consent.text.intro" vars={vars} block />
        {f.anaesthesia && <Both k="consent.text.anaesthesia" block />}
        <Both k="consent.text.risks" block />
        <Both k="consent.text.cost" block />
        <Both k="consent.text.contact" block />
      </div>
      <Field label={t('consent.signer')}><input type="text" value={f.signer} onChange={(e) => setF({ ...f, signer: e.target.value })} /></Field>
      <label className="check" style={{ margin: '10px 0' }}><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> {t('consent.agree')}</label>
      <div className="muted small">{t('consent.signHere')}</div>
      <SignaturePad onChange={setSig} />
      <div className="actionbar">
        <button className="btn" onClick={() => nav(-1)}>{t('common.cancel')}</button>
        <button className="btn primary" disabled={!valid} onClick={save}>{t('consent.save')}</button>
      </div>
    </div>
  );
}

const intlDateTime = (iso: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

export function ConsentView() {
  const { id = '' } = useParams();
  const { t } = useApp();
  const nav = useNavigate();
  const c = useQuery(() => getConsent(id), [id]);
  const settings = useQuery(getSettings);
  if (!c) return <div className="page">{t('common.notFound')}</div>;
  const vars = { owner: c.signer_name, pet: c.pet_name, procedure: c.procedure };
  const money = c.estimate != null ? `EGP ${(c.estimate / 100).toLocaleString('en-GB', { maximumFractionDigits: 2 })}` : '—';
  return (
    <div className="page">
      <div className="row no-print" style={{ marginBottom: 14 }}>
        <button className="btn" onClick={() => nav(`/pets/${c.pet_id}?tab=files`)}>{t('app.back')}</button>
        <button className="btn primary" onClick={() => platform.print()}><Icon name="print" /> {t('common.print')}</button>
      </div>
      <div className="sheet-wrap">
        <div className="sheet a5 consent-sheet">
          <div className="head">
            <div>
              <b style={{ fontSize: 15 }}>{settings.name_en}</b>
              <div dir="rtl" lang="ar" style={{ fontSize: 13, fontWeight: 600 }}>{settings.name_ar}</div>
              <div style={{ fontSize: 10 }}>{settings.phone && <span className="ltr">{settings.phone}</span>}</div>
            </div>
            {settings.logo_url && <img src={settings.logo_url} alt="" />}
          </div>
          <h2 className="consent-title"><Both k="consent.title" /></h2>
          <table className="facts-table">
            <tbody>
              <tr><td><Both k="consent.pet" /></td><td><b>{c.pet_name}</b> · <Both k={`species.${c.species}`} /></td></tr>
              <tr><td><Both k="consent.owner" /></td><td>{c.owner_name} · <span className="ltr">{c.owner_phone}</span></td></tr>
              <tr><td><Both k="consent.procedure" /></td><td><b>{c.procedure}</b></td></tr>
              <tr><td><Both k="consent.estimate" /></td><td>{money}</td></tr>
              {c.notes && <tr><td><Both k="common.notes" /></td><td>{c.notes}</td></tr>}
            </tbody>
          </table>
          <div className="consent-text">
            <Both k="consent.text.intro" vars={vars} block />
            {c.anaesthesia ? <Both k="consent.text.anaesthesia" block /> : null}
            <Both k="consent.text.risks" block />
            <Both k="consent.text.cost" block />
            <Both k="consent.text.contact" block />
          </div>
          <div className="consent-sign">
            <div>
              <img src={c.signature} alt="" />
              <div className="line" />
              <Both k="consent.signedBy" vars={{ name: c.signer_name }} />
            </div>
            <div className="small">
              <Both k="consent.signedAt" /> {intlDateTime(c.signed_at)}
              {c.user_name ? <div><Both k="consent.witness" /> {c.user_name}</div> : null}
            </div>
          </div>
          <SheetAddress address={settings.address} />
        </div>
      </div>
    </div>
  );
}
