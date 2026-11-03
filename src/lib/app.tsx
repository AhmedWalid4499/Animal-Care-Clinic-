// App-wide context: language (AR default, RTL), signed-in user, theme, toasts, and a hook that
// re-runs queries whenever the database changes.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import ar from '../i18n/ar.json';
import en from '../i18n/en.json';
import { getVersion, setActor, subscribe } from '../db/core';
import type { Locale, User } from '../db/types';

const messages = { ar, en } as const;
type Dict = Record<string, unknown>;

function lookup(dict: Dict, key: string): string | undefined {
  let cur: unknown = dict;
  for (const part of key.split('.')) {
    if (cur && typeof cur === 'object') cur = (cur as Dict)[part];
    else return undefined;
  }
  return typeof cur === 'string' ? cur : undefined;
}

export type T = (key: string, vars?: Record<string, string | number>) => string;
export type Theme = 'system' | 'light' | 'dark';

interface Ctx {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: T;
  user: User | null;
  setUser: (u: User | null) => void;
  isVet: boolean;
  theme: Theme;
  setTheme: (t: Theme) => void;
  toast: (msg: string) => void;
  fmt: Formatters;
}

const AppCtx = createContext<Ctx | null>(null);

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* ignore */
  }
}

export interface Formatters {
  date: (v: string | null | undefined) => string;
  dateTime: (v: string | null | undefined) => string;
  time: (v: string) => string;
  weekday: (v: string) => string;
  money: (piastres: number) => string;
  num: (n: number, digits?: number) => string;
}

function makeFormatters(locale: Locale): Formatters {
  const tag = locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB';
  const d = new Intl.DateTimeFormat(tag, { day: 'numeric', month: 'short', year: 'numeric' });
  const tm = new Intl.DateTimeFormat(tag, { hour: 'numeric', minute: '2-digit' });
  const wd = new Intl.DateTimeFormat(tag, { weekday: 'short', day: 'numeric', month: 'short' });
  const money = new Intl.NumberFormat(tag, { style: 'currency', currency: 'EGP', minimumFractionDigits: 2 });
  const toDate = (v: string) => (v.length === 10 ? new Date(`${v}T00:00:00`) : new Date(v));
  return {
    date: (v) => (v ? d.format(toDate(v)) : '—'),
    dateTime: (v) => (v ? `${d.format(toDate(v))} · ${tm.format(toDate(v))}` : '—'),
    time: (v) => tm.format(new Date(v)),
    weekday: (v) => wd.format(toDate(v)),
    money: (p) => money.format((p || 0) / 100),
    num: (n, digits = 1) => new Intl.NumberFormat(tag, { maximumFractionDigits: digits }).format(n),
  };
}

export function AppProvider({ children, defaultLocale }: { children: ReactNode; defaultLocale: Locale }) {
  const [locale, setLocaleState] = useState<Locale>(() => (safeGet('locale') as Locale) || defaultLocale);
  const [user, setUserState] = useState<User | null>(null);
  const [theme, setThemeState] = useState<Theme>(() => (safeGet('theme') as Theme) || 'system');
  const [toasts, setToasts] = useState<{ id: number; msg: string }[]>([]);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
  }, [locale]);
  useEffect(() => {
    if (theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const t = useCallback<T>(
    (key, vars) => {
      let s = lookup(messages[locale] as Dict, key) ?? lookup(messages.en as Dict, key) ?? key;
      if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
      return s;
    },
    [locale],
  );

  const value = useMemo<Ctx>(
    () => ({
      locale,
      setLocale: (l) => {
        setLocaleState(l);
        safeSet('locale', l);
      },
      t,
      user,
      setUser: (u) => {
        setActor(u?.id ?? null);
        setUserState(u);
        if (u && !safeGet('locale')) setLocaleState(u.locale);
      },
      isVet: user?.role === 'VET',
      theme,
      setTheme: (th) => {
        setThemeState(th);
        safeSet('theme', th);
      },
      toast: (msg) => {
        const id = Date.now() + Math.random();
        setToasts((x) => [...x, { id, msg }]);
        setTimeout(() => setToasts((x) => x.filter((y) => y.id !== id)), 2600);
      },
      fmt: makeFormatters(locale),
    }),
    [locale, t, user, theme],
  );

  return (
    <AppCtx.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((x) => (
          <div key={x.id} className="toast">{x.msg}</div>
        ))}
      </div>
    </AppCtx.Provider>
  );
}

export function useApp(): Ctx {
  const c = useContext(AppCtx);
  if (!c) throw new Error('AppProvider missing');
  return c;
}

/** Run a synchronous query and re-run it after every database write. */
export function useQuery<R>(fn: () => R, deps: unknown[] = []): R {
  const v = useSyncExternalStore(subscribe, getVersion);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(fn, [v, ...deps]);
}
