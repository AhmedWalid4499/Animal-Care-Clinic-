import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { strToU8, zipSync } from 'fflate';
import { useApp, useQuery } from '../lib/app';
import {
  getSettings, importOwnersPets, listPriceItems, listUsers, listVaccineTypes, resetPassword, savePriceItem, saveSettings, saveUser, saveVaccineType,
  tableRows, tempPassword, type ImportRow,
} from '../db/repo';
import { exportBytes, restoreFrom } from '../db/core';
import { EXPORT_TABLES } from '../db/schema';
import { isDesktop, platform } from '../lib/platform';
import { today } from '../lib/dates';
import { Confirm, Dialog, Field, Icon, imageToDataUrl } from '../components/ui';
import { PageHead } from '../components/Layout';
import { SyncPanel } from '../components/SyncBadge';
import { ServerBackupPanel } from '../components/ServerBackup';
import { UpdatesSection } from '../components/Updates';
import { InviteDialog } from '../components/Account';
import { DevicesTab } from '../components/Devices';
import { serverUrl } from '../sync/engine';
import { DrugsTab, TemplatesTab } from './SettingsClinical';
import { ActivityTab } from './Activity';
import { PRICE_CATEGORIES, ROLES, SPECIES, type ClinicSettings, type PriceItem, type Role, type User, type VaccineType } from '../db/types';

type Tab = 'clinic' | 'prices' | 'vaccines' | 'drugs' | 'templates' | 'users' | 'devices' | 'activity' | 'data';

export function Settings() {
  const { t } = useApp();
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get('tab') as Tab) || 'clinic';
  return (
    <div className="page">
      <PageHead title={t('settings.title')} />
      <div className="tabs" style={{ marginTop: -18, marginBottom: 18 }}>
        {(['clinic', 'prices', 'vaccines', 'drugs', 'templates', 'users', ...(serverUrl() ? ['devices'] : []), 'activity', 'data'] as Tab[]).map((k) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setSp({ tab: k }, { replace: true })}>{t(`settings.${k}`)}</button>
        ))}
      </div>
      <div key={tab} className="tab-enter">
        {tab === 'clinic' && <ClinicTab />}
        {tab === 'prices' && <PricesTab />}
        {tab === 'vaccines' && <VaccinesTab />}
        {tab === 'drugs' && <DrugsTab />}
        {tab === 'templates' && <TemplatesTab />}
        {tab === 'users' && <UsersTab />}
        {tab === 'devices' && <DevicesTab />}
        {tab === 'activity' && <ActivityTab />}
        {tab === 'data' && <DataTab />}
      </div>
    </div>
  );
}

