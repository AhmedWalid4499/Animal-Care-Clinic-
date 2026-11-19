// Suppliers and purchases (16 Nov 2026, change request; Admin): who the clinic buys from, each delivery with what it
// cost, and what is still owed. A purchase line for an item counted in stock restocks it (with its batch and expiry);
// voiding the purchase takes it back out. Payments to suppliers are money spent in the monthly report, next to the
// clinic's other expenses. Data: suppliers, purchases, purchase_items, supplier_payments (schema v22).
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApp, useQuery } from '../lib/app';
import {
  getPurchase, getSupplier, listPriceItems, listSuppliers, saveSupplier, saveSupplierPayment, savePurchase, supplierBalances, supplierPaymentsOf,
  supplierPurchases, voidPurchase, voidSupplierPayment, type PurchaseInput, type PurchaseRow,
} from '../db/repo';
import { PAYMENT_METHODS, type PaymentMethod, type Supplier } from '../db/types';
import { today } from '../lib/dates';
import { Badge, Confirm, Dialog, Field, Icon, WaButton } from '../components/ui';
import { PageHead } from '../components/Layout';
import { StockTabs } from '../components/Sections';

const egp = (s: string) => Number(s.replace(',', '.'));
const piastres = (s: string) => Math.round(egp(s) * 100);

