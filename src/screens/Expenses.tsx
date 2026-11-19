// Reports → Expenses (Admin; 7 Nov 2026 change request): the clinic's own spending — rent, salaries, supplies… — so the
// monthly report can show profit (money collected − money spent). Expenses are voided, never deleted.
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApp, useQuery } from '../lib/app';
import { expensesBetween, monthAdd, saveExpense, voidExpense, type ExpenseRow } from '../db/repo';
import { EXPENSE_CATEGORIES, PAYMENT_METHODS, type ExpenseCategory, type PaymentMethod } from '../db/types';
import { today } from '../lib/dates';
import { Confirm, Dialog, Field, Icon } from '../components/ui';

export function ExpensesReport({ Stepper }: { Stepper: (p: { label: string; onPrev: () => void; onNext: () => void; children: React.ReactNode }) => JSX.Element }) {
  const { t, fmt, locale } = useApp();
  const [sp, setSp] = useSearchParams();
  const month = sp.get('month') || today().slice(0, 7);
  const go = (m: string) => setSp({ view: 'expenses', month: m }, { replace: true });
  const rows = useQuery(() => expensesBetween(`${month}-01`, `${monthAdd(month, 1)}-01`), [month]);
  const [edit, setEdit] = useState<Partial<ExpenseRow> | null>(null);
  const label = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', { month: 'long', year: 'numeric' }).format(new Date(`${month}-01T12:00:00`));
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const byCat = EXPENSE_CATEGORIES.map((c) => ({ c, sum: rows.filter((r) => r.category === c).reduce((s, r) => s + r.amount, 0) })).filter((x) => x.sum > 0).sort((a, b) => b.sum - a.sum);

  return (
    <>
      <Stepper label={label} onPrev={() => go(monthAdd(month, -1))} onNext={() => go(monthAdd(month, 1))}>
        <input type="month" value={month} onChange={(e) => e.target.value && go(e.target.value)} aria-label={t('reports.monthCol')} />
      </Stepper>
      <div className="row" style={{ margin: '12px 0' }}>
        <div className="tiles spacer" style={{ margin: 0 }}>
          <div className="tile main"><span>{t('expenses.total')}</span><b className="num">{fmt.money(total)}</b><small>{t('expenses.count', { n: rows.length })}</small></div>
        </div>
        <button className="btn primary no-print" onClick={() => setEdit({ spent_at: month === today().slice(0, 7) ? today() : `${month}-01`, category: 'SUPPLIES', method: 'CASH' })}>
          <Icon name="plus" /> {t('expenses.add')}
        </button>
      </div>
      <div className="cols">
        <section className="section">
          <header><h2>{t('expenses.list')}</h2><span className="count">{rows.length}</span></header>
          <div className="tablewrap">
            <table className="t expenses">
              <thead><tr><th>{t('common.date')}</th><th>{t('expenses.category')}</th><th>{t('expenses.payee')}</th><th>{t('expenses.method')}</th><th className="r">{t('expenses.amount')}</th></tr></thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={5} className="muted">{t('expenses.none')}</td></tr>}
                {rows.map((r) => (
                  <tr key={r.id} className="link" onClick={() => setEdit(r)}>
                    <td>{fmt.date(r.spent_at)}</td>
                    <td>{t(`expenses.cat.${r.category}`)}</td>
                    <td>{r.payee ?? '—'}{r.note ? <span className="muted small"> · {r.note}</span> : null}</td>
                    <td>{t(`method.${r.method}`)}</td>
                    <td className="r num"><b>{fmt.money(r.amount)}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="section">
          <header><h2>{t('expenses.byCategory')}</h2></header>
          <table className="t">
            <tbody>
              {byCat.length === 0 && <tr><td className="muted">{t('expenses.none')}</td></tr>}
              {byCat.map((x) => (
                <tr key={x.c}>
                  <td>{t(`expenses.cat.${x.c}`)}</td>
                  <td className="r num"><b>{fmt.money(x.sum)}</b></td>
                  <td className="r muted num" style={{ width: 56 }}>{total ? `${Math.round((x.sum / total) * 100)}%` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
      {edit && <ExpenseDialog item={edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function ExpenseDialog({ item, onClose }: { item: Partial<ExpenseRow>; onClose: () => void }) {
  const { t, toast, user } = useApp();
  const [f, setF] = useState({
    spent_at: item.spent_at ?? today(), category: (item.category ?? 'SUPPLIES') as ExpenseCategory, method: (item.method ?? 'CASH') as PaymentMethod,
    amount: item.amount != null ? String(item.amount / 100) : '', payee: item.payee ?? '', note: item.note ?? '',
  });
  const [confirmVoid, setConfirmVoid] = useState(false);
  const egp = Number(f.amount.replace(',', '.'));
  const valid = !!f.spent_at && Number.isFinite(egp) && egp > 0;
  const save = () => {
    saveExpense({ spent_at: f.spent_at, category: f.category, method: f.method, amount: Math.round(egp * 100), payee: f.payee, note: f.note }, user?.id ?? null, item.id);
    toast(t('app.saved'));
    onClose();
  };
  return (
    <Dialog
      title={item.id ? t('expenses.edit') : t('expenses.add')}
      onClose={onClose}
      footer={<>
        {item.id && <button className="btn danger" style={{ marginInlineEnd: 'auto' }} onClick={() => setConfirmVoid(true)}>{t('expenses.void')}</button>}
        <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
        <button className="btn primary" disabled={!valid} onClick={save}>{t('common.save')}</button>
      </>}
    >
      <div className="grid g2">
        <Field label={t('expenses.amountEgp')}>
          <input type="number" min="0" step="any" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} autoFocus />
        </Field>
        <Field label={t('common.date')}><input type="date" value={f.spent_at} onChange={(e) => setF({ ...f, spent_at: e.target.value })} /></Field>
        <Field label={t('expenses.category')}>
          <select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as ExpenseCategory })}>
            {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{t(`expenses.cat.${c}`)}</option>)}
          </select>
        </Field>
        <Field label={t('expenses.method')}>
          <select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value as PaymentMethod })}>
            {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{t(`method.${m}`)}</option>)}
          </select>
        </Field>
        <Field label={t('expenses.payee')} className="span2" optional>
          <input type="text" value={f.payee} placeholder={t('expenses.payeePh')} onChange={(e) => setF({ ...f, payee: e.target.value })} />
        </Field>
        <Field label={t('common.notes')} className="span2" optional>
          <input type="text" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        </Field>
      </div>
      {confirmVoid && (
        <Confirm title={t('expenses.void')} body={t('expenses.voidConfirm')} danger onClose={() => setConfirmVoid(false)}
          onConfirm={() => { voidExpense(item.id!); toast(t('app.saved')); onClose(); }} />
      )}
    </Dialog>
  );
}
