import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApp, useQuery } from '../lib/app';
import {
  appointmentsBetween, getAppointment, getPet, getSettings, markAppointmentReminded, overlappingAppointments, saveAppointment,
  setAppointmentStatus, type ApptRow, type PetOption,
} from '../db/repo';
import { addDays, fromLocalInput, startOfDayIso, startOfWeek, toLocalInput, today } from '../lib/dates';
import { Dialog, Field, Icon, PetPicker, StatusBadge, WaButton, speciesEmoji } from '../components/ui';
import { PageHead } from '../components/Layout';
import { VISIT_TYPES, type VisitType } from '../db/types';

const OPEN_HOUR = 9;
const CLOSE_HOUR = 22;

export function Appointments() {
  const { t, fmt } = useApp();
  const [sp, setSp] = useSearchParams();
  const view = (sp.get('view') as 'day' | 'week') || 'day';
  const date = sp.get('date') || today();
  const openId = sp.get('open');
  const [editing, setEditing] = useState<{ id?: string; at?: string } | null>(openId ? { id: openId } : null);
  // A notification clicked while this screen is already open changes ?open= without remounting it.
  useEffect(() => {
    if (openId) setEditing({ id: openId });
  }, [openId]);
  const nav = (patch: Record<string, string | null>) => {
    const n = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) v == null ? n.delete(k) : n.set(k, v);
    setSp(n, { replace: true });
  };

  const from = view === 'day' ? date : startOfWeek(date);
  const days = view === 'day' ? 1 : 7;
  const rows = useQuery(() => appointmentsBetween(startOfDayIso(from), startOfDayIso(addDays(from, days))), [from, days]);
  const title = view === 'day' ? fmt.weekday(date) + ' ' + date.slice(0, 4) : `${fmt.date(from)} – ${fmt.date(addDays(from, 6))}`;

  return (
    <div className="page">
      <PageHead title={t('appointments.title')}>
        <button className="btn primary" onClick={() => setEditing({ at: `${date}T${String(Math.max(OPEN_HOUR, new Date().getHours() + 1)).padStart(2, '0')}:00` })}>
          <Icon name="plus" /> {t('appointments.new')}
        </button>
      </PageHead>
      <div className="cal-head">
        <div className="seg">
          <button className={view === 'day' ? 'on' : ''} onClick={() => nav({ view: 'day' })}>{t('appointments.day')}</button>
          <button className={view === 'week' ? 'on' : ''} onClick={() => nav({ view: 'week' })}>{t('appointments.week')}</button>
        </div>
        <button className="btn sm" onClick={() => nav({ date: addDays(date, -days) })} aria-label={t('common.prev')}>‹</button>
        <h2>{title}</h2>
        <button className="btn sm" onClick={() => nav({ date: addDays(date, days) })} aria-label={t('common.next')}>›</button>
        <button className="btn sm" onClick={() => nav({ date: today() })}>{t('common.today')}</button>
        <input type="date" value={date} onChange={(e) => e.target.value && nav({ date: e.target.value })} style={{ width: 'auto' }} />
      </div>

      {view === 'day' ? (
        <DayView date={date} rows={rows} onOpen={(id) => setEditing({ id })} onNew={(at) => setEditing({ at })} />
      ) : (
        <div className="week">
          {Array.from({ length: 7 }, (_, i) => addDays(from, i)).map((d) => {
            const list = rows.filter((a) => toLocalInput(a.scheduled_at).slice(0, 10) === d);
            return (
              <div key={d} className={`day ${d === today() ? 'today' : ''}`}>
                <h3 onClick={() => nav({ view: 'day', date: d })}>
                  <span>{fmt.weekday(d)}</span>
                  <span className="faint">{list.filter((a) => a.status === 'SCHEDULED').length || ''}</span>
                </h3>
                {list.map((a) => (
                  <button key={a.id} className={`chip ${a.status}`} onClick={() => setEditing({ id: a.id })}>
                    <b>{fmt.time(a.scheduled_at)} · {a.pet_name}</b>
                    {t(`visitType.${a.type}`)} · {a.owner_name}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {editing && <ApptDialog id={editing.id} at={editing.at} onClose={() => { setEditing(null); if (openId) nav({ open: null }); }} />}
    </div>
  );
}

function DayView({ date, rows, onOpen, onNew }: { date: string; rows: ApptRow[]; onOpen: (id: string) => void; onNew: (at: string) => void }) {
  const { t, fmt } = useApp();
  const hours = Array.from({ length: CLOSE_HOUR - OPEN_HOUR }, (_, i) => OPEN_HOUR + i);
  const byHour = (h: number) => rows.filter((a) => new Date(a.scheduled_at).getHours() === h);
  const outside = rows.filter((a) => {
    const h = new Date(a.scheduled_at).getHours();
    return h < OPEN_HOUR || h >= CLOSE_HOUR;
  });
  return (
    <div className="slots">
      {[...outside.length ? [-1] : [], ...hours].map((h) => {
        const list = h === -1 ? outside : byHour(h);
        return (
          <div key={h} className={`slot ${list.length ? '' : 'add'}`} onClick={() => !list.length && h >= 0 && onNew(`${date}T${String(h).padStart(2, '0')}:00`)}>
            <div className="h">{h >= 0 ? `${String(h).padStart(2, '0')}:00` : '•'}</div>
            <div className="c">
              {list.map((a) => (
                <div key={a.id} className={`appt ${a.status}`} onClick={(e) => { e.stopPropagation(); onOpen(a.id); }}>
                  <b className="num">{fmt.time(a.scheduled_at)}</b>
                  <b>{speciesEmoji[a.species]} {a.pet_name}</b>
                  <span className="muted small">{a.owner_name} · {t(`visitType.${a.type}`)} · {a.duration_min} {t('common.minutes')}{a.notes ? ` · ${a.notes}` : ''}</span>
                  <span className="spacer" />
                  <StatusBadge ns="apptStatus" value={a.status} />
                </div>
              ))}
              {list.length > 0 && h >= 0 && (
                <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={(e) => { e.stopPropagation(); onNew(`${date}T${String(h).padStart(2, '0')}:${String(Math.min(40, list.length * 20)).padStart(2, '0')}`); }}>+</button>
              )}
            </div>
          </div>
        );
      })}
      {rows.length === 0 && <p className="faint small" style={{ marginTop: 8 }}>{t('appointments.empty')}</p>}
    </div>
  );
}

function ApptDialog({ id, at, onClose }: { id?: string; at?: string; onClose: () => void }) {
  const { t, fmt, canVisit, toast, locale } = useApp();
  const navigate = useNavigate();
  const existing = useQuery(() => (id ? getAppointment(id) : undefined), [id]);
  const settings = useQuery(getSettings);
  const initialPet = useMemo<PetOption | null>(() => {
    if (!existing) return null;
    const p = getPet(existing.pet_id)!;
    return { id: p.id, name: p.name, species: p.species, owner_id: p.owner_id, owner_name: p.owner_name, owner_phone: p.owner_phone, status: p.status };
  }, [existing]);
  const [pet, setPet] = useState<PetOption | null>(initialPet);
  const [when, setWhen] = useState(existing ? toLocalInput(existing.scheduled_at) : at ?? '');
  const [duration, setDuration] = useState(existing?.duration_min ?? 20);
  const [type, setType] = useState<VisitType>(existing?.type ?? 'CHECKUP');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [overlap, setOverlap] = useState<ApptRow[] | null>(null);
  const clinic = locale === 'ar' ? settings.name_ar : settings.name_en;
  const locked = existing && existing.status !== 'SCHEDULED';

  const doSave = () => {
    saveAppointment({ pet_id: pet!.id, scheduled_at: fromLocalInput(when), duration_min: duration, type, notes }, id);
    toast(t('app.saved'));
    onClose();
  };
  const save = () => {
    if (!pet || !when) return;
    const o = overlappingAppointments(fromLocalInput(when), duration, id);
    if (o.length) setOverlap(o);
    else doSave();
  };
  const status = (s: 'DONE' | 'NO_SHOW' | 'CANCELLED' | 'SCHEDULED') => {
    if (!id) return;
    if (s === 'DONE' && canVisit) {
      onClose();
      navigate(`/pets/${existing!.pet_id}/visits/new?appointment=${id}`);
      return;
    }
    setAppointmentStatus(id, s);
    toast(t('app.saved'));
    onClose();
  };

  return (
    <Dialog
      title={id ? t('appointments.edit') : t('appointments.new')}
      onClose={onClose}
      footer={
        <>
          {existing?.status === 'SCHEDULED' && (
            <>
              <button className="btn danger" onClick={() => status('CANCELLED')}>{t('appointments.cancelAppt')}</button>
              <button className="btn" onClick={() => status('NO_SHOW')}>{t('appointments.noShow')}</button>
              <button className="btn" onClick={() => status('DONE')}>✓ {canVisit ? t('appointments.markDone') : t('appointments.markDoneOnly')}</button>
            </>
          )}
          {existing && existing.status !== 'SCHEDULED' && existing.status !== 'DONE' && (
            <button className="btn" onClick={() => status('SCHEDULED')}>{t('appointments.reopen')}</button>
          )}
          {existing?.visit_id && <button className="btn" onClick={() => { onClose(); navigate(`/pets/${existing.pet_id}`); }}>{t('appointments.openVisit')}</button>}
          <span className="spacer" />
          {!locked && <button className="btn primary" onClick={save} disabled={!pet || !when}>{t('common.save')}</button>}
        </>
      }
    >
      <div className="grid">
        {existing && (
          <div className="row">
            <StatusBadge ns="apptStatus" value={existing.status} />
            {existing.reminder_sent_at && <span className="faint small">✓ {t('common.reminded', { when: fmt.date(existing.reminder_sent_at) })}</span>}
            <span className="spacer" />
            {existing.status === 'SCHEDULED' && (
              <WaButton
                small
                phone={existing.whatsapp || existing.phone}
                text={t('wa.appointment', { owner: existing.owner_name, clinic, pet: existing.pet_name, date: fmt.date(existing.scheduled_at), time: fmt.time(existing.scheduled_at) })}
                onSent={() => markAppointmentReminded(existing.id)}
              />
            )}
          </div>
        )}
        <Field label={t('appointments.pet')} group>
          {locked ? <div className="chosen"><b>{pet?.name}</b> · {pet?.owner_name}</div> : <PetPicker value={pet} onChange={setPet} autoFocus={!id} />}
        </Field>
        <div className="grid g2">
          <Field label={t('appointments.when')}>
            <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} disabled={!!locked} required />
          </Field>
          <Field label={t('appointments.duration')}>
            <select value={duration} onChange={(e) => setDuration(Number(e.target.value))} disabled={!!locked}>
              {[10, 15, 20, 30, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </Field>
          <Field label={t('common.type')}>
            <select value={type} onChange={(e) => setType(e.target.value as VisitType)} disabled={!!locked}>
              {VISIT_TYPES.map((v) => <option key={v} value={v}>{t(`visitType.${v}`)}</option>)}
            </select>
          </Field>
          <Field label={t('common.notes')} optional>
            <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!!locked} />
          </Field>
        </div>
        {overlap && (
          <div className="note warn">
            <b>{t('appointments.overlapTitle')}</b>
            <div>{t('appointments.overlapBody', { list: overlap.map((o) => `${fmt.time(o.scheduled_at)} ${o.pet_name}`).join(', ') })}</div>
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn sm" onClick={() => setOverlap(null)}>{t('appointments.reschedule')}</button>
              <button className="btn sm primary" onClick={doSave}>{t('common.saveAnyway')}</button>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
