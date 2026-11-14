// Dashboard (redone 7 Nov 2026 at Ahmed's request: friendlier). A greeting, one big search, large buttons for what
// the front desk and the vets do most, today at a glance (each card opens its screen), what needs attention, then the
// vet's queue, today's schedule and the vaccinations due — each with its WhatsApp button.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp, useQuery } from '../lib/app';
import {
  appointmentsBetween, dueVaccinations, getSettings, markAppointmentReminded, markVaccinationReminded, openBalance, quickSearch, waitingQueue, wardBoard,
} from '../db/repo';
import { addDays, daysBetween, startOfDayIso, today } from '../lib/dates';
import { Badge, Icon, StatusBadge, WaButton, speciesEmoji } from '../components/ui';
import { QueueSection } from './IntakeForm';
import { remindersLeft } from './Reminders';
import { LowStockSection } from './Stock';

const greeting = (h = new Date().getHours()) => (h < 12 ? 'login.morning' : h < 17 ? 'login.afternoon' : 'login.evening');
const SHOW_DUE = 6;

function Quick({ icon, label, onClick, primary, badge }: { icon: string; label: string; onClick: () => void; primary?: boolean; badge?: number }) {
  return (
    <button type="button" className={`quick-btn${primary ? ' primary' : ''}`} onClick={onClick}>
      <span className="ic"><Icon name={icon} /></span>
      <span className="lbl">{label}</span>
      {badge ? <span className="pill">{badge}</span> : null}
    </button>
  );
}

function Glance({ icon, label, value, sub, tone, onClick }: { icon: string; label: string; value: string | number; sub?: string; tone?: 'warn' | 'bad' | 'ok'; onClick: () => void }) {
  return (
    <button type="button" className={`glance-card ${tone ?? ''}`} onClick={onClick}>
      <span className="g-top"><span aria-hidden>{icon}</span> {label}</span>
      <b className="num">{value}</b>
      {sub ? <span className="g-sub">{sub}</span> : null}
    </button>
  );
}

