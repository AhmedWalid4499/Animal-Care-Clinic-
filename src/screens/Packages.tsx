// Prepaid packages (16 Nov 2026, change request): the owner pays up front for a set of sessions — e.g. a puppy package
// of 3 vaccines + deworming — and each session used is ticked off. The Admin keeps the package list (Invoices & prices →
// Packages); anyone at the desk sells one from the pet's record (an invoice for the price is made, the payment is taken
// on it as usual) and records a session used, from the pet's record or on the visit form. Data: package_types,
// pet_packages, package_uses (schema v22, src/db/schema.ts).
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp, useQuery } from '../lib/app';
import {
  cancelPetPackage, getPet, listPackageTypes, listVaccineTypes, packageItems, packageTypesFor, petPackages, savePackageType, sellPackage,
  usePackageSession, voidPackageUse, type PackageTypeInput, type PetPackageRow,
} from '../db/repo';
import { SPECIES, type PackageType } from '../db/types';
import { today } from '../lib/dates';
import { Badge, Confirm, Dialog, Field, Icon } from '../components/ui';
import { PageHead } from '../components/Layout';
import { PricingTabs } from '../components/Sections';

const errText = (t: (k: string) => string, e: unknown) => {
  const m = e instanceof Error ? e.message : '';
  return m === 'PACKAGE_NONE_LEFT' ? t('packages.noneLeft') : m === 'PACKAGE_NOT_USABLE' ? t('packages.notUsable')
    : m === 'NAME_REQUIRED' ? t('packages.nameRequired') : m === 'ITEMS_REQUIRED' ? t('packages.itemsRequired') : m;
};

