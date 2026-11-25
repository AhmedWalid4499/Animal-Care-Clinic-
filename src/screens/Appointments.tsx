import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApp, useQuery } from '../lib/app';
import {
  appointmentsBetween, bookingRequests, deleteGuestAppointment, getAppointment, getPet, getSettings, guestMatch, markAppointmentReminded,
  overlappingAppointments, registerGuest, saveAppointment, setAppointmentStatus, type ApptFor, type ApptRow, type PetOption,
} from '../db/repo';
import { addDays, fromLocalInput, startOfDayIso, startOfWeek, toLocalInput, today } from '../lib/dates';
import { Badge, Confirm, Dialog, Field, Icon, PetPicker, StatusBadge, WaButton, speciesEmoji } from '../components/ui';
import { PageHead } from '../components/Layout';
import { SPECIES, VISIT_TYPES, type VisitType } from '../db/types';
import type { T as TFunction } from '../lib/app';

// Calendar hours (what the day view shows). Online booking offers the clinic's opening times instead: src/lib/clinic-info.json → hours.
const OPEN_HOUR = 9;
const CLOSE_HOUR = 22;

/** The pet's name, or for a guest who gave none, "Guest". */
export const apptPet = (a: Pick<ApptRow, 'pet_name' | 'is_guest'>, t: TFunction) => a.pet_name || (a.is_guest ? t('appointments.guest') : '');
/** The WhatsApp appointment text, for registered pets and guests alike. */
export const apptWaText = (key: string, a: ApptRow, clinic: string, t: TFunction, fmt: { date: (s: string) => string; time: (s: string) => string }) =>
  t(key, { owner: a.owner_name, clinic, pet: a.pet_name || t('appointments.yourPet'), date: fmt.date(a.scheduled_at), time: fmt.time(a.scheduled_at) });

