import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp, useQuery } from '../lib/app';
import { appointmentsBetween, dashboardCounts, dueVaccinations, getSettings, markAppointmentReminded, markVaccinationReminded, quickSearch } from '../db/repo';
import { addDays, daysBetween, startOfDayIso, today } from '../lib/dates';
import { Badge, Icon, StatusBadge, WaButton, speciesEmoji } from '../components/ui';
import { PageHead } from '../components/Layout';
import { QueueSection } from './IntakeForm';
import { remindersLeft } from './Reminders';
import { LowStockSection } from './Stock';
import { WardSection } from './Ward';

export function Dashboard() {
  const { t, fmt, canVisit, canIntake, locale } = useApp();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const hits = useQuery(() => quickSearch(q), [q]);
  const d = today();
  const appts = useQuery(() => appointmentsBetween(startOfDayIso(d), startOfDayIso(addDays(d, 1))), [d]);
  const due = useQuery(() => dueVaccinations(7));
  const counts = useQuery(dashboardCounts);
  const toRemind = useQuery(remindersLeft);
  const settings = useQuery(getSettings);
  const clinic = locale === 'ar' ? settings.name_ar : settings.name_en;

  return (
    <div className="page">
      <PageHead title={`${t('dashboard.title')} · ${fmt.weekday(d)}`} sub={t('dashboard.stats', counts)}>
        <button className="btn" onClick={() => nav('/reminders')}>
          <Icon name="chat" /> {t('reminders.title')}{toRemind > 0 && <span className="pill">{toRemind}</span>}
        </button>
        {canIntake && (
          <button className={`btn${canVisit ? '' : ' primary'}`} onClick={() => nav('/intake/new')}>
            <Icon name="clipboard" /> {t('nav.intake')}
          </button>
        )}
        {canVisit && (
          <button className="btn primary" onClick={() => nav('/visits/new')}>
            <Icon name="plus" /> {t('nav.newVisit')}
          </button>
        )}
      </PageHead>

      <div className="searchbox">
        <Icon name="search" />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('dashboard.search')} autoFocus aria-label={t('dashboard.search')} />
      </div>
      {q.trim().length > 0 && (
        <ul className="list" style={{ marginTop: 4 }}>
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

      <WardSection />
      <LowStockSection />
      <QueueSection />

      <div className="cols" style={{ marginTop: 26 }}>
        <section className="section">
          <header>
            <h2>{t('dashboard.todayAppts')}</h2>
            <span className="count">{appts.length}</span>
          </header>
          <ul className="list">
            {appts.length === 0 && <li className="empty">{t('dashboard.noAppts')}</li>}
            {appts.map((a) => (
              <li key={a.id} className={`link ${a.status === 'CANCELLED' || a.status === 'NO_SHOW' ? 'greyed' : ''}`} onClick={() => nav(`/appointments?view=day&date=${d}&open=${a.id}`)}>
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

        <section className="section">
          <header>
            <h2>{t('dashboard.due')}</h2>
            <span className="count">{due.length}</span>
          </header>
          <ul className="list">
            {due.length === 0 && <li className="empty">{t('dashboard.noDue')}</li>}
            {due.map((v) => {
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
        </section>
      </div>
    </div>
  );
}
