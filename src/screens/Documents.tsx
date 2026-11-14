// Printed documents for a pet (14 Nov 2026 change requests), each with the clinic logo and the customer ID:
//  - Lab report (A5): one test day's results with the reference ranges and high / low flags.
//  - Case report (A4): the owner, the patient, the whole case history (visits, diagnoses, treatment, prescriptions),
//    vaccinations, lab results, and the attached X-rays and photos printed in the report. Admins and Doctors.
//  - X-ray request (A5): the views to take, ticked from a menu, plus the vet's own notes. Printed, not stored.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useApp, useQuery } from '../lib/app';
import {
  getAttachmentBytes, getOwner, getPet, getSettings, lastWeight, petAttachments, petLabResults, petVaccinations, petVisits, shownCode,
  type PetRow,
} from '../db/repo';
import type { Attachment, LabResult } from '../db/types';
import { ageParts } from '../lib/dates';
import { platform } from '../lib/platform';
import { downloadAttachment, serverUrl } from '../sync/engine';
import { Icon } from '../components/ui';
import { labFlag } from './Labs';

const range = (r: Pick<LabResult, 'ref_low' | 'ref_high'>) =>
  r.ref_low != null && r.ref_high != null ? `${r.ref_low}–${r.ref_high}` : r.ref_low != null ? `≥ ${r.ref_low}` : r.ref_high != null ? `≤ ${r.ref_high}` : '';

