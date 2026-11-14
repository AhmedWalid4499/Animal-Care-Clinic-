import { Fragment, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useApp, useQuery, type Theme } from '../lib/app';
import { getSettings, newFoundCount } from '../db/repo';
import { userRoles } from '../db/types';
import { Icon } from './ui';
import { SideUpdateStatus, UpdateBanner, useUpdateState } from './Updates';
import { SyncBadge } from './SyncBadge';
import { signOutSync } from '../sync/engine';
import { dropPushSubscription } from '../sync/notify';
import { NotificationAnnouncer, NotificationBell, RefusedAnnouncer } from './Notifications';
import { ChangePasswordDialog } from './Account';
import { InstallPrompt } from './InstallPrompt';
import { WardWatcher } from '../screens/Ward';

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
  const updateReady = useUpdateState()?.status === 'ready';
  // Sidebar groups (10 Nov 2026, "the UI is a bit confusing"): the day's work first, then the clinic's books and
  // supplies, then Settings. The phone's bottom bar shows the items without `sideOnly`.
  type Item = { to: string; icon: string; label: string; end?: boolean; also?: string[]; sideOnly?: boolean; group: 'day' | 'clinic' | 'system'; dot?: boolean; count?: number };
  // Lost & found (schema v18): alerts from collar tags nobody has handled yet.
  const foundNew = useQuery(newFoundCount);
  const items: Item[] = [
    { to: '/', icon: 'home', label: t('nav.dashboard'), end: true, group: 'day' },
    { to: '/owners', icon: 'users', label: t('nav.owners'), group: 'day' },
    { to: '/appointments', icon: 'calendar', label: t('nav.appointments'), group: 'day' },
    { to: '/ward', icon: 'stethoscope', label: t('ward.title'), sideOnly: true, group: 'day' },
    { to: '/lost-found', icon: 'paw', label: t('lostFound.title'), sideOnly: true, group: 'day', count: foundNew },
    // Invoices, Reports and the Price list (the tabs on top of each move between them).
    { to: '/invoices', icon: 'receipt', label: t('nav.pricing'), also: ['/reports', '/prices'], group: 'clinic' },
    { to: '/stock', icon: 'box', label: t('nav.stock'), sideOnly: true, group: 'clinic' },
    ...(canVisit ? [{ to: '/templates', icon: 'clipboard', label: t('settings.templates'), sideOnly: true, group: 'clinic' as const }] : []),
    ...(canVisit ? [{ to: '/exam', icon: 'chart', label: t('exam.navTitle'), sideOnly: true, group: 'clinic' as const }] : []),
    // Admins: the clinic's full Settings. Everyone else: their own Settings (app updates, language, password).
    { to: isAdmin ? '/settings' : '/account', icon: 'settings', label: t('nav.settings'), group: 'system', dot: updateReady },
  ];
  const inSection = (i: { also?: string[] }) => !!i.also?.some((p) => pathname === p || pathname.startsWith(`${p}/`));
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
            {items.map((i, n) => (
              <Fragment key={i.to}>
                {(n === 0 || items[n - 1].group !== i.group) && (i.group === 'system' ? <hr className="nav-sep" /> : <div className="nav-group">{t(`nav.group.${i.group}`)}</div>)}
                <NavLink to={i.to} end={i.end} className={({ isActive }) => (isActive || inSection(i) ? 'active' : '')}>
                  <Icon name={i.icon} /> {i.label}{i.dot ? <span className="dot-badge" aria-label={t('updates.readyShort')} /> : null}
                  {i.count ? <span className="nav-count">{i.count}</span> : null}
                </NavLink>
              </Fragment>
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
            <SideUpdateStatus />
            <div className="who">
              <b>{user?.name}</b>
              <span className="muted">{userRoles(user).map((r) => t(`roles.${r}`)).join(' · ')}</span>
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
        <RefusedAnnouncer />
        <WardWatcher />
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
        {items.filter((i) => !('sideOnly' in i)).map((i) => (
          <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => (isActive || inSection(i) ? 'active' : '')}>
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
