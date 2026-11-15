// Dashboard (redone 14 Nov 2026 at Ahmed's request: "confusing", make it clear). Three parts, top to bottom:
//  1. hello + one search box + four big buttons for what the clinic does most;
//  2. "Needs attention": one short list, one sentence and one button per thing to do now (lost pet alerts, patients
//     waiting, late in-patient treatments, reminders to send, stock, unpaid invoices) — or "all clear";
//  3. today's schedule next to the vet's queue.
// Nothing is shown twice: the counters and the separate vaccination list of the 7 Nov version are gone (the
// vaccinations due are one row here and a full list in Reminders).
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp, useQuery } from '../lib/app';
import {
  appointmentsBetween, dueVaccinations, expiringStock, getSettings, lowDrugs, lowStock, markAppointmentReminded, newFoundCount, openBalance, quickSearch,
  waitingQueue, wardBoard,
} from '../db/repo';
import { addDays, daysBetween, startOfDayIso, today } from '../lib/dates';
import { Badge, Icon, StatusBadge, WaButton, speciesEmoji } from '../components/ui';
import { QueueSection } from './IntakeForm';
import { remindersLeft } from './Reminders';

const greeting = (h = new Date().getHours()) => (h < 12 ? 'login.morning' : h < 17 ? 'login.afternoon' : 'login.evening');

function Quick({ icon, label, onClick, primary }: { icon: string; label: string; onClick: () => void; primary?: boolean }) {
  return (
    <button type="button" className={`quick-btn${primary ? ' primary' : ''}`} onClick={onClick}>
      <span className="ic"><Icon name={icon} /></span>
      <span className="lbl">{label}</span>
    </button>
  );
}