export function Appointments() {
  const { t, fmt } = useApp();
  const go = useNavigate();
  const [sp, setSp] = useSearchParams();
  const view = (sp.get('view') as 'day' | 'week') || 'day';
  const date = sp.get('date') || today();
  const openId = sp.get('open');
  // ?new=1 (the dashboard's "Book appointment"): open a new booking straight away.
  const fresh = () => ({ at: `${date}T${String(Math.max(OPEN_HOUR, new Date().getHours() + 1)).padStart(2, '0')}:00` });
  const [editing, setEditing] = useState<{ id?: string; at?: string } | null>(openId ? { id: openId } : sp.get('new') ? fresh() : null);
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
        <button className="btn" onClick={() => go('/reminders')}>
          <Icon name="chat" /> {t('reminders.title')}
        </button>
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

      <RequestsStrip onOpen={(id) => setEditing({ id })} />

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
                    <b>{fmt.time(a.scheduled_at)} · {apptPet(a, t)}</b>
                    {t(`visitType.${a.type}`)} · {a.owner_name}{a.is_guest ? ` · ${t('appointments.guest')}` : ''}
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
                  <b>{speciesEmoji[a.species]} {apptPet(a, t)}</b>
                  {a.is_guest ? <Badge kind="warn">{t('appointments.guest')}</Badge> : null}
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

/** Online booking requests waiting for an answer, whatever day they are for. */
function RequestsStrip({ onOpen }: { onOpen: (id: string) => void }) {
  const { t, fmt } = useApp();
  const list = useQuery(bookingRequests);
  if (!list.length) return null;
  return (
    <section className="section requests">
      <header>
        <h2>{t('appointments.requests')}</h2>
        <span className="count">{list.length}</span>
      </header>
      <p className="faint small" style={{ margin: '0 0 8px' }}>{t('appointments.requestsHint')}</p>
      <ul className="list">
        {list.map((a) => (
          <li key={a.id} className="link" onClick={() => onOpen(a.id)}>
            <span className="time">{fmt.date(a.scheduled_at)}<br />{fmt.time(a.scheduled_at)}</span>
            <div className="main-col">
              <b>{speciesEmoji[a.species]} {apptPet(a, t)} · {a.owner_name}</b>
              <div className="sub"><span className="ltr">{a.phone}</span> · {t(`visitType.${a.type}`)}{a.notes ? ` · ${a.notes}` : ''}</div>
            </div>
            <StatusBadge ns="apptStatus" value={a.status} />
          </li>
        ))}
      </ul>
    </section>
  );
}

type Guest = { name: string; phone: string; pet_name: string; species: string };

function ApptDialog({ id, at, onClose }: { id?: string; at?: string; onClose: () => void }) {
  const { t, fmt, canVisit, toast, locale } = useApp();
  const navigate = useNavigate();
  const existing = useQuery(() => (id ? getAppointment(id) : undefined), [id]);
  const settings = useQuery(getSettings);
  const initialPet = useMemo<PetOption | null>(() => {
    if (!existing?.pet_id) return null;
    const p = getPet(existing.pet_id);
    return p ? { id: p.id, name: p.name, species: p.species, owner_id: p.owner_id, owner_name: p.owner_name, owner_phone: p.owner_phone, status: p.status } : null;
  }, [existing?.pet_id]);
  const [mode, setMode] = useState<'pet' | 'guest'>(existing?.is_guest ? 'guest' : 'pet');
  const [pet, setPet] = useState<PetOption | null>(initialPet);
  const [guest, setGuest] = useState<Guest>({
    name: existing?.guest_name ?? '', phone: existing?.guest_phone ?? '', pet_name: existing?.guest_pet_name ?? '', species: existing?.guest_species ?? '',
  });
  const [when, setWhen] = useState(existing ? toLocalInput(existing.scheduled_at) : at ?? '');
  const [duration, setDuration] = useState(existing?.duration_min ?? 20);
  const [type, setType] = useState<VisitType>(existing?.type ?? 'CHECKUP');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [overlap, setOverlap] = useState<{ list: ApptRow[]; then: () => void } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [declining, setDeclining] = useState(false);
  const clinic = locale === 'ar' ? settings.name_ar : settings.name_en;
  const requested = existing?.status === 'REQUESTED';
  const open = !existing || existing.status === 'SCHEDULED' || requested;
  const locked = !open;
  const isGuest = !!existing?.is_guest;
  const match = useMemo(() => (existing?.is_guest ? guestMatch(existing.id) : null), [existing?.id, existing?.is_guest]);
  const setG = (k: keyof Guest, v: string) => setGuest((g) => ({ ...g, [k]: v }));
  const who: ApptFor | null = mode === 'pet'
    ? pet ? { pet_id: pet.id } : null
    : guest.name.trim() && guest.phone.replace(/\D/g, '').length >= 6 ? { guest: { ...guest, species: guest.species || null } } : null;
  const ready = !!who && !!when;

  /** Save the form, then run `after` (accept a request, …). Warns first if the time is already taken. */
  const save = (after?: (savedId: string) => void) => {
    if (!who || !when) return;
    const go = () => {
      const savedId = saveAppointment({ for: who, scheduled_at: fromLocalInput(when), duration_min: duration, type, notes }, id);
      after?.(savedId);
      toast(t('app.saved'));
      onClose();
    };
    const o = overlappingAppointments(fromLocalInput(when), duration, id);
    if (o.length) setOverlap({ list: o, then: go });
    else go();
  };
  const status = (s: 'DONE' | 'NO_SHOW' | 'CANCELLED' | 'SCHEDULED') => {
    if (!id || !existing) return;
    let petId = existing.pet_id;
    // The guest came: they become a real owner and pet first (or join the owner on file with the same phone).
    if (s === 'DONE' && isGuest) petId = arrive(false);
    if (s === 'DONE' && canVisit) {
      onClose();
      navigate(`/pets/${petId}/visits/new?appointment=${id}`);
      return;
    }
    setAppointmentStatus(id, s);
    toast(t('app.saved'));
    onClose();
  };
  /** Register the guest; returns the pet id. */
  const arrive = (close = true) => {
    const r = registerGuest(id!);
    toast(r.newOwner ? t('appointments.registeredNew') : t('appointments.registeredExisting', { owner: match?.owner?.full_name ?? '' }));
    if (close) onClose();
    return r.petId;
  };
  const remove = () => {
    deleteGuestAppointment(id!);
    toast(t('appointments.deleted'));
    onClose();
  };

  return (
    <Dialog
      title={requested ? t('appointments.request') : id ? t('appointments.edit') : t('appointments.new')}
      onClose={onClose}
      footer={
        <>
          {requested && (
            <>
              <button className="btn danger" onClick={() => setDeclining(true)}>{t('appointments.decline')}</button>
              <span className="spacer" />
              <button className="btn primary" onClick={() => save((sid) => setAppointmentStatus(sid, 'SCHEDULED'))} disabled={!ready}>✓ {t('appointments.accept')}</button>
            </>
          )}
          {existing?.status === 'SCHEDULED' && (
            <>
              <button className="btn danger" onClick={() => status('CANCELLED')}>{t('appointments.cancelAppt')}</button>
              <button className="btn" onClick={() => status('NO_SHOW')}>{t('appointments.noShow')}</button>
              <button className="btn" onClick={() => status('DONE')}>✓ {canVisit ? t('appointments.markDone') : t('appointments.markDoneOnly')}</button>
            </>
          )}
          {existing && (existing.status === 'NO_SHOW' || existing.status === 'CANCELLED') && (
            <button className="btn" onClick={() => status('SCHEDULED')}>{t('appointments.reopen')}</button>
          )}
          {isGuest && !requested && existing?.status !== 'DONE' && (
            <button className="btn danger" onClick={() => setConfirmDelete(true)}><Icon name="x" /> {t('appointments.delete')}</button>
          )}
          {existing?.visit_id && existing.pet_id && <button className="btn" onClick={() => { onClose(); navigate(`/pets/${existing.pet_id}`); }}>{t('appointments.openVisit')}</button>}
          {!requested && <span className="spacer" />}
          {!requested && !locked && <button className="btn primary" onClick={() => save()} disabled={!ready}>{t('common.save')}</button>}
        </>
      }
    >
      <div className="grid">
        {existing && (
          <div className="row">
            <StatusBadge ns="apptStatus" value={existing.status} />
            {isGuest && <Badge kind="warn">{t('appointments.guest')}</Badge>}
            {existing.source === 'ONLINE' && <Badge>{t('appointments.online')}</Badge>}
            {existing.reminder_sent_at && <span className="faint small">✓ {t('common.reminded', { when: fmt.date(existing.reminder_sent_at) })}</span>}
            <span className="spacer" />
            {(existing.status === 'SCHEDULED' || requested) && (
              <WaButton
                small
                phone={existing.whatsapp || existing.phone}
                text={apptWaText(requested ? 'wa.bookingConfirmed' : 'wa.appointment', existing, clinic, t, fmt)}
                onSent={() => markAppointmentReminded(existing.id)}
              />
            )}
          </div>
        )}
        {requested && <div className="note">{t('appointments.requestNote')}</div>}
        {declining && existing && (
          <div className="note bad">
            <b>{t('appointments.declineTitle')}</b>
            <div>{t('appointments.declineBody')}</div>
            <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
              <WaButton small phone={existing.phone} text={apptWaText('wa.bookingDeclined', existing, clinic, t, fmt)} label={t('appointments.tellThem')} />
              <span className="spacer" />
              <button className="btn sm" onClick={() => setDeclining(false)}>{t('common.cancel')}</button>
              <button className="btn sm danger" onClick={remove}>{t('appointments.deleteRequest')}</button>
            </div>
          </div>
        )}
        {isGuest && existing?.status === 'SCHEDULED' && (
          <div className="note">
            <div>{match?.owner ? t('appointments.matchOwner', { owner: match.owner.full_name, pet: match.pet?.name ?? guest.pet_name ?? '' }) : t('appointments.guestArrive')}</div>
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn sm primary" onClick={() => arrive()}>{t('appointments.register')}</button>
            </div>
          </div>
        )}
        {!locked && !requested && (!existing || isGuest) && (
          <div className="seg" role="tablist">
            <button type="button" className={mode === 'pet' ? 'on' : ''} onClick={() => setMode('pet')}>{t('appointments.forPet')}</button>
            <button type="button" className={mode === 'guest' ? 'on' : ''} onClick={() => setMode('guest')}>{t('appointments.forGuest')}</button>
          </div>
        )}
        {mode === 'pet' ? (
          <Field label={t('appointments.pet')} group>
            {locked ? <div className="chosen"><b>{pet?.name}</b> · {pet?.owner_name}</div> : <PetPicker value={pet} onChange={setPet} autoFocus={!id} />}
          </Field>
        ) : (
          <>
            {!existing && <p className="faint small" style={{ margin: 0 }}>{t('appointments.guestHint')}</p>}
            <div className="grid g2">
              <Field label={t('appointments.guestName')}>
                <input type="text" value={guest.name} onChange={(e) => setG('name', e.target.value)} disabled={locked} autoFocus={!id} required autoComplete="off" />
              </Field>
              <Field label={t('appointments.guestPhone')}>
                <input type="tel" className="ltr" value={guest.phone} onChange={(e) => setG('phone', e.target.value)} disabled={locked} required inputMode="tel" />
              </Field>
              <Field label={t('appointments.guestPet')} optional>
                <input type="text" value={guest.pet_name} onChange={(e) => setG('pet_name', e.target.value)} disabled={locked} />
              </Field>
              <Field label={t('pets.species')} optional>
                <select value={guest.species} onChange={(e) => setG('species', e.target.value)} disabled={locked}>
                  <option value="">—</option>
                  {SPECIES.map((sp) => <option key={sp} value={sp}>{speciesEmoji[sp]} {t(`species.${sp}`)}</option>)}
                </select>
              </Field>
            </div>
          </>
        )}
        <div className="grid g2">
          <Field label={t('appointments.when')}>
            <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} disabled={locked} required />
          </Field>
          <Field label={t('appointments.duration')}>
            <select value={duration} onChange={(e) => setDuration(Number(e.target.value))} disabled={locked}>
              {[10, 15, 20, 30, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </Field>
          <Field label={t('common.type')}>
            <select value={type} onChange={(e) => setType(e.target.value as VisitType)} disabled={locked}>
              {VISIT_TYPES.map((v) => <option key={v} value={v}>{t(`visitType.${v}`)}</option>)}
            </select>
          </Field>
          <Field label={t('common.notes')} optional>
            <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} disabled={locked} />
          </Field>
        </div>
        {overlap && (
          <div className="note warn">
            <b>{t('appointments.overlapTitle')}</b>
            <div>{t('appointments.overlapBody', { list: overlap.list.map((o) => `${fmt.time(o.scheduled_at)} ${apptPet(o, t)}`).join(', ') })}</div>
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn sm" onClick={() => setOverlap(null)}>{t('appointments.reschedule')}</button>
              <button className="btn sm primary" onClick={overlap.then}>{t('common.saveAnyway')}</button>
            </div>
          </div>
        )}
      </div>
      {confirmDelete && (
        <Confirm
          title={t('appointments.delete')}
          body={t('appointments.deleteConfirm', { name: existing?.owner_name ?? '' })}
          confirmLabel={t('appointments.delete')}
          danger
          onConfirm={remove}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </Dialog>
  );
}
