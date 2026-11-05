// Accounts (Phase 5, docs/CLOUD-PLAN.md): choosing your own password after the Admin gave you a temporary one,
// and the Admin sending someone their sign-in details by WhatsApp or email.
import { useState } from 'react';
import bcrypt from 'bcryptjs';
import { useApp, useQuery } from '../lib/app';
import { changeOwnPassword, getSettings } from '../db/repo';
import { flush } from '../db/core';
import { serverUrl, signOutSync } from '../sync/engine';
import { platform } from '../lib/platform';
import type { User } from '../db/types';
import { Dialog, Field, Icon } from './ui';

const DOWNLOAD_URL = 'https://github.com/AhmedWalid4499/Animal-Care-Clinic-/releases/latest';
const MIN_LENGTH = 8;

function PasswordFields({ user, onSaved, submitLabel }: { user: User; onSaved: (u: User) => void; submitLabel: string }) {
  const { t } = useApp();
  const [pw, setPw] = useState('');
  const [again, setAgain] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.length < MIN_LENGTH) return setErr(t('password.tooShort'));
    if (pw !== again) return setErr(t('password.mismatch'));
    if (user.must_change_password && bcrypt.compareSync(pw, user.password_hash)) return setErr(t('password.sameAsTemp'));
    const u = changeOwnPassword(user.id, pw);
    void flush();
    onSaved(u);
  };
  return (
    <form onSubmit={submit} className="password-form">
      <Field label={t('password.new')} hint={t('password.rule')}>
        <input type="password" className="ltr" value={pw} minLength={MIN_LENGTH} autoComplete="new-password" autoFocus onChange={(e) => { setPw(e.target.value); setErr(null); }} required />
      </Field>
      <Field label={t('password.repeat')} error={err}>
        <input type="password" className="ltr" value={again} autoComplete="new-password" onChange={(e) => { setAgain(e.target.value); setErr(null); }} required />
      </Field>
      <button className="btn primary">{submitLabel}</button>
    </form>
  );
}

/** Shown instead of the app until someone with a temporary password chooses their own. */
export function ForcedPasswordChange() {
  const { t, user, setUser, toast } = useApp();
  if (!user) return null;
  return (
    <div className="login">
      <div className="pane" style={{ gridColumn: '1 / -1' }}>
        <div className="password-pane">
          <h1>{t('password.title')}</h1>
          <p className="muted">{t('password.sub')}</p>
          <p className="small"><b>{user.name}</b> · <span className="ltr">{user.email}</span></p>
          <PasswordFields user={user} submitLabel={t('password.save')} onSaved={(u) => { toast(t('password.changed')); setUser(u); }} />
          <button type="button" className="linkbtn" style={{ marginTop: 14 }} onClick={() => { signOutSync(); setUser(null); }}>{t('app.logout')}</button>
        </div>
      </div>
    </div>
  );
}

/** "Change my password" from the sidebar. */
export function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const { t, user, setUser, toast } = useApp();
  if (!user) return null;
  return (
    <Dialog title={t('password.change')} onClose={onClose}>
      <PasswordFields user={user} submitLabel={t('common.save')} onSaved={(u) => { toast(t('password.changed')); setUser(u); onClose(); }} />
    </Dialog>
  );
}

/** After the Admin creates a user or resets a password: the message with how to sign in, ready to send. */
export function InviteDialog({ person, password, onClose }: { person: Pick<User, 'name' | 'email' | 'role'>; password: string; onClose: () => void }) {
  const { t, locale, toast } = useApp();
  const settings = useQuery(getSettings);
  const clinic = locale === 'ar' ? settings.name_ar : settings.name_en;
  const server = serverUrl();
  const vars = { name: person.name, role: t(`roles.${person.role}`), clinic, email: person.email, password, server: server ?? '', download: server && __CLOUD__ ? server : DOWNLOAD_URL };
  const text = t(server ? 'invite.text' : 'invite.textNoServer', vars);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast(t('invite.copied'));
    } catch {
      /* clipboard blocked: the text is selectable */
    }
  };
  return (
    <Dialog
      title={t('invite.title')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={() => void copy()}>{t('invite.copy')}</button>
          <button className="btn" onClick={() => platform.openExternal(`mailto:${encodeURIComponent(person.email)}?subject=${encodeURIComponent(t('invite.subject', { clinic }))}&body=${encodeURIComponent(text)}`)}>
            ✉ {t('invite.email')}
          </button>
          <button className="btn primary" onClick={() => platform.openExternal(`https://wa.me/?text=${encodeURIComponent(text)}`)}>
            <Icon name="chat" /> {t('invite.whatsapp')}
          </button>
        </>
      }
    >
      <p className="muted" style={{ marginTop: 0 }}>{t('invite.sub', { name: person.name })}</p>
      <div className="temp-pw">
        <span className="muted small">{t('settings.tempPassword')}</span>
        <b className="ltr">{password}</b>
      </div>
      <pre className="invite-text">{text}</pre>
    </Dialog>
  );
}
