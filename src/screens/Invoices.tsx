import { useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useApp, useQuery } from '../lib/app';
import {
  addPayment, getInvoice, getOwner, getPet, getSettings, getVisit, listInvoices, listPriceItems, ownerPets, saveInvoice, searchOwners, voidInvoice,
  type InvoiceInput,
} from '../db/repo';
import { fromLocalInput, nowLocalInput } from '../lib/dates';
import { platform } from '../lib/platform';
import { Confirm, Dialog, Field, Icon, StatusBadge, WaButton } from '../components/ui';
import { PageHead } from '../components/Layout';
import { PAYMENT_METHODS, type InvoiceStatus, type PaymentMethod } from '../db/types';

const toPt = (egp: string | number) => Math.round(Number(String(egp).replace(',', '.')) * 100) || 0;
const toEgp = (pt: number) => (pt / 100).toFixed(2).replace(/\.00$/, '');

export function InvoicesList() {
  const { t, fmt } = useApp();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const [q, setQ] = useState(sp.get('q') ?? '');
  const [status, setStatus] = useState<InvoiceStatus | 'OPEN' | 'ALL'>(sp.get('q') ? 'ALL' : 'OPEN');
  const rows = useQuery(() => listInvoices(q, status), [q, status]);
  const sum = rows.filter((r) => r.status !== 'VOID').reduce((s, r) => s + (r.total - r.paid), 0);
  return (
    <div className="page">
      <PageHead title={t('invoices.title')} sub={`${rows.length} · ${t('invoices.balance')} ${fmt.money(sum)}`}>
        <button className="btn primary" onClick={() => nav('/invoices/new')}><Icon name="plus" /> {t('invoices.new')}</button>
      </PageHead>
      <div className="row" style={{ marginBottom: 12 }}>
        <div className="searchbox" style={{ flex: 1, minWidth: 240 }}>
          <Icon name="search" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`${t('invoices.number')} / ${t('invoices.owner')} / ${t('invoices.pet')}`} />
        </div>
        <div className="seg">
          {(['OPEN', 'UNPAID', 'PARTIAL', 'PAID', 'VOID', 'ALL'] as const).map((s) => (
            <button key={s} className={status === s ? 'on' : ''} onClick={() => setStatus(s)}>
              {s === 'OPEN' ? t('invoices.filterOpen') : s === 'ALL' ? t('common.all') : t(`invoiceStatus.${s}`)}
            </button>
          ))}
        </div>
      </div>
      <div className="tablewrap">
        <table className="t">
          <thead>
            <tr>
              <th>{t('invoices.number')}</th>
              <th>{t('invoices.issued')}</th>
              <th>{t('invoices.owner')}</th>
              <th className="hide-sm">{t('invoices.pet')}</th>
              <th className="r">{t('invoices.total')}</th>
              <th className="r">{t('invoices.balance')}</th>
              <th>{t('common.status')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={7} className="empty">{t('invoices.empty')}</td></tr>}
            {rows.map((i) => (
              <tr key={i.id} className={`link ${i.status === 'VOID' ? 'greyed' : ''}`} onClick={() => nav(`/invoices/${i.id}`)}>
                <td className="ltr num"><b>{i.number}</b></td>
                <td>{fmt.date(i.issued_at)}</td>
                <td>{i.owner_name}</td>
                <td className="hide-sm">{i.pet_name ?? '—'}</td>
                <td className="r num">{fmt.money(i.total)}</td>
                <td className="r num">{i.status === 'VOID' ? '—' : fmt.money(i.total - i.paid)}</td>
                <td><StatusBadge ns="invoiceStatus" value={i.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface Line { price_item_id: string | null; description: string; qty: string; unit_price: string }

export function InvoiceFormPage() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const { t, fmt, locale, user, toast } = useApp();
  const nav = useNavigate();
  const prices = useQuery(() => listPriceItems(true));
  const existing = useMemo(() => (id ? getInvoice(id) : undefined), [id]);
  const visit = useMemo(() => {
    const v = sp.get('visit') ?? existing?.visit_id;
    return v ? getVisit(v) : undefined;
  }, [sp, existing]);
  const priceName = (p: { name_en: string; name_ar: string }) => (locale === 'ar' ? p.name_ar : p.name_en);

  const initialOwner = existing?.owner_id ?? sp.get('owner') ?? (visit ? getOwnerIdOfPet(visit.pet_id) : null);
  const [ownerId, setOwnerId] = useState<string | null>(initialOwner);
  const [petId, setPetId] = useState<string>(existing?.pet_id ?? visit?.pet_id ?? '');
  const [discount, setDiscount] = useState(existing ? toEgp(existing.discount) : '0');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [lines, setLines] = useState<Line[]>(() => {
    if (existing) return existing.items.map((i) => ({ price_item_id: i.price_item_id, description: i.description, qty: String(i.qty), unit_price: toEgp(i.unit_price) }));
    const consult = prices.find((p) => p.category === 'CONSULTATION');
    const out: Line[] = [];
    if (consult) out.push({ price_item_id: consult.id, description: priceName(consult), qty: '1', unit_price: toEgp(consult.unit_price) });
    if (visit?.vaccinations.length) {
      const vac = prices.find((p) => p.category === 'VACCINE');
      if (vac) out.push({ price_item_id: vac.id, description: `${priceName(vac)} — ${visit.vaccinations.map((v) => v.vaccine).join(', ')}`, qty: String(visit.vaccinations.length), unit_price: toEgp(vac.unit_price) });
    }
    visit?.prescriptions.forEach((r) => out.push({ price_item_id: null, description: r.drug, qty: '1', unit_price: '0' }));
    return out;
  });
  const [ownerQ, setOwnerQ] = useState('');
  const ownerHits = useQuery(() => (ownerQ.trim().length >= 2 ? searchOwners(ownerQ, 'ACTIVE').slice(0, 8) : []), [ownerQ]);
  const owner = useQuery(() => (ownerId ? getOwner(ownerId) : undefined), [ownerId]);
  const pets = useQuery(() => (ownerId ? ownerPets(ownerId) : []), [ownerId]);
  const [err, setErr] = useState<string | null>(null);

  const subtotal = lines.reduce((s, l) => s + Math.round((Number(l.qty) || 0) * toPt(l.unit_price)), 0);
  const total = Math.max(0, subtotal - toPt(discount));
  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ownerId) return setErr(t('invoices.pickOwner'));
    if (!lines.some((l) => l.description.trim())) return setErr(t('invoices.noItems'));
    const input: InvoiceInput = {
      owner_id: ownerId, pet_id: petId || null, visit_id: visit?.id ?? null, discount: toPt(discount), notes,
      items: lines.map((l) => ({ price_item_id: l.price_item_id, description: l.description, qty: Number(l.qty) || 0, unit_price: toPt(l.unit_price) })),
    };
    const savedId = saveInvoice(input, user?.id ?? null, id);
    toast(t('app.saved'));
    nav(`/invoices/${savedId}`, { replace: true });
  };

  return (
    <div className="page narrow">
      <PageHead title={id ? `${t('invoices.edit')} ${existing?.number ?? ''}` : t('invoices.new')} crumb={{ to: id ? `/invoices/${id}` : '/invoices', label: t('invoices.title') }}
        sub={visit ? `${t('invoices.visit')}: ${visit.pet_name} · ${fmt.date(visit.visited_at)} · ${t(`visitType.${visit.type}`)}` : t('invoices.standalone')} />
      <form onSubmit={submit}>
        {err && <p className="note bad">{err}</p>}
        <div className="grid g2">
          <Field label={t('invoices.owner')} group>
            {owner ? (
              <div className="chosen">
                <b style={{ flex: 1 }}>{owner.full_name}</b>
                <span className="ltr muted small">{owner.phone}</span>
                {!visit && !id && <button type="button" className="btn ghost sm" onClick={() => { setOwnerId(null); setPetId(''); }}>{t('common.edit')}</button>}
              </div>
            ) : (
              <>
                <input type="search" value={ownerQ} autoFocus onChange={(e) => setOwnerQ(e.target.value)} placeholder={t('dashboard.search')} />
                {ownerHits.length > 0 && (
                  <div className="picker">
                    {ownerHits.map((o) => (
                      <button type="button" key={o.id} onClick={() => { setOwnerId(o.id); setOwnerQ(''); setErr(null); }}>
                        <b style={{ flex: 1 }}>{o.full_name}</b> <span className="muted small">{o.pet_names}</span> <span className="ltr muted small">{o.phone}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </Field>
          <Field label={t('invoices.pet')} optional>
            <select value={petId} onChange={(e) => setPetId(e.target.value)} disabled={!ownerId || !!visit}>
              <option value="">—</option>
              {pets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
        </div>

        <div className="form-section">
          <div className="row" style={{ marginBottom: 8 }}>
            <h2 className="spacer">{t('invoices.items')}</h2>
            <select
              style={{ width: 'auto' }}
              value=""
              onChange={(e) => {
                const p = prices.find((x) => x.id === e.target.value);
                if (p) setLines((ls) => [...ls, { price_item_id: p.id, description: priceName(p), qty: '1', unit_price: toEgp(p.unit_price) }]);
              }}
            >
              <option value="">{t('invoices.fromPriceList')}</option>
              {prices.map((p) => <option key={p.id} value={p.id}>{priceName(p)} — {fmt.money(p.unit_price)}</option>)}
            </select>
            <button type="button" className="btn sm" onClick={() => setLines((ls) => [...ls, { price_item_id: null, description: '', qty: '1', unit_price: '0' }])}>
              <Icon name="plus" /> {t('invoices.addItem')}
            </button>
          </div>
          <div className="tablewrap">
            <table className="t">
              <thead>
                <tr>
                  <th>{t('invoices.description')}</th>
                  <th style={{ width: 80 }}>{t('invoices.qty')}</th>
                  <th style={{ width: 120 }}>{t('invoices.unitPrice')}</th>
                  <th className="r" style={{ width: 120 }}>{t('invoices.lineTotal')}</th>
                  <th style={{ width: 40 }} />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td><input type="text" value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} /></td>
                    <td><input type="number" min="0" step="0.5" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} /></td>
                    <td><input type="number" min="0" step="0.01" value={l.unit_price} onChange={(e) => setLine(i, { unit_price: e.target.value })} /></td>
                    <td className="r num">{fmt.money(Math.round((Number(l.qty) || 0) * toPt(l.unit_price)))}</td>
                    <td><button type="button" className="btn ghost sm" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label={t('common.remove')}><Icon name="x" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="totals">
            <div><span>{t('invoices.subtotal')}</span><span>{fmt.money(subtotal)}</span></div>
            <div>
              <span>{t('invoices.discount')}</span>
              <input type="number" min="0" step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} style={{ width: 110, minHeight: 30, padding: '2px 8px' }} />
            </div>
            <div className="big"><span>{t('invoices.total')}</span><span>{fmt.money(total)}</span></div>
          </div>
        </div>
        <Field label={t('common.notes')} optional>
          <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <div className="actionbar">
          <button type="button" className="btn" onClick={() => nav(-1)}>{t('common.cancel')}</button>
          <button className="btn primary">{t('common.save')}</button>
        </div>
      </form>
    </div>
  );
}

function getOwnerIdOfPet(petId: string) {
  return getPet(petId)?.owner_id ?? null;
}

export function InvoiceDetail() {
  const { id = '' } = useParams();
  const { t, fmt, isVet, user, toast, locale } = useApp();
  const nav = useNavigate();
  const inv = useQuery(() => getInvoice(id), [id]);
  const settings = useQuery(getSettings);
  const [pay, setPay] = useState(false);
  const [confirmVoid, setConfirmVoid] = useState(false);
  if (!inv) return <div className="page">{t('common.notFound')}</div>;
  const balance = inv.total - inv.paid;
  const clinic = locale === 'ar' ? settings.name_ar : settings.name_en;
  return (
    <div className="page narrow">
      <PageHead title={inv.number} crumb={{ to: '/invoices', label: t('invoices.title') }} sub={`${fmt.dateTime(inv.issued_at)} · ${inv.owner_name}${inv.pet_name ? ` · ${inv.pet_name}` : ''}`}>
        <StatusBadge ns="invoiceStatus" value={inv.status} />
        {inv.status !== 'VOID' && <button className="btn" onClick={() => nav(`/invoices/${id}/edit`)}><Icon name="edit" /> {t('common.edit')}</button>}
        <button className="btn" onClick={() => nav(`/invoices/${id}/print`)}><Icon name="print" /> {t('invoices.printReceipt')}</button>
      </PageHead>
      <div className="row" style={{ marginBottom: 10 }}>
        <a href={`#/owners/${inv.owner_id}`}>{inv.owner_name}</a>
        {inv.pet_id && <>· <a href={`#/pets/${inv.pet_id}`}>{inv.pet_name}</a></>}
      </div>
      <table className="t">
        <thead><tr><th>{t('invoices.description')}</th><th className="r">{t('invoices.qty')}</th><th className="r">{t('invoices.unitPrice')}</th><th className="r">{t('invoices.lineTotal')}</th></tr></thead>
        <tbody>
          {inv.items.map((i) => (
            <tr key={i.id}><td>{i.description}</td><td className="r num">{fmt.num(i.qty, 2)}</td><td className="r num">{fmt.money(i.unit_price)}</td><td className="r num">{fmt.money(i.line_total)}</td></tr>
          ))}
        </tbody>
      </table>
      <div className="totals">
        <div><span>{t('invoices.subtotal')}</span><span>{fmt.money(inv.subtotal)}</span></div>
        {inv.discount > 0 && <div><span>{t('invoices.discount')}</span><span>− {fmt.money(inv.discount)}</span></div>}
        <div className="big"><span>{t('invoices.total')}</span><span>{fmt.money(inv.total)}</span></div>
        <div><span>{t('invoices.paid')}</span><span>{fmt.money(inv.paid)}</span></div>
        <div className="big" style={{ color: balance > 0 && inv.status !== 'VOID' ? 'var(--bad)' : undefined }}><span>{t('invoices.balance')}</span><span>{inv.status === 'VOID' ? '—' : fmt.money(balance)}</span></div>
      </div>
      {inv.notes && <p className="note">{inv.notes}</p>}

      <section className="section">
        <header>
          <h2>{t('invoices.payments')}</h2>
          <div className="row">
            {balance > 0 && inv.status !== 'VOID' && (
              <>
                <WaButton small label={t('invoices.remindBalance')} phone={inv.owner_whatsapp || inv.owner_phone} text={t('wa.balance', { owner: inv.owner_name, clinic, number: inv.number, amount: fmt.money(balance) })} />
                <button className="btn sm primary" onClick={() => setPay(true)}><Icon name="plus" /> {t('invoices.addPayment')}</button>
              </>
            )}
          </div>
        </header>
        <ul className="list">
          {inv.payments.length === 0 && <li className="empty">{t('invoices.noPayments')}</li>}
          {inv.payments.map((p) => (
            <li key={p.id}>
              <div className="main-col">
                <b>{t(`method.${p.method}`)}</b>
                <div className="sub">{fmt.dateTime(p.paid_at)}{p.received_by_name ? ` · ${p.received_by_name}` : ''}{p.reference ? ` · ${p.reference}` : ''}</div>
              </div>
              <span className="num">{fmt.money(p.amount)}</span>
            </li>
          ))}
        </ul>
      </section>

      {isVet && inv.status !== 'VOID' && (
        <div style={{ marginTop: 28 }}><button className="btn danger sm" onClick={() => setConfirmVoid(true)}>{t('invoices.void')}</button></div>
      )}
      {confirmVoid && <Confirm title={t('invoices.void')} body={t('invoices.voidConfirm')} danger onClose={() => setConfirmVoid(false)} onConfirm={() => { voidInvoice(id); toast(t('app.saved')); }} />}
      {pay && <PaymentDialog balance={balance} onClose={() => setPay(false)} onSave={(p) => { addPayment(id, p, user?.id ?? null); toast(t('app.saved')); setPay(false); }} />}
    </div>
  );
}

function PaymentDialog({ balance, onClose, onSave }: { balance: number; onClose: () => void; onSave: (p: { amount: number; method: PaymentMethod; paid_at: string; reference: string }) => void }) {
  const { t } = useApp();
  const [amount, setAmount] = useState(toEgp(balance));
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [paidAt, setPaidAt] = useState(nowLocalInput());
  const [reference, setReference] = useState('');
  const pt = toPt(amount);
  return (
    <Dialog
      title={t('invoices.addPayment')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn primary" disabled={pt <= 0} onClick={() => onSave({ amount: pt, method, paid_at: fromLocalInput(paidAt), reference })}>{t('common.save')}</button>
        </>
      }
    >
      <div className="grid g2">
        <Field label={`${t('invoices.amount')} (EGP)`}><input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus /></Field>
        <Field label={t('invoices.method')} group>
          <div className="seg" style={{ flexWrap: 'wrap' }}>
            {PAYMENT_METHODS.map((m) => <button type="button" key={m} className={method === m ? 'on' : ''} onClick={() => setMethod(m)}>{t(`method.${m}`)}</button>)}
          </div>
        </Field>
        <Field label={t('common.date')}><input type="datetime-local" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} /></Field>
        <Field label={t('invoices.reference')} optional><input type="text" className="ltr" value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}

/** A5 receipt (print CSS). */
export function InvoicePrint() {
  const { id = '' } = useParams();
  const { t, fmt, locale } = useApp();
  const nav = useNavigate();
  const inv = useQuery(() => getInvoice(id), [id]);
  const s = useQuery(getSettings);
  if (!inv) return null;
  return (
    <div className="page">
      <div className="row no-print" style={{ marginBottom: 14 }}>
        <button className="btn" onClick={() => nav(-1)}>{t('app.back')}</button>
        <button className="btn primary" onClick={() => platform.print()}><Icon name="print" /> {t('common.print')}</button>
      </div>
      <div className="sheet-wrap">
        <div className="sheet a5">
          <div className="head">
            <div>
              <b style={{ fontSize: 15 }}>{locale === 'ar' ? s.name_ar : s.name_en}</b>
              <div style={{ fontSize: 10 }}>{s.address}</div>
              {(s.phone || s.whatsapp) && <div style={{ fontSize: 10 }} className="ltr">{[...new Set([s.phone, s.whatsapp].filter(Boolean))].join(' · ')}</div>}
            </div>
            {s.logo_url && <img src={s.logo_url} alt="" />}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 8 }}>
            <div>
              <b>{t('invoices.receipt')} <span className="ltr">{inv.number}</span></b>
              <div>{fmt.dateTime(inv.issued_at)}</div>
            </div>
            <div style={{ textAlign: 'end' }}>
              <div>{inv.owner_name}</div>
              <div className="ltr">{inv.owner_phone}</div>
              {inv.pet_name && <div>{t('invoices.pet')}: {inv.pet_name}</div>}
            </div>
          </div>
          <table>
            <thead><tr><th>{t('invoices.description')}</th><th className="r">{t('invoices.qty')}</th><th className="r">{t('invoices.unitPrice')}</th><th className="r">{t('invoices.lineTotal')}</th></tr></thead>
            <tbody>
              {inv.items.map((i) => (
                <tr key={i.id}><td>{i.description}</td><td className="r">{fmt.num(i.qty, 2)}</td><td className="r">{fmt.money(i.unit_price)}</td><td className="r">{fmt.money(i.line_total)}</td></tr>
              ))}
              <tr><td colSpan={3} className="r">{t('invoices.subtotal')}</td><td className="r">{fmt.money(inv.subtotal)}</td></tr>
              {inv.discount > 0 && <tr><td colSpan={3} className="r">{t('invoices.discount')}</td><td className="r">− {fmt.money(inv.discount)}</td></tr>}
              <tr><td colSpan={3} className="r"><b>{t('invoices.total')}</b></td><td className="r"><b>{fmt.money(inv.total)}</b></td></tr>
              {inv.payments.map((p) => (
                <tr key={p.id}><td colSpan={3} className="r">{t('invoices.paid')} · {t(`method.${p.method}`)} · {fmt.date(p.paid_at)}</td><td className="r">{fmt.money(p.amount)}</td></tr>
              ))}
              <tr><td colSpan={3} className="r"><b>{t('invoices.balance')}</b></td><td className="r"><b>{fmt.money(Math.max(0, inv.total - inv.paid))}</b></td></tr>
            </tbody>
          </table>
          <div style={{ marginTop: 8, fontSize: 11 }}><b>{t(`invoiceStatus.${inv.status}`)}</b></div>
          {s.receipt_footer && <div className="foot">{s.receipt_footer}</div>}
        </div>
      </div>
    </div>
  );
}
