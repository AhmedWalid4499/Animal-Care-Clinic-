// Reports for the Admin (6 Nov 2026 change requests): the end-of-day cash report (closing the till) and the monthly
// report (revenue, visits by type, top services, who owes money and for how long). Both read the device's own copy of
// the clinic's data, which sync keeps complete, and both print from the browser's print dialog.
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useApp, useQuery } from '../lib/app';
import {
  getSettings, listInvoices, monthAdd, monthStartIso, ownersOwing, paymentsBetween, revenueByMonth, topServices, visitsByType,
} from '../db/repo';
import { addDays, daysBetween, localDateOf, startOfDayIso, today } from '../lib/dates';
import { platform } from '../lib/platform';
import { Badge, Icon, WaButton } from '../components/ui';
import { PricingTabs } from '../components/Sections';
import { ExpensesReport } from './Expenses';
import { PageHead } from '../components/Layout';
import { PAYMENT_METHODS } from '../db/types';

type View = 'day' | 'month' | 'expenses';
/** "1 payment" / "3 payments" (reports.paymentsOne / reports.paymentsN). */
const plural = (t: (k: string, v?: Record<string, string | number>) => string, what: 'payments' | 'owners' | 'invoices', n: number) =>
  n === 1 ? t(`reports.${what}One`) : t(`reports.${what}N`, { n });

export function Reports() {
  const { t } = useApp();
  const [sp, setSp] = useSearchParams();
  const v = sp.get('view');
  const view: View = v === 'month' || v === 'expenses' ? v : 'day';
  return (
    <div className="page reports">
      <PricingTabs />
      <PageHead title={t('reports.title')}>
        <button className="btn primary no-print" onClick={() => platform.print()}><Icon name="print" /> {t('common.print')}</button>
      </PageHead>
      <div className="tabs no-print" style={{ marginTop: -18, marginBottom: 18 }}>
        {(['day', 'month', 'expenses'] as View[]).map((k) => (
          <button key={k} className={view === k ? 'on' : ''} onClick={() => setSp({ view: k }, { replace: true })}>{t(`reports.${k}`)}</button>
        ))}
      </div>
      <div key={view} className="tab-enter">{view === 'day' ? <DayReport /> : view === 'month' ? <MonthReport /> : <ExpensesReport Stepper={Stepper} />}</div>
    </div>
  );
}

function Stepper({ label, onPrev, onNext, children }: { label: string; onPrev: () => void; onNext: () => void; children: React.ReactNode }) {
  const { t } = useApp();
  return (
    <div className="row stepper">
      <button type="button" className="btn sm no-print" onClick={onPrev} aria-label={t('common.prev')}>‹</button>
      <h2 className="spacer" style={{ margin: 0 }}>{label}</h2>
      <span className="no-print">{children}</span>
      <button type="button" className="btn sm no-print" onClick={onNext} aria-label={t('common.next')}>›</button>
    </div>
  );
}

