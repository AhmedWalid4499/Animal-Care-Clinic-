// Tomorrow's reminders (6 Nov 2026 change request): one screen the front desk works through in a few minutes —
// tomorrow's appointments and this week's due (or overdue) vaccinations, each with its WhatsApp button. Sending marks
// the row reminded (reminder_sent_at), so the list shows what is left. Uses the one integration (wa.me click-to-chat).
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApp, useQuery } from '../lib/app';
import { appointmentsBetween, dueVaccinations, getSettings, markAppointmentReminded, markRecalled, markVaccinationReminded, recallList } from '../db/repo';
import { addDays, daysBetween, localDateOf, startOfDayIso, today } from '../lib/dates';
import { Badge, WaButton, speciesEmoji } from '../components/ui';
import { PageHead } from '../components/Layout';

/** How many reminders are still to send (dashboard button). */
export function remindersLeft(): number {
  const d = today();
  const appts = appointmentsBetween(startOfDayIso(addDays(d, 1)), startOfDayIso(addDays(d, 2))).filter((a) => a.status === 'SCHEDULED' && !a.reminder_sent_at);
  return appts.length + dueVaccinations(7).filter((v) => !v.reminder_sent_at).length;
}

export function Reminders() {
  const { t } = useApp();
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') === 'recall' ? 'recall' : 'week';
  return (
    <>
      <div className="tabs no-print reminder-tabs">
        <button className={tab === 'week' ? 'on' : ''} onClick={() => setSp({}, { replace: true })}>{t('reminders.title')}</button>
        <button className={tab === 'recall' ? 'on' : ''} onClick={() => setSp({ tab: 'recall' }, { replace: true })}>{t('recall.title')}</button>
      </div>
      {tab === 'week' ? <ThisWeek /> : <Recall />}
    </>
  );
}

function ThisWeek() {
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

const RECALL_MONTHS = [6, 12, 18, 24];
const PAGE = 60;

/** Pets not seen for a while (no visit in N months, nothing booked): one WhatsApp "time for a check-up" each. */
function Recall() {
  const { t, fmt, locale } = useApp();
  const nav = useNavigate();
  const [months, setMonths] = useState(12);
  const [shown, setShown] = useState(PAGE);
  const rows = useQuery(() => recallList(months), [months]);
  const settings = useQuery(getSettings);
  const clinic = locale === 'ar' ? settings.name_ar : settings.name_en;
  // Reminded in the last 30 days: done for now (greyed, at the end).
  const recent = (iso: string | null) => !!iso && daysBetween(localDateOf(iso), today()) <= 30;
  const ordered = [...rows.filter((r) => !recent(r.recall_sent_at)), ...rows.filter((r) => recent(r.recall_sent_at))];
  const done = rows.length - rows.filter((r) => !recent(r.recall_sent_at)).length;
  return (
    <div className="page reminders recall">
      <PageHead title={t('recall.title')} sub={rows.length ? t('reminders.progress', { done, total: rows.length }) : t('recall.none')} />
      <div className="row" style={{ marginBottom: 12 }}>
        <span className="muted small">{t('recall.lastVisit')}</span>
        <div className="seg" role="group" aria-label={t('recall.lastVisit')}>
          {RECALL_MONTHS.map((m) => (
            <button key={m} type="button" className={months === m ? 'on' : ''} onClick={() => { setMonths(m); setShown(PAGE); }}>{t('recall.months', { n: m })}</button>
          ))}
        </div>
      </div>
      <p className="muted small">{t('recall.hint')}</p>
      <ul className="list">
        {ordered.length === 0 && <li className="empty">{t('recall.none')}</li>}
        {ordered.slice(0, shown).map((r) => {
          const ago = Math.max(1, Math.round(daysBetween(localDateOf(r.last_visit), today()) / 30.4));
          return (
            <li key={r.pet_id} className={`link ${recent(r.recall_sent_at) ? 'done' : ''}`} onClick={() => nav(`/pets/${r.pet_id}`)}>
              <div className="main-col">
                <b>{speciesEmoji[r.species]} {r.pet_name}</b>
                <div className="sub">
                  {r.owner_name} · {t('recall.seen', { date: fmt.date(r.last_visit) })}
                  {r.recall_sent_at && <> · ✓ {t('common.reminded', { when: fmt.date(r.recall_sent_at) })}</>}
                </div>
              </div>
              <Badge kind={ago >= 18 ? 'bad' : 'warn'}>{t('recall.monthsAgo', { n: ago })}</Badge>
              <WaButton
                small
                phone={r.whatsapp || r.phone}
                label={recent(r.recall_sent_at) ? t('reminders.again') : t('dashboard.remind')}
                text={t('wa.recall', { owner: r.owner_name, clinic, pet: r.pet_name, date: fmt.date(r.last_visit) })}
                onSent={() => markRecalled(r.pet_id)}
              />
            </li>
          );
        })}
      </ul>
      {ordered.length > shown && (
        <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
          <button className="btn" onClick={() => setShown(shown + PAGE)}>{t('recall.more', { n: ordered.length - shown })}</button>
        </div>
      )}
    </div>
  );
}
