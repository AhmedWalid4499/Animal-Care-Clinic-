// The owner's page (Phase 6): a private link on the clinic server, given to the owner as a QR code.
// The page itself is served by server/portal.mjs; here staff create it, print the QR card, send the link,
// and (Admin) replace or switch it off. Creating it is an ordinary owner edit, so it syncs like any other.
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import qrcode from 'qrcode-generator';
import { useApp, useQuery } from '../lib/app';
import { createOwnerPage, disableOwnerPage, getOwner, getSettings, ownerPets, replaceOwnerPage } from '../db/repo';
import type { Owner } from '../db/types';
import { serverUrl } from '../sync/engine';
import { platform } from '../lib/platform';
import { Confirm, Icon, WaButton, SheetAddress } from './ui';

export const ownerPageUrl = (token: string, base = serverUrl()) => (base ? `${base}/o/${token}` : null);

/** QR code as crisp SVG (one path; dark modules on white with the 4-module quiet zone scanners need). */
export function QrCode({ text, size = 176, label }: { text: string; size?: number; label?: string }) {
  const { d, n } = useMemo(() => {
    const q = qrcode(0, 'M');
    q.addData(text);
    q.make();
    const count = q.getModuleCount();
    let path = '';
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) {
        if (!q.isDark(r, c)) continue;
        let run = 1;
        while (c + run < count && q.isDark(r, c + run)) run++;
        path += `M${c + 4} ${r + 4}h${run}v1h-${run}z`;
        c += run - 1;
      }
    }
    return { d: path, n: count + 8 };
  }, [text]);
  return (
    <svg className="qr" width={size} height={size} viewBox={`0 0 ${n} ${n}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect width={n} height={n} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}

/** Owner detail → "Owner page": QR, link, print card, WhatsApp, Admin replace / off. */
export function OwnerPageSection({ owner }: { owner: Owner }) {
  const { t, isAdmin, toast, locale } = useApp();
  const nav = useNavigate();
  const settings = useQuery(getSettings);
  const [confirm, setConfirm] = useState<'replace' | 'disable' | null>(null);
  const base = serverUrl();
  const url = owner.portal_token ? ownerPageUrl(owner.portal_token, base) : null;
  const clinic = locale === 'ar' ? settings.name_ar : settings.name_en;

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast(t('portal.copied'));
    } catch {
      /* clipboard blocked: the link is selectable */
    }
  };

  return (
    <section className="section owner-page">
      <header>
        <h2>{t('portal.title')}</h2>
      </header>
      {!base ? (
        <p className="note">{t('portal.needsServer')}</p>
      ) : owner.status === 'ARCHIVED' ? (
        <p className="note">{t('portal.archived')}</p>
      ) : !url ? (
        <div className="owner-page-empty">
          <p className="muted">{t('portal.intro')}</p>
          <button className="btn primary create-owner-page" onClick={() => createOwnerPage(owner.id)}><Icon name="qr" /> {t('portal.create')}</button>
        </div>
      ) : (
        <div className="owner-page-body">
          <QrCode text={url} label={t('portal.title')} />
          <div className="owner-page-side">
            <p className="muted small" style={{ marginTop: 0 }}>{t('portal.intro')}</p>
            <a className="owner-page-link ltr" href={url} onClick={(e) => { e.preventDefault(); platform.openExternal(url); }}>{url}</a>
            <p className="faint small">{t('portal.syncNote')}</p>
            <div className="row">
              <button className="btn sm primary" onClick={() => nav(`/owners/${owner.id}/card`)}><Icon name="print" /> {t('portal.printCard')}</button>
              <WaButton small label={t('portal.send')} phone={owner.whatsapp || owner.phone} text={t('wa.portal', { owner: owner.full_name, clinic, link: url })} />
              <button className="btn sm" onClick={() => void copy()}><Icon name="clipboard" /> {t('portal.copyLink')}</button>
              <button className="btn sm ghost" onClick={() => platform.openExternal(url)}><Icon name="eye" /> {t('portal.open')}</button>
            </div>
            {isAdmin && (
              <div className="row" style={{ marginTop: 8 }}>
                <button className="btn sm ghost replace-owner-page" onClick={() => setConfirm('replace')}>{t('portal.replace')}</button>
                <button className="btn sm ghost" onClick={() => setConfirm('disable')}>{t('portal.disable')}</button>
              </div>
            )}
          </div>
        </div>
      )}
      {confirm && (
        <Confirm
          title={t(confirm === 'replace' ? 'portal.replace' : 'portal.disable')}
          body={t(confirm === 'replace' ? 'portal.replaceBody' : 'portal.disableBody')}
          danger
          onClose={() => setConfirm(null)}
          onConfirm={() => (confirm === 'replace' ? replaceOwnerPage(owner.id) : disableOwnerPage(owner.id))}
        />
      )}
    </section>
  );
}

/** /owners/:id/card — the QR card to hand to the owner (A5 sheet; cut out the card). */
export function OwnerCardPrint() {
  const { id = '' } = useParams();
  const { t, locale } = useApp();
  const nav = useNavigate();
  const owner = useQuery(() => getOwner(id), [id]);
  const pets = useQuery(() => ownerPets(id), [id]);
  const s = useQuery(getSettings);
  if (!owner) return null;
  const url = owner.portal_token ? ownerPageUrl(owner.portal_token) : null;
  const clinic = locale === 'ar' ? s.name_ar : s.name_en;
  return (
    <div className="page">
      <div className="row no-print" style={{ marginBottom: 14 }}>
        <button className="btn" onClick={() => nav(-1)}>{t('app.back')}</button>
        <button className="btn primary" disabled={!url} onClick={() => platform.print()}><Icon name="print" /> {t('common.print')}</button>
      </div>
      {!url ? (
        <p className="note">{serverUrl() ? t('portal.intro') : t('portal.needsServer')}</p>
      ) : (
        <div className="sheet-wrap">
          <div className="sheet a5">
            <div className="owner-card">
              <div className="head">
                <div>
                  <b style={{ fontSize: 15 }}>{clinic}</b>
                  {s.phone && <div style={{ fontSize: 10 }} className="ltr">{s.phone}</div>}
                </div>
                {s.logo_url && <img src={s.logo_url} alt="" />}
              </div>
              <div className="owner-card-body">
                <QrCode text={url} size={200} />
                <div>
                  <h2>{t('portal.cardTitle', { clinic })}</h2>
                  <p><b>{owner.full_name}</b></p>
                  {pets.filter((p) => p.status === 'ACTIVE').length > 0 && <p>🐾 {pets.filter((p) => p.status === 'ACTIVE').map((p) => p.name).join(' · ')}</p>}
                  <p>{t('portal.cardScan')}</p>
                </div>
              </div>
              <div className="foot">{t('portal.cardPrivate')}</div>
              <SheetAddress address={s.address} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
