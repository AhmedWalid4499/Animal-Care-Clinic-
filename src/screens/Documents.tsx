// Printed documents for a pet (14 Nov 2026 change requests), each with the clinic logo and the customer ID:
//  - Lab report (A5): one test day's results with the reference ranges and high / low flags.
//  - Case report (A4): the owner, the patient, the whole case history (visits, diagnoses, treatment, prescriptions),
//    vaccinations, lab results, and the attached X-rays and photos printed in the report. Admins and Doctors.
//  - X-ray request (A5) and lab request (A4, the clinic's own sheet): ticked from a menu, plus the vet's notes; saved in the
//    pet's history (test_requests, schema v17) and shown on the owner page.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useApp, useQuery } from '../lib/app';
import {
  getAttachmentBytes, getOwner, getPet, getSettings, getTestRequest, lastWeight, petAttachments, petLabResults, petVaccinations, petVisits,
  petTestRequests, saveTestRequest, shownCode,
  type PetRow,
} from '../db/repo';
import type { Attachment, LabResult, RequestKind } from '../db/types';
import labTests from '../lib/lab-tests.json';
import { ageParts } from '../lib/dates';
import { platform } from '../lib/platform';
import { downloadAttachment, serverUrl } from '../sync/engine';
import { Icon, SheetAddress } from '../components/ui';
import { examParts } from '../components/Exam';
import { labFlag } from './Labs';

const range = (r: Pick<LabResult, 'ref_low' | 'ref_high'>) =>
  r.ref_low != null && r.ref_high != null ? `${r.ref_low}–${r.ref_high}` : r.ref_low != null ? `≥ ${r.ref_low}` : r.ref_high != null ? `≤ ${r.ref_high}` : '';

/** Back + Print above a sheet, and the sheet itself. */
function PrintPage({ children, actions, onPrint }: { children: ReactNode; actions?: ReactNode; onPrint?: () => void }) {
  const { t } = useApp();
  const nav = useNavigate();
  return (
    <div className="page">
      <div className="row no-print" style={{ marginBottom: 14 }}>
        <button className="btn" onClick={() => nav(-1)}>{t('app.back')}</button>
        <span className="spacer" />
        {actions}
        <button className="btn primary print-btn" onClick={() => { onPrint?.(); setTimeout(() => platform.print(), onPrint ? 150 : 0); }}><Icon name="print" /> {t('common.print')}</button>
      </div>
      <div className="sheet-wrap">{children}</div>
    </div>
  );
}

/** The clinic's address along the bottom of every document (14 Nov 2026: footer, not header). */
function SheetFoot() {
  const s = useQuery(getSettings);
  return <SheetAddress address={s.address} />;
}

/** Clinic name, phone and logo across the top of every document (the address is in the footer). */
function SheetHead() {
  const { locale } = useApp();
  const s = useQuery(getSettings);
  return (
    <div className="head">
      <div>
        <b style={{ fontSize: 15 }}>{locale === 'ar' ? s.name_ar : s.name_en}</b>
        <div style={{ fontSize: 10 }}>{s.phone && <span className="ltr">{s.phone}</span>}</div>
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
        <SheetFoot />
      </div>
    </PrintPage>
  );
}

// ---------------------------------------------------------------- case report (A4)
export const isImage = (a: Attachment) => /^image\/(png|jpe?g|gif|webp|bmp)$/i.test(a.mime_type ?? '') || /\.(png|jpe?g|gif|webp|bmp)$/i.test(a.file_name);

