import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useApp, useQuery } from '../lib/app';
import {
  addAttachment, getAttachmentBytes, getPet, getSettings, lastWeight, markVaccinationReminded, petAppointments, petAttachments,
  petVaccinations, petVisits, petWeights, visitInvoice, petConsents, shownCode } from '../db/repo';
import { ageParts, daysBetween, today } from '../lib/dates';
import { platform } from '../lib/platform';
import { get } from '../db/core';
import { downloadAttachment, serverUrl } from '../sync/engine';
import { Badge, Field, Icon, MenuButton, OwnerCode, PetAlerts, PetAvatar, StatusBadge, WaButton } from '../components/ui';
import { PageHead } from '../components/Layout';
import { LabsTab } from './Labs';
import { ATTACHMENT_KINDS, type AttachmentKind } from '../db/types';
import { RxArchive } from '../components/RxArchive';

type Tab = 'timeline' | 'vaccinations' | 'prescriptions' | 'weight' | 'labs' | 'files';

export function PetRecord() {
  const { id = '' } = useParams();
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get('tab') as Tab) || 'timeline';
  const { t, fmt, canVisit, canIntake, locale } = useApp();
  const nav = useNavigate();
  const pet = useQuery(() => getPet(id), [id]);
  const settings = useQuery(getSettings);
  const weight = useQuery(() => lastWeight(id), [id]);
  const upcoming = useQuery(() => petAppointments(id), [id]);
  if (!pet) return <div className="page">{t('common.notFound')}</div>;
  const age = pet.date_of_birth ? ageParts(pet.date_of_birth) : null;

  return (
    <div className="page">
      <PageHead title={pet.name} crumb={{ to: `/owners/${pet.owner_id}`, label: pet.owner_name }}>
        <WaButton
          phone={pet.owner_whatsapp || pet.owner_phone}
          text={t('wa.pet', { owner: pet.owner_name, clinic: locale === 'ar' ? settings.name_ar : settings.name_en, pet: pet.name })}
        />
        {/* Printouts and forms under one button (10 Nov 2026): the header had seven buttons in a row. */}
        <MenuButton
          icon="print"
          label={t('petRecord.printForms')}
          items={[
            { icon: 'print', label: t('petRecord.printSummary'), onClick: () => nav(`/pets/${id}/print`) },
            { icon: 'print', label: t('certificate.button'), onClick: () => nav(`/pets/${id}/certificate`) },
            ...(canVisit ? [
              { icon: 'file', label: t('docs.reportButton'), onClick: () => nav(`/pets/${id}/report`) },
              { icon: 'clipboard', label: t('xray.button'), onClick: () => nav(`/pets/${id}/xray-request`) },
            ] : []),
            ...(pet.status === 'ACTIVE' ? [{ icon: 'edit', label: t('consent.button'), onClick: () => nav(`/pets/${id}/consent/new`) }] : []),
          ]}
        />
        <button className="btn" onClick={() => nav(`/pets/${id}/edit`)}><Icon name="edit" /> {t('common.edit')}</button>
        {canIntake && pet.status === 'ACTIVE' && (
          <button className={`btn${canVisit ? '' : ' primary'}`} onClick={() => nav(`/pets/${id}/intake`)}><Icon name="clipboard" /> {t('nav.intake')}</button>
        )}
        {canVisit && pet.status === 'ACTIVE' && (
          <button className="btn primary" onClick={() => nav(`/pets/${id}/visits/new`)}><Icon name="plus" /> {t('nav.newVisit')}</button>
        )}
      </PageHead>

      <PetAlerts flags={pet.alert_flags} note={pet.alert_note} className="big" />
      <div className={`record ${pet.status !== 'ACTIVE' ? 'greyed' : ''}`} style={{ gridTemplateColumns: 'auto 1fr' }}>
        <PetAvatar photo={pet.photo_url} species={pet.species} />
        <div>
          <div className="row">
            <b style={{ fontSize: 18 }}>{t(`species.${pet.species}`)}{pet.breed ? ` · ${pet.breed}` : ''}</b>
            <StatusBadge ns="petStatus" value={pet.status} />
            {pet.status === 'DECEASED' && pet.deceased_at && <span className="muted small">{fmt.date(pet.deceased_at)}</span>}
          </div>
          <div className="facts">
            <div><span>{t('pets.sex')}</span><b>{t(`sex.${pet.sex}`)}{pet.is_neutered ? ` · ${t('pets.neutered')}` : ''}</b></div>
            <div>
              <span>{t('pets.age')}</span>
              <b>{age ? `${t('pets.ageValue', { y: age.years, m: age.months })}${pet.dob_is_estimate ? ` (${t('pets.dobEstimate')})` : ''}` : '—'}</b>
            </div>
            <div><span>{t('pets.dob')}</span><b>{fmt.date(pet.date_of_birth)}</b></div>
            <div><span>{t('pets.color')}</span><b>{pet.color || '—'}</b></div>
            <div><span>{t('pets.microchip')}</span><b className="ltr num">{pet.microchip_no || '—'}</b></div>
            <div><span>{t('pets.lastWeight')}</span><b className="num">{weight ? `${fmt.num(weight.weight_kg, 2)} ${t('common.kg')}` : '—'}</b></div>
            <div><span>{t('pets.owner')}</span><b><a href={`#/owners/${pet.owner_id}`}>{pet.owner_name}</a> <OwnerCode code={pet.owner_code} ownerId={pet.owner_id} /> <span className="ltr muted small">{pet.owner_phone}</span></b></div>
          </div>
          {pet.notes && <p className="note" style={{ marginTop: 12, marginBottom: 0 }}>{pet.notes}</p>}
          {upcoming.length > 0 && (
            <p className="small muted" style={{ marginBottom: 0 }}>
              {t('petRecord.upcoming')}: {upcoming.map((a) => `${fmt.dateTime(a.scheduled_at)} (${t(`visitType.${a.type}`)})`).join(' · ')}
            </p>
          )}
        </div>
      </div>

      <div className="tabs" role="tablist">
        {(['timeline', 'vaccinations', 'prescriptions', 'weight', 'labs', 'files'] as Tab[]).map((k) => (
          <button key={k} role="tab" className={tab === k ? 'on' : ''} onClick={() => setSp({ tab: k }, { replace: true })}>
            {t(`petRecord.${k}`)}
          </button>
        ))}
      </div>
      <div key={tab} className="tab-enter">
        {tab === 'timeline' && <Timeline petId={id} />}
        {tab === 'vaccinations' && <Vaccinations petId={id} />}
        {tab === 'prescriptions' && <RxArchive petId={id} />}
        {tab === 'weight' && <WeightChart petId={id} />}
        {tab === 'labs' && <LabsTab petId={id} />}
        {tab === 'files' && <Files petId={id} />}
      </div>
    </div>
  );
}

