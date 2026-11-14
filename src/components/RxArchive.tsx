// Prescription archive: every prescription of an owner's pets (or one pet), searchable, each one reprintable.
// Prescriptions already live on their visit; this puts them in one place so the doctor finds them again.
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApp, useQuery } from '../lib/app';
import { getPet, getSettings, getVisit, prescriptionArchive } from '../db/repo';
import { ageParts } from '../lib/dates';
import { platform } from '../lib/platform';
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

/** /visits/:visitId/prescription — one visit's prescription, A5, to reprint at any time. */
export function PrescriptionPrint() {
  const { visitId = '' } = useParams();
  const { t, fmt, locale } = useApp();
  const nav = useNavigate();
  const v = useQuery(() => getVisit(visitId), [visitId]);
  const pet = useQuery(() => (v ? getPet(v.pet_id) : undefined), [v?.pet_id]);
  const s = useQuery(getSettings);
  if (!v || !pet) return <div className="page">{t('common.notFound')}</div>;
  const age = pet.date_of_birth ? ageParts(pet.date_of_birth, v.visited_at.slice(0, 10)) : null;
  return (
    <div className="page">
      <div className="row no-print" style={{ marginBottom: 14 }}>
        <button className="btn" onClick={() => nav(-1)}>{t('app.back')}</button>
        <button className="btn primary" onClick={() => platform.print()}><Icon name="print" /> {t('common.print')}</button>
      </div>
      <div className="sheet-wrap">
        <div className="sheet a5 rx-sheet">
          <div className="head">
            <div>
              <b style={{ fontSize: 15 }}>{locale === 'ar' ? s.name_ar : s.name_en}</b>
              <div style={{ fontSize: 10 }}>{s.address} {s.phone && <span className="ltr">· {s.phone}</span>}</div>
            </div>
            {s.logo_url && <img src={s.logo_url} alt="" />}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 11, marginBottom: 8 }}>
            <div>
              <h2 style={{ margin: '0 0 2px' }}>℞ {t('rxArchive.printTitle')}</h2>
              <div>{fmt.date(v.visited_at)}</div>
            </div>
            <div style={{ textAlign: 'end' }}>
              <div>{t('rxArchive.owner')}: {pet.owner_name} <span className="ltr">{pet.owner_phone}</span></div>
              <div>
                {t('rxArchive.patient')}: <b>{pet.name}</b> · {t(`species.${pet.species}`)}{pet.breed ? ` · ${pet.breed}` : ''} · {t(`sex.${pet.sex}`)}
                {age ? ` · ${t('pets.ageValue', { y: age.years, m: age.months })}` : ''}
                {v.weight_kg != null ? ` · ${fmt.num(v.weight_kg, 2)} ${t('common.kg')}` : ''}
              </div>
            </div>
          </div>
          <table>
            <thead>
              <tr><th>{t('rxArchive.drug')}</th><th>{t('rxArchive.dose')}</th><th>{t('rxArchive.frequency')}</th><th className="r">{t('rxArchive.duration')}</th></tr>
            </thead>
            <tbody>
              {v.prescriptions.length === 0 && <tr><td colSpan={4}>—</td></tr>}
              {v.prescriptions.map((r) => (
                <tr key={r.id}>
                  <td><b>{r.drug}</b>{r.instructions && <div style={{ fontSize: '9pt' }}>{r.instructions}</div>}</td>
                  <td>{r.dose || '—'}</td>
                  <td>{r.frequency || '—'}</td>
                  <td className="r">{r.duration_days ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="rx-sign">
            <div>{v.vet_name ?? ''}</div>
            <div className="line">{t('rxArchive.signature')}</div>
          </div>
          <div className="foot">{t('rxArchive.printed', { date: fmt.date(new Date().toISOString()) })}</div>
        </div>
      </div>
    </div>
  );
}
