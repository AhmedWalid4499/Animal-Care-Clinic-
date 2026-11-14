// Lost & found (14 Nov 2026, schema v18): someone scanned a pet's collar tag and pressed Alert. The clinic server writes
// the report (with the finder's location if they allowed it) and notifies everyone; here the clinic sees them, calls the
// owner or the finder, opens the map, and marks a report handled. Also: the pet's collar tag (create, print, replace).
import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useApp, useQuery } from '../lib/app';
import { createPetTag, disablePetTag, foundReports, getPet, getSettings, markFoundHandled, replacePetTag } from '../db/repo';
import { platform } from '../lib/platform';
import { telUrl } from '../lib/whatsapp';
import { serverUrl } from '../sync/engine';
import { PageHead } from '../components/Layout';
import { Badge, Confirm, Icon, OwnerCode, PetAvatar, WaButton } from '../components/ui';
import { QrCode } from '../components/OwnerPage';

const mapUrl = (lat: number, lng: number) => `https://www.google.com/maps?q=${lat},${lng}`;

export function LostFound() {
  const { t, fmt, user, locale } = useApp();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const open = sp.get('open');
  const reports = useQuery(foundReports);
  const settings = useQuery(getSettings);
  const clinic = locale === 'ar' ? settings.name_ar : settings.name_en;
  return (
    <div className="page">
      <PageHead title={t('lostFound.title')} sub={t('lostFound.sub')} />
      {reports.length === 0 && <p className="empty">{t('lostFound.none')}</p>}
      <ul className="list found-list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {reports.map((r) => (
          <li key={r.id} className={`found-item ${r.status === 'NEW' ? 'new' : 'handled'} ${open === r.id ? 'open' : ''}`}>
            <PetAvatar photo={r.photo_url} species={r.species} />
            <div>
              <div className="row">
                <b style={{ fontSize: 17 }}><a href={`#/pets/${r.pet_id}`}>{r.pet_name}</a></b>
                <Badge kind={r.status === 'NEW' ? 'bad' : 'ok'}>{t(`lostFound.status.${r.status}`)}</Badge>
                <span className="muted small">{fmt.dateTime(r.reported_at)}</span>
              </div>
              <div className="small" style={{ marginTop: 4 }}>
                {t('lostFound.owner')}: {r.owner_name ? <a href={`#/owners/${r.owner_id ?? ''}`}>{r.owner_name}</a> : '—'} <OwnerCode code={r.owner_code} plain />{' '}
                {r.owner_phone && <span className="ltr muted">{r.owner_phone}</span>}
              </div>
              <div className="small" style={{ marginTop: 2 }}>
                {r.lat != null && r.lng != null
                  ? <>📍 {t('lostFound.location')} <span className="ltr muted">{r.lat.toFixed(5)}, {r.lng.toFixed(5)}</span>{r.accuracy_m != null ? <span className="muted"> (±{Math.round(r.accuracy_m)} m)</span> : null}</>
                  : <span className="muted">{t('lostFound.noLocation')}</span>}
              </div>
              {(r.finder_name || r.finder_phone) && (
                <div className="small" style={{ marginTop: 2 }}>{t('lostFound.finder')}: {r.finder_name ?? ''} {r.finder_phone && <span className="ltr">{r.finder_phone}</span>}</div>
              )}
              {r.message && <p className="found-msg small" dir="auto">{r.message}</p>}
              {r.status === 'HANDLED' && <div className="faint small" style={{ marginTop: 4 }}>✓ {t('lostFound.handledBy', { name: r.handled_by_name ?? '—', when: fmt.dateTime(r.handled_at) })}</div>}
            </div>
            <div className="row" style={{ justifyContent: 'flex-end', maxWidth: 360 }}>
              {r.lat != null && r.lng != null && <button className="btn sm primary open-map" onClick={() => platform.openExternal(mapUrl(r.lat!, r.lng!))}><Icon name="send" /> {t('lostFound.openMap')}</button>}
              {r.owner_phone && <a className="btn sm" href={telUrl(r.owner_phone)}><Icon name="phone" /> {t('lostFound.callOwner')}</a>}
              {r.owner_phone && (
                <WaButton small phone={r.owner_whatsapp || r.owner_phone} label={t('lostFound.waOwner')}
                  text={t('lostFound.waOwnerText', { owner: r.owner_name ?? '', pet: r.pet_name, clinic, map: r.lat != null && r.lng != null ? mapUrl(r.lat, r.lng) : '' })} />
              )}
              {r.finder_phone && <a className="btn sm" href={telUrl(r.finder_phone)}><Icon name="phone" /> {t('lostFound.callFinder')}</a>}
              {r.status === 'NEW' && <button className="btn sm mark-handled" onClick={() => markFoundHandled(r.id, user?.id ?? null)}><Icon name="check" /> {t('lostFound.markHandled')}</button>}
              <button className="btn ghost sm" onClick={() => nav(`/pets/${r.pet_id}`)}>{t('lostFound.openPet')}</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** /pets/:id/tag — the pet's collar tag: create it, print it (several sizes on one sheet), replace a lost one (Admin). */
export function PetTag() {
  const { id = '' } = useParams();
  const { t, isAdmin, locale } = useApp();
  const nav = useNavigate();
  const pet = useQuery(() => getPet(id), [id]);
  const s = useQuery(getSettings);
  const [confirm, setConfirm] = useState<'replace' | 'disable' | null>(null);
  if (!pet) return null;
  const base = serverUrl();
  const url = pet.tag_token && base ? `${base}/t/${pet.tag_token}` : null;
  const clinic = locale === 'ar' ? s.name_ar : s.name_en;
  const Tag = ({ size }: { size: 'lg' | 'sm' | 'round' }) => (
    <div className={`collar-tag ${size}`}>
      <QrCode text={url!} size={size === 'lg' ? 144 : size === 'sm' ? 90 : 72} label={t('tag.title')} />
      <b>{pet.name}</b>
      {size !== 'round' && <span>{t('tag.scanMe')}</span>}
      {size === 'lg' && s.phone && <span className="ltr">{clinic} · {s.phone}</span>}
    </div>
  );
  return (
    <div className="page">
      <div className="row no-print" style={{ marginBottom: 14 }}>
        <button className="btn" onClick={() => nav(-1)}>{t('app.back')}</button>
        <span className="spacer" />
        {url && isAdmin && <button className="btn ghost" onClick={() => setConfirm('replace')}>{t('tag.replace')}</button>}
        {url && isAdmin && <button className="btn ghost" onClick={() => setConfirm('disable')}>{t('tag.disable')}</button>}
        {url && <button className="btn" onClick={() => platform.openExternal(url)}><Icon name="eye" /> {t('tag.preview')}</button>}
        {url && <button className="btn primary" onClick={() => platform.print()}><Icon name="print" /> {t('common.print')}</button>}
      </div>
      {!base ? (
        <p className="note">{t('portal.needsServer')}</p>
      ) : pet.status !== 'ACTIVE' ? (
        <p className="note">{t('tag.inactive')}</p>
      ) : !url ? (
        <div className="section">
          <p className="muted" style={{ maxWidth: '60ch' }}>{t('tag.intro', { pet: pet.name })}</p>
          <button className="btn primary create-tag" onClick={() => createPetTag(pet.id)}><Icon name="qr" /> {t('tag.create')}</button>
        </div>
      ) : (
        <>
          <p className="muted no-print" style={{ maxWidth: '70ch' }}>{t('tag.howTo')}</p>
          <p className="no-print small"><a className="ltr tag-link" href={url} onClick={(e) => { e.preventDefault(); platform.openExternal(url); }}>{url}</a></p>
          <div className="sheet-wrap">
            <div className="sheet a5 tag-sheet">
              <div className="tags">
                <Tag size="lg" /><Tag size="lg" />
                <Tag size="sm" /><Tag size="sm" /><Tag size="sm" />
                <Tag size="round" /><Tag size="round" /><Tag size="round" />
              </div>
            </div>
          </div>
        </>
      )}
      {confirm && (
        <Confirm
          title={t(confirm === 'replace' ? 'tag.replace' : 'tag.disable')}
          body={t(confirm === 'replace' ? 'tag.replaceBody' : 'tag.disableBody')}
          danger
          onClose={() => setConfirm(null)}
          onConfirm={() => (confirm === 'replace' ? replacePetTag(pet.id) : disablePetTag(pet.id))}
        />
      )}
    </div>
  );
}
