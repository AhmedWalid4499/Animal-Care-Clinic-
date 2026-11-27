// Surgery / anaesthesia consent (7 Nov 2026 change request). The owner reads the form (Arabic and English together,
// whatever the app language) and signs it. Two ways (27 Nov 2026 change request, schema v26):
//  · sent to sign at home — printed, saved as a PDF, sent on WhatsApp and/or put on the owner's page; the signed copy
//    comes back as a photo / PDF that staff upload, or that the owner uploads on their page (server/portal.mjs), where
//    staff check it (accept, or ask for a new copy);
//  · the owner is at the clinic — signed on screen with a finger, pen or mouse.
// The signed form is kept with the pet (consents, synced) and prints on A5 any time. The wording is a starting point
// for Dr. Waleed to confirm.
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useApp, useQuery } from '../lib/app';
import {
  acceptConsent, askConsentAgain, attachSignedConsent, cancelConsent, createOwnerPage, getAttachmentBytes, getConsent, getPet, getSettings,
  prepareConsent, saveConsent, saveConsentPdf, setConsentOnPage, type ConsentRow,
} from '../db/repo';
import { get } from '../db/core';
import type { Attachment } from '../db/types';
import { platform } from '../lib/platform';
import { mimeOf } from '../lib/mime';
import { publicBase } from '../lib/site';
import { waMessage } from '../lib/whatsapp';
import { downloadAttachment, serverUrl } from '../sync/engine';
import { Badge, Confirm, Field, Icon, SavePdfButton, SheetAddress, WaButton } from '../components/ui';
import { PageHead } from '../components/Layout';
import { ownerPageUrl } from '../components/OwnerPage';
import { isImage, useImages } from './Documents';
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

/** Under a blank line on the paper form: the English label above the Arabic one (narrow columns). */
function PaperLabel({ k }: { k: string }) {
  return <span className="cp-label"><span dir="ltr">{pick(en as Dict, k)}</span><span dir="rtl" lang="ar">{pick(ar as Dict, k)}</span></span>;
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

type How = 'send' | 'screen';

export function ConsentNew() {
  const { id = '' } = useParams();
  const [sp] = useSearchParams();
  const { t, toast, user } = useApp();
  const nav = useNavigate();
  const pet = useQuery(() => getPet(id), [id]);
  const [f, setF] = useState({ procedure: '', anaesthesia: true, estimate: '', notes: '', signer: '' });
  // Most owners are not at the clinic when the form is made (27 Nov 2026): sending it is the default.
  const [how, setHow] = useState<How>('send');
  const [sig, setSig] = useState<string | null>(null);
  const [agree, setAgree] = useState(false);
  useEffect(() => { if (pet && !f.signer) setF((x) => ({ ...x, signer: pet.owner_name })); }, [pet]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!pet) return null;
  const egp = Number(f.estimate.replace(',', '.'));
  const input = {
    pet_id: id, visit_id: sp.get('visit'), procedure: f.procedure, anaesthesia: f.anaesthesia,
    estimate: f.estimate.trim() && Number.isFinite(egp) ? Math.round(egp * 100) : null, notes: f.notes,
  };
  const valid = !!f.procedure.trim() && (how === 'send' || (f.signer.trim() && sig && agree));
  const save = () => {
    if (how === 'send') {
      const cid = prepareConsent(input, user?.id ?? null);
      toast(t('consent.prepared'));
      nav(`/consents/${cid}`, { replace: true });
      return;
    }
    const cid = saveConsent({ ...input, signer_name: f.signer, signature: sig! }, user?.id ?? null);
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
      <div className="consent-how">
        <div className="muted small" style={{ marginBottom: 6 }}>{t('consent.howTitle')}</div>
        <div className="seg" role="radiogroup" aria-label={t('consent.howTitle')}>
          {(['send', 'screen'] as How[]).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={how === k} className={`consent-how-${k}${how === k ? ' on' : ''}`} onClick={() => setHow(k)}>
              {t(k === 'send' ? 'consent.howSend' : 'consent.howScreen')}
            </button>
          ))}
        </div>
      </div>
      {how === 'send' ? (
        <p className="note">{t('consent.howSendHint')}</p>
      ) : (
        <>
          <Field label={t('consent.signer')}><input type="text" value={f.signer} onChange={(e) => setF({ ...f, signer: e.target.value })} /></Field>
          <label className="check" style={{ margin: '10px 0' }}><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> {t('consent.agree')}</label>
          <div className="muted small">{t('consent.signHere')}</div>
          <SignaturePad onChange={setSig} />
        </>
      )}
      <div className="actionbar">
        <button className="btn" onClick={() => nav(-1)}>{t('common.cancel')}</button>
        <button className="btn primary" disabled={!valid} onClick={save}>{t(how === 'send' ? 'consent.prepare' : 'consent.save')}</button>
      </div>
    </div>
  );
}

