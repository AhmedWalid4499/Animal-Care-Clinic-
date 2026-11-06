// Settings for everyone who is not an Admin (Doctors, Assistants): this computer's app updates and their own account.
// The Admin's full Settings (clinic, prices, users, data…) stay at /settings.
import { useState } from 'react';
import { useApp, type Theme } from '../lib/app';
import type { Locale } from '../db/types';
import { isDesktop } from '../lib/platform';
import { PageHead } from '../components/Layout';
import { UpdatesSection } from '../components/Updates';
import { ChangePasswordDialog } from '../components/Account';

export function MySettings() {
  const { t, user, isAdmin, locale, setLocale, theme, setTheme } = useApp();
  const [pwDialog, setPwDialog] = useState(false);
  if (!user) return null;
  return (
    <div className="page narrow">
      <PageHead title={t('account.title')} sub={t('account.sub')} />
      {isDesktop ? (
        <UpdatesSection canChangeAuto={isAdmin} />
      ) : (
        <div className="form-section">
          <h2>{t('updates.title')}</h2>
          <p className="muted small">{t('account.webUpToDate')}</p>
        </div>
      )}
      <div className="form-section my-account">
        <h2>{t('account.me')}</h2>
        <p>
          <b>{user.name}</b> <span className="muted">· {t(`roles.${user.role}`)} · <span className="ltr">{user.email}</span></span>
        </p>
        <div className="grid g2">
          <label className="field">
            <span>{t('account.language')}</span>
            <select value={locale} onChange={(e) => setLocale(e.target.value as Locale)}>
              <option value="ar">العربية</option>
              <option value="en">English</option>
            </select>
          </label>
          <label className="field">
            <span>{t('app.theme')}</span>
            <select value={theme} onChange={(e) => setTheme(e.target.value as Theme)}>
              {(['system', 'light', 'dark'] as Theme[]).map((th) => (
                <option key={th} value={th}>{t(`app.theme${th[0].toUpperCase()}${th.slice(1)}`)}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="row">
          <button type="button" className="btn" onClick={() => setPwDialog(true)}>{t('password.change')}</button>
        </div>
        <p className="muted small">{t('account.notifyHint')}</p>
      </div>
      {pwDialog && <ChangePasswordDialog onClose={() => setPwDialog(false)} />}
    </div>
  );
}