// ---------------------------------------------------------------- end of day
function DayReport() {
  const { t, fmt } = useApp();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const date = sp.get('date') || today();
  const go = (d: string) => setSp({ view: 'day', date: d }, { replace: true });
  const payments = useQuery(() => paymentsBetween(startOfDayIso(date), startOfDayIso(addDays(date, 1))), [date]);
  const open = useQuery(() => listInvoices('', 'OPEN'), []);
  const total = payments.reduce((s, p) => s + p.amount, 0);
  const byMethod = PAYMENT_METHODS.map((m) => {
    const ps = payments.filter((p) => p.method === m);
    return { m, n: ps.length, sum: ps.reduce((s, p) => s + p.amount, 0) };
  });
  const staff = new Map<string, { n: number; sum: number }>();
  for (const p of payments) {
    const k = p.received_by_name ?? t('reports.unknownStaff');
    const r = staff.get(k) ?? { n: 0, sum: 0 };
    r.n++;
    r.sum += p.amount;
    staff.set(k, r);
  }
  const openToday = open.filter((i) => localDateOf(i.issued_at) === date);
  const openBalance = open.reduce((s, i) => s + (i.total - i.paid), 0);

  return (
    <>
      <Stepper label={`${t('reports.dayTitle')} · ${fmt.weekday(date)} ${date.slice(0, 4)}`} onPrev={() => go(addDays(date, -1))} onNext={() => go(addDays(date, 1))}>
        <input type="date" value={date} max={today()} onChange={(e) => e.target.value && go(e.target.value)} aria-label={t('common.date')} />
      </Stepper>

      <div className="tiles">
        <div className="tile main"><span>{t('reports.collected')}</span><b className="num">{fmt.money(total)}</b><small>{plural(t, 'payments', payments.length)}</small></div>
        {byMethod.map(({ m, n, sum }) => (
          <div key={m} className="tile"><span>{t(`method.${m}`)}</span><b className="num">{fmt.money(sum)}</b><small>{plural(t, 'payments', n)}</small></div>
        ))}
      </div>

      <section className="section">
        <header><h2>{t('reports.byStaff')}</h2></header>
        <table className="t">
          <tbody>
            {staff.size === 0 && <tr><td className="muted">{t('reports.noPayments')}</td></tr>}
            {[...staff].map(([name, r]) => (
              <tr key={name}><td>{name}</td><td className="r muted">{plural(t, 'payments', r.n)}</td><td className="r num"><b>{fmt.money(r.sum)}</b></td></tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="section">
        <header><h2>{t('reports.payments')}</h2><span className="count">{payments.length}</span></header>
        <div className="tablewrap">
          <table className="t">
            <thead>
              <tr><th>{t('common.time')}</th><th>{t('invoices.number')}</th><th>{t('invoices.owner')}</th><th>{t('reports.method')}</th><th>{t('reports.takenBy')}</th><th className="r">{t('reports.amount')}</th></tr>
            </thead>
            <tbody>
              {payments.length === 0 && <tr><td colSpan={6} className="muted">{t('reports.noPayments')}</td></tr>}
              {payments.map((p) => (
                <tr key={p.id} className="link" onClick={() => nav(`/invoices/${p.invoice_id}`)}>
                  <td className="num">{fmt.time(p.paid_at)}</td>
                  <td className="ltr">{p.number}</td>
                  <td>{p.owner_name}{p.pet_name ? <span className="muted"> · {p.pet_name}</span> : null}</td>
                  <td>{t(`method.${p.method}`)}{p.reference ? <span className="muted small"> · {p.reference}</span> : null}</td>
                  <td>{p.received_by_name ?? '—'}</td>
                  <td className="r num">{fmt.money(p.amount)}</td>
                </tr>
              ))}
            </tbody>
            {payments.length > 0 && (
              <tfoot><tr><td colSpan={5}><b>{t('reports.collected')}</b></td><td className="r num"><b>{fmt.money(total)}</b></td></tr></tfoot>
            )}
          </table>
        </div>
      </section>

      <section className="section">
        <header>
          <h2>{t('reports.stillOpen')}</h2>
          <span className="count">{t('reports.openSummary', { n: open.length, amount: fmt.money(openBalance) })}</span>
        </header>
        <div className="tablewrap">
          <table className="t">
            <thead>
              <tr><th>{t('invoices.number')}</th><th>{t('invoices.owner')}</th><th>{t('invoices.issued')}</th><th className="r">{t('invoices.total')}</th><th className="r">{t('reports.due')}</th></tr>
            </thead>
            <tbody>
              {openToday.length === 0 && <tr><td colSpan={5} className="muted">{t('reports.noneOpenToday')}</td></tr>}
              {openToday.map((i) => (
                <tr key={i.id} className="link" onClick={() => nav(`/invoices/${i.id}`)}>
                  <td className="ltr">{i.number}</td>
                  <td>{i.owner_name}</td>
                  <td>{fmt.time(i.issued_at)}</td>
                  <td className="r num">{fmt.money(i.total)}</td>
                  <td className="r num"><b>{fmt.money(i.total - i.paid)}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small no-print">{t('reports.openHint')} <button type="button" className="linkbtn" onClick={() => nav('/invoices')}>{t('reports.allOpen')}</button></p>
      </section>
    </>
  );
}

// ---------------------------------------------------------------- month
function MonthReport() {
  const { t, fmt, locale } = useApp();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const month = sp.get('month') || today().slice(0, 7);
  const go = (m: string) => setSp({ view: 'month', month: m }, { replace: true });
  const from = monthStartIso(month);
  const to = monthStartIso(monthAdd(month, 1));
  const tag = locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB';
  const monthLong = new Intl.DateTimeFormat(tag, { month: 'long', year: 'numeric' });
  const monthShort = new Intl.DateTimeFormat(tag, { month: 'short' });
  const label = (m: string) => monthLong.format(new Date(`${m}-01T12:00:00`));
  const revenue = useQuery(() => revenueByMonth(month, 12), [month]);
  const visits = useQuery(() => visitsByType(from, to), [month]);
  const services = useQuery(() => topServices(from, to, 10), [month]);
  const owing = useQuery(ownersOwing);
  const settings = useQuery(getSettings);
  const clinic = locale === 'ar' ? settings.name_ar : settings.name_en;
  const cur = revenue[revenue.length - 1] ?? { invoiced: 0, collected: 0, spent: 0 };
  const profit = cur.collected - cur.spent;
  const visitTotal = visits.reduce((s, v) => s + v.n, 0);
  const owed = owing.reduce((s, o) => s + o.balance, 0);
  const chart = revenue.map((r) => ({ ...r, label: monthShort.format(new Date(`${r.month}-01T12:00:00`)), egp: r.collected / 100, spentEgp: r.spent / 100 }));
  const bucket = (days: number) => (days > 90 ? 'bad' : days > 60 ? 'bad' : days > 30 ? 'warn' : 'info');

  return (
    <>
      <Stepper label={label(month)} onPrev={() => go(monthAdd(month, -1))} onNext={() => go(monthAdd(month, 1))}>
        <input type="month" value={month} max={today().slice(0, 7)} onChange={(e) => e.target.value && go(e.target.value)} aria-label={t('reports.monthCol')} />
      </Stepper>

      <div className="tiles">
        <div className="tile main"><span>{t('reports.collected')}</span><b className="num">{fmt.money(cur.collected)}</b></div>
        <div className="tile"><span>{t('reports.spent')}</span><b className="num">{fmt.money(cur.spent)}</b></div>
        <div className={`tile ${profit < 0 ? 'neg' : ''}`}><span>{t('reports.profit')}</span><b className="num">{fmt.money(profit)}</b><small>{t('reports.profitHint')}</small></div>
        <div className="tile"><span>{t('reports.invoiced')}</span><b className="num">{fmt.money(cur.invoiced)}</b></div>
        <div className="tile"><span>{t('reports.visits')}</span><b className="num">{fmt.num(visitTotal, 0)}</b></div>
        <div className="tile"><span>{t('reports.owedNow')}</span><b className="num">{fmt.money(owed)}</b><small>{plural(t, 'owners', owing.length)}</small></div>
      </div>

      <section className="section">
        <header><h2>{t('reports.revenueChart')}</h2></header>
        <div className="chart-box" style={{ height: 240 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart} margin={{ top: 12, right: 12, bottom: 4, left: 8 }} barCategoryGap="28%">
              <CartesianGrid stroke="var(--rule)" vertical={false} />
              <XAxis dataKey="label" reversed={locale === 'ar'} stroke="var(--ink-3)" fontSize={12} tickLine={false} />
              <YAxis orientation={locale === 'ar' ? 'right' : 'left'} stroke="var(--ink-3)" fontSize={12} tickLine={false} axisLine={false} width={64}
                tickFormatter={(v: number) => fmt.num(v, 0)} />
              <Tooltip
                cursor={{ fill: 'var(--bg-2)' }}
                contentStyle={{ background: 'var(--bg)', border: '1px solid var(--rule-2)', borderRadius: 4, color: 'var(--ink)' }}
                formatter={(v: number, name: string) => [fmt.money(v * 100), name === 'spentEgp' ? t('reports.spent') : t('reports.collected')]}
                labelFormatter={(_l, p) => (p?.[0] ? label((p[0].payload as { month: string }).month) : '')}
              />
              <Bar dataKey="egp" fill="var(--accent)" radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false} />
              {chart.some((r) => r.spent > 0) && <Bar dataKey="spentEgp" fill="var(--ink-3)" radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false} />}
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="tablewrap">
          <table className="t compact">
            <thead><tr><th>{t('reports.monthCol')}</th><th className="r">{t('reports.invoiced')}</th><th className="r">{t('reports.collected')}</th><th className="r">{t('reports.spent')}</th><th className="r">{t('reports.profit')}</th></tr></thead>
            <tbody>
              {revenue.slice().reverse().map((r) => (
                <tr key={r.month} className={r.month === month ? 'on' : ''}><td>{label(r.month)}</td><td className="r num">{fmt.money(r.invoiced)}</td><td className="r num">{fmt.money(r.collected)}</td><td className="r num">{fmt.money(r.spent)}</td><td className={`r num ${r.collected - r.spent < 0 ? 'neg' : ''}`}>{fmt.money(r.collected - r.spent)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="cols" style={{ marginTop: 6 }}>
        <section className="section">
          <header><h2>{t('reports.topServices')}</h2></header>
          <table className="t">
            <thead><tr><th>{t('reports.service')}</th><th className="r">{t('reports.qty')}</th><th className="r">{t('reports.amount')}</th></tr></thead>
            <tbody>
              {services.length === 0 && <tr><td colSpan={3} className="muted">{t('reports.nothingThisMonth')}</td></tr>}
              {services.map((s, i) => (
                <tr key={i}>
                  <td>{(locale === 'ar' ? s.name_ar : s.name_en) || s.description}</td>
                  <td className="r num">{fmt.num(s.qty, 1)}</td>
                  <td className="r num">{fmt.money(s.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="section">
          <header><h2>{t('reports.visitsByType')}</h2><span className="count">{visitTotal}</span></header>
          <table className="t">
            <tbody>
              {visits.length === 0 && <tr><td className="muted">{t('reports.nothingThisMonth')}</td></tr>}
              {visits.map((v) => (
                <tr key={v.type}>
                  <td>{t(`visitType.${v.type}`)}</td>
                  <td className="r num"><b>{v.n}</b></td>
                  <td className="r muted num" style={{ width: 64 }}>{visitTotal ? `${Math.round((v.n / visitTotal) * 100)}%` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <section className="section">
        <header>
          <h2>{t('reports.owing')}</h2>
          <span className="count">{t('reports.owingSummary', { n: owing.length, amount: fmt.money(owed) })}</span>
        </header>
        <div className="tablewrap">
          <table className="t">
            <thead>
              <tr><th>{t('invoices.owner')}</th><th>{t('reports.oldest')}</th><th>{t('reports.age')}</th><th className="r">{t('reports.due')}</th><th className="no-print" /></tr>
            </thead>
            <tbody>
              {owing.length === 0 && <tr><td colSpan={5} className="muted">{t('reports.nobodyOwes')}</td></tr>}
              {owing.map((o) => {
                const days = daysBetween(localDateOf(o.oldest), today());
                return (
                  <tr key={o.owner_id} className="link" onClick={() => nav(`/owners/${o.owner_id}`)}>
                    <td>{o.owner_name}<span className="muted small"> · {plural(t, 'invoices', o.invoices)}</span></td>
                    <td>{fmt.date(o.oldest)}</td>
                    <td><Badge kind={bucket(days)}>{days > 90 ? t('reports.over90') : t('reports.daysN', { n: days })}</Badge></td>
                    <td className="r num"><b>{fmt.money(o.balance)}</b></td>
                    <td className="no-print r">
                      <WaButton small phone={o.whatsapp || o.phone} label="" text={t('wa.owing', { owner: o.owner_name, clinic, amount: fmt.money(o.balance) })} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
