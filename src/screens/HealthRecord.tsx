// Pet health record booklet (14 Nov 2026, change request from Ahmed, after a "Canine health record" sample): a paper
// record that stays with the owner, so the vaccinations are with the customer as well as in the app. One A4 sheet,
// landscape, printed on both sides (flip on the short edge) and folded in three:
//   outside: [weight log + deworming] [back cover: microchip, veterinarian, alerts, notes] [front cover: logo, pet, owner]
//   inside:  [vaccinations: a box per vaccine with date, next due, vet signature and a space for the vaccine sticker]
//            … [flea & tick, other treatments]
// Every label in English and Arabic (as on the vaccination certificate). "Filled in" writes the pet, the owner and
// what is already recorded (vaccinations, weights); "Blank" leaves everything to be written by hand.
import { useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApp, useQuery } from '../lib/app';
import { getOwner, getPet, getSettings, listVaccineTypes, petVaccinations, petWeights, shownCode, type VaccinationRow } from '../db/repo';
import { platform } from '../lib/platform';
import { Icon } from '../components/ui';
import { Bi, intlDate } from './Certificate';

// Parasite prevention has its own tables (like the paper sample); everything else in the catalogue is a vaccine box.
const DEWORM = /worm|ديدان|طفيل/i;
const FLEA = /flea|tick|براغيث|قراد/i;

/** Lines to write on, with what is already known printed on them. */
function Lines({ rows, cols, values }: { rows: number; cols: string[]; values?: (string | null | undefined)[][] }) {
  return (
    <table className="hr-table">
      <thead><tr>{cols.map((c) => <th key={c}><Bi k={c} /></th>)}</tr></thead>
      <tbody>
        {Array.from({ length: Math.max(rows, values?.length ?? 0) }, (_, i) => (
          <tr key={i}>{cols.map((c, j) => <td key={c}>{values?.[i]?.[j] ?? ''}</td>)}</tr>
        ))}
      </tbody>
    </table>
  );
}
function Field({ k, value }: { k: string; value?: ReactNode }) {
  return <div className="hr-field"><span className="hr-label"><Bi k={k} /></span><span className="hr-line">{value ?? ''}</span></div>;
}
function Box({ title, children }: { title: string; children: ReactNode }) {
  return <section className="hr-box"><h3><Bi k={title} /></h3>{children}</section>;
}