/** Back + Print above a sheet, and the sheet itself. */
function PrintPage({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  const { t } = useApp();
  const nav = useNavigate();
  return (
    <div className="page">
      <div className="row no-print" style={{ marginBottom: 14 }}>
        <button className="btn" onClick={() => nav(-1)}>{t('app.back')}</button>
        <span className="spacer" />
        {actions}
        <button className="btn primary print-btn" onClick={() => platform.print()}><Icon name="print" /> {t('common.print')}</button>
      </div>
      <div className="sheet-wrap">{children}</div>
    </div>
  );
}

/** Clinic name, address, phone and logo across the top of every document. */
function SheetHead() {
  const { locale } = useApp();
  const s = useQuery(getSettings);
  return (
    <div className="head">
      <div>
        <b style={{ fontSize: 15 }}>{locale === 'ar' ? s.name_ar : s.name_en}</b>
        <div style={{ fontSize: 10 }}>{s.address} {s.phone && <span className="ltr">· {s.phone}</span>}</div>
      </div>
      {s.logo_url && <img src={s.logo_url} alt="" />}
    </div>
  );
}

/** Owner (with customer ID) and patient facts, as on every document. */
function Who({ pet, at, weight }: { pet: PetRow; at?: string; weight?: number | null }) {
  const { t, fmt } = useApp();
  const age = pet.date_of_birth ? ageParts(pet.date_of_birth, (at ?? new Date().toISOString()).slice(0, 10)) : null;
  return (
    <div className="doc-facts">
      <span>{t('docs.owner')}: <b>{pet.owner_name}</b></span>
      {shownCode(pet.owner_code) && <span>{t('owners.code')}: <b className="ltr">{pet.owner_code}</b></span>}
      <span>{t('owners.phone')}: <b className="ltr">{pet.owner_phone}</b></span>
      <span>{t('docs.pet')}: <b>{pet.name}</b> ({t(`species.${pet.species}`)}{pet.breed ? ` · ${pet.breed}` : ''})</span>
      <span>{t('pets.sex')}: <b>{t(`sex.${pet.sex}`)}{pet.is_neutered ? ` · ${t('pets.neutered')}` : ''}</b></span>
      <span>{t('pets.age')}: <b>{age ? t('pets.ageValue', { y: age.years, m: age.months }) : '—'}</b></span>
      {weight != null && <span>{t('visits.weight')}: <b className="ltr">{fmt.num(weight, 2)} {t('common.kg')}</b></span>}
      {pet.microchip_no && <span>{t('pets.microchip')}: <b className="ltr">{pet.microchip_no}</b></span>}
    </div>
  );
}

// ---------------------------------------------------------------- lab report (A5)
/** /pets/:id/labs/:date — every result taken that day, grouped by panel. */
export function LabReportPrint() {
  const { id = '', date = '' } = useParams();
  const { t, fmt } = useApp();
  const pet = useQuery(() => getPet(id), [id]);
  const rows = useQuery(() => petLabResults(id).filter((r) => r.taken_at === date), [id, date]);
  if (!pet) return null;
  const panels = [...new Set(rows.map((r) => r.panel ?? ''))];
  const notes = [...new Set(rows.map((r) => r.note).filter(Boolean))];
  return (
    <PrintPage>
      <div className="sheet a5 doc lab-sheet">
        <SheetHead />
        <h2 className="doc-title">{t('docs.labTitle')}</h2>
        <Who pet={pet} at={date} />
        <div className="doc-facts"><span>{t('docs.sampleDate')}: <b>{fmt.date(date)}</b></span></div>
        {panels.map((p) => (
          <div key={p} className="doc-block">
            {p && <h3>{p}</h3>}
            <table>
              <thead><tr><th>{t('labs.analyte')}</th><th className="r">{t('labs.value')}</th><th>{t('labs.unit')}</th><th>{t('labs.range')}</th><th /></tr></thead>
              <tbody>
                {rows.filter((r) => (r.panel ?? '') === p).map((r) => {
                  const f = labFlag(r);
                  return (
                    <tr key={r.id} className={f ? 'flag' : ''}>
                      <td>{r.analyte}</td>
                      <td className="r ltr"><b>{r.value != null ? fmt.num(r.value, 2) : r.value_text}</b></td>
                      <td className="ltr">{r.unit ?? ''}</td>
                      <td className="ltr">{range(r)}</td>
                      <td className="r">{f ? <b>{t(f === 'H' ? 'labs.high' : 'labs.low')}</b> : ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
        {rows.length === 0 && <p>{t('labs.none')}</p>}
        {notes.map((n) => <p key={n} className="small">{n}</p>)}
        <div className="doc-sign"><div className="line" />{t('certificate.signature')}</div>
        <div className="foot">{t('docs.printed', { date: fmt.date(new Date().toISOString()) })}</div>
      </div>
    </PrintPage>
  );
}

// ---------------------------------------------------------------- case report (A4)
const isImage = (a: Attachment) => /^image\/(png|jpe?g|gif|webp|bmp)$/i.test(a.mime_type ?? '') || /\.(png|jpe?g|gif|webp|bmp)$/i.test(a.file_name);

/** Object URLs for the pet's image attachments; files only on the clinic server are fetched first. */
function useImages(files: Attachment[], enabled: boolean) {
  const [urls, setUrls] = useState<Record<string, string | null>>({});
  const key = files.map((f) => f.id).join(',');
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const made: string[] = [];
    (async () => {
      const out: Record<string, string | null> = {};
      for (const a of files.filter(isImage)) {
        let b = getAttachmentBytes(a.id);
        if (!b && serverUrl()) b = (await downloadAttachment(a.id).catch(() => null)) ?? undefined;
        if (!b) {
          out[a.id] = null;
          continue;
        }
        const u = URL.createObjectURL(new Blob([b], { type: a.mime_type || 'image/jpeg' }));
        made.push(u);
        out[a.id] = u;
      }
      if (alive) setUrls(out);
    })();
    return () => {
      alive = false;
      made.forEach((u) => URL.revokeObjectURL(u));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);
  return urls;
}

/** /pets/:id/report — the full case for a referral, insurance or the owner. */
export function CaseReport() {
  const { id = '' } = useParams();
  const [sp] = useSearchParams();
  const { t, fmt, user } = useApp();
  const pet = useQuery(() => getPet(id), [id]);
  const owner = useQuery(() => (pet ? getOwner(pet.owner_id) : undefined), [pet?.owner_id]);
  const visitsAll = useQuery(() => petVisits(id).filter((v) => v.stage === 'DONE'), [id]);
  const vacc = useQuery(() => petVaccinations(id), [id]);
  const labs = useQuery(() => petLabResults(id), [id]);
  const files = useQuery(() => petAttachments(id), [id]);
  const weight = useQuery(() => lastWeight(id), [id]);
  const [from, setFrom] = useState(sp.get('from') ?? '');
  const [to, setTo] = useState(sp.get('to') ?? '');
  const [withFiles, setWithFiles] = useState(true);
  const inRange = (d: string) => (!from || d.slice(0, 10) >= from) && (!to || d.slice(0, 10) <= to);
  const visits = visitsAll.filter((v) => inRange(v.visited_at)).slice().reverse(); // oldest first, as a case reads
  const labDays = useMemo(() => [...new Set(labs.filter((l) => inRange(l.taken_at)).map((l) => l.taken_at))].sort(), [labs, from, to]); // eslint-disable-line react-hooks/exhaustive-deps
  const shownFiles = files.filter((f) => inRange(f.created_at));
  const images = useImages(shownFiles, withFiles);
  if (!pet || !owner) return null;
  const diagnoses = [...new Set(visits.map((v) => v.diagnosis).filter(Boolean))] as string[];

  return (
    <PrintPage
      actions={
        <div className="row report-options">
          <label className="small">{t('docs.from')} <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="small">{t('docs.to')} <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <label className="small check"><input type="checkbox" checked={withFiles} onChange={(e) => setWithFiles(e.target.checked)} /> {t('docs.withImages')}</label>
        </div>
      }
    >
      <div className="sheet a4 doc case-report">
        <SheetHead />
        <h2 className="doc-title">{t('docs.reportTitle')}</h2>
        <p className="small" style={{ textAlign: 'center', margin: '-4px 0 10px' }}>
          {from || to ? t('docs.period', { from: from ? fmt.date(from) : '…', to: to ? fmt.date(to) : '…' }) : t('docs.wholeHistory')}
        </p>

        <h3>{t('docs.ownerSection')}</h3>
        <table className="kv-table">
          <tbody>
            <tr><td>{t('owners.fullName')}</td><td><b>{owner.full_name}</b></td><td>{t('owners.code')}</td><td className="ltr">{shownCode(owner.code) ?? '—'}</td></tr>
            <tr><td>{t('owners.phone')}</td><td className="ltr">{owner.phone}</td><td>{t('owners.whatsapp')}</td><td className="ltr">{owner.whatsapp || owner.phone}</td></tr>
            {(owner.email || owner.address) && <tr><td>{t('owners.email')}</td><td className="ltr">{owner.email || '—'}</td><td>{t('owners.address')}</td><td>{owner.address || '—'}</td></tr>}
          </tbody>
        </table>

        <h3>{t('docs.patientSection')}</h3>
        <table className="kv-table">
          <tbody>
            <tr><td>{t('pets.name')}</td><td><b>{pet.name}</b></td><td>{t('pets.species')}</td><td>{t(`species.${pet.species}`)}{pet.breed ? ` · ${pet.breed}` : ''}</td></tr>
            <tr>
              <td>{t('pets.sex')}</td><td>{t(`sex.${pet.sex}`)}{pet.is_neutered ? ` · ${t('pets.neutered')}` : ''}</td>
              <td>{t('pets.dob')}</td>
              <td>{fmt.date(pet.date_of_birth)}{pet.date_of_birth ? (() => { const a = ageParts(pet.date_of_birth); return ` (${t('pets.ageValue', { y: a.years, m: a.months })})`; })() : ''}</td>
            </tr>
            <tr><td>{t('pets.color')}</td><td>{pet.color || '—'}</td><td>{t('pets.microchip')}</td><td className="ltr">{pet.microchip_no || '—'}</td></tr>
            <tr><td>{t('pets.lastWeight')}</td><td>{weight ? `${fmt.num(weight.weight_kg, 2)} ${t('common.kg')} · ${fmt.date(weight.visited_at)}` : '—'}</td><td>{t('pets.status')}</td><td>{t(`petStatus.${pet.status}`)}</td></tr>
            {(pet.alert_flags || pet.alert_note) && (
              <tr><td>{t('alerts.title')}</td><td colSpan={3}><b>{[...(pet.alert_flags ?? '').split(',').filter(Boolean).map((f) => t(`alerts.flag.${f}`)), pet.alert_note].filter(Boolean).join(' · ')}</b></td></tr>
            )}
          </tbody>
        </table>

        {diagnoses.length > 0 && (
          <>
            <h3>{t('docs.diagnoses')}</h3>
            <p className="doc-dx">{diagnoses.join(' · ')}</p>
          </>
        )}

        <h3>{t('docs.history')}</h3>
        {visits.length === 0 && <p className="small">{t('petRecord.noVisits')}</p>}
        {visits.map((v) => (
          <div key={v.id} className="visit-block">
            <div className="visit-head">
              <b>{fmt.dateTime(v.visited_at)}</b> · {t(`visitType.${v.type}`)}{v.vet_name ? ` · ${v.vet_name}` : ''}
            </div>
            <div className="visit-body">
              {v.complaint && <p><span>{t('visits.complaint')}:</span> {v.complaint}</p>}
              {v.history && <p><span>{t('intake.history')}:</span> {v.history}</p>}
              {[v.weight_kg != null ? `${t('visits.weight')} ${fmt.num(v.weight_kg, 2)} ${t('common.kg')}` : null,
                v.temperature_c != null ? `${t('visits.temperature')} ${fmt.num(v.temperature_c, 1)}` : null,
                v.heart_rate != null ? `♥ ${v.heart_rate}/min` : null,
                v.resp_rate != null ? `🫁 ${v.resp_rate}/min` : null].filter(Boolean).length > 0 && (
                <p className="vitals">{[v.weight_kg != null ? `${t('visits.weight')} ${fmt.num(v.weight_kg, 2)} ${t('common.kg')}` : null,
                  v.temperature_c != null ? `${t('visits.temperature')} ${fmt.num(v.temperature_c, 1)}` : null,
                  v.heart_rate != null ? `♥ ${v.heart_rate}/min` : null,
                  v.resp_rate != null ? `🫁 ${v.resp_rate}/min` : null].filter(Boolean).join(' · ')}</p>
              )}
              {v.intake_notes && <p><span>{t('intake.notes')}:</span> {v.intake_notes}</p>}
              {v.diagnosis && <p className="dx"><span>{t('visits.diagnosis')}:</span> <b>{v.diagnosis}</b></p>}
              {v.treatment_notes && <p><span>{t('visits.treatment')}:</span> {v.treatment_notes}</p>}
              {v.prescriptions.length > 0 && (
                <table>
                  <thead><tr><th>{t('rxSheet.rx')}</th><th>{t('visits.dose')}</th><th>{t('visits.frequency')}</th><th>{t('visits.durationDays')}</th></tr></thead>
                  <tbody>
                    {v.prescriptions.map((r) => (
                      <tr key={r.id}><td><b dir="auto">{r.drug}</b>{r.instructions ? <div className="small" dir="auto">{r.instructions}</div> : null}</td><td dir="auto">{r.dose || '—'}</td><td dir="auto">{r.frequency || '—'}</td><td>{r.duration_days ?? '—'}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
              {v.vaccinations.length > 0 && <p><span>{t('visits.vaccine')}:</span> {v.vaccinations.map((x) => x.vaccine).join(', ')}</p>}
              {v.follow_up_at && <p><span>{t('visits.followUp')}:</span> {fmt.dateTime(v.follow_up_at)}</p>}
            </div>
          </div>
        ))}

        {vacc.filter((x) => inRange(x.administered_at)).length > 0 && (
          <>
            <h3>{t('petRecord.vaccinations')}</h3>
            <table>
              <thead><tr><th>{t('visits.vaccine')}</th><th>{t('petRecord.administered')}</th><th>{t('petRecord.nextDue')}</th><th>{t('petRecord.batch')}</th></tr></thead>
              <tbody>
                {vacc.filter((x) => inRange(x.administered_at)).map((x) => (
                  <tr key={x.id}><td>{x.vaccine}</td><td>{fmt.date(x.administered_at)}</td><td>{fmt.date(x.next_due_at)}</td><td className="ltr">{x.batch_no || '—'}</td></tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {labDays.length > 0 && (
          <>
            <h3>{t('docs.labTitle')}</h3>
            <table>
              <thead><tr><th>{t('common.date')}</th><th>{t('labs.analyte')}</th><th className="r">{t('labs.value')}</th><th>{t('labs.unit')}</th><th>{t('labs.range')}</th><th /></tr></thead>
              <tbody>
                {labDays.flatMap((day) => labs.filter((l) => l.taken_at === day).map((r, i) => {
                  const f = labFlag(r);
                  return (
                    <tr key={r.id} className={f ? 'flag' : ''}>
                      <td>{i === 0 ? fmt.date(day) : ''}</td>
                      <td>{r.panel ? `${r.panel} · ` : ''}{r.analyte}</td>
                      <td className="r ltr"><b>{r.value != null ? fmt.num(r.value, 2) : r.value_text}</b></td>
                      <td className="ltr">{r.unit ?? ''}</td>
                      <td className="ltr">{range(r)}</td>
                      <td>{f ? <b>{t(f === 'H' ? 'labs.high' : 'labs.low')}</b> : ''}</td>
                    </tr>
                  );
                }))}
              </tbody>
            </table>
          </>
        )}

        {shownFiles.length > 0 && (
          <>
            <h3>{t('docs.attachments')}</h3>
            {withFiles && (
              <div className="doc-images">
                {shownFiles.filter(isImage).map((a) => (
                  <figure key={a.id}>
                    {images[a.id] ? <img src={images[a.id]!} alt={a.file_name} /> : <div className="img-missing">{images[a.id] === null ? t('docs.imageMissing') : '…'}</div>}
                    <figcaption>{t(`attachmentKind.${a.kind}`)} · {fmt.date(a.created_at)} · {a.file_name}</figcaption>
                  </figure>
                ))}
              </div>
            )}
            {shownFiles.filter((a) => !withFiles || !isImage(a)).length > 0 && (
              <table>
                <thead><tr><th>{t('docs.file')}</th><th>{t('petRecord.kind')}</th><th>{t('common.date')}</th></tr></thead>
                <tbody>
                  {shownFiles.filter((a) => !withFiles || !isImage(a)).map((a) => (
                    <tr key={a.id}><td dir="auto">{a.file_name}</td><td>{t(`attachmentKind.${a.kind}`)}</td><td>{fmt.date(a.created_at)}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}

        <div className="doc-sign wide">
          <div>{t('docs.preparedBy')}: <b>{user?.name ?? ''}</b></div>
          <div><div className="line" />{t('certificate.signature')}</div>
        </div>
        <div className="foot">{t('docs.printed', { date: fmt.date(new Date().toISOString()) })}</div>
      </div>
    </PrintPage>
  );
}

// ---------------------------------------------------------------- X-ray request (A5)
/** Regions and views on the request; limbs have a left / right box each. Labels in src/i18n (xray.*). */
export const XRAY_MENU: { region: string; views: string[]; sides?: boolean }[] = [
  { region: 'thorax', views: ['latR', 'latL', 'vd', 'dv'] },
  { region: 'abdomen', views: ['lat', 'vd'] },
  { region: 'skull', views: ['lat', 'dv', 'openMouth', 'dental', 'bulla'] },
  { region: 'spine', views: ['cervical', 'thoracic', 'lumbar', 'lumbosacral'] },
  { region: 'pelvis', views: ['vdExtended', 'vdFrog', 'lat'] },
  { region: 'forelimb', views: ['shoulder', 'humerus', 'elbow', 'radiusUlna', 'carpus', 'paw'], sides: true },
  { region: 'hindlimb', views: ['hip', 'femur', 'stifle', 'tibia', 'tarsus', 'paw'], sides: true },
  { region: 'other', views: ['wholeBody', 'contrast', 'comparison'] },
];
const OPTIONS = ['sedation', 'urgent', 'repeat'];

/** /pets/:id/xray-request — tick on screen, or print the empty boxes and tick by pen. */
export function XrayRequest() {
  const { id = '' } = useParams();
  const { t, fmt, user } = useApp();
  const pet = useQuery(() => getPet(id), [id]);
  const weight = useQuery(() => lastWeight(id), [id]);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState('');
  const [other, setOther] = useState('');
  if (!pet) return null;
  const toggle = (k: string) => setTicked((s) => {
    const n = new Set(s);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    return n;
  });
  const Box = ({ k, label }: { k: string; label: string }) => (
    <label className={`xbox ${ticked.has(k) ? 'on' : ''}`}>
      <input type="checkbox" checked={ticked.has(k)} onChange={() => toggle(k)} />
      <span className="sq" aria-hidden>{ticked.has(k) ? '✓' : ''}</span>
      <span>{label}</span>
    </label>
  );
  return (
    <PrintPage actions={<button className="btn" onClick={() => { setTicked(new Set()); setNotes(''); setOther(''); }}>{t('xray.clear')}</button>}>
      <div className="sheet a5 doc xray-sheet">
        <SheetHead />
        <h2 className="doc-title">{t('xray.title')}</h2>
        <Who pet={pet} weight={weight?.weight_kg ?? null} />
        <div className="doc-facts">
          <span>{t('common.date')}: <b>{fmt.date(new Date().toISOString())}</b></span>
          {user && <span>{t('xray.requestedBy')}: <b>{user.name}</b></span>}
        </div>
        <div className="xray-grid">
          {XRAY_MENU.map((g) => (
            <fieldset key={g.region}>
              <legend>{t(`xray.region.${g.region}`)}</legend>
              {g.views.map((v) => (g.sides ? (
                <div key={v} className="xside">
                  <span className="xside-name">{t(`xray.view.${v}`)}</span>
                  <Box k={`${g.region}.${v}.L`} label={t('xray.left')} />
                  <Box k={`${g.region}.${v}.R`} label={t('xray.right')} />
                </div>
              ) : <Box key={v} k={`${g.region}.${v}`} label={t(`xray.view.${v}`)} />))}
            </fieldset>
          ))}
        </div>
        <div className="xray-opts">{OPTIONS.map((o) => <Box key={o} k={`opt.${o}`} label={t(`xray.opt.${o}`)} />)}</div>
        <div className="xray-write">
          <div className="xw-label">{t('xray.otherViews')}</div>
          <textarea className="no-print" rows={1} value={other} onChange={(e) => setOther(e.target.value)} placeholder={t('xray.otherPh')} />
          <div className="print-only lines">{other}</div>
          <div className="xw-label">{t('xray.notes')}</div>
          <textarea className="no-print" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('xray.notesPh')} />
          <div className="print-only lines tall">{notes}</div>
        </div>
        <div className="doc-sign"><div className="line" />{t('certificate.signature')}</div>
        <div className="foot">{t('xray.foot')}</div>
      </div>
    </PrintPage>
  );
}