/** One thing to do now: what it is in plain words, and the one button that deals with it. */
function Attn({ icon, tone, title, sub, action, onAction, className }: {
  icon: string; tone: 'bad' | 'warn' | 'info'; title: ReactNode; sub?: ReactNode; action: string; onAction: () => void; className?: string;
}) {
  return (
    <li className={`attn-row ${tone} ${className ?? ''}`}>
      <span className="attn-ic" aria-hidden>{icon}</span>
      <div className="main-col">
        <b>{title}</b>
        {sub ? <div className="sub">{sub}</div> : null}
      </div>
      <button type="button" className={`btn sm ${tone === 'bad' ? 'primary' : ''}`} onClick={onAction}>{action}</button>
    </li>
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
  const foundNew = useQuery(newFoundCount);
  const money = useQuery(openBalance);
  const toRemind = useQuery(remindersLeft);
  const lowItems = useQuery(lowStock);
  const lowDrugList = useQuery(lowDrugs);
  const expiring = useQuery(() => expiringStock(30));
  const settings = useQuery(getSettings);
  const clinic = locale === 'ar' ? settings.name_ar : settings.name_en;
  const now = Date.now();
  const next = appts.find((a) => a.status === 'SCHEDULED' && new Date(a.scheduled_at).getTime() >= now - 15 * 60_000);
  const late = ward.reduce((s, r) => s + r.tasks.filter((x) => x.status === 'DUE' && new Date(x.due_at).getTime() < now - 10 * 60_000).length, 0);
  const firstName = (user?.name ?? '').replace(/^(dr\.?|د\.?)\s+/i, '').split(/\s+/)[0];
  const overdueVacc = due.filter((v) => daysBetween(d, v.next_due_at) < 0).length;
  const waitingNow = waiting.filter((w) => w.stage === 'WAITING').length;
  const stockParts = [
    ...lowItems.map((r) => `${locale === 'ar' ? r.name_ar : r.name_en}: ${fmt.num(r.on_hand, 2)}`),
    ...lowDrugList.map((x) => `${x.name}: ${fmt.num(x.stock_qty ?? 0, 2)}${x.stock_unit ? ` ${x.stock_unit}` : ''}`),
  ];

  const rows: ReactNode[] = [];
  if (foundNew > 0) {
    rows.push(<Attn key="found" className="found-banner" icon="🚨" tone="bad" title={t('lostFound.dashboard', { n: foundNew })} action={t('dashboard.foundBtn')} onAction={() => nav('/lost-found')} />);
  }
  if (late > 0) {
    rows.push(<Attn key="ward" className="attn-ward" icon="⏰" tone="bad" title={t('dashboard.wardLate', { n: late })} sub={t('dashboard.wardSub', { n: ward.length })} action={t('dashboard.openWard')} onAction={() => nav('/ward')} />);
  }
  if (waitingNow > 0) {
    rows.push(<Attn key="queue" className="attn-queue" icon="🩺" tone="warn" title={t('dashboard.waitingRow', { n: waitingNow })} action={t('dashboard.seeQueue')}
      onAction={() => document.querySelector('.section.queue')?.scrollIntoView({ behavior: 'smooth', block: 'start' })} />);
  }
  if (due.length > 0 || toRemind > 0) {
    rows.push(
      <Attn key="remind" className="attn-reminders" icon="💉" tone={overdueVacc ? 'warn' : 'info'}
        title={due.length ? t('dashboard.vaccRow', { n: due.length }) : t('dashboard.remindRow', { n: toRemind })}
        sub={[overdueVacc ? t('dashboard.overdueN', { n: overdueVacc }) : null, toRemind ? t('dashboard.notSent', { n: toRemind }) : null].filter(Boolean).join(' · ') || undefined}
        action={t('dashboard.sendReminders')} onAction={() => nav('/reminders')} />,
    );
  }
  if (stockParts.length || expiring.length) {
    rows.push(
      <Attn key="stock" className="low-stock" icon="📦" tone="warn"
        title={stockParts.length ? t('dashboard.stockLow', { n: stockParts.length }) : t('dashboard.stockExpiring', { n: expiring.length })}
        sub={[
          stockParts.join(' · '),
          expiring.length ? `${t('stock.expiringSoon')} ${expiring.slice(0, 3).map((b) => `${locale === 'ar' ? b.name_ar : b.name_en}${b.batch_no ? ` (${b.batch_no})` : ''}: ${fmt.date(b.expires_at!)}`).join(' · ')}${expiring.length > 3 ? ` +${expiring.length - 3}` : ''}` : null,
        ].filter(Boolean).join(' — ')}
        action={t('dashboard.stockBtn')} onAction={() => nav(lowDrugList.length && !lowItems.length && !expiring.length ? '/stock/drugs' : '/stock')} />,
    );
  }
  if (money.n > 0) {
    rows.push(<Attn key="money" className="attn-invoices" icon="🧾" tone="info" title={t('dashboard.unpaidRow', { n: money.n })} sub={t('dashboard.stillDue', { amount: fmt.money(money.due) })} action={t('dashboard.invoicesBtn')} onAction={() => nav('/invoices')} />);
  }

  return (
    <div className="page dash">
      <header className="dash-hello">
        <p className="dash-date">{new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${d}T12:00:00`))}</p>
        <h1>{t(greeting())}{firstName ? `${locale === 'ar' ? '، ' : ', '}${firstName}` : ''}</h1>
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
      </nav>

      <section className="section attention">
        <header>
          <h2>{t('dashboard.attention')}</h2>
          {rows.length > 0 && <span className="count">{rows.length}</span>}
        </header>
        <ul className="list attn">
          {rows.length ? rows : <li className="empty all-clear">✓ {t('dashboard.allClear')}</li>}
        </ul>
      </section>

      <div className="cols dash-cols">
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
                {a.id === next?.id ? <Badge kind="info">{t('dashboard.nextBadge')}</Badge> : <StatusBadge ns="apptStatus" value={a.status} />}
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
        <div className="queue-col">
          <QueueSection />
        </div>
      </div>
    </div>
  );
}
