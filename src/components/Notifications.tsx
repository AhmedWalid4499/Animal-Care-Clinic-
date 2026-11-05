import { useEffect, useRef, useState } from 'react';
import { useApp, useQuery, type Formatters, type T } from '../lib/app';
import { get } from '../db/core';
import { saveNotifyOff } from '../db/repo';
import type { User } from '../db/types';
import { isDesktop, platform } from '../lib/platform';
import { serverUrl } from '../sync/engine';
import {
  NOTIFY_KINDS, enablePush, markRead, onArrival, pushPermission, pushSupported, routeFor, useNotifications,
  type ClinicNotification, type NotifyKind,
} from '../sync/notify';
import { Icon } from './ui';

/** One notification as text, in the reader's language. */
export function notificationText(n: ClinicNotification, t: T, fmt: Formatters): string {
  const d = n.data;
  const vars: Record<string, string> = {
    by: String(d.by ?? ''), pet: String(d.pet ?? ''), owner: String(d.owner ?? ''), number: String(d.number ?? ''), label: String(d.label ?? ''),
    at: d.at ? `${fmt.weekday(String(d.at))} ${fmt.time(String(d.at))}` : '',
    amount: d.amount != null ? fmt.money(Number(d.amount)) : '',
  };
  return t(`notify.${n.kind}.${n.event}`, vars).replace(/\(\s*\)/g, '').trim();
}

function ago(iso: string, t: T, locale: string) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return t('notify.now');
  const rtf = new Intl.RelativeTimeFormat(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', { numeric: 'auto', style: 'short' });
  if (s < 3600) return rtf.format(-Math.round(s / 60), 'minute');
  if (s < 86400) return rtf.format(-Math.round(s / 3600), 'hour');
  return rtf.format(-Math.round(s / 86400), 'day');
}

const KIND_ICON: Record<NotifyKind, string> = { appointment: 'calendar', visit: 'stethoscope', payment: 'receipt', conflict: 'edit' };

/** The bell: unread count, the list, and each person's on/off choices. */
export function NotificationBell({ floating }: { floating?: boolean }) {
  const { t, fmt, locale, user } = useApp();
  const { items, unread } = useNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const me = useQuery(() => (user ? get<User>('SELECT * FROM users WHERE id = ?', [user.id]) : undefined), [user?.id]);
  const off = new Set((me?.notify_off ?? '').split(',').filter(Boolean));
  const [perm, setPerm] = useState(pushPermission());
  const [background, setBackground] = useState<boolean | null>(null);

  useEffect(() => {
    if (open && isDesktop) platform.getBackground().then(setBackground);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  if (!serverUrl() || !user) return null;
  const toggleKind = (k: NotifyKind) => {
    const next = new Set(off);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    saveNotifyOff(user.id, [...next]);
  };

  return (
    <div className={`bell-wrap ${floating ? 'floating no-print' : ''}`} ref={ref}>
      <button type="button" className={`bell ${unread ? 'has-unread' : ''}`} aria-label={`${t('notify.title')}${unread ? ` (${unread})` : ''}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name="bell" />
        {unread > 0 && <span className="count">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="bell-panel" role="dialog" aria-label={t('notify.title')}>
          <header>
            <b>{t('notify.title')}</b>
            {unread > 0 && <button type="button" className="linkbtn" onClick={() => void markRead('all')}>{t('notify.markAll')}</button>}
          </header>
          <ul>
            {items.length === 0 && <li className="empty-note">{t('notify.empty')}</li>}
            {items.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  className={n.read_at ? '' : 'unread'}
                  onClick={() => {
                    void markRead([n.id]);
                    setOpen(false);
                    location.hash = routeFor(n);
                  }}
                >
                  <span className="kind"><Icon name={KIND_ICON[n.kind]} /></span>
                  <span className="text">{notificationText(n, t, fmt)}</span>
                  <span className="when">{ago(n.created_at, t, locale)}</span>
                </button>
              </li>
            ))}
          </ul>
          <footer>
            <div className="small muted">{t('notify.prefs')}</div>
            <div className="kinds">
              {NOTIFY_KINDS.map((k) => (
                <label key={k} className="check small">
                  <input type="checkbox" checked={!off.has(k)} onChange={() => toggleKind(k)} /> {t(`notify.kind.${k}`)}
                </label>
              ))}
            </div>
            {pushSupported() && (
              perm === 'granted' ? <div className="small muted">✓ {t('notify.pushActive')}</div>
                : perm === 'denied' ? <div className="small muted">{t('notify.pushBlocked')}</div>
                  : (
                    <div>
                      <button type="button" className="btn sm primary" onClick={async () => { await enablePush(); setPerm(pushPermission()); }}>{t('notify.pushOn')}</button>
                      <div className="small muted">{t('notify.pushOnHint')}</div>
                    </div>
                  )
            )}
            {isDesktop && background !== null && (
              <label className="check small">
                <input type="checkbox" checked={background} onChange={async (e) => setBackground(await platform.setBackground(e.target.checked))} />
                <span>{t('notify.background')}<br /><span className="muted">{t('notify.backgroundHint')}</span></span>
              </label>
            )}
          </footer>
        </div>
      )}
    </div>
  );
}

/** New arrivals: a toast in the app, and a system notification when the desktop window is hidden or in the tray. */
export function NotificationAnnouncer() {
  const { t, fmt, toast } = useApp();
  useEffect(
    () =>
      onArrival(async (list) => {
        // Browsers / phones get Web Push from the service worker instead, so they don't show it twice.
        const system = isDesktop && typeof Notification !== 'undefined' && !(await platform.isForeground());
        for (const n of list.slice(0, 3)) {
          const text = notificationText(n, t, fmt);
          toast(text);
          if (system) {
            const os = new Notification(t(`notify.titles.${n.kind}`), { body: text, tag: n.id });
            os.onclick = () => {
              platform.showWindow();
              location.hash = routeFor(n);
              void markRead([n.id]);
            };
          }
        }
      }),
    [t, fmt, toast],
  );
  return null;
}