function Timeline({ petId }: { petId: string }) {
  const { t, fmt, canVisit, canIntake } = useApp();
  const nav = useNavigate();
  const visits = useQuery(() => petVisits(petId), [petId]);
  if (!visits.length) return <p className="empty">{t('petRecord.noVisits')}</p>;
  return (
    <ul className="tl">
      {visits.map((v) => {
        const invId = v.invoice_id ?? visitInvoice(v.id);
        return (
          <li key={v.id}>
            <div className="when">
              <b>{fmt.date(v.visited_at)}</b>
              <span>{fmt.time(v.visited_at)}{v.vet_name ? ` · ${v.vet_name}` : ''}</span>
            </div>
            <div className="body">
              <div className="row">
                <Badge kind={v.type === 'EMERGENCY' ? 'bad' : v.type === 'SURGERY' ? 'warn' : 'info'}>{t(`visitType.${v.type}`)}</Badge>
                {v.stage !== 'DONE' && <Badge kind="warn">{t(`intake.stage.${v.stage}`)}</Badge>}
                {v.diagnosis && <b>{v.diagnosis}</b>}
                <span className="spacer" />
                {invId ? (
                  <button className="btn ghost sm" onClick={() => nav(`/invoices/${invId}`)}><Icon name="receipt" /> {t('petRecord.invoiced')}</button>
                ) : (
                  <button className="btn ghost sm" onClick={() => nav(`/invoices/new?visit=${v.id}`)}><Icon name="receipt" /> {t('petRecord.createInvoice')}</button>
                )}
                {v.prescriptions.length > 0 && <button className="btn ghost sm" onClick={() => nav(`/visits/${v.id}/prescription`)}><Icon name="print" /> {t('rxSheet.button')}</button>}
                {(canVisit || (canIntake && v.stage === 'WAITING')) && <button className="btn ghost sm" onClick={() => nav(v.stage === 'WAITING' ? `/visits/${v.id}/intake` : `/visits/${v.id}/edit`)}><Icon name="edit" /> {t('common.edit')}</button>}
              </div>
              {v.complaint && <p><span className="muted">{t('visits.complaint')}:</span> {v.complaint}</p>}
              {v.intake_at && (v.history || v.intake_notes) && (
                <p className="small">
                  <span className="muted">🩺 {t('intake.section')} ({v.intake_by_name ?? '—'}{v.urgency && v.urgency !== 'ROUTINE' ? ` · ${t(`urgency.${v.urgency}`)}` : ''}):</span>{' '}
                  {[v.history, v.intake_notes].filter(Boolean).join(' · ')}
                </p>
              )}
              <div className="kv">
                {v.weight_kg != null && <span>⚖ {fmt.num(v.weight_kg, 2)} {t('common.kg')}</span>}
                {v.temperature_c != null && <span>🌡 {fmt.num(v.temperature_c, 1)} {t('common.celsius')}</span>}
                {v.heart_rate != null && <span>♥ {v.heart_rate}/min</span>}
                {v.resp_rate != null && <span>🫁 {v.resp_rate}/min</span>}
                {v.follow_up_at && <span>↻ {t('visits.followUp')}: {fmt.dateTime(v.follow_up_at)}</span>}
              </div>
              {v.treatment_notes && <p className="small">{v.treatment_notes}</p>}
              {(v.prescriptions.length > 0 || v.vaccinations.length > 0) && (
                <ul className="rx">
                  {v.prescriptions.map((r) => (
                    <li key={r.id}>💊 <b>{r.drug}</b> {[r.dose, r.frequency, r.duration_days ? `${r.duration_days} ${t('common.days')}` : null, r.instructions].filter(Boolean).join(' · ')}</li>
                  ))}
                  {v.vaccinations.map((x) => (
                    <li key={x.id}>💉 <b>{x.vaccine}</b> · {t('petRecord.nextDue')} {fmt.date(x.next_due_at)}{x.batch_no ? ` · ${t('petRecord.batch')} ${x.batch_no}` : ''}</li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function Vaccinations({ petId }: { petId: string }) {
  const { t, fmt, locale } = useApp();
  const rows = useQuery(() => petVaccinations(petId), [petId]);
  const pet = useQuery(() => getPet(petId), [petId])!;
  const settings = useQuery(getSettings);
  const clinic = locale === 'ar' ? settings.name_ar : settings.name_en;
  const seen = new Set<string>();
  const d = today();
  if (!rows.length) return <p className="empty">{t('petRecord.noVaccinations')}</p>;
  return (
    <div className="tablewrap">
      <table className="t">
        <thead>
          <tr>
            <th>{t('visits.vaccine')}</th>
            <th>{t('petRecord.administered')}</th>
            <th>{t('petRecord.nextDue')}</th>
            <th className="hide-sm">{t('petRecord.batch')}</th>
            <th className="r" />
          </tr>
        </thead>
        <tbody>
          {rows.map((x) => {
            const latest = !seen.has(x.vaccine_type_id);
            seen.add(x.vaccine_type_id);
            const n = x.next_due_at ? daysBetween(d, x.next_due_at) : null;
            return (
              <tr key={x.id} className={latest ? '' : 'greyed'}>
                <td><b>{x.vaccine}</b> {latest && <Badge>{t('petRecord.latest')}</Badge>}</td>
                <td>{fmt.date(x.administered_at)}</td>
                <td>
                  {fmt.date(x.next_due_at)}{' '}
                  {latest && n != null && n <= 7 && <Badge kind={n < 0 ? 'bad' : 'warn'}>{n < 0 ? t('dashboard.overdue', { n: -n }) : n === 0 ? t('dashboard.dueToday') : t('dashboard.dueIn', { n })}</Badge>}
                </td>
                <td className="hide-sm ltr">{x.batch_no || '—'}</td>
                <td className="r">
                  {latest && x.next_due_at && pet.status === 'ACTIVE' && (
                    <WaButton
                      small
                      label={t('dashboard.remind')}
                      phone={pet.owner_whatsapp || pet.owner_phone}
                      text={t('wa.vaccination', { owner: pet.owner_name, clinic, pet: pet.name, vaccine: x.vaccine, date: fmt.date(x.next_due_at) })}
                      onSent={() => markVaccinationReminded(x.id)}
                    />
                  )}
                  {x.reminder_sent_at && <div className="faint small">✓ {fmt.date(x.reminder_sent_at)}</div>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function WeightChart({ petId }: { petId: string }) {
  const { t, fmt, locale } = useApp();
  const pts = useQuery(() => petWeights(petId), [petId]);
  if (!pts.length) return <p className="empty">{t('petRecord.weightEmpty')}</p>;
  const data = pts.map((p) => ({ x: new Date(p.visited_at).getTime(), kg: p.weight_kg }));
  return (
    <>
      <div className="chart" dir="ltr">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 12, right: 20, bottom: 8, left: 0 }}>
            <CartesianGrid stroke="var(--rule)" vertical={false} />
            <XAxis dataKey="x" type="number" scale="time" domain={['dataMin', 'dataMax']} reversed={locale === 'ar'} tickFormatter={(v) => fmt.date(new Date(v).toISOString())} stroke="var(--ink-3)" fontSize={12} />
            <YAxis orientation={locale === 'ar' ? 'right' : 'left'} stroke="var(--ink-3)" fontSize={12} width={44} domain={['auto', 'auto']} unit="" />
            <Tooltip
              labelFormatter={(v) => fmt.date(new Date(Number(v)).toISOString())}
              formatter={(v) => [`${fmt.num(Number(v), 2)} ${t('common.kg')}`, '']}
              contentStyle={{ background: 'var(--bg)', border: '1px solid var(--rule-2)', borderRadius: 4 }}
            />
            <Line type="monotone" dataKey="kg" stroke="var(--accent)" strokeWidth={2} dot={{ r: 4, fill: 'var(--accent)' }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <table className="t" style={{ marginTop: 10 }}>
        <tbody>
          {[...pts].reverse().map((p) => (
            <tr key={p.visited_at}><td>{fmt.date(p.visited_at)}</td><td className="r num">{fmt.num(p.weight_kg, 2)} {t('common.kg')}</td></tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function Files({ petId }: { petId: string }) {
  const { t, fmt, user, toast } = useApp();
  const files = useQuery(() => petAttachments(petId), [petId]);
  const consents = useQuery(() => petConsents(petId), [petId]);
  const nav = useNavigate();
  const [kind, setKind] = useState<AttachmentKind>('LAB');
  const [fetching, setFetching] = useState<string | null>(null);
  const upload = async () => {
    const f = await platform.pickFile([{ name: 'Files', extensions: ['pdf', 'jpg', 'jpeg', 'png', 'heic', 'doc', 'docx', 'xls', 'xlsx', 'txt', 'dcm'] }, { name: 'All', extensions: ['*'] }]);
    if (!f) return;
    try {
      addAttachment(petId, { name: f.name, bytes: f.bytes, mime: mimeOf(f.name) }, kind, null, user?.id ?? null);
      toast(t('app.saved'));
    } catch {
      toast(t('petRecord.fileTooLarge'));
    }
  };
  return (
    <div>
      {consents.length > 0 && (
        <section className="section consents">
          <header><h2>✍ {t('consent.signedForms')}</h2><span className="count">{consents.length}</span></header>
          <ul className="list">
            {consents.map((c) => (
              <li key={c.id} className="link" onClick={() => nav(`/consents/${c.id}`)}>
                <div className="main-col"><b>{c.procedure}</b><div className="sub">{fmt.dateTime(c.signed_at)} · {c.signer_name}</div></div>
                <Icon name="print" />
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="row" style={{ margin: '14px 0' }}>
        <Field label={t('petRecord.kind')}>
          <select value={kind} onChange={(e) => setKind(e.target.value as AttachmentKind)}>
            {ATTACHMENT_KINDS.map((k) => <option key={k} value={k}>{t(`attachmentKind.${k}`)}</option>)}
          </select>
        </Field>
        <button className="btn primary" style={{ alignSelf: 'flex-end' }} onClick={upload}><Icon name="file" /> {t('petRecord.upload')}</button>
      </div>
      <ul className="list">
        {files.length === 0 && <li className="empty">{t('petRecord.noFiles')}</li>}
        {files.map((a) => {
          // Added on another device: the bytes come from the clinic server the first time it is opened here.
          const here = !!get('SELECT 1 FROM attachment_blobs WHERE attachment_id = ?', [a.id]);
          const open = async () => {
            let b = getAttachmentBytes(a.id);
            if (!b && serverUrl()) {
              setFetching(a.id);
              b = await downloadAttachment(a.id).catch(() => null) ?? undefined;
              setFetching(null);
            }
            if (b) platform.openFile(a.file_name, b, a.mime_type ?? 'application/octet-stream');
            else toast(t('petRecord.fileNotHere'));
          };
          return (
            <li key={a.id} className="link" onClick={() => void open()}>
              <Icon name="file" />
              <div className="main-col">
                <b>{a.file_name}</b>
                <div className="sub">
                  {t(`attachmentKind.${a.kind}`)} · {fmt.date(a.created_at)} · {Math.max(1, Math.round((a.size_bytes ?? 0) / 1024))} KB
                  {!here && <> · ☁ {t('petRecord.onServer')}</>}
                </div>
              </div>
              <span className="btn sm">{fetching === a.id ? '…' : t('common.open')}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function mimeOf(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return ({ pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', heic: 'image/heic', txt: 'text/plain', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', dcm: 'application/dicom' } as Record<string, string>)[ext] ?? 'application/octet-stream';
}

/** Print / PDF summary of the pet record (A5, print CSS). */
export function PetSummaryPrint() {
  const { id = '' } = useParams();
  const { t, fmt, locale } = useApp();
  const pet = useQuery(() => getPet(id), [id]);
  const visits = useQuery(() => petVisits(id), [id]);
  const vacc = useQuery(() => petVaccinations(id), [id]);
  const settings = useQuery(getSettings);
  const nav = useNavigate();
  if (!pet) return null;
  const age = pet.date_of_birth ? ageParts(pet.date_of_birth) : null;
  const seen = new Set<string>();
  const latestVacc = vacc.filter((x) => (seen.has(x.vaccine_type_id) ? false : (seen.add(x.vaccine_type_id), true)));
  return (
    <div className="page">
      <div className="row no-print" style={{ marginBottom: 14 }}>
        <button className="btn" onClick={() => nav(-1)}>{t('app.back')}</button>
        <button className="btn primary" onClick={() => platform.print()}><Icon name="print" /> {t('common.print')}</button>
      </div>
      <div className="sheet-wrap">
        <div className="sheet a5">
          <div className="head">
            <div>
              <b style={{ fontSize: 15 }}>{locale === 'ar' ? settings.name_ar : settings.name_en}</b>
              <div style={{ fontSize: 10 }}>{settings.address} {settings.phone && <span className="ltr">· {settings.phone}</span>}</div>
            </div>
            {settings.logo_url && <img src={settings.logo_url} alt="" />}
          </div>
          <h2 style={{ marginBottom: 6 }}>{t('petRecord.summaryTitle')} — {pet.name}</h2>
          <table>
            <tbody>
              <tr><td>{t('pets.species')}</td><td>{t(`species.${pet.species}`)}{pet.breed ? ` · ${pet.breed}` : ''}</td><td>{t('pets.sex')}</td><td>{t(`sex.${pet.sex}`)}{pet.is_neutered ? ` · ${t('pets.neutered')}` : ''}</td></tr>
              <tr><td>{t('pets.dob')}</td><td>{fmt.date(pet.date_of_birth)}{age ? ` (${t('pets.ageValue', { y: age.years, m: age.months })})` : ''}</td><td>{t('pets.microchip')}</td><td className="ltr">{pet.microchip_no || '—'}</td></tr>
              <tr><td>{t('pets.owner')}</td><td>{pet.owner_name}{shownCode(pet.owner_code) ? ` · ${pet.owner_code}` : ''}</td><td>{t('owners.phone')}</td><td className="ltr">{pet.owner_phone}</td></tr>
            </tbody>
          </table>
          <h3 style={{ margin: '12px 0 4px' }}>{t('petRecord.vaccinations')}</h3>
          <table>
            <thead><tr><th>{t('visits.vaccine')}</th><th>{t('petRecord.administered')}</th><th>{t('petRecord.nextDue')}</th></tr></thead>
            <tbody>{latestVacc.length ? latestVacc.map((x) => <tr key={x.id}><td>{x.vaccine}</td><td>{fmt.date(x.administered_at)}</td><td>{fmt.date(x.next_due_at)}</td></tr>) : <tr><td colSpan={3}>—</td></tr>}</tbody>
          </table>
          <h3 style={{ margin: '12px 0 4px' }}>{t('petRecord.timeline')}</h3>
          <table>
            <thead><tr><th>{t('common.date')}</th><th>{t('common.type')}</th><th>{t('visits.diagnosis')}</th><th className="r">{t('common.kg')}</th></tr></thead>
            <tbody>
              {visits.slice(0, 12).map((v) => (
                <tr key={v.id}>
                  <td>{fmt.date(v.visited_at)}</td>
                  <td>{t(`visitType.${v.type}`)}</td>
                  <td>{v.diagnosis || v.complaint || '—'}{v.prescriptions.length ? ` · 💊 ${v.prescriptions.map((r) => r.drug).join(', ')}` : ''}</td>
                  <td className="r">{v.weight_kg != null ? fmt.num(v.weight_kg, 2) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="foot">{fmt.date(new Date().toISOString())}</div>
        </div>
      </div>
    </div>
  );
}