export function HealthRecordPrint() {
  const { id = '' } = useParams();
  const { t } = useApp();
  const nav = useNavigate();
  const [blank, setBlank] = useState(false);
  const pet = useQuery(() => getPet(id), [id]);
  const owner = useQuery(() => (pet ? getOwner(pet.owner_id) : undefined), [pet?.owner_id]);
  const s = useQuery(getSettings);
  const types = useQuery(() => listVaccineTypes(true), []);
  const given = useQuery(() => petVaccinations(id).slice().reverse(), [id]); // oldest first
  const weights = useQuery(() => petWeights(id), [id]);
  if (!pet) return null;

  const mine = types.filter((v) => v.species.split(',').includes(pet.species) || pet.species === 'OTHER');
  const vaccines = mine.filter((v) => !DEWORM.test(v.name) && !FLEA.test(v.name));
  const show = (v: string | null | undefined) => (blank ? '' : v ?? '');
  const recorded = (test: RegExp) => (blank ? [] : given.filter((g) => test.test(g.vaccine)));
  const row = (g: VaccinationRow) => [intlDate(g.administered_at), g.vaccine, g.next_due_at ? intlDate(g.next_due_at) : ''];
  // Three boxes per vaccine (two when the list is long, so it still fits the inside of the sheet), and two spare.
  const slots = vaccines.length > 4 ? 2 : 3;
  const vaccineBoxes = [...vaccines.map((v) => ({ key: v.id, name: v.name, done: blank ? [] : given.filter((g) => g.vaccine_type_id === v.id) })), { key: 'o1', name: '', done: [] as VaccinationRow[] }, { key: 'o2', name: '', done: [] as VaccinationRow[] }];
  const alerts = [...(pet.alert_flags ?? '').split(',').filter(Boolean).map((f) => t(`alerts.flag.${f}`)), pet.alert_note].filter(Boolean).join(' · ');

  return (
    <div className="page">
      <div className="row no-print" style={{ marginBottom: 14, flexWrap: 'wrap' }}>
        <button className="btn" onClick={() => nav(-1)}>{t('app.back')}</button>
        <div className="seg" role="group" aria-label={t('healthRecord.mode')}>
          <button type="button" className={!blank ? 'on' : ''} onClick={() => setBlank(false)}>{t('healthRecord.filled')}</button>
          <button type="button" className={blank ? 'on' : ''} onClick={() => setBlank(true)}>{t('healthRecord.blank')}</button>
        </div>
        <span className="spacer" />
        <button className="btn primary" onClick={() => platform.print()}><Icon name="print" /> {t('common.print')}</button>
      </div>
      <p className="muted no-print" style={{ maxWidth: '75ch' }}>{t('healthRecord.howTo')}</p>
      <div className="sheet-wrap hr-wrap">
        {/* Outside of the sheet */}
        <div className="sheet hr-page hr-outside">
          <div className="hr-panel">
            <Box title="healthRecord.weightLog">
              <Lines rows={10} cols={['healthRecord.date', 'healthRecord.weightKg']} values={blank ? [] : weights.slice(-10).map((w) => [intlDate(w.visited_at), String(w.weight_kg)])} />
            </Box>
            <Box title="healthRecord.deworming">
              <Lines rows={8} cols={['healthRecord.date', 'healthRecord.product', 'healthRecord.nextDue']} values={recorded(DEWORM).slice(-8).map(row)} />
            </Box>
          </div>
          <div className="hr-panel">
            <Box title="healthRecord.microchip">
              <Field k="healthRecord.number" value={<span className="ltr">{show(pet.microchip_no)}</span>} />
              <Field k="healthRecord.implanted" />
            </Box>
            <Box title="healthRecord.vet">
              <Field k="healthRecord.clinic" value={<>{s.name_en} · <span dir="rtl" lang="ar">{s.name_ar}</span></>} />
              <Field k="healthRecord.phone" value={<span className="ltr">{s.phone}</span>} />
              <Field k="healthRecord.address" value={<span dir="auto">{s.address}</span>} />
            </Box>
            <Box title="healthRecord.alerts">
              <div className="hr-write">{show(alerts)}</div>
            </Box>
            <Box title="healthRecord.notes">
              <div className="hr-write tall" />
            </Box>
          </div>
          <div className="hr-panel hr-cover">
            {s.logo_url && <img className="hr-logo" src={s.logo_url} alt="" />}
            <h1><Bi k="healthRecord.title" /></h1>
            <p className="hr-keep"><Bi k="healthRecord.keep" /></p>
            <Box title="healthRecord.petInfo">
              <Field k="pets.name" value={<b>{show(pet.name)}</b>} />
              <Field k="pets.species" value={blank ? '' : <><Bi k={`species.${pet.species}`} />{pet.breed ? ` · ${pet.breed}` : ''}</>} />
              <Field k="pets.sex" value={blank ? '' : <><Bi k={`sex.${pet.sex}`} />{pet.is_neutered ? <> · <Bi k="pets.neutered" /></> : null}</>} />
              <Field k="pets.dob" value={blank || !pet.date_of_birth ? '' : intlDate(pet.date_of_birth)} />
              <Field k="pets.color" value={show(pet.color)} />
            </Box>
            <Box title="healthRecord.ownerInfo">
              <Field k="healthRecord.name" value={show(pet.owner_name)} />
              <Field k="owners.code" value={<span className="ltr">{blank ? '' : shownCode(pet.owner_code) ?? ''}</span>} />
              <Field k="healthRecord.phone" value={<span className="ltr">{show(pet.owner_phone)}</span>} />
              <Field k="healthRecord.address" value={<span dir="auto">{show(owner?.address)}</span>} />
            </Box>
            <div className="hr-clinic"><b>{s.name_en}</b> · <span className="ltr">{s.phone}</span><div dir="auto">{s.address}</div></div>
          </div>
        </div>

        {/* Inside of the sheet */}
        <div className="sheet hr-page hr-inside">
          <div className="hr-vaccines">
            <h2><Bi k="healthRecord.vaccinations" /></h2>
            {vaccineBoxes.map((v) => (
              <section key={v.key} className="hr-vbox">
                <h3>{v.name ? v.name : <><Bi k="healthRecord.otherVaccine" /> <span className="hr-blank" /></>}</h3>
                {Array.from({ length: Math.max(slots, v.done.length) }, (_, i) => {
                  const g = v.done[i];
                  return (
                    <div key={i} className="hr-slot">
                      <div className="hr-sticker"><Bi k="healthRecord.sticker" /></div>
                      <div className="hr-slot-lines">
                        <Field k="healthRecord.given" value={g ? intlDate(g.administered_at) : ''} />
                        <Field k="healthRecord.nextDue" value={g?.next_due_at ? intlDate(g.next_due_at) : ''} />
                        <Field k="healthRecord.vetSign" />
                      </div>
                    </div>
                  );
                })}
              </section>
            ))}
          </div>
          <div className="hr-panel">
            <Box title="healthRecord.flea">
              <Lines rows={12} cols={['healthRecord.date', 'healthRecord.product', 'healthRecord.nextDue']} values={recorded(FLEA).slice(-12).map(row)} />
            </Box>
            <Box title="healthRecord.otherTreatments">
              <Lines rows={7} cols={['healthRecord.date', 'healthRecord.treatment']} />
            </Box>
          </div>
        </div>
      </div>
    </div>
  );
}