const intlDateTime = (iso: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
const intlDate = (iso: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));
const statusKind = { AWAITING: 'warn', RECEIVED: 'info', SIGNED: 'ok', CANCELLED: undefined } as const;

export function ConsentView() {
  const { id = '' } = useParams();
  const { t } = useApp();
  const nav = useNavigate();
  const c = useQuery(() => getConsent(id), [id]);
  const settings = useQuery(getSettings);
  if (!c) return <div className="page">{t('common.notFound')}</div>;
  const vars = { owner: c.signer_name || c.owner_name, pet: c.pet_name, procedure: c.procedure };
  const money = c.estimate != null ? `EGP ${(c.estimate / 100).toLocaleString('en-GB', { maximumFractionDigits: 2 })}` : '—';
  const onScreen = c.method === 'SCREEN' && !!c.signature;
  return (
    <div className="page">
      <div className="row no-print" style={{ marginBottom: 14 }}>
        <button className="btn" onClick={() => nav(`/pets/${c.pet_id}?tab=files`)}>{t('app.back')}</button>
        <button className="btn primary" onClick={() => platform.print()}><Icon name="print" /> {t('common.print')}</button>
        <SavePdfButton owner={c.owner_name} pet={c.pet_name} doc={t('consent.title')} />
      </div>
      {!onScreen && <ConsentPanel c={c} />}
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
              {!onScreen && <tr><td><Both k="consent.sentOn" /></td><td>{intlDate(c.sent_at ?? c.created_at)}</td></tr>}
            </tbody>
          </table>
          <div className="consent-text">
            <Both k="consent.text.intro" vars={vars} block />
            {c.anaesthesia ? <Both k="consent.text.anaesthesia" block /> : null}
            <Both k="consent.text.risks" block />
            <Both k="consent.text.cost" block />
            <Both k="consent.text.contact" block />
          </div>
          {onScreen ? (
            <div className="consent-sign">
              <div>
                <img src={c.signature!} alt="" />
                <div className="line" />
                <Both k="consent.signedBy" vars={{ name: c.signer_name ?? '' }} />
              </div>
              <div className="small">
                <Both k="consent.signedAt" /> {intlDateTime(c.signed_at!)}
                {c.user_name ? <div><Both k="consent.witness" /> {c.user_name}</div> : null}
              </div>
            </div>
          ) : (
            <>
              {/* Signed by hand: blank lines for the owner, and how to send it back. */}
              <div className="consent-paper">
                <div className="cp-field"><span className="cp-line" /><PaperLabel k="consent.paperName" /></div>
                <div className="cp-field"><span className="cp-line tall" /><PaperLabel k="consent.paperSignature" /></div>
                <div className="cp-field"><span className="cp-line" /><PaperLabel k="consent.paperDate" /></div>
              </div>
              <p className="consent-return"><Both k="consent.text.return" /></p>
            </>
          )}
          <SheetAddress address={settings.address} />
        </div>
      </div>
    </div>
  );
}

/**
 * A form sent to sign at home: where it is (waiting, copy to check, signed, cancelled), sending it (WhatsApp, the
 * owner's page), and the signed copy (upload, open, accept or ask again). Not printed.
 */
