// Prescription archive: every prescription of an owner's pets (or one pet), searchable; Print opens the
// prescription sheet (/visits/:id/prescription, screens/Prescription.tsx).
// Prescriptions already live on their visit; this puts them in one place so the doctor finds them again.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp, useQuery } from '../lib/app';
import { prescriptionArchive } from '../db/repo';
import { Icon } from './ui';

const SHOW = 8;

export function RxArchive({ ownerId, petId }: { ownerId?: string; petId?: string }) {
  const { t, fmt } = useApp();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [pet, setPet] = useState<string>('all');
  const [showAll, setShowAll] = useState(false);
  const everything = useQuery(() => prescriptionArchive({ ownerId, petId }), [ownerId, petId]);
  const found = useQuery(() => (q.trim() ? prescriptionArchive({ ownerId, petId }, q) : everything), [ownerId, petId, q, everything]);
  const pets = [...new Map(everything.map((v) => [v.pet_id, v.pet_name])).entries()];
  const list = pet === 'all' ? found : found.filter((v) => v.pet_id === pet);
  const shown = showAll || q.trim() ? list : list.slice(0, SHOW);

  if (!everything.length) return <p className="empty">{t('rxArchive.empty')}</p>;
  return (
    <div className="rx-archive">
      <div className="row" style={{ margin: '12px 0 4px' }}>
        <div className="searchbox rx-search" style={{ flex: '1 1 240px' }}>
          <Icon name="search" />
          <input type="search" value={q} placeholder={t('rxArchive.search')} aria-label={t('rxArchive.search')} onChange={(e) => setQ(e.target.value)} />
        </div>
        {!petId && pets.length > 1 && (
          <div className="seg" role="group">
            <button className={pet === 'all' ? 'on' : ''} onClick={() => setPet('all')}>{t('rxArchive.allPets')}</button>
            {pets.map(([id, name]) => (
              <button key={id} className={pet === id ? 'on' : ''} onClick={() => setPet(id)}>{name}</button>
            ))}
          </div>
        )}
      </div>
      <ul className="tl rx-list">
        {list.length === 0 && <li className="empty">{t('rxArchive.noMatch')}</li>}
        {shown.map((v) => (
          <li key={v.visit_id}>
            <div className="when">
              <b>{fmt.date(v.visited_at)}</b>
              <span>{v.vet_name ? t('rxArchive.byVet', { name: v.vet_name }) : ''}</span>
            </div>
            <div className="body">
              <div className="row">
                {!petId && <a href={`#/pets/${v.pet_id}?tab=prescriptions`} className={v.pet_status !== 'ACTIVE' ? 'greyed' : ''}><b>{v.pet_name}</b></a>}
                <span className="muted small">{t(`visitType.${v.type}`)}{v.diagnosis ? ` · ${v.diagnosis}` : ''}</span>
                <span className="spacer" />
                <button className="btn ghost sm" onClick={() => nav(`/visits/${v.visit_id}/prescription`)}><Icon name="print" /> {t('rxArchive.print')}</button>
              </div>
              <ul className="rx">
                {v.prescriptions.map((r) => (
                  <li key={r.id}>💊 <b>{r.drug}</b> {[r.dose, r.frequency, r.duration_days ? `${r.duration_days} ${t('common.days')}` : null, r.instructions].filter(Boolean).join(' · ')}</li>
                ))}
              </ul>
            </div>
          </li>
        ))}
      </ul>
      {shown.length < list.length && (
        <p><button className="btn sm" onClick={() => setShowAll(true)}>{t('rxArchive.showAll', { n: list.length })}</button></p>
      )}
    </div>
  );
}
