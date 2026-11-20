// Settings → Lab extranet (change request, 20 Nov 2026): the Admin gives the lab's doctor an account for the lab
// extranet on the clinic server (<server>/lab, server/lab.mjs). A new account gets a temporary password, sent with the
// link by WhatsApp or email; the lab doctor chooses their own at the first sign-in. These accounts (role LAB, schema v24)
// can never sign in to the app.
import { useState } from 'react';
import { useApp, useQuery } from '../lib/app';
import { getSettings, listLabUsers, resetPassword, saveLabUser } from '../db/repo';
import { serverUrl } from '../sync/engine';
import { platform } from '../lib/platform';
import type { User } from '../db/types';
import { Dialog, Field, Icon } from './ui';
import { InviteDialog } from './Account';

export function LabAccountsTab() {
  const { t, fmt, locale } = useApp();
  const rows = useQuery(listLabUsers);
  const settings = useQuery(getSettings);
  const server = serverUrl();
  const link = server ? `${server.replace(/\/+$/, '')}/lab` : null;
  const [edit, setEdit] = useState<Partial<User> | null>(null);
  const [invite, setInvite] = useState<{ person: User | Pick<User, 'name' | 'email' | 'role' | 'roles' | 'lab_name'>; password: string } | null>(null);
  const clinic = locale === 'ar' ? settings.name_ar : settings.name_en;
  const message = (p: { name: string; email: string; lab_name?: string | null }, password: string) =>
    t('labAccounts.inviteText', { name: p.name, lab: p.lab_name || '—', clinic, link: link ?? '—', email: p.email, password });
  return (
    <>
      <p className="muted small" style={{ marginTop: 0 }}>{t('labAccounts.hint')}</p>
      {link ? (
        <p className="note" style={{ marginTop: 0 }}>
          🧪 {t('labAccounts.linkIs')} <a href={link} onClick={(e) => { e.preventDefault(); platform.openExternal(link); }} className="ltr">{link}</a>
        </p>
      ) : (
        <p className="note warn" style={{ marginTop: 0 }}>{t('labAccounts.notLinked')}</p>
      )}
      <div className="row end" style={{ marginBottom: 10 }}>
        <button className="btn primary" onClick={() => setEdit({ name: '', email: '', lab_name: '', locale: 'ar', is_active: 1 })}><Icon name="plus" /> {t('labAccounts.add')}</button>
      </div>
      <div className="tablewrap">
        <table className="t">
          <thead><tr><th>{t('labAccounts.name')}</th><th>{t('labAccounts.labName')}</th><th>{t('settings.email')}</th><th>{t('common.status')}</th><th className="hide-sm">{t('labAccounts.since')}</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={5} className="empty">{t('labAccounts.none')}</td></tr>}
            {rows.map((u) => (
              <tr key={u.id} className={`link ${u.is_active ? '' : 'greyed'}`} onClick={() => setEdit(u)}>
                <td><b>{u.name}</b></td><td>{u.lab_name || '—'}</td><td className="ltr">{u.email}</td>
                <td>{u.is_active ? t('common.active') : t('common.inactive')}{u.is_active && u.must_change_password ? <span className="muted small"> · {t('labAccounts.notSignedInYet')}</span> : null}</td>
                <td className="hide-sm">{fmt.date((u as User & { created_at?: string }).created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && (
        <LabAccountDialog
          item={edit}
          onClose={() => setEdit(null)}
          onInvite={(person, password) => { setEdit(null); setInvite({ person, password }); }}
        />
      )}
      {invite && (
        <InviteDialog person={{ ...invite.person, role: 'LAB', roles: null }} password={invite.password} message={message(invite.person, invite.password)} onClose={() => setInvite(null)} />
      )}
    </>
  );
}

function LabAccountDialog({ item, onClose, onInvite }: {
  item: Partial<User>; onClose: () => void; onInvite: (person: Pick<User, 'name' | 'email' | 'role' | 'roles' | 'lab_name'>, password: string) => void;
}) {
  const { t, toast } = useApp();
  const [f, setF] = useState({ name: item.name ?? '', lab_name: item.lab_name ?? '', email: item.email ?? '', locale: (item.locale ?? 'ar') as 'ar' | 'en', is_active: item.is_active !== 0 });
  const [err, setErr] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const save = () => {
    if (!f.name.trim() || !/^\S+@\S+\.\S+$/.test(f.email.trim())) return setErr(t('labAccounts.required'));
    try {
      const r = saveLabUser(f, item.id);
      toast(t('app.saved'));
      if (r.password) onInvite({ name: f.name.trim(), email: f.email.trim(), lab_name: f.lab_name.trim(), role: 'LAB', roles: null }, r.password);
      else onClose();
    } catch (e) {
      setErr((e as Error).message === 'EMAIL_TAKEN' ? t('labAccounts.emailTaken') : String(e));
    }
  };
  return (
    <Dialog
      title={item.id ? t('labAccounts.edit') : t('labAccounts.add')}
      onClose={onClose}
      footer={
        <>
          {item.id && item.is_active ? (
            confirmReset ? (
              <button className="btn danger" onClick={() => { const pw = resetPassword(item.id!); onInvite({ name: item.name!, email: item.email!, lab_name: item.lab_name ?? null, role: 'LAB', roles: null }, pw); }}>
                {t('labAccounts.resetConfirm')}
              </button>
            ) : (
              <button className="btn" onClick={() => setConfirmReset(true)}>{t('settings.resetPassword')}</button>
            )
          ) : null}
          <span className="spacer" />
          <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn primary" onClick={save}>{item.id ? t('common.save') : t('labAccounts.create')}</button>
        </>
      }
    >
      {err && <p className="note bad">{err}</p>}
      <div className="grid g2">
        <Field label={t('labAccounts.name')}><input type="text" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
        <Field label={t('labAccounts.labName')} optional><input type="text" value={f.lab_name} onChange={(e) => setF({ ...f, lab_name: e.target.value })} /></Field>
        <Field label={t('settings.email')} hint={t('labAccounts.emailHint')}><input type="email" className="ltr" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label={t('settings.locale')}>
          <select value={f.locale} onChange={(e) => setF({ ...f, locale: e.target.value as 'ar' | 'en' })}>
            <option value="ar">العربية</option>
            <option value="en">English</option>
          </select>
        </Field>
      </div>
      {item.id && (
        <label className="check" style={{ marginTop: 10 }}><input type="checkbox" checked={f.is_active} onChange={(e) => setF({ ...f, is_active: e.target.checked })} /> {t('labAccounts.active')}</label>
      )}
      {!item.id && <p className="faint small">{t('labAccounts.tempHint')}</p>}
    </Dialog>
  );
}
