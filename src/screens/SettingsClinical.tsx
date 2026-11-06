// Settings → Drugs and Settings → Treatment templates (Admin; 6 Nov 2026 change requests).
// Drugs feed the dose calculator in the visit form; templates fill a visit's diagnosis, treatment and prescriptions.
import { useState } from 'react';
import { useApp, useQuery } from '../lib/app';
import { listDrugs, listTemplates, saveDrug, saveTemplate, templateRx, type DrugInput } from '../db/repo';
import { Dialog, Field, Icon } from '../components/ui';
import { DRUG_UNITS, SPECIES, type Drug, type DrugUnit, type TemplateRx, type TreatmentTemplate } from '../db/types';

const n = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')));

export function DrugsTab() {
  const { t, fmt } = useApp();
  const rows = useQuery(() => listDrugs());
  const [edit, setEdit] = useState<Partial<Drug> | null>(null);
  return (
    <>
      <p className="note warn">{t('drugs.safety')}</p>
      <div className="row end" style={{ marginBottom: 10 }}>
        <button className="btn primary" onClick={() => setEdit({ name: '', unit: 'ml', is_active: 1 })}><Icon name="plus" /> {t('drugs.add')}</button>
      </div>
      <div className="tablewrap">
        <table className="t">
          <thead>
            <tr><th>{t('drugs.name')}</th><th className="r">{t('drugs.doseMgKg')}</th><th className="r">{t('drugs.concentration')}</th><th className="r">{t('drugs.maxMg')}</th><th>{t('drugs.species')}</th><th>{t('common.status')}</th></tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} className="muted">{t('drugs.empty')}</td></tr>}
            {rows.map((d) => (
              <tr key={d.id} className={`link ${d.is_active ? '' : 'greyed'}`} onClick={() => setEdit(d)}>
                <td><b>{d.name}</b>{d.frequency ? <span className="muted small"> · {d.frequency}</span> : null}</td>
                <td className="r num">{fmt.num(d.dose_mg_kg, 3)}</td>
                <td className="r num">{d.unit === 'mg' || !d.concentration ? '—' : t('drugs.per', { mg: fmt.num(d.concentration, 3), unit: t(`drugs.unit.${d.unit}`) })}</td>
                <td className="r num">{d.max_mg ? fmt.num(d.max_mg, 1) : '—'}</td>
                <td>{d.species ? d.species.split(',').map((s) => t(`species.${s}`)).join(', ') : t('drugs.allSpecies')}</td>
                <td>{d.is_active ? t('common.active') : t('common.inactive')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && <DrugDialog item={edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function DrugDialog({ item, onClose }: { item: Partial<Drug>; onClose: () => void }) {
  const { t, toast } = useApp();
  const [f, setF] = useState({
    name: item.name ?? '', dose: item.dose_mg_kg?.toString() ?? '', conc: item.concentration?.toString() ?? '', unit: (item.unit ?? 'ml') as DrugUnit,
    max: item.max_mg?.toString() ?? '', frequency: item.frequency ?? '', duration: item.duration_days?.toString() ?? '',
    species: new Set((item.species ?? '').split(',').filter(Boolean)), notes: item.notes ?? '', active: item.is_active !== 0,
  });
  const dose = n(f.dose);
  const valid = !!f.name.trim() && dose != null && dose > 0 && (f.unit === 'mg' || (n(f.conc) ?? 0) > 0);
  const save = () => {
    const d: DrugInput = {
      name: f.name, dose_mg_kg: dose!, concentration: f.unit === 'mg' ? null : n(f.conc), unit: f.unit, max_mg: n(f.max),
      frequency: f.frequency, duration_days: n(f.duration), species: SPECIES.filter((s) => f.species.has(s)).join(',') || null,
      notes: f.notes, is_active: f.active ? 1 : 0,
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
        <label className="check"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> {t('common.active')}</label>
      </div>
    </Dialog>
  );
}

export function TemplatesTab() {
  const { t } = useApp();
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
          <thead><tr><th>{t('templates.name')}</th><th>{t('visits.diagnosis')}</th><th>{t('visits.prescriptions')}</th><th>{t('common.status')}</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={4} className="muted">{t('templates.empty')}</td></tr>}
            {rows.map((tpl) => (
              <tr key={tpl.id} className={`link ${tpl.is_active ? '' : 'greyed'}`} onClick={() => setEdit(tpl)}>
                <td><b>{tpl.name}</b></td>
                <td>{tpl.diagnosis || '—'}</td>
                <td>{templateRx(tpl).map((r) => r.drug).join(', ') || '—'}</td>
                <td>{tpl.is_active ? t('common.active') : t('common.inactive')}</td>
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
    name: item.name ?? '', diagnosis: item.diagnosis ?? '', treatment_notes: item.treatment_notes ?? '',
    rx: item.id ? templateRx(item as TreatmentTemplate) : [] as TemplateRx[], active: item.is_active !== 0,
  });
  const setRx = (i: number, patch: Partial<TemplateRx>) => setF({ ...f, rx: f.rx.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const save = () => {
    saveTemplate({ name: f.name, diagnosis: f.diagnosis, treatment_notes: f.treatment_notes, prescriptions: f.rx, is_active: f.active ? 1 : 0 }, user?.id ?? null, item.id);
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
