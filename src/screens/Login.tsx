import { useState } from 'react';
import { useApp, useQuery } from '../lib/app';
import { getSettings, login } from '../db/repo';
import { DEFAULT_LOGINS } from '../db/seed';
import { Field } from '../components/ui';

export function Login({ firstRun }: { firstRun: boolean }) {
  const { t, setUser, locale, setLocale } = useApp();
  const settings = useQuery(getSettings);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(false);
  const name = locale === 'ar' ? settings.name_ar : settings.name_en;
  return (
    <div className="login">
      <div className="art">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {settings.logo_url ? <img src={settings.logo_url} alt="" style={{ height: 44 }} /> : <span style={{ fontSize: 28 }}>🐾</span>}
          <b>{name}</b>
        </div>
        <div>
          <h1>{t('app.name')}</h1>
          <p>{locale === 'ar' ? 'سجل واحد لكل حيوان، تحت مالكه. الزيارات، التطعيمات، الوزن، والفواتير في ثوانٍ.' : 'One record per pet, grouped under its owner. Visits, vaccinations, weight and invoices in seconds.'}</p>
        </div>
        <small style={{ opacity: 0.7 }}>{settings.address}</small>
      </div>
      <div className="pane">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const u = login(email, password);
            if (u) setUser(u);
            else setError(true);
          }}
        >
          <div className="login-tools tools">
            <button type="button" className="linkbtn" onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')}>{t('app.language')}</button>
          </div>
          <div>
            <h1>{t('login.title')}</h1>
            <p className="muted" style={{ margin: '4px 0 0' }}>{t('login.subtitle')}</p>
          </div>
          <Field label={t('login.email')}>
            <input type="email" className="ltr" value={email} autoFocus onChange={(e) => { setEmail(e.target.value); setError(false); }} required />
          </Field>
          <Field label={t('login.password')} error={error ? t('login.error') : null}>
            <input type="password" className="ltr" value={password} onChange={(e) => { setPassword(e.target.value); setError(false); }} required />
          </Field>
          <button className="btn primary" style={{ minHeight: 44 }}>{t('login.submit')}</button>
          {firstRun && (
            <div className="creds">
              {t('login.firstRun')}
              {DEFAULT_LOGINS.map((l) => (
                <div key={l.email} className="ltr" style={{ marginTop: 4 }}>
                  <button type="button" className="linkbtn" onClick={() => { setEmail(l.email); setPassword(l.password); }}>
                    {t(`roles.${l.role}`)}
                  </button>{' '}
                  <code>{l.email}</code> / <code>{l.password}</code>
                </div>
              ))}
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
