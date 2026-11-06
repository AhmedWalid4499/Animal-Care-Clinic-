import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApp, useQuery } from '../lib/app';
import { getOwner, getPet, microchipTaken, savePet, searchOwners, type PetInput } from '../db/repo';
import { Field, PetAvatar, imageToDataUrl } from '../components/ui';
import { PageHead } from '../components/Layout';
import { ALERT_FLAGS, PET_STATUS, SEXES, SPECIES, type Pet } from '../db/types';
import { today } from '../lib/dates';

export function PetFormPage() {
  const { id, ownerId } = useParams();
  const existing = id ? getPet(id) : undefined;
  const { t, toast } = useApp();
  const nav = useNavigate();
  const [f, setF] = useState<PetInput>(() =>
    existing
      ? strip(existing)
      : { owner_id: ownerId!, name: '', species: 'DOG', breed: '', sex: 'UNKNOWN', is_neutered: 0, date_of_birth: '', dob_is_estimate: 0, color: '', microchip_no: '', photo_url: null, status: 'ACTIVE', deceased_at: null, notes: '', alert_flags: null, alert_note: '' },
  );
  const [ownerQ, setOwnerQ] = useState('');
  const owners = useQuery(() => (ownerQ.trim().length >= 2 ? searchOwners(ownerQ, 'ACTIVE').slice(0, 8) : []), [ownerQ]);
  const owner = useQuery(() => getOwner(f.owner_id), [f.owner_id]);
  const chipErr = f.microchip_no && microchipTaken(f.microchip_no, id) ? t('pets.microchipTaken') : null;
  const set = <K extends keyof PetInput>(k: K, v: PetInput[K]) => setF({ ...f, [k]: v });

  return (
    <div className="page narrow">
      <PageHead
        title={id ? t('pets.edit') : t('pets.new')}
        crumb={id ? { to: `/pets/${id}`, label: existing?.name ?? '' } : { to: `/owners/${ownerId}`, label: owner?.full_name ?? '' }}
      />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (chipErr) return;
          const savedId = savePet(f, id);
          toast(t('app.saved'));
          nav(`/pets/${savedId}`, { replace: true });
        }}
      >
        <div className="row" style={{ gap: 16, marginBottom: 18 }}>
          <PetAvatar photo={f.photo_url} species={f.species} />
          <div className="row">
            <label className="btn">
              {t('pets.choosePhoto')}
              <input type="file" accept="image/*" hidden onChange={async (e) => { const file = e.target.files?.[0]; if (file) set('photo_url', await imageToDataUrl(file)); }} />
            </label>
            {f.photo_url && <button type="button" className="btn ghost" onClick={() => set('photo_url', null)}>{t('common.remove')}</button>}
          </div>
        </div>
        <div className="grid g2">
          <Field label={t('pets.name')}>
            <input type="text" value={f.name} onChange={(e) => set('name', e.target.value)} required autoFocus />
          </Field>
          <Field label={t('pets.species')}>
            <select value={f.species} onChange={(e) => set('species', e.target.value as Pet['species'])}>
              {SPECIES.map((s) => <option key={s} value={s}>{t(`species.${s}`)}</option>)}
            </select>
          </Field>
          <Field label={t('pets.breed')} optional>
            <input type="text" value={f.breed ?? ''} onChange={(e) => set('breed', e.target.value)} />
          </Field>
          <Field label={t('pets.sex')}>
            <select value={f.sex} onChange={(e) => set('sex', e.target.value as Pet['sex'])}>
              {SEXES.map((s) => <option key={s} value={s}>{t(`sex.${s}`)}</option>)}
            </select>
          </Field>
          <Field label={t('pets.dob')} optional>
            <input type="date" value={f.date_of_birth ?? ''} max={today()} onChange={(e) => set('date_of_birth', e.target.value)} />
          </Field>
          <div className="field">
            <span>&nbsp;</span>
            <div className="row">
              <label className="check"><input type="checkbox" checked={!!f.dob_is_estimate} onChange={(e) => set('dob_is_estimate', e.target.checked ? 1 : 0)} /> {t('pets.dobEstimate')}</label>
              <label className="check"><input type="checkbox" checked={!!f.is_neutered} onChange={(e) => set('is_neutered', e.target.checked ? 1 : 0)} /> {t('pets.neutered')}</label>
            </div>
          </div>
          <Field label={t('pets.color')} optional>
            <input type="text" value={f.color ?? ''} onChange={(e) => set('color', e.target.value)} />
          </Field>
          <Field label={t('pets.microchip')} optional error={chipErr}>
            <input type="text" className="ltr" value={f.microchip_no ?? ''} onChange={(e) => set('microchip_no', e.target.value)} inputMode="numeric" />
          </Field>
          {id && (
            <Field label={t('pets.status')}>
              <select value={f.status} onChange={(e) => set('status', e.target.value as Pet['status'])}>
                {PET_STATUS.map((s) => <option key={s} value={s}>{t(`petStatus.${s}`)}</option>)}
              </select>
            </Field>
          )}
          {id && (
            <Field label={t('pets.owner')} hint={t('pets.transferHint')} group>
              <div className="chosen"><b style={{ flex: 1 }}>{owner?.full_name}</b></div>
              <input type="search" value={ownerQ} onChange={(e) => setOwnerQ(e.target.value)} placeholder={t('common.search')} />
              {owners.length > 0 && (
                <div className="picker">
                  {owners.map((o) => (
                    <button type="button" key={o.id} onClick={() => { set('owner_id', o.id); setOwnerQ(''); }}>
                      <b style={{ flex: 1 }}>{o.full_name}</b> <span className="muted small ltr">{o.phone}</span>
                    </button>
                  ))}
                </div>
              )}
            </Field>
          )}
          <Field label={t('alerts.title')} className="span2 alerts-field" hint={t('alerts.hint')} optional group>
            <div className="row">
              {ALERT_FLAGS.map((fl) => {
                const on = (f.alert_flags ?? '').split(',').includes(fl);
                return (
                  <label key={fl} className="check">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={(e) => {
                        const cur = new Set((f.alert_flags ?? '').split(',').filter(Boolean));
                        if (e.target.checked) cur.add(fl);
                        else cur.delete(fl);
                        set('alert_flags', ALERT_FLAGS.filter((x) => cur.has(x)).join(',') || null);
                      }}
                    />{' '}
                    {t(`alerts.flag.${fl}`)}
                  </label>
                );
              })}
            </div>
            <input type="text" value={f.alert_note ?? ''} placeholder={t('alerts.notePlaceholder')} aria-label={t('alerts.note')} onChange={(e) => set('alert_note', e.target.value)} />
          </Field>
          <Field label={t('common.notes')} className="span2" optional>
            <textarea value={f.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
          </Field>
        </div>
        <div className="actionbar">
          <button type="button" className="btn" onClick={() => nav(-1)}>{t('common.cancel')}</button>
          <button className="btn primary" disabled={!!chipErr}>{t('common.save')}</button>
        </div>
      </form>
    </div>
  );
}

function strip(p: Pet): PetInput {
  const rest: Record<string, unknown> = { ...p };
  for (const k of ['id', 'owner_name', 'owner_phone', 'owner_whatsapp', 'created_at', 'updated_at']) delete rest[k];
  return rest as unknown as PetInput;
}