// ---------------------------------------------------------------- the package list (Admin)
export function PackagesPage() {
  const { t, fmt } = useApp();
  const rows = useQuery(() => listPackageTypes());
  const [edit, setEdit] = useState<Partial<PackageType> | null>(null);
  return (
    <div className="page">
      <PricingTabs />
      <PageHead title={t('packages.title')} sub={t('packages.sub')}>
        <button className="btn primary" onClick={() => setEdit({ name: '', price: 0, is_active: 1, items: '[]' })}><Icon name="plus" /> {t('packages.add')}</button>
      </PageHead>
      {rows.length === 0 ? <p className="note">{t('packages.none')}</p> : (
        <div className="tablewrap">
          <table className="t packages">
            <thead><tr><th>{t('packages.name')}</th><th>{t('packages.lines')}</th><th>{t('packages.forSpecies')}</th><th>{t('packages.validDays')}</th><th className="r">{t('packages.price')}</th><th>{t('common.status')}</th></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className={`link ${p.is_active ? '' : 'greyed'}`} onClick={() => setEdit(p)}>
                  <td><b>{p.name}</b></td>
                  <td>{packageItems(p.items).map((i) => `${i.qty} × ${i.label}`).join(' · ')}</td>
                  <td>{p.species ? p.species.split(',').map((s) => t(`species.${s}`)).join(', ') : t('packages.anySpecies')}</td>
                  <td className="num">{p.valid_days ?? '—'}</td>
                  <td className="r num"><b>{fmt.money(p.price)}</b></td>
                  <td>{p.is_active ? t('common.active') : t('common.inactive')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {edit && <PackageTypeDialog item={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function PackageTypeDialog({ item, onClose }: { item: Partial<PackageType>; onClose: () => void }) {
  const { t, toast } = useApp();
  const vaccines = useQuery(() => listVaccineTypes(true));
  const [f, setF] = useState({
    name: item.name ?? '', price: item.price != null ? String(item.price / 100) : '', valid_days: item.valid_days != null ? String(item.valid_days) : '',
    notes: item.notes ?? '', is_active: item.is_active !== 0, species: (item.species ?? '').split(',').filter(Boolean),
    items: (() => {
      const list = packageItems(item.items).map((i) => ({ key: i.key, label: i.label, qty: String(i.qty), vaccine_type_id: i.vaccine_type_id ?? '' }));
      return list.length ? list : [{ key: '', label: '', qty: '1', vaccine_type_id: '' }];
    })(),
  });
  const [err, setErr] = useState<string | null>(null);
  const setLine = (i: number, v: Partial<(typeof f.items)[number]>) => setF({ ...f, items: f.items.map((x, j) => (j === i ? { ...x, ...v } : x)) });
  const save = () => {
    const input: PackageTypeInput = {
      name: f.name, species: f.species.join(','), price: Math.round(Number(f.price.replace(',', '.')) * 100) || 0,
      valid_days: f.valid_days.trim() ? Number(f.valid_days) : null, notes: f.notes, is_active: f.is_active,
      items: f.items.map((i) => ({ key: i.key || undefined, label: i.label, qty: Number(i.qty) || 0, vaccine_type_id: i.vaccine_type_id || null })),
    };
    try {
      savePackageType(input, item.id);
      toast(t('app.saved'));
      onClose();
    } catch (e) {
      setErr(errText(t, e));
    }
  };
  return (
    <Dialog
      title={item.id ? t('packages.edit') : t('packages.add')}
      onClose={onClose}
      wide
      footer={<><button className="btn" onClick={onClose}>{t('common.cancel')}</button><button className="btn primary" disabled={!f.name.trim()} onClick={save}>{t('common.save')}</button></>}
    >
      <div className="grid g3">
        <Field label={t('packages.name')} className="span2"><input type="text" value={f.name} placeholder={t('packages.namePh')} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
        <Field label={t('packages.price')}><input type="number" min="0" step="0.01" inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></Field>
        <Field label={t('packages.validDays')} hint={t('packages.validHint')} optional><input type="number" min="1" inputMode="numeric" value={f.valid_days} onChange={(e) => setF({ ...f, valid_days: e.target.value })} /></Field>
        <Field label={t('packages.forSpecies')} className="span2" group optional>
          <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
            {SPECIES.map((s) => (
              <label key={s} className="check">
                <input type="checkbox" checked={f.species.includes(s)} onChange={(e) => setF({ ...f, species: e.target.checked ? [...f.species, s] : f.species.filter((x) => x !== s) })} /> {t(`species.${s}`)}
              </label>
            ))}
          </div>
        </Field>
      </div>
      <h3 style={{ margin: '14px 0 6px' }}>{t('packages.lines')}</h3>
      {f.items.map((it, i) => (
        <div className="repeat pkg-line" key={i}>
          <Field label={t('packages.line')}><input type="text" value={it.label} placeholder={t('packages.linePh')} onChange={(e) => setLine(i, { label: e.target.value })} /></Field>
          <Field label={t('packages.qty')}><input type="number" min="1" inputMode="numeric" value={it.qty} onChange={(e) => setLine(i, { qty: e.target.value })} /></Field>
          <Field label={t('packages.vaccine')} optional>
            <select value={it.vaccine_type_id} onChange={(e) => {
              const v = vaccines.find((x) => x.id === e.target.value);
              setLine(i, { vaccine_type_id: e.target.value, ...(v && !it.label.trim() ? { label: v.name } : {}) });
            }}>
              <option value="">{t('packages.noVaccine')}</option>
              {vaccines.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </Field>
          <button type="button" className="btn ghost sm" aria-label={t('common.remove')} disabled={f.items.length < 2} onClick={() => setF({ ...f, items: f.items.filter((_, j) => j !== i) })}><Icon name="x" /></button>
        </div>
      ))}
      <button type="button" className="btn sm" onClick={() => setF({ ...f, items: [...f.items, { key: '', label: '', qty: '1', vaccine_type_id: '' }] })}><Icon name="plus" /> {t('packages.addLine')}</button>
      <div className="grid g2" style={{ marginTop: 12 }}>
        <Field label={t('common.notes')} optional><input type="text" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        <label className="check" style={{ alignSelf: 'end' }}><input type="checkbox" checked={f.is_active} onChange={(e) => setF({ ...f, is_active: e.target.checked })} /> {t('common.active')}</label>
      </div>
      {err && <p className="note warn">{err}</p>}
    </Dialog>
  );
}

// ---------------------------------------------------------------- on the pet's record
/** The pet's packages: what is left, Use 1, sell a new one. Nothing at all when there is nothing to show or sell. */
export function PetPackagesPanel({ petId }: { petId: string }) {
  const { t, fmt, isAdmin, canVisit, toast, user } = useApp();
  const nav = useNavigate();
  const pet = useQuery(() => getPet(petId), [petId]);
  const pkgs = useQuery(() => petPackages(petId), [petId]);
  const types = useQuery(() => (pet ? packageTypesFor(pet.species) : []), [pet?.species]);
  const [sell, setSell] = useState(false);
  const [open, setOpen] = useState<PetPackageRow | null>(null);
  const [showOld, setShowOld] = useState(false);
  if (!pet) return null;
  const current = pkgs.filter((p) => p.status === 'ACTIVE' && !p.expired && !p.done);
  const old = pkgs.filter((p) => !current.includes(p));
  const canSell = pet.status === 'ACTIVE' && types.length > 0;
  if (!pkgs.length && !canSell) return null;
  const use = (p: PetPackageRow, key: string) => {
    try {
      usePackageSession(p.id, key, user?.id ?? null);
      toast(t('packages.used'));
    } catch (e) {
      toast(errText(t, e));
    }
  };
  const shown = showOld ? pkgs : current;
  return (
    <section className="section pet-packages">
      <header>
        <h2>📦 {t('packages.petTitle')}</h2>
        {current.length > 0 && <span className="count">{current.length}</span>}
        <span className="spacer" />
        {canSell && <button type="button" className="btn sm" onClick={() => setSell(true)}><Icon name="plus" /> {t('packages.sell')}</button>}
      </header>
      <ul className="list">
        {shown.map((p) => (
          <li key={p.id} className={p === open ? 'on' : current.includes(p) ? '' : 'done'}>
            <div className="main-col">
              <div className="row" style={{ gap: 8 }}>
                <button type="button" className="linkbtn" onClick={() => setOpen(p)}><b>{p.name}</b></button>
                {p.status === 'CANCELLED' ? <Badge kind="bad">{t('packages.cancelled')}</Badge>
                  : p.done ? <Badge>{t('packages.allUsed')}</Badge>
                    : p.expired ? <Badge kind="warn">{t('packages.expired', { date: fmt.date(p.expires_at!) })}</Badge>
                      : p.expires_at ? <span className="muted small">{t('packages.expires', { date: fmt.date(p.expires_at) })}</span> : null}
                {p.invoice_id && p.invoice_status !== 'PAID' && p.invoice_status !== 'VOID' && (
                  <button type="button" className="linkbtn small" onClick={() => nav(`/invoices/${p.invoice_id}`)}><Badge kind="warn">{t('packages.unpaid')}</Badge></button>
                )}
              </div>
              <div className="pkg-lines">
                {p.lines.map((l) => (
                  <span key={l.key} className="pkg-line-chip">
                    {l.label}: <b className="num">{t('packages.leftOf', { left: l.left, qty: l.qty })}</b>
                    {current.includes(p) && l.left > 0 && (
                      <button type="button" className="btn sm" onClick={() => use(p, l.key)}>{t('packages.use')}</button>
                    )}
                  </span>
                ))}
              </div>
            </div>
          </li>
        ))}
        {!shown.length && <li className="empty">{t('packages.noCurrent')}</li>}
      </ul>
      {old.length > 0 && !showOld && <button type="button" className="linkbtn small" onClick={() => setShowOld(true)}>{t('packages.showOld', { n: old.length })}</button>}
      {sell && <SellDialog petId={petId} onClose={() => setSell(false)} />}
      {open && <PackageDialog pkg={pkgs.find((p) => p.id === open.id) ?? open} canUndo={canVisit} canCancel={isAdmin} onClose={() => setOpen(null)} />}
    </section>
  );
}

function SellDialog({ petId, onClose }: { petId: string; onClose: () => void }) {
  const { t, fmt, toast, user } = useApp();
  const nav = useNavigate();
  const pet = useQuery(() => getPet(petId), [petId]);
  const types = useQuery(() => (pet ? packageTypesFor(pet.species) : []), [pet?.species]);
  const [typeId, setTypeId] = useState(types[0]?.id ?? '');
  const [start, setStart] = useState(today());
  const type = types.find((x) => x.id === typeId);
  if (!pet) return null;
  const save = () => {
    const r = sellPackage(petId, typeId, start, user?.id ?? null);
    toast(t('packages.sold'));
    onClose();
    nav(`/invoices/${r.invoiceId}`);
  };
  return (
    <Dialog
      title={t('packages.sellTitle', { pet: pet.name })}
      onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>{t('common.cancel')}</button><button className="btn primary" disabled={!type || !start} onClick={save}><Icon name="receipt" /> {t('packages.sell')}</button></>}
    >
      <div className="grid g2">
        <Field label={t('packages.name')}>
          <select value={typeId} onChange={(e) => setTypeId(e.target.value)} autoFocus>
            {types.map((p) => <option key={p.id} value={p.id}>{p.name} — {fmt.money(p.price)}</option>)}
          </select>
        </Field>
        <Field label={t('packages.start')}><input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
      </div>
      {type && (
        <ul className="plain small">
          {packageItems(type.items).map((i) => <li key={i.key}>{i.qty} × {i.label}</li>)}
          {type.valid_days ? <li className="muted">{t('packages.validDays')}: {type.valid_days}</li> : null}
        </ul>
      )}
      <p className="muted small">{t('packages.sellHint', { owner: pet.owner_name })}</p>
    </Dialog>
  );
}

function PackageDialog({ pkg, canUndo, canCancel, onClose }: { pkg: PetPackageRow; canUndo: boolean; canCancel: boolean; onClose: () => void }) {
  const { t, fmt, toast } = useApp();
  const nav = useNavigate();
  const [undo, setUndo] = useState<string | null>(null);
  const [cancel, setCancel] = useState(false);
  return (
    <Dialog
      title={pkg.name}
      onClose={onClose}
      wide
      footer={<>
        {canCancel && pkg.status === 'ACTIVE' && <button className="btn danger" style={{ marginInlineEnd: 'auto' }} onClick={() => setCancel(true)}>{t('packages.cancel')}</button>}
        {pkg.invoice_id && <button className="btn" onClick={() => nav(`/invoices/${pkg.invoice_id}`)}><Icon name="receipt" /> {t('packages.invoice', { number: pkg.invoice_number ?? '' })}</button>}
        <button className="btn" onClick={onClose}>{t('common.close')}</button>
      </>}
    >
      <p className="muted small">
        {fmt.date(pkg.started_at)}{pkg.expires_at ? ` → ${fmt.date(pkg.expires_at)}` : ''} · {fmt.money(pkg.price)}
        {pkg.status === 'CANCELLED' ? ` · ${t('packages.cancelled')}` : ''}{pkg.notes ? ` · ${pkg.notes}` : ''}
      </p>
      <table className="t compact">
        <tbody>
          {pkg.lines.map((l) => <tr key={l.key}><td>{l.label}</td><td className="r num"><b>{t('packages.leftOf', { left: l.left, qty: l.qty })}</b></td></tr>)}
        </tbody>
      </table>
      <h3 style={{ margin: '14px 0 6px' }}>{t('packages.history')}</h3>
      <table className="t compact">
        <tbody>
          {pkg.uses.length === 0 && <tr><td className="muted">{t('packages.noUses')}</td></tr>}
          {pkg.uses.map((u) => (
            <tr key={u.id} className={u.status === 'VOID' ? 'greyed' : ''}>
              <td>{fmt.dateTime(u.used_at)}</td>
              <td>{u.label}{u.status === 'VOID' ? ` · ${t('suppliers.voided')}` : ''}</td>
              <td className="muted">{u.user_name ?? '—'}</td>
              <td className="r">{canUndo && u.status === 'ACTIVE' && <button type="button" className="btn sm ghost" onClick={() => setUndo(u.id)}>{t('packages.undo')}</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {undo && <Confirm title={t('packages.undo')} body={t('packages.undoConfirm')} onClose={() => setUndo(null)} onConfirm={() => { voidPackageUse(undo); toast(t('packages.undone')); setUndo(null); }} />}
      {cancel && <Confirm title={t('packages.cancel')} body={t('packages.cancelConfirm')} danger onClose={() => setCancel(false)} onConfirm={() => { cancelPetPackage(pkg.id, pkg.notes ?? ''); toast(t('app.saved')); setCancel(false); onClose(); }} />}
    </Dialog>
  );
}

// ---------------------------------------------------------------- on the visit form
export type PackagePick = { pet_package_id: string; item_key: string };
/**
 * Visit form: the pet's usable packages, one tick per line with sessions left. Ticked lines are recorded as used when
 * the visit is saved (VisitInput.package_uses). An edited visit shows what it already used.
 */
export function VisitPackagesSection({ petId, value, onChange, usedHere }: {
  petId: string; value: PackagePick[]; onChange: (v: PackagePick[]) => void; usedHere: { id: string; name: string; label: string }[];
}) {
  const { t } = useApp();
  const pkgs = useQuery(() => petPackages(petId).filter((p) => p.status === 'ACTIVE' && !p.expired && p.left > 0), [petId]);
  if (!pkgs.length && !usedHere.length) return null;
  const on = (p: string, k: string) => value.some((v) => v.pet_package_id === p && v.item_key === k);
  const toggle = (p: string, k: string, yes: boolean) => onChange(yes ? [...value, { pet_package_id: p, item_key: k }] : value.filter((v) => !(v.pet_package_id === p && v.item_key === k)));
  return (
    <div className="form-section visit-packages">
      <h2>📦 {t('packages.visitSection')}</h2>
      <p className="muted small" style={{ marginTop: 0 }}>{t('packages.visitHint')}</p>
      {usedHere.map((u) => <p key={u.id} className="small" style={{ margin: '2px 0' }}>✓ {u.name}: {u.label} <span className="muted">· {t('packages.usedHere')}</span></p>)}
      {pkgs.map((p) => (
        <div key={p.id} className="row" style={{ flexWrap: 'wrap', gap: 14, margin: '6px 0' }}>
          <b>{p.name}</b>
          {p.lines.filter((l) => l.left > 0).map((l) => (
            <label key={l.key} className="check">
              <input type="checkbox" checked={on(p.id, l.key)} onChange={(e) => toggle(p.id, l.key, e.target.checked)} /> {l.label} <span className="muted small">({t('packages.left', { n: l.left })})</span>
            </label>
          ))}
        </div>
      ))}
    </div>
  );
}
