// Settings → Drugs and Settings → Treatment templates (Admin; 6 Nov 2026 change requests).
// Drugs feed the dose calculator in the visit form; templates fill a visit's diagnosis, treatment and prescriptions.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp, useQuery } from '../lib/app';
import { listDrugs, listTemplates, saveDrug, saveTemplate, setDrugCount, templateRx, type DrugInput } from '../db/repo';
import { Badge, Dialog, Field, Icon } from '../components/ui';
import { DRUG_UNITS, SPECIES, type Drug, type DrugUnit, type TemplateRx, type TreatmentTemplate } from '../db/types';

const n = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')));

export function DrugsTab() {
  const { t, fmt } = useApp();
  const rows = useQuery(() => listDrugs());
  const [edit, setEdit] = useState<Partial<Drug> | null>(null);
  const [count, setCount] = useState<Drug | null>(null);
  return (
    <>
      <p className="note warn">{t('drugs.safety')}</p>
      <div className="row end" style={{ marginBottom: 10 }}>
        <button className="btn primary" onClick={() => setEdit({ name: '', unit: 'ml', is_active: 1 })}><Icon name="plus" /> {t('drugs.add')}</button>
      </div>
      <div className="tablewrap">
        <table className="t">
          <thead>
            <tr><th>{t('drugs.name')}</th><th className="r">{t('drugs.doseMgKg')}</th><th className="r">{t('drugs.concentration')}</th><th className="r">{t('drugs.maxMg')}</th><th>{t('drugs.species')}</th><th className="r">{t('drugs.inStock')}</th><th>{t('common.status')}</th></tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={7} className="muted">{t('drugs.empty')}</td></tr>}
            {rows.map((d) => (
              <tr key={d.id} className={`link ${d.is_active ? '' : 'greyed'}`} onClick={() => setEdit(d)}>
                <td><b>{d.name}</b>{d.frequency ? <span className="muted small"> · {d.frequency}</span> : null}</td>
                <td className="r num">{fmt.num(d.dose_mg_kg, 3)}</td>
                <td className="r num">{d.unit === 'mg' || !d.concentration ? '—' : t('drugs.per', { mg: fmt.num(d.concentration, 3), unit: t(`drugs.unit.${d.unit}`) })}</td>
                <td className="r num">{d.max_mg ? fmt.num(d.max_mg, 1) : '—'}</td>
                <td>{d.species ? d.species.split(',').map((s) => t(`species.${s}`)).join(', ') : t('drugs.allSpecies')}</td>
                <td className="r nowrap" onClick={(e) => e.stopPropagation()}>
                  {d.stock_qty != null ? <b className="num">{fmt.num(d.stock_qty, 2)}</b> : <span className="muted">—</span>}
                  {d.stock_qty != null && d.stock_unit ? <span className="muted small"> {d.stock_unit}</span> : null}
                  {d.stock_qty != null && d.is_active && d.stock_qty <= (d.low_stock ?? 0) ? <> <Badge kind={d.stock_qty <= 0 ? 'bad' : 'warn'}>{d.stock_qty <= 0 ? t('stock.out') : t('stock.low')}</Badge></> : null}
                  {' '}<button type="button" className="btn sm" onClick={() => setCount(d)}>{t('drugs.countBtn')}</button>
                </td>
                <td>{d.is_active ? t('common.active') : t('common.inactive')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && <DrugDialog item={edit} onClose={() => setEdit(null)} />}
      {count && <DrugCountDialog drug={count} onClose={() => setCount(null)} />}
    </>
  );
}

function DrugDialog({ item, onClose }: { item: Partial<Drug>; onClose: () => void }) {
  const { t, toast } = useApp();
  const [f, setF] = useState({
    name: item.name ?? '', dose: item.dose_mg_kg?.toString() ?? '', conc: item.concentration?.toString() ?? '', unit: (item.unit ?? 'ml') as DrugUnit,
    max: item.max_mg?.toString() ?? '', frequency: item.frequency ?? '', duration: item.duration_days?.toString() ?? '',
    species: new Set((item.species ?? '').split(',').filter(Boolean)), notes: item.notes ?? '', active: item.is_active !== 0,
    qty: item.stock_qty?.toString() ?? '', qtyUnit: item.stock_unit ?? '', low: item.low_stock?.toString() ?? '',
  });
  const dose = n(f.dose);
  const valid = !!f.name.trim() && dose != null && dose > 0 && (f.unit === 'mg' || (n(f.conc) ?? 0) > 0);
  const save = () => {
    const d: DrugInput = {
      name: f.name, dose_mg_kg: dose!, concentration: f.unit === 'mg' ? null : n(f.conc), unit: f.unit, max_mg: n(f.max),
      frequency: f.frequency, duration_days: n(f.duration), species: SPECIES.filter((s) => f.species.has(s)).join(',') || null,
      notes: f.notes, is_active: f.active ? 1 : 0, stock_qty: n(f.qty), stock_unit: f.qtyUnit, low_stock: n(f.low),
    };
    saveDrug(d, item.id);
    toast(t('app.saved'));
    onClose();
  };
  return (
    <Dialog
      title={t('drugs.title')}
      onClose={onClose}
      wide
      footer={<><button className="btn" onClick={onClose}>{t('common.cancel')}</button><button className="btn primary" disabled={!valid} onClick={save}>{t('common.save')}</button></>}
    >
      <div className="grid g2">
        <Field label={t('drugs.name')} className="span2" hint={t('drugs.nameHint')}>
          <input type="text" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus />
        </Field>
        <Field label={t('drugs.doseMgKg')}>
          <input type="number" step="any" min="0" inputMode="decimal" value={f.dose} onChange={(e) => setF({ ...f, dose: e.target.value })} />
        </Field>
        <Field label={t('drugs.form')}>
          <select value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value as DrugUnit })}>
            {DRUG_UNITS.map((u) => <option key={u} value={u}>{t(`drugs.formOf.${u}`)}</option>)}
          </select>
        </Field>
        {f.unit !== 'mg' && (
          <Field label={t('drugs.concentrationOf', { unit: t(`drugs.unit.${f.unit}`) })}>
            <input type="number" step="any" min="0" inputMode="decimal" value={f.conc} onChange={(e) => setF({ ...f, conc: e.target.value })} />
          </Field>
        )}
        <Field label={t('drugs.maxMg')} optional>
          <input type="number" step="any" min="0" inputMode="decimal" value={f.max} onChange={(e) => setF({ ...f, max: e.target.value })} />
        </Field>
        <Field label={t('visits.frequency')} optional>
          <input type="text" value={f.frequency} placeholder={t('drugs.frequencyPh')} onChange={(e) => setF({ ...f, frequency: e.target.value })} />
        </Field>
        <Field label={t('visits.durationDays')} optional>
          <input type="number" min="0" value={f.duration} onChange={(e) => setF({ ...f, duration: e.target.value })} />
        </Field>
        <Field label={t('drugs.species')} className="span2" hint={t('drugs.speciesHint')} group>
          <div className="row">
            {SPECIES.map((s) => (
              <label key={s} className="check">
                <input type="checkbox" checked={f.species.has(s)} onChange={(e) => { const x = new Set(f.species); if (e.target.checked) x.add(s); else x.delete(s); setF({ ...f, species: x }); }} /> {t(`species.${s}`)}
              </label>
            ))}
          </div>
        </Field>
        <Field label={t('common.notes')} className="span2" optional>
          <input type="text" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </Field>
        <Field label={t('drugs.howMany')} optional hint={t('drugs.howManyHint')}>
          <input type="number" step="any" min="0" inputMode="decimal" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} />
        </Field>
        <Field label={t('drugs.countUnit')} optional>
          <input type="text" list="drug-count-units" value={f.qtyUnit} placeholder={t('drugs.countUnitPh')} onChange={(e) => setF({ ...f, qtyUnit: e.target.value })} />
        </Field>
        <Field label={t('stock.lowAt')} optional hint={t('stock.lowHint')}>
          <input type="number" step="any" min="0" inputMode="decimal" value={f.low} onChange={(e) => setF({ ...f, low: e.target.value })} />
        </Field>
        <datalist id="drug-count-units">{(t('drugs.countUnits') as string).split(',').map((u) => <option key={u} value={u} />)}</datalist>
        <label className="check"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> {t('common.active')}</label>
      </div>
    </Dialog>
  );
}