function ClinicTab() {
  const { t, toast } = useApp();
  const s = useQuery(getSettings);
  const [f, setF] = useState<ClinicSettings>(s);
  const set = <K extends keyof ClinicSettings>(k: K, v: ClinicSettings[K]) => setF({ ...f, [k]: v });
  return (
    <form
      style={{ maxWidth: 720 }}
      onSubmit={(e) => {
        e.preventDefault();
        saveSettings({ name_en: f.name_en, name_ar: f.name_ar, logo_url: f.logo_url, phone: f.phone, whatsapp: f.whatsapp, address: f.address, receipt_footer: f.receipt_footer, locale_default: f.locale_default });
        toast(t('app.saved'));
      }}
    >
      <div className="row" style={{ gap: 16, marginBottom: 18 }}>
        <div className="avatar">{f.logo_url ? <img src={f.logo_url} alt="" style={{ objectFit: 'contain' }} /> : '🐾'}</div>
        <label className="btn">
          {t('settings.chooseLogo')}
          <input type="file" accept="image/*" hidden onChange={async (e) => { const file = e.target.files?.[0]; if (file) set('logo_url', await imageToDataUrl(file, 400)); }} />
        </label>
        {f.logo_url && <button type="button" className="btn ghost" onClick={() => set('logo_url', null)}>{t('settings.removeLogo')}</button>}
      </div>
      <div className="grid g2">
        <Field label={t('settings.nameEn')}><input type="text" value={f.name_en} onChange={(e) => set('name_en', e.target.value)} required /></Field>
        <Field label={t('settings.nameAr')}><input type="text" value={f.name_ar} onChange={(e) => set('name_ar', e.target.value)} required dir="rtl" /></Field>
        <Field label={t('settings.phone')}><input type="tel" className="ltr" value={f.phone ?? ''} onChange={(e) => set('phone', e.target.value)} /></Field>
        <Field label={t('settings.whatsapp')}><input type="tel" className="ltr" value={f.whatsapp ?? ''} onChange={(e) => set('whatsapp', e.target.value)} /></Field>
        <Field label={t('settings.address')} className="span2"><input type="text" value={f.address ?? ''} onChange={(e) => set('address', e.target.value)} /></Field>
        <Field label={t('settings.receiptFooter')} className="span2"><input type="text" value={f.receipt_footer ?? ''} onChange={(e) => set('receipt_footer', e.target.value)} /></Field>
        <Field label={t('settings.defaultLocale')}>
          <select value={f.locale_default} onChange={(e) => set('locale_default', e.target.value as 'ar' | 'en')}>
            <option value="ar">العربية</option>
            <option value="en">English</option>
          </select>
        </Field>
      </div>
      <div className="actionbar"><button className="btn primary">{t('common.save')}</button></div>
    </form>
  );
}

function PricesTab() {
  const { t, fmt } = useApp();
  const nav = useNavigate();
  const rows = useQuery(() => listPriceItems());
  const [edit, setEdit] = useState<Partial<PriceItem> | null>(null);
  return (
    <>
      <div className="row end" style={{ marginBottom: 10 }}>
        <button className="btn" onClick={() => nav('/stock')}><Icon name="box" /> {t('stock.title')}</button>
        <button className="btn primary" onClick={() => setEdit({ name_en: '', name_ar: '', category: 'OTHER', unit_price: 0, is_active: 1, track_stock: 0, low_stock: null })}><Icon name="plus" /> {t('settings.addPrice')}</button>
      </div>
      <div className="tablewrap">
      <table className="t">
        <thead><tr><th>{t('settings.nameEnCol')}</th><th>{t('settings.nameArCol')}</th><th>{t('settings.category')}</th><th className="r">{t('settings.price')}</th><th>{t('common.status')}</th></tr></thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id} className={`link ${p.is_active ? '' : 'greyed'}`} onClick={() => setEdit(p)}>
              <td>{p.name_en}</td><td dir="rtl">{p.name_ar}</td><td>{t(`priceCategory.${p.category}`)}</td><td className="r num">{fmt.money(p.unit_price)}</td>
              <td>{p.is_active ? t('common.active') : t('common.inactive')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      {edit && <PriceDialog item={edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function PriceDialog({ item, onClose }: { item: Partial<PriceItem>; onClose: () => void }) {
  const { t, toast } = useApp();
  const [f, setF] = useState({ ...item, price: String((item.unit_price ?? 0) / 100), low: item.low_stock?.toString() ?? '' });
  return (
    <Dialog
      title={t('settings.prices')}
      onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>{t('common.cancel')}</button>
        <button className="btn primary" disabled={!f.name_en || !f.name_ar} onClick={() => {
          savePriceItem({
            name_en: f.name_en!, name_ar: f.name_ar!, category: f.category!, unit_price: Math.round(Number(f.price) * 100) || 0, is_active: f.is_active ? 1 : 0,
            track_stock: f.track_stock ? 1 : 0, low_stock: f.low.trim() === '' ? null : Number(f.low.replace(',', '.')),
          }, item.id);
          toast(t('app.saved')); onClose();
        }}>{t('common.save')}</button></>}
    >
      <div className="grid g2">
        <Field label={t('settings.nameEnCol')}><input type="text" value={f.name_en} onChange={(e) => setF({ ...f, name_en: e.target.value })} autoFocus /></Field>
        <Field label={t('settings.nameArCol')}><input type="text" dir="rtl" value={f.name_ar} onChange={(e) => setF({ ...f, name_ar: e.target.value })} /></Field>
        <Field label={t('settings.category')}>
          <select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as PriceItem['category'] })}>
            {PRICE_CATEGORIES.map((c) => <option key={c} value={c}>{t(`priceCategory.${c}`)}</option>)}
          </select>
        </Field>
        <Field label={t('settings.price')}><input type="number" min="0" step="0.01" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></Field>
        <label className="check"><input type="checkbox" checked={!!f.is_active} onChange={(e) => setF({ ...f, is_active: e.target.checked ? 1 : 0 })} /> {t('common.active')}</label>
        <label className="check"><input type="checkbox" checked={!!f.track_stock} onChange={(e) => setF({ ...f, track_stock: e.target.checked ? 1 : 0 })} /> {t('stock.track')}</label>
        {!!f.track_stock && (
          <Field label={t('stock.lowAt')} hint={t('stock.lowHint')}>
            <input type="number" min="0" step="any" value={f.low} onChange={(e) => setF({ ...f, low: e.target.value })} />
          </Field>
        )}
      </div>
    </Dialog>
  );
}

