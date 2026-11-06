// Tomorrow's reminders (6 Nov 2026 change request): one screen the front desk works through in a few minutes —
// tomorrow's appointments and this week's due (or overdue) vaccinations, each with its WhatsApp button. Sending marks
// the row reminded (reminder_sent_at), so the list shows what is left. Uses the one integration (wa.me click-to-chat).
import { useNavigate } from 'react-router-dom';
import { useApp, useQuery } from '../lib/app';
import { appointmentsBetween, dueVaccinations, getSettings, markAppointmentReminded, markVaccinationReminded } from '../db/repo';
import { addDays, daysBetween, startOfDayIso, today } from '../lib/dates';
import { Badge, WaButton, speciesEmoji } from '../components/ui';
import { PageHead } from '../components/Layout';

/** How many reminders are still to send (dashboard button). */
export function remindersLeft(): number {
  const d = today();
  const appts = appointmentsBetween(startOfDayIso(addDays(d, 1)), startOfDayIso(addDays(d, 2))).filter((a) => a.status === 'SCHEDULED' && !a.reminder_sent_at);
  return appts.length + dueVaccinations(7).filter((v) => !v.reminder_sent_at).length;
}

export function Reminders() {
  const { t, fmt, locale } = useApp();
  const nav = useNavigate();
  const d = today();
  const tomorrow = addDays(d, 1);
  const appts = useQuery(() => appointmentsBetween(startOfDayIso(tomorrow), startOfDayIso(addDays(d, 2))).filter((a) => a.status === 'SCHEDULED'), [tomorrow]);
  const due = useQuery(() => dueVaccinations(7));
  const settings = useQuery(getSettings);
  const clinic = locale === 'ar' ? settings.name_ar : settings.name_en;
  const total = appts.length + due.length;
  const done = appts.filter((a) => a.reminder_sent_at).length + due.filter((v) => v.reminder_sent_at).length;

  return (
    <div className="page reminders">
      <PageHead title={t('reminders.title')} sub={total ? t('reminders.progress', { done, total }) : t('reminders.nothing')} />

      <section className="section">
        <header>
          <h2>{t('reminders.tomorrow', { date: fmt.date(tomorrow) })}</h2>
          <span className="count">{appts.length}</span>
        </header>
        <ul className="list">
          {appts.length === 0 && <li className="empty">{t('reminders.noAppts')}</li>}
          {appts.map((a) => (
            <li key={a.id} className={`link ${a.reminder_sent_at ? 'done' : ''}`} onClick={() => nav(`/appointments?view=day&date=${tomorrow}&open=${a.id}`)}>
              <span className="time">{fmt.time(a.scheduled_at)}</span>
              <div className="main-col">
                <b>{speciesEmoji[a.species]} {a.pet_name}</b>
                <div className="sub">
                  {a.owner_name} · {t(`visitType.${a.type}`)}
                  {a.reminder_sent_at && <> · ✓ {t('common.reminded', { when: fmt.date(a.reminder_sent_at) })}</>}
                </div>
              </div>
              <WaButton
                small
                phone={a.whatsapp || a.phone}
                label={a.reminder_sent_at ? t('reminders.again') : t('dashboard.remind')}
                text={t('wa.appointment', { owner: a.owner_name, clinic, pet: a.pet_name, date: fmt.date(a.scheduled_at), time: fmt.time(a.scheduled_at) })}
                onSent={() => markAppointmentReminded(a.id)}
              />
            </li>
          ))}
        </ul>
      </section>

      <section className="section" style={{ marginTop: 22 }}>
        <header>
          <h2>{t('reminders.vaccinations')}</h2>
          <span className="count">{due.length}</span>
        </header>
        <ul className="list">
          {due.length === 0 && <li className="empty">{t('dashboard.noDue')}</li>}
          {due.map((v) => {
            const n = daysBetween(d, v.next_due_at);
            return (
              <li key={v.vaccination_id} className={`link ${v.reminder_sent_at ? 'done' : ''}`} onClick={() => nav(`/pets/${v.pet_id}?tab=vaccinations`)}>
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
                  label={v.reminder_sent_at ? t('reminders.again') : t('dashboard.remind')}
                  text={t('wa.vaccination', { owner: v.owner_name, clinic, pet: v.pet_name, vaccine: v.vaccine, date: fmt.date(v.next_due_at) })}
                  onSent={() => markVaccinationReminded(v.vaccination_id)}
                />
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