/** Stock → Drugs → Count: write down how many are on the shelf now. */
function DrugCountDialog({ drug, onClose }: { drug: Drug; onClose: () => void }) {
  const { t, toast } = useApp();
  const [qty, setQty] = useState(drug.stock_qty?.toString() ?? '');
  const v = n(qty);
  return (
    <Dialog
      title={`${t('drugs.countBtn')} · ${drug.name}`}
      onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>{t('common.cancel')}</button>
        <button className="btn primary" disabled={v != null && (!Number.isFinite(v) || v < 0)} onClick={() => { setDrugCount(drug.id, v); toast(t('app.saved')); onClose(); }}>{t('common.save')}</button></>}
    >
      <Field label={t('drugs.howMany')} hint={drug.stock_unit ? t('drugs.inUnit', { unit: drug.stock_unit }) : t('drugs.howManyHint')}>
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <button type="button" className="btn" aria-label="−" onClick={() => setQty(String(Math.max(0, (n(qty) ?? 0) - 1)))}>−</button>
          <input type="number" step="any" min="0" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus style={{ textAlign: 'center' }} />
          <button type="button" className="btn" aria-label="+" onClick={() => setQty(String((n(qty) ?? 0) + 1))}>+</button>
        </div>
      </Field>
    </Dialog>
  );
}