/** Object URLs for the pet's image attachments; files only on the clinic server are fetched first. */
export function useImages(files: Attachment[], enabled: boolean) {
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
  const requests = useQuery(() => petTestRequests(id).filter((r) => r.status !== 'CANCELLED'), [id]);
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
              {examParts(v, t).length > 0 && <p className="vitals exam-line"><span>{t('exam.title')}:</span> {examParts(v, t).map((x) => `${x.label} ${x.text}`).join(' · ')}</p>}
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

        {requests.filter((r) => inRange(r.requested_at)).length > 0 && (
          <>
            <h3>{t('petRecord.requests')}</h3>
            <table>
              <thead><tr><th>{t('common.date')}</th><th>{t('common.type')}</th><th>{t('docs.requested')}</th><th>{t('common.status')}</th></tr></thead>
              <tbody>
                {requests.filter((r) => inRange(r.requested_at)).map((r) => (
                  <tr key={r.id}>
                    <td>{fmt.date(r.requested_at)}</td>
                    <td>{t(r.kind === 'XRAY' ? 'xray.title' : 'labReq.title')}</td>
                    <td>{[...(r.items ?? '').split(',').filter(Boolean).map((k) => requestItemLabel(t, r.kind, k)), r.other].filter(Boolean).join(' · ')}</td>
                    <td>{t(`requests.status.${r.status}`)}</td>
                  </tr>
                ))}
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
        <SheetFoot />
      </div>
    </PrintPage>
  );
}

// ---------------------------------------------------------------- X-ray and lab requests (saved, schema v17)
/** Regions and views on the X-ray request; limbs have a left / right box each. Labels in src/i18n (xray.*). */
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
const XRAY_OPTIONS = ['sedation', 'urgent', 'repeat'];
/** The lab tests, from the clinic's own request sheet (src/lib/lab-tests.json; test names stay in English). */
export const LAB_GROUPS = labTests.groups;
const LAB_LABEL = new Map(LAB_GROUPS.flatMap((g) => g.tests.map((x) => [x.key, x.label] as const)));

/** A ticked item as text: "Chest (thorax): Right lateral", "Front leg: Elbow (L)", "Creatinine". */
export function requestItemLabel(t: (k: string) => string, kind: RequestKind, key: string): string {
  if (kind === 'LAB') return LAB_LABEL.get(key) ?? key;
  const [a, b, side] = key.split('.');
  if (a === 'opt') return t(`xray.opt.${b}`);
  return `${t(`xray.region.${a}`)}: ${t(`xray.view.${b}`)}${side ? ` (${t(side === 'L' ? 'xray.left' : 'xray.right')})` : ''}`;
}

/**
 * /pets/:id/xray-request, /pets/:id/lab-request (new) and /requests/:rid (saved): tick on screen and save to the pet's
 * history, or print the boxes and tick by pen. Printing saves first, so what the owner holds is what the clinic keeps.
 */
export function RequestForm({ kind: newKind }: { kind?: RequestKind }) {
  const { id: petParam = '', rid = '' } = useParams();
  const { t, fmt, user, toast, canVisit } = useApp();
  const nav = useNavigate();
  const saved = useQuery(() => (rid ? getTestRequest(rid) : undefined), [rid]);
  const kind: RequestKind = saved?.kind ?? newKind ?? 'XRAY';
  const petId = saved?.pet_id ?? petParam;
  const pet = useQuery(() => getPet(petId), [petId]);
  const weight = useQuery(() => lastWeight(petId), [petId]);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState('');
  const [other, setOther] = useState('');
  const [dirty, setDirty] = useState(false);
  const [loadedFor, setLoadedFor] = useState('');
  if (saved && loadedFor !== saved.id) {
    setLoadedFor(saved.id);
    setTicked(new Set((saved.items ?? '').split(',').filter(Boolean)));
    setNotes(saved.notes ?? '');
    setOther(saved.other ?? '');
    setDirty(false);
  }
  if (!pet || (rid && !saved)) return null;
  const editable = canVisit && saved?.status !== 'CANCELLED';
  const toggle = (k: string) => {
    if (!editable) return;
    setDirty(true);
    setTicked((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  };
  const order = kind === 'LAB'
    ? LAB_GROUPS.flatMap((g) => g.tests.map((x) => x.key))
    : [...XRAY_MENU.flatMap((g) => g.views.flatMap((v) => (g.sides ? [`${g.region}.${v}.L`, `${g.region}.${v}.R`] : [`${g.region}.${v}`]))), ...XRAY_OPTIONS.map((o) => `opt.${o}`)];
  const save = (): string => {
    const items = order.filter((k) => ticked.has(k));
    const sid = saveTestRequest({ pet_id: pet.id, kind, items, other, notes }, user?.id ?? null, saved?.id);
    setDirty(false);
    if (!saved) nav(`/requests/${sid}`, { replace: true });
    return sid;
  };
  const Box = ({ k, label }: { k: string; label: string }) => (
    <label className={`xbox ${ticked.has(k) ? 'on' : ''}`}>
      <input type="checkbox" checked={ticked.has(k)} disabled={!editable} onChange={() => toggle(k)} />
      <span className="sq" aria-hidden>{ticked.has(k) ? '✓' : ''}</span>
      <span>{label}</span>
    </label>
  );
  const prefix = kind === 'LAB' ? 'labReq' : 'xray';
  const when = saved?.requested_at ?? new Date().toISOString();
  const by = saved ? saved.requested_by_name : user?.name;
  return (
    <PrintPage
      onPrint={editable && (dirty || !saved) ? () => { save(); toast(t('app.saved')); } : undefined}
      actions={
        <>
          {saved && <span className={`badge ${saved.status === 'DONE' ? 'ok' : saved.status === 'CANCELLED' ? '' : 'info'}`}>{t(`requests.status.${saved.status}`)}</span>}
          {editable && <button className="btn" onClick={() => { setTicked(new Set()); setNotes(''); setOther(''); setDirty(true); }}>{t('xray.clear')}</button>}
          {editable && <button className="btn save-request" disabled={!!saved && !dirty} onClick={() => { save(); toast(t('app.saved')); }}>{t('common.save')}</button>}
        </>
      }
    >
      <div className={`sheet ${kind === 'LAB' ? 'a4 lab-request' : 'a5 xray-sheet'} doc`}>
        <SheetHead />
        <h2 className="doc-title">{t(`${prefix}.title`)}</h2>
        {kind === 'LAB' && by && <div className="doc-facts"><span>{t('labReq.referredBy')}: <b>{by}</b></span></div>}
        <Who pet={pet} weight={weight?.weight_kg ?? null} />
        <div className="doc-facts">
          <span>{t('common.date')}: <b>{fmt.date(when)}</b></span>
          {kind === 'LAB' && pet.date_of_birth && <span>{t('pets.dob')}: <b>{fmt.date(pet.date_of_birth)}</b></span>}
          {kind === 'XRAY' && by && <span>{t('xray.requestedBy')}: <b>{by}</b></span>}
        </div>
        {kind === 'XRAY' ? (
          <>
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
            <div className="xray-opts">{XRAY_OPTIONS.map((o) => <Box key={o} k={`opt.${o}`} label={t(`xray.opt.${o}`)} />)}</div>
          </>
        ) : (
          <div className="xray-grid lab-grid" dir="ltr">
            {LAB_GROUPS.map((g) => (
              <fieldset key={g.key}>
                <legend dir="auto">{t(`labReq.group.${g.key}`)}</legend>
                {g.tests.map((x) => <Box key={x.key} k={x.key} label={x.label} />)}
              </fieldset>
            ))}
          </div>
        )}
        <div className="xray-write">
          <div className="xw-label">{t(`${prefix}.otherViews`)}</div>
          <textarea className="no-print" rows={1} value={other} readOnly={!editable} onChange={(e) => { setOther(e.target.value); setDirty(true); }} placeholder={t(`${prefix}.otherPh`)} />
          <div className="print-only lines">{other}</div>
          <div className="xw-label">{t('xray.notes')}</div>
          <textarea className="no-print" rows={3} value={notes} readOnly={!editable} onChange={(e) => { setNotes(e.target.value); setDirty(true); }} placeholder={t('xray.notesPh')} />
          <div className="print-only lines tall">{notes}</div>
        </div>
        <div className="doc-sign"><div className="line" />{t('certificate.signature')}</div>
        <div className="foot">{t(`${prefix}.foot`)}</div>
        <SheetFoot />
      </div>
    </PrintPage>
  );
}