function ConsentPanel({ c }: { c: ConsentRow }) {
  const { t, fmt, toast, user, locale } = useApp();
  const settings = useQuery(getSettings);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const signed = useQuery(() => (c.signed_file_id ? get<Attachment>('SELECT * FROM attachments WHERE id = ?', [c.signed_file_id]) : undefined), [c.signed_file_id]);
  const previews = useImages(signed && isImage(signed) ? [signed] : [], !!signed);
  const waiting = c.status === 'AWAITING' || c.status === 'RECEIVED';
  const base = publicBase();
  const pageOk = !!base && c.owner_status !== 'ARCHIVED';
  const link = c.on_page && c.owner_portal_token ? ownerPageUrl(c.owner_portal_token, base) : null;
  const clinic = locale === 'ar' ? settings.name_ar : settings.name_en;
  const waVars = { owner: c.owner_name, clinic, pet: c.pet_name, procedure: c.procedure };
  const phone = c.owner_whatsapp || c.owner_phone;

  // On the owner's page, the form is offered as a PDF (14 Nov 2026 pattern, test requests): made by the desktop app
  // from the sheet on screen, once. The browser can't make one; the owner's page then shows the form as a page to print.
  const making = useRef(false);
  useEffect(() => {
    if (!waiting || !c.on_page || c.pdf_id || !platform.canPdf) return;
    const here = window.location.hash;
    const h = setTimeout(async () => {
      if (window.location.hash !== here || making.current) return;
      making.current = true;
      try {
        const bytes = await platform.pdf('A5');
        if (bytes && window.location.hash === here) saveConsentPdf(c.id, bytes, user?.id ?? null);
      } catch {
        /* made again the next time the form is opened */
      } finally {
        making.current = false;
      }
    }, 700);
    return () => clearTimeout(h);
  }, [waiting, c.on_page, c.pdf_id, c.id, user?.id]);

  const togglePage = (on: boolean) => {
    if (on && !c.owner_portal_token) createOwnerPage(c.owner_id);
    setConsentOnPage(c.id, on);
    toast(t(on ? 'consent.onPageOn' : 'consent.onPageOff'));
  };
  const upload = async () => {
    const f = await platform.pickFile([{ name: 'Signed form', extensions: ['pdf', 'jpg', 'jpeg', 'png', 'heic', 'webp'] }, { name: 'All', extensions: ['*'] }]);
    if (!f) return;
    try {
      attachSignedConsent(c.id, { name: f.name, bytes: f.bytes, mime: mimeOf(f.name) }, user?.id ?? null);
      toast(t('consent.uploadedSigned'));
    } catch {
      toast(t('petRecord.fileTooLarge'));
    }
  };
  const openSigned = async () => {
    if (!signed) return;
    let b = getAttachmentBytes(signed.id);
    if (!b && serverUrl()) {
      setBusy(true);
      b = (await downloadAttachment(signed.id).catch(() => null)) ?? undefined;
      setBusy(false);
    }
    if (b) platform.openFile(signed.file_name, b, signed.mime_type ?? 'application/octet-stream');
    else toast(t('petRecord.fileNotHere'));
  };
  const how = c.method ? t(`consent.method.${c.method}`, { name: c.reviewed_by_name ?? '' }) : null;
  return (
    <section className="section consent-panel no-print">
      <header>
        <h2 style={{ margin: 0 }}>{t('consent.title')}</h2>
        <Badge kind={statusKind[c.status]}>{t(`consent.status.${c.status}`)}</Badge>
      </header>
      {c.status === 'AWAITING' && <p className="muted small" style={{ marginTop: 0 }}>{t('consent.sendHint')}</p>}
      {c.status === 'RECEIVED' && <p className="note"><b>{t('consent.receivedTitle')}.</b> {t('consent.receivedHint')}</p>}
      {signed && (
        <div className="consent-copy">
          <div className="muted small">
            {t('consent.signedCopyAt')} {c.signed_at ? fmt.dateTime(c.signed_at) : '—'}{how ? ` · ${how}` : ''}
            {c.status === 'SIGNED' && c.method === 'OWNER_PAGE' && c.reviewed_by_name ? ` · ${t('consent.reviewedBy', { name: c.reviewed_by_name })}` : ''}
          </div>
          {previews[signed.id] && <img src={previews[signed.id]!} alt={t('consent.signedCopy')} />}
          <div className="row">
            <button className="btn sm" disabled={busy} onClick={() => void openSigned()}><Icon name="eye" /> {busy ? '…' : t('consent.openSigned')}</button>
          </div>
        </div>
      )}
      {c.status === 'RECEIVED' && (
        <div className="row">
          <button className="btn primary accept-consent" onClick={() => { acceptConsent(c.id, user?.id ?? null); toast(t('consent.accepted')); }}><Icon name="check" /> {t('consent.accept')}</button>
          <WaButton label={t('consent.askAgain')} phone={phone} text={waMessage(t, 'consentAgain', waVars)} onSent={() => { askConsentAgain(c.id); toast(t('consent.askAgainDone')); }} />
          {!phone && <button className="btn" onClick={() => { askConsentAgain(c.id); toast(t('consent.askAgainDone')); }}>{t('consent.askAgain')}</button>}
        </div>
      )}
      {waiting && (
        <>
          <div className="row">
            <WaButton
              label={t('consent.sendWa')}
              phone={phone}
              text={link ? waMessage(t, 'consent', { ...waVars, link: `${link}#consents` }) : waMessage(t, 'consentFile', waVars)}
            />
            <button className="btn upload-signed" onClick={() => void upload()}><Icon name="file" /> {t('consent.uploadSigned')}</button>
            <button className="btn ghost cancel-consent" onClick={() => setConfirm(true)}>{t('consent.cancel')}</button>
          </div>
          {!link && <p className="faint small" style={{ margin: '6px 0 0' }}>{t('consent.sendWaFileHint')}</p>}
          <label className="check">
            <input type="checkbox" className="consent-on-page" checked={!!c.on_page} disabled={!pageOk} onChange={(e) => togglePage(e.target.checked)} /> {t('consent.onPage')}
          </label>
          {!base ? <p className="faint small">{t('consent.onPageNeedsServer')}</p> : c.owner_status === 'ARCHIVED' ? <p className="faint small">{t('consent.onPageArchived')}</p> : null}
        </>
      )}
      {confirm && (
        <Confirm title={t('consent.cancel')} body={t('consent.cancelConfirm')} confirmLabel={t('consent.cancel')} danger
          onConfirm={() => { cancelConsent(c.id); toast(t('consent.cancelled')); }} onClose={() => setConfirm(false)} />
      )}
    </section>
  );
}
