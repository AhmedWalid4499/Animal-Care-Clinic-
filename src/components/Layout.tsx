import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useApp, useQuery, type Theme } from '../lib/app';
import { getSettings } from '../db/repo';
import { Icon } from './ui';
import { UpdateBanner } from './Updates';
import { SyncBadge } from './SyncBadge';
import { signOutSync } from '../sync/engine';
import { dropPushSubscription } from '../sync/notify';
import { NotificationAnnouncer, NotificationBell } from './Notifications';
import { ChangePasswordDialog } from './Account';
import { InstallPrompt } from './InstallPrompt';

export function Layout() {
  const { t, user, setUser, isAdmin, canVisit, locale, setLocale, theme, setTheme } = useApp();
  const settings = useQuery(getSettings);
  const nav = useNavigate();
  const { pathname } = useLocation();
  const [pwDialog, setPwDialog] = useState(false);
  // Each screen starts at the top and slides in (see .route-enter in styles.css).
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [pathname]);
  const items = [
    { to: '/', icon: 'home', label: t('nav.dashboard'), end: true },
    { to: '/owners', icon: 'users', label: t('nav.owners') },
    { to: '/appointments', icon: 'calendar', label: t('nav.appointments') },
    { to: '/invoices', icon: 'receipt', label: t('nav.invoices') },
    ...(isAdmin ? [{ to: '/reports', icon: 'chart', label: t('nav.reports') }] : []),
    // Admins: the clinic's full Settings. Everyone else: their own Settings (app updates, language, password).
    { to: isAdmin ? '/settings' : '/account', icon: 'settings', label: t('nav.settings') },
  ];
  const clinicName = locale === 'ar' ? settings.name_ar : settings.name_en;
  const nextTheme: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' };
  return (
    <>
      {__WEB_DEMO__ && <div className="demo-banner no-print">{t('app.demoBanner')}</div>}
      <UpdateBanner />
      <div className="shell">
        <aside className="side no-print">
          {settings.logo_url ? (
            <div className="brand with-logo">
              <span className="logo-plate"><img src={settings.logo_url} alt={clinicName} /></span>
              <span>{locale === 'ar' ? `${settings.name_ar} · ` : ''}{t('app.name')}</span>
            </div>
          ) : (
            <div className="brand">
              <div className="mark">{clinicName.slice(0, 1)}</div>
              <div>
                <b>{clinicName}</b>
                <span>{t('app.name')}</span>
              </div>
            </div>
          )}
          <nav className="nav">
            {items.map((i) => (
              <NavLink key={i.to} to={i.to} end={i.end}>
                <Icon name={i.icon} /> {i.label}
              </NavLink>
            ))}
          </nav>
          {canVisit && (
            <button className="btn primary" style={{ marginTop: 14 }} onClick={() => nav('/visits/new')}>
              <Icon name="plus" /> {t('nav.newVisit')}
            </button>
          )}
          <div className="side-foot">
            <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
              <SyncBadge />
              <NotificationBell />
            </div>
            <div className="who">
              <b>{user?.name}</b>
              <span className="muted">{t(`roles.${user?.role}`)}</span>
            </div>
            <button className="linkbtn" onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')}>{t('app.language')}</button>
            <button className="linkbtn" onClick={() => setTheme(nextTheme[theme])}>
              {t('app.theme')}: {t(`app.theme${theme[0].toUpperCase()}${theme.slice(1)}`)}
            </button>
            <button className="linkbtn" onClick={() => setPwDialog(true)}>{t('password.change')}</button>
            <button className="linkbtn" onClick={async () => { await dropPushSubscription(); signOutSync(); setUser(null); nav('/'); }}>{t('app.logout')}</button>
          </div>
        </aside>
        <NotificationAnnouncer />
        {pwDialog && <ChangePasswordDialog onClose={() => setPwDialog(false)} />}
        <div className="mobile-bell"><NotificationBell floating /></div>
        <main className="main">
          <InstallPrompt />
          <div key={pathname} className="route-enter">
            <Outlet />
          </div>
        </main>
      </div>
      <nav className="bottom-nav no-print">
        {items.map((i) => (
          <NavLink key={i.to} to={i.to} end={i.end}>
            <Icon name={i.icon} />
            {i.label}
          </NavLink>
        ))}
      </nav>
    </>
  );
}

export function PageHead({ title, sub, crumb, children }: { title: string; sub?: string; crumb?: { to: string; label: string }; children?: React.ReactNode }) {
  const { locale } = useApp();
  return (
    <div className="pagehead">
      <div>
        {crumb && <NavLink className="crumb" to={crumb.to}>{locale === 'ar' ? '→' : '←'} {crumb.label}</NavLink>}
        <h1>{title}</h1>
        {sub && <div className="sub">{sub}</div>}
      </div>
      <div className="row">{children}</div>
    </div>
  );
}
