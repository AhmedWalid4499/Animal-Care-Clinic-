// In-patients (7 Nov 2026 change request): the animals staying in the clinic, each with its timed treatment sheet.
// Anyone ticks a treatment when it is given (or skips it with a reason); overdue ones turn red, show on the dashboard
// and raise a notification on every computer (WardWatcher). The Admin or a Doctor admits, adds treatments, discharges.
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp, useQuery } from '../lib/app';
import {
  addCareTasks, admitPet, dischargePet, listVets, overdueTasks, petAdmission, tickTask, wardBoard, type PetOption, type WardRow, type WardTask,
} from '../db/repo';
import { isDesktop, platform } from '../lib/platform';
import { Badge, Dialog, Field, Icon, PetAlerts, PetPicker, speciesEmoji } from '../components/ui';
import { PageHead } from '../components/Layout';

const GRACE_MIN = 10;
const isOverdue = (t: WardTask) => t.status === 'DUE' && new Date(t.due_at).getTime() < Date.now() - GRACE_MIN * 60_000;
const localInput = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** Ticks every minute so "overdue" stays current while the screen is open. */
function useMinute() {
  const [, set] = useState(0);
  useEffect(() => {
    const id = setInterval(() => set((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);
}

export function Ward() {
  const { t, canVisit } = useApp();
  useMinute();
  const rows = useQuery(wardBoard);
  const [admit, setAdmit] = useState(false);
  const overdue = rows.reduce((s, r) => s + r.tasks.filter(isOverdue).length, 0);
  return (
    <div className="page ward">
      <PageHead title={t('ward.title')} sub={rows.length ? t('ward.sub', { n: rows.length }) : t('ward.empty')}>
        {canVisit && <button className="btn primary" onClick={() => setAdmit(true)}><Icon name="plus" /> {t('ward.admit')}</button>}
      </PageHead>
      {overdue > 0 && <p className="note warn" role="status">⏰ {t('ward.overdueN', { n: overdue })}</p>}
      <div className="ward-grid">
        {rows.map((r) => <WardCard key={r.id} row={r} />)}
      </div>
      {admit && <AdmitDialog onClose={() => setAdmit(false)} />}
    </div>
  );
}

function WardCard({ row }: { row: WardRow }) {
  const { t, fmt, canVisit, user, toast } = useApp();
  const nav = useNavigate();
  const [adding, setAdding] = useState(false);
  const [discharge, setDischarge] = useState(false);
  const [skip, setSkip] = useState<WardTask | null>(null);
  const [showDone, setShowDone] = useState(false);
  const open = row.tasks.filter((x) => x.status === 'DUE');
  const done = row.tasks.filter((x) => x.status !== 'DUE');
  return (
    <section className={`ward-card ${row.tasks.some(isOverdue) ? 'late' : ''}`}>
      <header>
        <div>
          <button type="button" className="linkbtn" onClick={() => nav(`/pets/${row.pet_id}`)}><b>{speciesEmoji[row.species]} {row.pet_name}</b></button>
          {row.cage && <Badge kind="info">{t('ward.cage')} {row.cage}</Badge>}
          <div className="muted small">{row.owner_name} · {t('ward.since', { when: fmt.dateTime(row.admitted_at) })}{row.vet_name ? ` · ${row.vet_name}` : ''}</div>
        </div>
      </header>
      <PetAlerts flags={row.alert_flags} note={row.alert_note} />
      {row.reason && <p className="small">{row.reason}</p>}
      <ul className="tasks">
        {open.length === 0 && <li className="muted small">{t('ward.noTasks')}</li>}
        {open.map((x) => (
          <li key={x.id} className={isOverdue(x) ? 'overdue' : ''}>
            <span className="time num">{fmt.time(x.due_at)}<span className="small muted"> {fmt.date(x.due_at) !== fmt.date(new Date().toISOString()) ? fmt.date(x.due_at) : ''}</span></span>
            <span className="what">{x.task}</span>
            <button type="button" className="btn sm primary" onClick={() => { tickTask(x.id, 'DONE', user?.id ?? null); toast(t('ward.given', { task: x.task })); }}>✓ {t('ward.done')}</button>
            <button type="button" className="btn sm ghost" onClick={() => setSkip(x)}>{t('ward.skip')}</button>
          </li>
        ))}
      </ul>
      {done.length > 0 && (
        <>
          <button type="button" className="linkbtn small" onClick={() => setShowDone(!showDone)}>{showDone ? t('ward.hideDone') : t('ward.showDone', { n: done.length })}</button>
          {showDone && (
            <ul className="tasks done">
              {done.slice().reverse().map((x) => (
                <li key={x.id}>
                  <span className="time num">{fmt.time(x.due_at)}</span>
                  <span className="what">{x.task}{x.note ? <span className="muted"> · {x.note}</span> : null}</span>
                  <span className="small muted">{x.status === 'DONE' ? '✓' : t('ward.skipped')} {x.done_at ? fmt.time(x.done_at) : ''} {x.done_by_name ?? ''}</span>
                  <button type="button" className="btn sm ghost" onClick={() => tickTask(x.id, 'DUE', null)} title={t('ward.undo')}>↺</button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {canVisit && (
        <div className="row" style={{ marginTop: 10 }}>
          <button type="button" className="btn sm" onClick={() => setAdding(true)}><Icon name="plus" /> {t('ward.addTask')}</button>
          <span className="spacer" />
          <button type="button" className="btn sm" onClick={() => setDischarge(true)}>{t('ward.discharge')}</button>
        </div>
      )}
      {adding && <TaskDialog admissionId={row.id} onClose={() => setAdding(false)} />}
      {skip && <SkipDialog task={skip} onClose={() => setSkip(null)} />}
      {discharge && <DischargeDialog row={row} onClose={() => setDischarge(false)} />}
    </section>
  );
}

function AdmitDialog({ onClose }: { onClose: () => void }) {
  const { t, toast, user } = useApp();
  const vets = useQuery(listVets);
  const [pet, setPet] = useState<PetOption | null>(null);
  const [f, setF] = useState({ cage: '', reason: '', vet_id: user?.role !== 'ASSISTANT' ? user?.id ?? '' : '' });
  const already = pet ? petAdmission(pet.id) : undefined;
  return (
    <Dialog
      title={t('ward.admit')}
      onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>{t('common.cancel')}</button>
        <button className="btn primary" disabled={!pet || !!already} onClick={() => { admitPet({ pet_id: pet!.id, ...f, vet_id: f.vet_id || null }, user?.id ?? null); toast(t('app.saved')); onClose(); }}>{t('ward.admit')}</button></>}
    >
      <Field label={t('ward.pet')}><PetPicker value={pet} onChange={setPet} autoFocus /></Field>
      {already && <p className="note warn">{t('ward.alreadyIn')}</p>}
      <div className="grid g2">
        <Field label={t('ward.cage')} optional><input type="text" value={f.cage} onChange={(e) => setF({ ...f, cage: e.target.value })} /></Field>
        <Field label={t('visits.vet')}>
          <select value={f.vet_id} onChange={(e) => setF({ ...f, vet_id: e.target.value })}>
            <option value="">—</option>
            {vets.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </Field>
        <Field label={t('ward.reason')} className="span2" optional><input type="text" value={f.reason} placeholder={t('ward.reasonPh')} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
      </div>
    </Dialog>
  );
}

const EVERY = [0, 4, 6, 8, 12, 24];

function TaskDialog({ admissionId, onClose }: { admissionId: string; onClose: () => void }) {
  const { t, toast } = useApp();
  const next = new Date(Math.ceil(Date.now() / 900_000) * 900_000); // next quarter hour
  const [f, setF] = useState({ task: '', first: localInput(next), every: 8, times: '3' });
  const times = f.every ? Math.max(1, Math.min(60, Number(f.times) || 1)) : 1;
  return (
    <Dialog
      title={t('ward.addTask')}
      onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>{t('common.cancel')}</button>
        <button className="btn primary" disabled={!f.task.trim() || !f.first} onClick={() => {
          const n = addCareTasks(admissionId, { task: f.task, first_at: new Date(f.first).toISOString(), every_hours: f.every || null, times });
          toast(t('ward.tasksAdded', { n }));
          onClose();
        }}>{t('common.save')}</button></>}
    >
      <Field label={t('ward.task')}><input type="text" value={f.task} placeholder={t('ward.taskPh')} onChange={(e) => setF({ ...f, task: e.target.value })} autoFocus /></Field>
      <div className="grid g3">
        <Field label={t('ward.firstAt')}><input type="datetime-local" value={f.first} onChange={(e) => setF({ ...f, first: e.target.value })} /></Field>
        <Field label={t('ward.every')}>
          <select value={f.every} onChange={(e) => setF({ ...f, every: Number(e.target.value) })}>
            {EVERY.map((h) => <option key={h} value={h}>{h ? t('ward.everyH', { n: h }) : t('ward.once')}</option>)}
          </select>
        </Field>
        {f.every > 0 && <Field label={t('ward.times')}><input type="number" min="1" max="60" value={f.times} onChange={(e) => setF({ ...f, times: e.target.value })} /></Field>}
      </div>
      {f.every > 0 && <p className="muted small">{t('ward.timesHint', { n: times, h: f.every })}</p>}
    </Dialog>
  );
}

function SkipDialog({ task, onClose }: { task: WardTask; onClose: () => void }) {
  const { t, user } = useApp();
  const [note, setNote] = useState('');
  return (
    <Dialog
      title={`${t('ward.skip')} · ${task.task}`}
      onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>{t('common.cancel')}</button>
        <button className="btn primary" disabled={!note.trim()} onClick={() => { tickTask(task.id, 'SKIPPED', user?.id ?? null, note.trim()); onClose(); }}>{t('ward.skip')}</button></>}
    >
      <Field label={t('ward.skipWhy')}><input type="text" value={note} placeholder={t('ward.skipPh')} onChange={(e) => setNote(e.target.value)} autoFocus /></Field>
    </Dialog>
  );
}

function DischargeDialog({ row, onClose }: { row: WardRow; onClose: () => void }) {
  const { t, toast } = useApp();
  const [note, setNote] = useState('');
  const left = row.tasks.filter((x) => x.status === 'DUE').length;
  return (
    <Dialog
      title={`${t('ward.discharge')} · ${row.pet_name}`}
      onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>{t('common.cancel')}</button>
        <button className="btn primary" onClick={() => { dischargePet(row.id, note); toast(t('app.saved')); onClose(); }}>{t('ward.discharge')}</button></>}
    >
      {left > 0 && <p className="note warn">{t('ward.leftOpen', { n: left })}</p>}
      <Field label={t('ward.dischargeNote')} optional><input type="text" value={note} onChange={(e) => setNote(e.target.value)} autoFocus /></Field>
    </Dialog>
  );
}

/** Dashboard: who is staying in, and how many treatments are late. Nothing when the ward is empty. */
export function WardSection() {
  const { t } = useApp();
  const nav = useNavigate();
  useMinute();
  const rows = useQuery(wardBoard);
  if (!rows.length) return null;
  const late = rows.reduce((s, r) => s + r.tasks.filter(isOverdue).length, 0);
  return (
    <div className={`note ${late ? 'warn' : ''} ward-note`} role="status">
      <b>🏥 {t('ward.inNow', { n: rows.length })}</b>{' '}
      {rows.map((r) => r.pet_name).join(' · ')}
      {late > 0 && <> · <b className="neg">⏰ {t('ward.overdueN', { n: late })}</b></>}{' '}
      <button type="button" className="linkbtn" onClick={() => nav('/ward')}>{t('ward.open')}</button>
    </div>
  );
}

/**
 * Runs everywhere the app is open: once a minute, a treatment that became overdue raises a toast and, when the
 * window is hidden or in the tray, a system notification (each task once per computer).
 */
export function WardWatcher() {
  const { t, toast } = useApp();
  const told = useRef(new Set<string>());
  useEffect(() => {
    const check = async () => {
      let list: ReturnType<typeof overdueTasks> = [];
      try { list = overdueTasks(GRACE_MIN); } catch { return; } // database not open yet
      const fresh = list.filter((x) => !told.current.has(x.id));
      if (!fresh.length) return;
      fresh.forEach((x) => told.current.add(x.id));
      const text = fresh.length === 1 ? t('ward.lateOne', { task: fresh[0].task, pet: fresh[0].pet_name }) : t('ward.lateMany', { n: fresh.length });
      toast(`⏰ ${text}`);
      if (isDesktop && typeof Notification !== 'undefined' && !(await platform.isForeground())) {
        const n = new Notification(t('ward.title'), { body: text, tag: 'ward-overdue' });
        n.onclick = () => { platform.showWindow(); location.hash = '#/ward'; };
      }
    };
    const id = setInterval(check, 60_000);
    const first = setTimeout(check, 5_000);
    return () => { clearInterval(id); clearTimeout(first); };
  }, [t, toast]);
  return null;
}