function VaccinesTab() {
  const { t } = useApp();
  const rows = useQuery(() => listVaccineTypes());
  const [edit, setEdit] = useState<Partial<VaccineType> | null>(null);
  return (
    <>
      <div className="row end" style={{ marginBottom: 10 }}>
        <button className="btn primary" onClick={() => setEdit({ name: '', species: 'DOG,CAT', interval_days: 365, is_active: 1 })}><Icon name="plus" /> {t('settings.addVaccine')}</button>
      </div>
      <div className="tablewrap">
      <table className="t">
        <thead><tr><th>{t('settings.vaccineName')}</th><th>{t('settings.species')}</th><th className="r">{t('settings.interval')}</th><th>{t('common.status')}</th></tr></thead>
        <tbody>
          {rows.map((v) => (
            <tr key={v.id} className={`link ${v.is_active ? '' : 'greyed'}`} onClick={() => setEdit(v)}>
              <td><b>{v.name}</b></td><td>{v.species.split(',').map((s) => t(`species.${s}`)).join('، ')}</td><td className="r num">{v.interval_days}</td>
              <td>{v.is_active ? t('common.active') : t('common.inactive')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      {edit && <VaccineDialog item={edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function VaccineDialog({ item, onClose }: { item: Partial<VaccineType>; onClose: () => void }) {
  const { t, toast } = useApp();
  const [f, setF] = useState(item);
  const sel = new Set((f.species ?? '').split(',').filter(Boolean));
  return (
    <Dialog
      title={t('settings.vaccines')}
      onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>{t('common.cancel')}</button>
        <button className="btn primary" disabled={!f.name || !sel.size || !f.interval_days} onClick={() => {
          saveVaccineType({ name: f.name!, species: [...sel].join(','), interval_days: Number(f.interval_days), is_active: f.is_active ? 1 : 0 }, item.id);
          toast(t('app.saved')); onClose();
        }}>{t('common.save')}</button></>}
    >
      <div className="grid g2">
        <Field label={t('settings.vaccineName')}><input type="text" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
        <Field label={t('settings.interval')}><input type="number" min="1" value={f.interval_days} onChange={(e) => setF({ ...f, interval_days: Number(e.target.value) })} /></Field>
        <div className="field span2">
          <span>{t('settings.species')}</span>
          <div className="row">
            {SPECIES.map((s) => (
              <label key={s} className="check">
                <input type="checkbox" checked={sel.has(s)} onChange={(e) => { e.target.checked ? sel.add(s) : sel.delete(s); setF({ ...f, species: [...sel].join(',') }); }} /> {t(`species.${s}`)}
              </label>
            ))}
          </div>
        </div>
        <label className="check"><input type="checkbox" checked={!!f.is_active} onChange={(e) => setF({ ...f, is_active: e.target.checked ? 1 : 0 })} /> {t('common.active')}</label>
      </div>
    </Dialog>
  );
}

function UsersTab() {
  const { t } = useApp();
  const rows = useQuery(listUsers);
  const [edit, setEdit] = useState<Partial<User> | null>(null);
  const [invite, setInvite] = useState<{ person: Pick<User, 'name' | 'email' | 'role'>; password: string } | null>(null);
  return (
    <>
      <p className="muted small" style={{ marginTop: 0 }}>{t('settings.roleHint')}</p>
      <div className="row end" style={{ marginBottom: 10 }}>
        <button className="btn primary" onClick={() => setEdit({ name: '', email: '', role: 'ASSISTANT', locale: 'ar', is_active: 1 })}><Icon name="plus" /> {t('settings.addUser')}</button>
      </div>
      <div className="tablewrap">
      <table className="t">
        <thead><tr><th>{t('settings.userName')}</th><th>{t('settings.email')}</th><th>{t('settings.role')}</th><th>{t('settings.locale')}</th><th>{t('common.status')}</th></tr></thead>
        <tbody>
          {rows.map((u) => (
            <tr key={u.id} className={`link ${u.is_active ? '' : 'greyed'}`} onClick={() => setEdit(u)}>
              <td><b>{u.name}</b></td><td className="ltr">{u.email}</td><td>{t(`roles.${u.role}`)}</td><td>{u.locale === 'ar' ? 'العربية' : 'English'}</td>
              <td>{u.is_active ? t('common.active') : t('common.inactive')}{u.is_active && u.must_change_password ? <span className="muted small"> · {t('settings.mustChange')}</span> : null}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      {edit && <UserDialog item={edit} onClose={() => setEdit(null)} onInvite={(person, password) => { setEdit(null); setInvite({ person, password }); }} />}
      {invite && <InviteDialog person={invite.person} password={invite.password} onClose={() => setInvite(null)} />}
    </>
  );
}

function UserDialog({ item, onClose, onInvite }: { item: Partial<User>; onClose: () => void; onInvite: (person: Pick<User, 'name' | 'email' | 'role'>, password: string) => void }) {
  const { t, toast } = useApp();
  // A new person gets a temporary password (shown, so it can be sent); they choose their own at first sign-in.
  const [f, setF] = useState({ ...item, password: item.id ? '' : tempPassword() });
  const [err, setErr] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  return (
    <Dialog
      title={t('settings.users')}
      onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>{t('common.cancel')}</button>
        <button className="btn primary" disabled={!f.name || !f.email} onClick={() => {
          try {
            saveUser({ name: f.name!, email: f.email!, role: f.role as Role, locale: f.locale as 'ar' | 'en', is_active: !!f.is_active, password: f.password || undefined }, item.id);
            toast(t('app.saved'));
            if (f.password) onInvite({ name: f.name!, email: f.email!, role: f.role as Role }, f.password);
            else onClose();
          } catch (e) {
            const m = String((e as Error).message);
            setErr(m.includes('ONE_ADMIN') ? t('settings.oneVet') : m.includes('PASSWORD') ? t('settings.passwordRequired') : m.includes('UNIQUE') ? `${t('settings.email')} ✗` : m);
          }
        }}>{t('common.save')}</button></>}
    >
      {err && <p className="note bad">{err}</p>}
      <div className="grid g2">
        <Field label={t('settings.userName')}><input type="text" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
        <Field label={t('settings.email')}><input type="email" className="ltr" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label={t('settings.role')}>
          <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>
            {ROLES.map((r) => <option key={r} value={r}>{t(`roles.${r}`)}</option>)}
          </select>
        </Field>
        <Field label={t('settings.locale')}>
          <select value={f.locale} onChange={(e) => setF({ ...f, locale: e.target.value as 'ar' | 'en' })}>
            <option value="ar">العربية</option><option value="en">English</option>
          </select>
        </Field>
        {item.id ? (
          <div className="span2 row">
            <button type="button" className="btn" onClick={() => setConfirmReset(true)}>{t('settings.resetPassword')}</button>
            {!!item.must_change_password && <span className="muted small">{t('settings.mustChange')}</span>}
          </div>
        ) : (
          <Field label={t('settings.tempPassword')} hint={t('settings.mustChange')} className="span2">
            <input type="text" name="temp-password" className="ltr" value={f.password} minLength={8} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="off" spellCheck={false} />
          </Field>
        )}
        <label className="check"><input type="checkbox" checked={!!f.is_active} onChange={(e) => setF({ ...f, is_active: e.target.checked ? 1 : 0 })} /> {t('common.active')}</label>
      </div>
      {confirmReset && item.id && (
        <Confirm
          title={t('settings.resetPassword')}
          body={t('settings.resetConfirm', { name: item.name ?? '' })}
          confirmLabel={t('settings.resetPassword')}
          danger
          onClose={() => setConfirmReset(false)}
          onConfirm={() => {
            const pw = resetPassword(item.id!);
            onInvite({ name: item.name!, email: item.email!, role: item.role as Role }, pw);
          }}
        />
      )}
    </Dialog>
  );
}

const MONEY_COLS: Record<string, string[]> = {
  price_items: ['unit_price'], invoices: ['subtotal', 'discount', 'total'], invoice_items: ['unit_price', 'line_total'], payments: ['amount'],
};
function exportRows(table: string) {
  return tableRows(table).map((r) => {
    const o: Record<string, unknown> = { ...r };
    for (const c of MONEY_COLS[table] ?? []) o[c] = Number(o[c] ?? 0) / 100;
    if (table === 'users') o.password_hash = '(hidden)';
    for (const [k, v] of Object.entries(o)) if (typeof v === 'string' && v.startsWith('data:')) o[k] = '(image)';
    return o;
  });
}

function DataTab() {
  const { t, toast } = useApp();
  const [cfg, setCfg] = useState<{ backupDir: string; dataDir: string } | null>(null);
  const [restore, setRestore] = useState<Uint8Array | null>(null);
  const [result, setResult] = useState<string | null>(null);
  useEffect(() => {
    platform.config().then((c) => setCfg(c));
  }, []);
  const stamp = today();

  const [saved, setSaved] = useState<string | null>(null);
  const done = (path: string) => {
    setSaved(path);
    toast(t('settings.exported'));
  };

  const exportXlsx = async () => {
    const wb = XLSX.utils.book_new();
    for (const table of EXPORT_TABLES) {
      const rows = exportRows(table);
      XLSX.utils.book_append_sheet(wb, rows.length ? XLSX.utils.json_to_sheet(rows) : XLSX.utils.aoa_to_sheet([['(empty)']]), table.slice(0, 31));
    }
    const bytes = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
    done(await platform.exportFile(`clinic-export-${stamp}.xlsx`, bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'));
  };
  const exportCsv = async () => {
    // One .zip with one UTF-8 CSV per table (BOM so Excel opens Arabic correctly).
    const files: Record<string, Uint8Array> = {};
    for (const table of EXPORT_TABLES) {
      const rows = exportRows(table);
      const csv = rows.length ? XLSX.utils.sheet_to_csv(XLSX.utils.json_to_sheet(rows)) : '';
      files[`${table}.csv`] = strToU8(`\uFEFF${csv}`);
    }
    done(await platform.exportFile(`clinic-export-${stamp}-csv.zip`, zipSync(files), 'application/zip'));
  };
  const backup = async () => {
    done(await platform.exportFile(`clinic-backup-${stamp}.sqlite`, exportBytes(), 'application/x-sqlite3'));
  };
  const pickRestore = async () => {
    const f = await platform.pickFile([{ name: 'SQLite backup', extensions: ['sqlite'] }]);
    if (f) setRestore(f.bytes);
  };
  const template = async () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['owner_full_name', 'owner_phone', 'owner_whatsapp', 'owner_email', 'owner_address', 'owner_notes', 'pet_name', 'species', 'breed', 'sex', 'is_neutered', 'date_of_birth', 'dob_is_estimate', 'color', 'microchip_no', 'pet_notes'],
      ['Mona Hassan', '01012345678', '', 'mona@example.com', 'Heliopolis', '', 'Luna', 'CAT', 'Persian', 'FEMALE', 'yes', '2022-05-14', 'no', 'White', '', ''],
      ['Mona Hassan', '01012345678', '', '', '', '', 'Max', 'DOG', 'Golden Retriever', 'MALE', 'no', '2020-01-01', 'yes', 'Golden', '', ''],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'owners-pets');
    const bytes = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
    done(await platform.exportFile('owners-pets-TEMPLATE.xlsx', bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'));
  };
  const doImport = async () => {
    const f = await platform.pickFile([{ name: 'Excel / CSV', extensions: ['xlsx', 'xls', 'csv'] }]);
    if (!f) return;
    const wb = XLSX.read(f.bytes, { type: 'array' });
    const rows = XLSX.utils.sheet_to_json<ImportRow>(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: true });
    const r = importOwnersPets(rows);
    setResult(`${t('settings.importResult', { owners: r.owners, pets: r.pets, skipped: r.skipped.length })}${r.skipped.length ? `\n${r.skipped.map((s) => `#${s.row}: ${s.reason}`).join('\n')}` : ''}`);
  };

  return (
    <div style={{ maxWidth: 760 }}>
      <SyncPanel />
      <ServerBackupPanel />
      <div className="form-section">
        <h2>{t('settings.export')}</h2>
        <p className="muted small">{t('settings.exportHint')}</p>
        <div className="row">
          <button className="btn primary" onClick={exportXlsx}>⬇ {t('settings.export')}</button>
          <button className="btn" onClick={exportCsv}>{t('settings.exportCsv')}</button>
        </div>
        {saved && isDesktop && (
          <p className="note row" style={{ marginTop: 12 }}>
            <span className="spacer ltr" style={{ wordBreak: 'break-all' }}>{t('settings.savedTo', { path: saved })}</span>
            <button className="btn sm" onClick={() => platform.showItem(saved)}>{t('settings.showInFolder')}</button>
          </p>
        )}
      </div>
      <div className="form-section">
        <h2>{t('settings.backup')}</h2>
        <p className="muted small">
          {t('settings.backupHint')} {isDesktop && cfg && <code className="ltr">{cfg.backupDir}</code>}
        </p>
        <div className="row">
          <button className="btn" onClick={backup}>💾 {t('settings.backup')}</button>
          <button className="btn danger" onClick={pickRestore}>{t('settings.restore')}</button>
          {isDesktop && <button className="btn ghost" onClick={() => platform.showDataFolder()}>{t('settings.openFolder')}</button>}
        </div>
      </div>
      <div className="form-section">
        <h2>{t('settings.import')}</h2>
        <p className="muted small">{t('settings.importHint')}</p>
        <div className="row">
          <button className="btn" onClick={template}>{t('settings.template')}</button>
          <button className="btn primary" onClick={doImport}>⬆ {t('settings.import')}</button>
        </div>
        {result && <pre className="note" style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{result}</pre>}
      </div>
      {isDesktop && <UpdatesSection />}
      {restore && (
        <Confirm
          title={t('settings.restore')}
          body={t('settings.restoreConfirm')}
          danger
          onClose={() => setRestore(null)}
          onConfirm={async () => {
            try {
              await restoreFrom(restore);
              toast(t('settings.restored'));
            } catch (e) {
              toast(String((e as Error).message));
            }
          }}
        />
      )}
    </div>
  );
}