export function Dashboard() {
  const { t, fmt, canVisit, canIntake, locale, user } = useApp();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const hits = useQuery(() => quickSearch(q), [q]);
  const d = today();
  const appts = useQuery(() => appointmentsBetween(startOfDayIso(d), startOfDayIso(addDays(d, 1))), [d]);
  const due = useQuery(() => dueVaccinations(7));
  const waiting = useQuery(waitingQueue);
  const ward = useQuery(wardBoard);
  const money = useQuery(openBalance);
  const toRemind = useQuery(remindersLeft);
  const settings = useQuery(getSettings);
  const clinic = locale === 'ar' ? settings.name_ar : settings.name_en;
  const now = Date.now();
  const upcoming = appts.filter((a) => a.status === 'SCHEDULED' && new Date(a.scheduled_at).getTime() >= now - 15 * 60_000);
  const next = upcoming[0];
  const late = ward.reduce((s, r) => s + r.tasks.filter((x) => x.status === 'DUE' && new Date(x.due_at).getTime() < now - 10 * 60_000).length, 0);
  const firstName = (user?.name ?? '').replace(/^(dr\.?|د\.?)\s+/i, '').split(/\s+/)[0];
  const overdueVacc = due.filter((v) => daysBetween(d, v.next_due_at) < 0).length;

  return (
    <div className="page dash">
      <header className="dash-hello">
        <div>
          <p className="dash-date">{new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${d}T12:00:00`))}</p>
          <h1>{t(greeting())}{firstName ? `${locale === 'ar' ? '، ' : ', '}${firstName}` : ''} 👋</h1>
          <p className="muted">{t('dashboard.hello', { clinic })}</p>
        </div>
      </header>

      <div className="searchbox big">
        <Icon name="search" />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('dashboard.search')} autoFocus aria-label={t('dashboard.search')} />
      </div>
      {q.trim().length > 0 && (
        <ul className="list search-results">
          {q.trim().length < 2 && <li className="faint small">{t('dashboard.searchHint')}</li>}
          {q.trim().length >= 2 && hits.length === 0 && <li className="faint">{t('common.noResults')}</li>}
          {hits.map((h) => (
            <li key={`${h.kind}${h.id}`} className={`link ${h.status !== 'ACTIVE' ? 'greyed' : ''}`} onClick={() => nav(h.kind === 'pet' ? `/pets/${h.id}` : `/owners/${h.id}`)}>
              <span aria-hidden style={{ width: 24, textAlign: 'center' }}>{h.kind === 'pet' ? speciesEmoji[h.species!] : '👤'}</span>
              <div className="main-col">
                <b>{h.title}</b>
                <div className="sub">{h.subtitle}</div>
              </div>
              <Badge>{h.kind === 'pet' ? t('dashboard.pet') : t('dashboard.owner')}</Badge>
            </li>
          ))}
        </ul>
      )}

      <nav className="quick" aria-label={t('dashboard.quick')}>
        {canVisit && <Quick primary icon="plus" label={t('nav.newVisit')} onClick={() => nav('/visits/new')} />}
        {canIntake && <Quick primary={!canVisit} icon="clipboard" label={t('nav.intake')} onClick={() => nav('/intake/new')} />}
        <Quick icon="calendar" label={t('dashboard.book')} onClick={() => nav(`/appointments?view=day&date=${d}&new=1`)} />
        <Quick icon="users" label={t('dashboard.newOwner')} onClick={() => nav('/owners/new')} />
        <Quick icon="chat" label={t('reminders.title')} badge={toRemind} onClick={() => nav('/reminders')} />
        <Quick icon="receipt" label={t('invoices.new')} onClick={() => nav('/invoices/new')} />
      </nav>

      <h2 className="dash-h">{t('dashboard.glance')}</h2>
      <div className="glance">
        <Glance icon="📅" label={t('dashboard.todayAppts')} value={appts.length}
          sub={next ? t('dashboard.nextAt', { time: fmt.time(next.scheduled_at), pet: next.pet_name }) : appts.length ? t('dashboard.noneLeft') : t('dashboard.noAppts')}
          onClick={() => nav(`/appointments?view=day&date=${d}`)} />
        <Glance icon="🩺" label={t('queue.title')} value={waiting.length} tone={waiting.some((w) => w.stage === 'WAITING') ? 'warn' : undefined}
          sub={waiting.length ? t('dashboard.waitingSub', { n: waiting.filter((w) => w.stage === 'WAITING').length }) : t('queue.empty')}
          onClick={() => document.querySelector('.section.queue')?.scrollIntoView({ behavior: 'smooth' })} />
        <Glance icon="🏥" label={t('ward.title')} value={ward.length} tone={late ? 'bad' : undefined}
          sub={late ? t('ward.overdueN', { n: late }) : ward.length ? t('dashboard.allOnTime') : t('ward.empty')}
          onClick={() => nav('/ward')} />
        <Glance icon="💉" label={t('dashboard.dueShort')} value={due.length} tone={overdueVacc ? 'warn' : undefined}
          sub={overdueVacc ? t('dashboard.overdueN', { n: overdueVacc }) : t('dashboard.next7')}
          onClick={() => nav('/reminders')} />
        <Glance icon="🧾" label={t('dashboard.openInvoices')} value={money.n}
          sub={money.n ? t('dashboard.stillDue', { amount: fmt.money(money.due) }) : t('dashboard.allPaid')}
          onClick={() => nav('/invoices')} />
      </div>

      {/* In-patients have their card above (it turns red when a treatment is late); stock warnings show here. */}
      <div className="attention">
        <LowStockSection />
      </div>

      <div className="cols dash-cols">
        <div>
          <QueueSection />
          <section className="section schedule">
            <header>
              <h2>{t('dashboard.todayAppts')}</h2>
              <span className="count">{appts.length}</span>
            </header>
            <ul className="list">
              {appts.length === 0 && (
                <li className="empty">
                  {t('dashboard.noAppts')}{' '}
                  <button type="button" className="linkbtn" onClick={() => nav(`/appointments?view=day&date=${d}&new=1`)}>{t('dashboard.book')}</button>
                </li>
              )}
              {appts.map((a) => (
                <li key={a.id} className={`link ${a.status === 'CANCELLED' || a.status === 'NO_SHOW' ? 'greyed' : ''} ${a.id === next?.id ? 'next' : ''}`} onClick={() => nav(`/appointments?view=day&date=${d}&open=${a.id}`)}>
                  <span className="time">{fmt.time(a.scheduled_at)}</span>
                  <div className="main-col">
                    <b>{speciesEmoji[a.species]} {a.pet_name}</b>
                    <div className="sub">{a.owner_name} · {t(`visitType.${a.type}`)}{a.notes ? ` · ${a.notes}` : ''}</div>
                  </div>
                  <StatusBadge ns="apptStatus" value={a.status} />
                  {a.status === 'SCHEDULED' && (
                    <WaButton
                      small
                      phone={a.whatsapp || a.phone}
                      label=""
                      text={t('wa.appointment', { owner: a.owner_name, clinic, pet: a.pet_name, date: fmt.date(a.scheduled_at), time: fmt.time(a.scheduled_at) })}
                      onSent={() => markAppointmentReminded(a.id)}
                    />
                  )}
                </li>
              ))}
            </ul>
          </section>
        </div>

        <section className="section due">
          <header>
            <h2>{t('dashboard.due')}</h2>
            <span className="count">{due.length}</span>
          </header>
          <ul className="list">
            {due.length === 0 && <li className="empty">🎉 {t('dashboard.noDue')}</li>}
            {due.slice(0, SHOW_DUE).map((v) => {
              const n = daysBetween(d, v.next_due_at);
              return (
                <li key={v.vaccination_id} className="link" onClick={() => nav(`/pets/${v.pet_id}?tab=vaccinations`)}>
                  <div className="main-col">
                    <b>{speciesEmoji[v.species]} {v.pet_name} · {v.vaccine}</b>
                    <div className="sub">
                      {v.owner_name} · {fmt.date(v.next_due_at)}
                      {v.reminder_sent_at && <> · ✓ {t('common.reminded', { when: fmt.date(v.reminder_sent_at) })}</>}
                    </div>
                  </div>
                  <Badge kind={n < 0 ? 'bad' : n === 0 ? 'warn' : 'info'}>
                    {n < 0 ? t('dashboard.overdue', { n: -n }) : n === 0 ? t('dashboard.dueToday') : t('dashboard.dueIn', { n })}
                  </Badge>
                  <WaButton
                    small
                    phone={v.whatsapp || v.phone}
                    label={t('dashboard.remind')}
                    text={t('wa.vaccination', { owner: v.owner_name, clinic, pet: v.pet_name, vaccine: v.vaccine, date: fmt.date(v.next_due_at) })}
                    onSent={() => markVaccinationReminded(v.vaccination_id)}
                  />
                </li>
              );
            })}
          </ul>
          {due.length > SHOW_DUE && (
            <button type="button" className="linkbtn" style={{ marginTop: 8 }} onClick={() => nav('/reminders')}>{t('dashboard.seeAll', { n: due.length })}</button>
          )}
        </section>
      </div>
    </div>
  );
}