export function TemplatesTab() {
  const { t } = useApp();
  const nav = useNavigate();
  const rows = useQuery(() => listTemplates());
  const [edit, setEdit] = useState<Partial<TreatmentTemplate> | null>(null);
  return (
    <>
      <p className="muted small">{t('templates.hint')}</p>
      <div className="row end" style={{ marginBottom: 10 }}>
        <button className="btn primary" onClick={() => setEdit({ name: '', is_active: 1 })}><Icon name="plus" /> {t('templates.add')}</button>
      </div>
      <div className="tablewrap">
        <table className="t">
          <thead><tr><th>{t('templates.name')}</th><th>{t('visits.diagnosis')}</th><th>{t('visits.prescriptions')}</th><th>{t('common.status')}</th><th /></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={5} className="muted">{t('templates.empty')}</td></tr>}
            {rows.map((tpl) => (
              <tr key={tpl.id} className={`link ${tpl.is_active ? '' : 'greyed'}`} onClick={() => setEdit(tpl)}>
                <td><b>{tpl.name}</b></td>
                <td>{tpl.diagnosis || '—'}</td>
                <td>{templateRx(tpl).map((r) => r.drug).join(', ') || '—'}</td>
                <td>{tpl.is_active ? t('common.active') : t('common.inactive')}</td>
                <td className="r" onClick={(e) => e.stopPropagation()}>
                  <button type="button" className="btn sm" onClick={() => nav(`/templates/${tpl.id}/print`)}><Icon name="print" /> {t('templates.print')}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && <TemplateDialog item={edit} onClose={() => setEdit(null)} />}
    </>
  );
}

const emptyRx: TemplateRx = { drug: '', dose: '', frequency: '', duration_days: '', instructions: '' };

export function TemplateDialog({ item, onClose }: { item: Partial<TreatmentTemplate>; onClose: () => void }) {
  const { t, toast, user } = useApp();
  const drugs = useQuery(() => listDrugs(true));
  const [f, setF] = useState({
    name: item.name ?? '', diagnosis: item.diagnosis ?? '', treatment_notes: item.treatment_notes ?? '', owner_note: item.owner_note ?? '',
    rx: item.id ? templateRx(item as TreatmentTemplate) : [] as TemplateRx[], active: item.is_active !== 0,
  });
  const setRx = (i: number, patch: Partial<TemplateRx>) => setF({ ...f, rx: f.rx.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const save = () => {
    saveTemplate({ name: f.name, diagnosis: f.diagnosis, treatment_notes: f.treatment_notes, owner_note: f.owner_note, prescriptions: f.rx, is_active: f.active ? 1 : 0 }, user?.id ?? null, item.id);
    toast(t('app.saved'));
    onClose();
  };
  return (
    <Dialog
      title={t('templates.title')}
      onClose={onClose}
      wide
      footer={<><button className="btn" onClick={onClose}>{t('common.cancel')}</button><button className="btn primary" disabled={!f.name.trim()} onClick={save}>{t('common.save')}</button></>}
    >
      <div className="grid g2">
        <Field label={t('templates.name')} className="span2"><input type="text" value={f.name} placeholder={t('templates.namePh')} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
        <Field label={t('visits.diagnosis')} className="span2" optional><input type="text" value={f.diagnosis} onChange={(e) => setF({ ...f, diagnosis: e.target.value })} /></Field>
        <Field label={t('visits.treatment')} className="span2" optional><textarea value={f.treatment_notes} onChange={(e) => setF({ ...f, treatment_notes: e.target.value })} /></Field>
        <Field label={t('templates.ownerNote')} className="span2" optional hint={t('templates.ownerNoteHint')}>
          <textarea rows={3} value={f.owner_note} placeholder={t('templates.ownerNotePh')} onChange={(e) => setF({ ...f, owner_note: e.target.value })} />
        </Field>
      </div>
      <div className="row" style={{ margin: '12px 0 4px' }}>
        <h3 className="spacer" style={{ margin: 0 }}>💊 {t('visits.prescriptions')}</h3>
        <button type="button" className="btn sm" onClick={() => setF({ ...f, rx: [...f.rx, { ...emptyRx }] })}><Icon name="plus" /> {t('visits.addPrescription')}</button>
      </div>
      <p className="muted small">{t('templates.doseHint')}</p>
      <datalist id="tpl-drug-list">{drugs.map((d) => <option key={d.id} value={d.name} />)}</datalist>
      {f.rx.map((r, i) => (
        <div className="repeat rx" key={i}>
          <Field label={t('visits.drug')}><input type="text" list="tpl-drug-list" value={r.drug} onChange={(e) => setRx(i, { drug: e.target.value })} /></Field>
          <Field label={t('visits.dose')} optional><input type="text" value={r.dose} onChange={(e) => setRx(i, { dose: e.target.value })} /></Field>
          <Field label={t('visits.frequency')} optional><input type="text" value={r.frequency} onChange={(e) => setRx(i, { frequency: e.target.value })} /></Field>
          <Field label={t('visits.durationDays')} optional><input type="number" min="0" value={r.duration_days} onChange={(e) => setRx(i, { duration_days: e.target.value })} /></Field>
          <Field label={t('visits.instructions')} optional><input type="text" value={r.instructions} onChange={(e) => setRx(i, { instructions: e.target.value })} /></Field>
          <button type="button" className="btn ghost sm" aria-label={t('common.remove')} onClick={() => setF({ ...f, rx: f.rx.filter((_, j) => j !== i) })}><Icon name="x" /></button>
        </div>
      ))}
      <label className="check" style={{ marginTop: 10 }}><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> {t('common.active')}</label>
    </Dialog>
  );
}