export function SuppliersPage() {
  const { t, fmt } = useApp();
  const nav = useNavigate();
  const rows = useQuery(supplierBalances);
  const [edit, setEdit] = useState<Partial<Supplier> | null>(null);
  const [buy, setBuy] = useState(false);
  const owed = rows.reduce((s, r) => s + Math.max(0, r.owed), 0);
  return (
    <div className="page suppliers">
      <StockTabs />
      <PageHead title={t('suppliers.title')} sub={t('suppliers.sub')}>
        <button className="btn" onClick={() => setEdit({ name: '', is_active: 1 })}><Icon name="plus" /> {t('suppliers.add')}</button>
        <button className="btn primary" disabled={!rows.some((r) => r.is_active)} onClick={() => setBuy(true)}><Icon name="box" /> {t('suppliers.newPurchase')}</button>
      </PageHead>
      {rows.length > 0 && (
        <div className="tiles" style={{ marginBottom: 14 }}>
          <div className="tile main"><span>{t('suppliers.totalOwed')}</span><b className="num">{fmt.money(owed)}</b></div>
        </div>
      )}
      {rows.length === 0 ? <p className="note">{t('suppliers.none')}</p> : (
        <div className="tablewrap">
          <table className="t">
            <thead><tr><th>{t('suppliers.name')}</th><th>{t('suppliers.lastPurchase')}</th><th className="r">{t('suppliers.bought')}</th><th className="r">{t('suppliers.paid')}</th><th className="r">{t('suppliers.owed')}</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={`link ${r.is_active ? '' : 'greyed'}`} onClick={() => nav(`/stock/suppliers/${r.id}`)}>
                  <td><b>{r.name}</b>{r.phone ? <span className="ltr muted small"> · {r.phone}</span> : null}</td>
                  <td className="muted">{r.last_purchase ? fmt.date(r.last_purchase) : '—'}</td>
                  <td className="r num">{fmt.money(r.bought)}</td>
                  <td className="r num">{fmt.money(r.paid)}</td>
                  <td className="r num"><OwedCell owed={r.owed} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {edit && <SupplierDialog item={edit} onClose={() => setEdit(null)} />}
      {buy && <PurchaseDialog onClose={() => setBuy(false)} />}
    </div>
  );
}

function OwedCell({ owed }: { owed: number }) {
  const { t, fmt } = useApp();
  if (owed > 0) return <b className="neg">{fmt.money(owed)}</b>;
  if (owed < 0) return <span className="muted">{t('suppliers.credit', { amount: fmt.money(-owed) })}</span>;
  return <span className="muted">{t('suppliers.settled')}</span>;
}

export function SupplierDetail() {
  const { id = '' } = useParams();
  const { t, fmt, locale } = useApp();
  const supplier = useQuery(() => getSupplier(id), [id]);
  const balance = useQuery(() => supplierBalances().find((r) => r.id === id), [id]);
  const purchases = useQuery(() => supplierPurchases(id), [id]);
  const payments = useQuery(() => supplierPaymentsOf(id), [id]);
  const [edit, setEdit] = useState(false);
  const [buy, setBuy] = useState<string | 'new' | null>(null);
  const [pay, setPay] = useState(false);
  const [voidPay, setVoidPay] = useState<string | null>(null);
  if (!supplier) return <div className="page">{t('common.notFound')}</div>;
  return (
    <div className="page supplier">
      <StockTabs />
      <PageHead title={supplier.name} crumb={{ to: '/stock/suppliers', label: t('suppliers.back') }}>
        {supplier.phone && <WaButton phone={supplier.phone} text={locale === 'ar' ? `مرحبًا ${supplier.name}` : `Hello ${supplier.name}`} />}
        <button className="btn" onClick={() => setEdit(true)}><Icon name="edit" /> {t('common.edit')}</button>
        <button className="btn" onClick={() => setPay(true)}>{t('suppliers.recordPayment')}</button>
        <button className="btn primary" disabled={!supplier.is_active} onClick={() => setBuy('new')}><Icon name="box" /> {t('suppliers.newPurchase')}</button>
      </PageHead>
      {!supplier.is_active && <p className="note">{t('suppliers.inactive')}</p>}
      {supplier.notes && <p className="note">{supplier.notes}</p>}
      <div className="tiles" style={{ marginBottom: 14 }}>
        <div className="tile"><span>{t('suppliers.bought')}</span><b className="num">{fmt.money(balance?.bought ?? 0)}</b></div>
        <div className="tile"><span>{t('suppliers.paid')}</span><b className="num">{fmt.money(balance?.paid ?? 0)}</b></div>
        <div className="tile main"><span>{t('suppliers.owed')}</span><b className="num"><OwedCell owed={balance?.owed ?? 0} /></b></div>
      </div>
      <div className="cols">
        <section className="section">
          <header><h2>{t('suppliers.purchases')}</h2><span className="count">{purchases.filter((p) => p.status === 'ACTIVE').length}</span></header>
          <div className="tablewrap">
            <table className="t">
              <thead><tr><th>{t('common.date')}</th><th>{t('suppliers.reference')}</th><th className="r">{t('suppliers.total')}</th><th className="r">{t('suppliers.paid')}</th></tr></thead>
              <tbody>
                {purchases.length === 0 && <tr><td colSpan={4} className="muted">{t('suppliers.noPurchases')}</td></tr>}
                {purchases.map((p: PurchaseRow) => (
                  <tr key={p.id} className={`link ${p.status === 'VOID' ? 'greyed' : ''}`} onClick={() => setBuy(p.id)}>
                    <td>{fmt.date(p.purchased_at)}</td>
                    <td><span className="ltr">{p.reference ?? '—'}</span> <span className="muted small">· {p.lines}</span>{p.status === 'VOID' && <> <Badge kind="bad">{t('suppliers.voided')}</Badge></>}</td>
                    <td className="r num"><b>{fmt.money(p.total)}</b></td>
                    <td className="r num muted">{p.paid ? fmt.money(p.paid) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="section">
          <header><h2>{t('suppliers.payments')}</h2><span className="count">{payments.filter((p) => p.status === 'ACTIVE').length}</span></header>
          <table className="t">
            <tbody>
              {payments.length === 0 && <tr><td className="muted">{t('suppliers.noPayments')}</td></tr>}
              {payments.map((p) => (
                <tr key={p.id} className={p.status === 'VOID' ? 'greyed' : ''}>
                  <td>{fmt.date(p.paid_at)}</td>
                  <td>{t(`method.${p.method}`)}{p.purchase_ref ? <span className="muted small ltr"> · {p.purchase_ref}</span> : null}{p.note ? <span className="muted small"> · {p.note}</span> : null}{p.status === 'VOID' && <> <Badge kind="bad">{t('suppliers.voided')}</Badge></>}</td>
                  <td className="r num"><b>{fmt.money(p.amount)}</b></td>
                  <td className="r">{p.status === 'ACTIVE' && <button type="button" className="btn sm ghost" onClick={() => setVoidPay(p.id)}>{t('suppliers.void')}</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
      {edit && <SupplierDialog item={supplier} onClose={() => setEdit(false)} />}
      {buy && <PurchaseDialog supplierId={id} purchaseId={buy === 'new' ? undefined : buy} onClose={() => setBuy(null)} />}
      {pay && <PaymentDialog supplierId={id} onClose={() => setPay(false)} />}
      {voidPay && (
        <Confirm title={t('suppliers.voidPayment')} body={t('suppliers.voidPaymentConfirm')} danger onClose={() => setVoidPay(null)}
          onConfirm={() => { voidSupplierPayment(voidPay); setVoidPay(null); }} />
      )}
    </div>
  );
}

function SupplierDialog({ item, onClose }: { item: Partial<Supplier>; onClose: () => void }) {
  const { t, toast } = useApp();
  const nav = useNavigate();
  const [f, setF] = useState({ name: item.name ?? '', phone: item.phone ?? '', notes: item.notes ?? '', is_active: item.is_active !== 0 });
  const save = () => {
    const id = saveSupplier(f, item.id);
    toast(t('app.saved'));
    onClose();
    if (!item.id) nav(`/stock/suppliers/${id}`);
  };
  return (
    <Dialog
      title={item.id ? t('suppliers.edit') : t('suppliers.add')}
      onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>{t('common.cancel')}</button><button className="btn primary" disabled={!f.name.trim()} onClick={save}>{t('common.save')}</button></>}
    >
      <div className="grid g2">
        <Field label={t('suppliers.name')}><input type="text" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
        <Field label={t('suppliers.phone')} optional><input type="tel" className="ltr" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label={t('common.notes')} className="span2" optional><input type="text" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        {item.id && <label className="check"><input type="checkbox" checked={f.is_active} onChange={(e) => setF({ ...f, is_active: e.target.checked })} /> {t('common.active')}</label>}
      </div>
    </Dialog>
  );
}

type Line = { price_item_id: string; description: string; qty: string; unit_cost: string; batch_no: string; expires_at: string };
const emptyLine = (): Line => ({ price_item_id: '', description: '', qty: '1', unit_cost: '', batch_no: '', expires_at: '' });

/** New purchase (supplier picked here when opened from the list) or an existing one to correct or void. */
function PurchaseDialog({ supplierId, purchaseId, onClose }: { supplierId?: string; purchaseId?: string; onClose: () => void }) {
  const { t, fmt, toast, user, locale } = useApp();
  const suppliers = useQuery(() => listSuppliers(true));
  const items = useQuery(() => listPriceItems(true));
  const existing = useQuery(() => (purchaseId ? getPurchase(purchaseId) : undefined), [purchaseId]);
  const [f, setF] = useState(() => ({
    supplier_id: existing?.supplier_id ?? supplierId ?? suppliers[0]?.id ?? '',
    purchased_at: existing?.purchased_at ?? today(), reference: existing?.reference ?? '', notes: existing?.notes ?? '',
    lines: existing?.items.length
      ? existing.items.map((i) => ({ price_item_id: i.price_item_id ?? '', description: i.description, qty: String(i.qty), unit_cost: String(i.unit_cost / 100), batch_no: i.batch_no ?? '', expires_at: i.expires_at ?? '' }))
      : [emptyLine()],
    paid: '', method: 'CASH' as PaymentMethod,
  }));
  const [err, setErr] = useState<string | null>(null);
  const [confirmVoid, setConfirmVoid] = useState(false);
  const isVoid = existing?.status === 'VOID';
  const itemName = (id: string) => {
    const it = items.find((x) => x.id === id);
    return it ? (locale === 'ar' ? it.name_ar : it.name_en) : '';
  };
  const setLine = (i: number, v: Partial<Line>) => setF({ ...f, lines: f.lines.map((x, j) => (j === i ? { ...x, ...v } : x)) });
  const lineTotal = (l: Line) => Math.round((egp(l.qty) || 0) * (piastres(l.unit_cost) || 0));
  const total = f.lines.reduce((s, l) => s + lineTotal(l), 0);
  const save = () => {
    const input: PurchaseInput = {
      supplier_id: f.supplier_id, purchased_at: f.purchased_at, reference: f.reference, notes: f.notes,
      items: f.lines.map((l) => ({
        price_item_id: l.price_item_id || null, description: l.price_item_id ? itemName(l.price_item_id) : l.description, qty: egp(l.qty) || 0,
        unit_cost: piastres(l.unit_cost) || 0, batch_no: l.batch_no, expires_at: l.expires_at,
      })),
      paid_now: f.paid.trim() ? { amount: piastres(f.paid), method: f.method } : null,
    };
    try {
      savePurchase(input, user?.id ?? null, purchaseId);
      toast(t('app.saved'));
      onClose();
    } catch (e) {
      setErr(e instanceof Error && e.message === 'ITEMS_REQUIRED' ? t('suppliers.itemsRequired') : String(e));
    }
  };
  return (
    <Dialog
      title={purchaseId ? t('suppliers.purchase') : t('suppliers.newPurchase')}
      onClose={onClose}
      wide
      footer={<>
        {purchaseId && !isVoid && <button className="btn danger" style={{ marginInlineEnd: 'auto' }} onClick={() => setConfirmVoid(true)}>{t('suppliers.voidPurchase')}</button>}
        <b className="buy-total num" style={{ marginInlineEnd: 'auto' }}>{t('suppliers.total')}: {fmt.money(total)}</b>
        <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
        {!isVoid && <button className="btn primary" disabled={!f.supplier_id || !f.purchased_at} onClick={save}>{t('common.save')}</button>}
      </>}
    >
      <fieldset disabled={isVoid} style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="grid g3">
          <Field label={t('suppliers.name')}>
            <select value={f.supplier_id} onChange={(e) => setF({ ...f, supplier_id: e.target.value })} disabled={!!supplierId || !!purchaseId}>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label={t('common.date')}><input type="date" value={f.purchased_at} onChange={(e) => setF({ ...f, purchased_at: e.target.value })} /></Field>
          <Field label={t('suppliers.reference')} optional><input type="text" className="ltr" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
        </div>
        <p className="muted small" style={{ margin: '10px 0 0' }}>{t('suppliers.stockNote')}</p>
        {f.lines.map((l, i) => (
          <div className="repeat buy-line" key={i}>
            <Field label={t('suppliers.item')} group>
              <select value={l.price_item_id} onChange={(e) => setLine(i, { price_item_id: e.target.value })} aria-label={t('suppliers.item')}>
                <option value="">{t('suppliers.freeText')}</option>
                {items.map((it) => <option key={it.id} value={it.id}>{locale === 'ar' ? it.name_ar : it.name_en}{it.track_stock ? ' 📦' : ''}</option>)}
              </select>
              {!l.price_item_id && (
                <input type="text" style={{ marginTop: 4 }} value={l.description} placeholder={t('suppliers.description')} aria-label={t('suppliers.description')} onChange={(e) => setLine(i, { description: e.target.value })} />
              )}
            </Field>
            <Field label={t('suppliers.qty')}><input type="number" min="0" step="any" inputMode="decimal" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} /></Field>
            <Field label={t('suppliers.unitCost')}><input type="number" min="0" step="0.01" inputMode="decimal" value={l.unit_cost} onChange={(e) => setLine(i, { unit_cost: e.target.value })} /></Field>
            <Field label={t('suppliers.batch')} optional><input type="text" className="ltr" value={l.batch_no} onChange={(e) => setLine(i, { batch_no: e.target.value })} /></Field>
            <Field label={t('suppliers.expires')} optional><input type="date" value={l.expires_at} onChange={(e) => setLine(i, { expires_at: e.target.value })} /></Field>
            <Field label={t('suppliers.lineTotal')}><span className="num" style={{ lineHeight: '36px' }}>{fmt.money(lineTotal(l))}</span></Field>
            <button type="button" className="btn ghost sm" aria-label={t('common.remove')} disabled={f.lines.length < 2} onClick={() => setF({ ...f, lines: f.lines.filter((_, j) => j !== i) })}><Icon name="x" /></button>
          </div>
        ))}
        <button type="button" className="btn sm" style={{ marginTop: 8 }} onClick={() => setF({ ...f, lines: [...f.lines, emptyLine()] })}><Icon name="plus" /> {t('suppliers.addLine')}</button>
        <div className="grid g3" style={{ marginTop: 12 }}>
          {!purchaseId && (
            <>
              <Field label={t('suppliers.paidNow')} hint={t('suppliers.paidNowHint')} optional>
                <input type="number" min="0" step="0.01" inputMode="decimal" value={f.paid} onChange={(e) => setF({ ...f, paid: e.target.value })} />
              </Field>
              <Field label={t('suppliers.method')}>
                <select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value as PaymentMethod })}>
                  {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{t(`method.${m}`)}</option>)}
                </select>
              </Field>
            </>
          )}
          <Field label={t('common.notes')} optional><input type="text" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        </div>
      </fieldset>
      {err && <p className="note warn">{err}</p>}
      {confirmVoid && (
        <Confirm title={t('suppliers.voidPurchase')} body={t('suppliers.voidPurchaseConfirm')} danger onClose={() => setConfirmVoid(false)}
          onConfirm={() => { voidPurchase(purchaseId!); toast(t('app.saved')); onClose(); }} />
      )}
    </Dialog>
  );
}

function PaymentDialog({ supplierId, onClose }: { supplierId: string; onClose: () => void }) {
  const { t, fmt, toast, user } = useApp();
  const purchases = useQuery(() => supplierPurchases(supplierId).filter((p) => p.status === 'ACTIVE' && p.paid < p.total), [supplierId]);
  const owed = useQuery(() => supplierBalances().find((r) => r.id === supplierId)?.owed ?? 0, [supplierId]);
  const [f, setF] = useState({ amount: owed > 0 ? String(owed / 100) : '', paid_at: today(), method: 'CASH' as PaymentMethod, purchase_id: '', reference: '', note: '' });
  const amount = piastres(f.amount);
  const save = () => {
    saveSupplierPayment({ supplier_id: supplierId, purchase_id: f.purchase_id || null, paid_at: f.paid_at, amount, method: f.method, reference: f.reference, note: f.note }, user?.id ?? null);
    toast(t('app.saved'));
    onClose();
  };
  return (
    <Dialog
      title={t('suppliers.recordPayment')}
      onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>{t('common.cancel')}</button><button className="btn primary" disabled={!(amount > 0) || !f.paid_at} onClick={save}>{t('common.save')}</button></>}
    >
      <div className="grid g2">
        <Field label={t('suppliers.amount')}><input type="number" min="0" step="0.01" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} autoFocus /></Field>
        <Field label={t('common.date')}><input type="date" value={f.paid_at} onChange={(e) => setF({ ...f, paid_at: e.target.value })} /></Field>
        <Field label={t('suppliers.method')}>
          <select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value as PaymentMethod })}>
            {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{t(`method.${m}`)}</option>)}
          </select>
        </Field>
        <Field label={t('suppliers.forPurchase')} optional>
          <select value={f.purchase_id} onChange={(e) => {
            const p = purchases.find((x) => x.id === e.target.value);
            setF({ ...f, purchase_id: e.target.value, ...(p ? { amount: String((p.total - p.paid) / 100) } : {}) });
          }}>
            <option value="">{t('suppliers.anyPurchase')}</option>
            {purchases.map((p) => <option key={p.id} value={p.id}>{fmt.date(p.purchased_at)}{p.reference ? ` · ${p.reference}` : ''} · {fmt.money(p.total - p.paid)}</option>)}
          </select>
        </Field>
        <Field label={t('common.notes')} className="span2" optional><input type="text" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      </div>
    </Dialog>
  );
}
