// Pet record → Requests (14 Nov 2026): the X-ray and lab requests given to the owner, kept in the pet's history
// (test_requests, schema v17), and the pet's X-ray images. The owner sees the same on their page (Requests tab).
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp, useQuery } from '../lib/app';
import { addAttachment, petAttachments, petTestRequests, setTestRequestStatus } from '../db/repo';
import type { RequestStatus } from '../db/types';
import { platform } from '../lib/platform';
import { isImage, requestItemLabel, useImages } from '../screens/Documents';
import { mimeOf } from '../lib/mime';
import { Badge, Confirm, Icon } from './ui';

const SHOWN = 6;

export function RequestsTab({ petId, active }: { petId: string; active: boolean }) {
  const { t, fmt, canVisit, user, toast } = useApp();
  const nav = useNavigate();
  const requests = useQuery(() => petTestRequests(petId), [petId]);
  const xrays = useQuery(() => petAttachments(petId).filter((a) => a.kind === 'XRAY'), [petId]);
  const images = useImages(xrays, true);
  const [confirm, setConfirm] = useState<{ id: string; status: RequestStatus } | null>(null);
  const upload = async () => {
    const f = await platform.pickFile([{ name: 'X-ray', extensions: ['jpg', 'jpeg', 'png', 'webp', 'pdf', 'dcm'] }, { name: 'All', extensions: ['*'] }]);
    if (!f) return;
    try {
      addAttachment(petId, { name: f.name, bytes: f.bytes, mime: mimeOf(f.name) }, 'XRAY', null, user?.id ?? null);
      toast(t('app.saved'));
    } catch {
      toast(t('petRecord.fileTooLarge'));
    }
  };

  return (
    <div className="requests-tab">
      {canVisit && active && (
        <div className="row" style={{ margin: '14px 0' }}>
          <button className="btn primary new-xray-request" onClick={() => nav(`/pets/${petId}/xray-request`)}><Icon name="plus" /> {t('requests.newXray')}</button>
          <button className="btn new-lab-request" onClick={() => nav(`/pets/${petId}/lab-request`)}><Icon name="plus" /> {t('requests.newLab')}</button>
        </div>
      )}
      <ul className="list request-list">
        {requests.length === 0 && <li className="empty">{t('requests.none')}</li>}
        {requests.map((r) => {
          const items = (r.items ?? '').split(',').filter(Boolean);
          return (
            <li key={r.id} className={`link ${r.status === 'CANCELLED' ? 'greyed' : ''}`} onClick={() => nav(`/requests/${r.id}`)}>
              <span className="req-kind" aria-hidden>{r.kind === 'XRAY' ? '🩻' : '🧪'}</span>
              <div className="main-col">
                <b>{t(r.kind === 'XRAY' ? 'xray.title' : 'labReq.title')}</b>
                <div className="sub">{fmt.date(r.requested_at)}{r.requested_by_name ? ` · ${r.requested_by_name}` : ''}</div>
                <div className="sub req-items">
                  {items.slice(0, SHOWN).map((k) => requestItemLabel(t, r.kind, k)).join(' · ')}
                  {items.length > SHOWN ? ` · +${items.length - SHOWN}` : ''}
                  {r.other ? `${items.length ? ' · ' : ''}${r.other}` : ''}
                </div>
              </div>
              <Badge kind={r.status === 'DONE' ? 'ok' : r.status === 'CANCELLED' ? undefined : 'info'}>{t(`requests.status.${r.status}`)}</Badge>
              {canVisit && r.status === 'REQUESTED' && (
                <span className="row" onClick={(e) => e.stopPropagation()}>
                  <button className="btn ghost sm mark-done" onClick={() => setTestRequestStatus(r.id, 'DONE')}><Icon name="check" /> {t('requests.markDone')}</button>
                  <button className="btn ghost sm" onClick={() => setConfirm({ id: r.id, status: 'CANCELLED' })}>{t('requests.cancel')}</button>
                </span>
              )}
            </li>
          );
        })}
      </ul>

      <section className="section xray-images">
        <header>
          <h2>🩻 {t('requests.xrayImages')} <span className="count">{xrays.length}</span></h2>
          <button className="btn sm upload-xray" onClick={() => void upload()}><Icon name="file" /> {t('requests.uploadXray')}</button>
        </header>
        {xrays.length === 0 && <p className="empty">{t('requests.noXrays')}</p>}
        <div className="xray-thumbs">
          {xrays.map((a) => (
            <figure key={a.id}>
              {isImage(a) && images[a.id] ? <img src={images[a.id]!} alt={a.file_name} /> : <div className="thumb-file"><Icon name="file" /></div>}
              <figcaption>{fmt.date(a.created_at)} · <span dir="auto">{a.file_name}</span></figcaption>
            </figure>
          ))}
        </div>
      </section>

      {confirm && (
        <Confirm
          title={t('requests.cancel')}
          body={t('requests.cancelBody')}
          danger
          onClose={() => setConfirm(null)}
          onConfirm={() => setTestRequestStatus(confirm.id, confirm.status)}
        />
      )}
    </div>
  );
}
