import { useEffect, useRef, useState } from 'react';
import { get } from '../db/core';
import { useApp, useQuery } from '../lib/app';
import { auditLogin, getSettings, login } from '../db/repo';
import { DEFAULT_LOGINS } from '../db/seed';
import { Icon } from '../components/ui';
import { checkServer, normaliseUrl, onlineLogin, rememberedUser, resumeSync, serverFixed, serverUrl, setServerUrl, takeRevokedNotice } from '../sync/engine';

const LAST_EMAIL = 'login:lastEmail';
const FEATURES = ['search', 'vaccines', 'receipts'] as const;
const SLIDE_MS = 5500;

function readLastEmail() {
  try {
    return localStorage.getItem(LAST_EMAIL) ?? '';
  } catch {
    return '';
  }
}

/** Morning until noon, afternoon until 17:00, evening after that (clinic PC local time). */
function greetingKey(d = new Date()) {
  const h = d.getHours();
  return h < 12 ? 'login.morning' : h < 17 ? 'login.afternoon' : 'login.evening';
}

/** A trail of paw prints crossing the panel, one print after another. Decorative only. */
function PawTrail() {
  const steps = Array.from({ length: 7 }, (_, i) => i);
  return (
    <svg className="paw-trail" viewBox="0 0 900 170" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      {steps.map((i) => (
        <g
          key={i}
          className="paw"
          style={{ animationDelay: `${i * 0.55}s` }}
          transform={`translate(${60 + i * 128} ${i % 2 ? 112 : 58}) rotate(${i % 2 ? 100 : 80}) scale(1.7)`}
        >
          <ellipse cx="0" cy="10" rx="13" ry="11" />
          <ellipse cx="-13" cy="-6" rx="5" ry="7" />
          <ellipse cx="-4" cy="-13" rx="5" ry="7" />
          <ellipse cx="6" cy="-13" rx="5" ry="7" />
          <ellipse cx="15" cy="-5" rx="5" ry="7" />
        </g>
      ))}
    </svg>
  );
}

function FeatureSlides() {
  const { t } = useApp();
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const h = setInterval(() => setI((x) => (x + 1) % FEATURES.length), SLIDE_MS);
    return () => clearInterval(h);
  }, [paused]);
  return (
    <div className="slides" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <div className="slide-stage" aria-live="polite">
        <div key={FEATURES[i]} className="slide">
          <b>{t(`login.f_${FEATURES[i]}`)}</b>
          <p>{t(`login.f_${FEATURES[i]}_text`)}</p>
        </div>
      </div>
      <div className="dots" role="tablist">
        {FEATURES.map((f, k) => (
          <button key={f} type="button" role="tab" aria-selected={k === i} aria-label={t(`login.f_${f}`)} className={k === i ? 'on' : ''} onClick={() => setI(k)} />
        ))}
      </div>
    </div>
  );
}

function getSettingsRowExists() {
  return !!get('SELECT 1 FROM users LIMIT 1');
}

export function Login({ firstRun }: { firstRun: boolean }) {
  const { t, setUser, locale, setLocale } = useApp();
  const settings = useQuery(getSettings);
  const [email, setEmail] = useState(readLastEmail);
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  const [error, setError] = useState(false);
  const [shake, setShake] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(() => (takeRevokedNotice() ? t('sync.revoked') : null));
  const [server, setServer] = useState<string | null>(serverUrl);
  const [editServer, setEditServer] = useState(false);
  const [serverInput, setServerInput] = useState('');
  const [serverMsg, setServerMsg] = useState<string | null>(null);
  const pwRef = useRef<HTMLInputElement>(null);
  const name = locale === 'ar' ? settings.name_ar : settings.name_en;

  // Linked laptops stay signed in until Sign out, so the app in the tray keeps syncing and notifying after a restart.
  useEffect(() => {
    const u = rememberedUser();
    if (u) {
      setUser(u);
      resumeSync(u.id);
    }
  }, [setUser]);

  const remember = (mail: string) => {
    try {
      localStorage.setItem(LAST_EMAIL, mail);
    } catch {
      /* private window */
    }
  };
  const fail = (msg: string | null) => {
    setBusy(false);
    setError(msg === null);
    setMessage(msg);
    setShake((n) => n + 1);
    setPassword('');
    pwRef.current?.focus();
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage(null);
    // Checking the password takes a moment; let the "Signing in…" state paint first.
    setTimeout(async () => {
      try {
        // Linked to a clinic server: sign in there (and sync); without a connection, sign in on this device.
        if (serverUrl()) {
          const u = await onlineLogin(email, password);
          if (u !== 'unreachable') {
            auditLogin(u.id);
            remember(u.email);
            setUser(u);
            return;
          }
        }
        const u = login(email, password);
        if (u) {
          remember(u.email);
          setUser(u);
          resumeSync(u.id);
          return;
        }
        fail(serverUrl() && !getSettingsRowExists() ? t('login.firstSignInOnline') : null);
      } catch (err) {
        const m = (err as Error).message;
        const status = (err as { status?: number }).status;
        fail(m === 'NOT_SET_UP' ? t('login.notSetUp') : status === 401 ? null : status === 429 ? t('login.tooMany') : m);
      }
    }, 30);
  };
  const connectServer = async () => {
    const url = normaliseUrl(serverInput);
    setServerMsg('…');
    if (await checkServer(url)) {
      setServerUrl(url);
      setServer(url);
      setEditServer(false);
      setServerMsg(t('login.serverSaved'));
    } else setServerMsg(t('login.serverUnreachable'));
  };
  const capsCheck = (e: React.KeyboardEvent) => setCaps(e.getModifierState?.('CapsLock') ?? false);

  return (
    <div className="login">
      <div className="art">
        <div className="art-top enter" style={{ ['--d' as string]: '0ms' }}>
          {settings.logo_url ? (
            <span className="logo-plate"><img src={settings.logo_url} alt={name} /></span>
          ) : (
            <b style={{ fontSize: 20 }}>{name}</b>
          )}
        </div>
        <div className="art-mid enter" style={{ ['--d' as string]: '120ms' }}>
          <h1>{t('app.name')}</h1>
          <FeatureSlides />
        </div>
        <div className="art-bottom">
          <PawTrail />
          <small>{[locale === 'ar' ? settings.name_ar : null, settings.address, settings.phone].filter(Boolean).join(' · ')}</small>
        </div>
      </div>

      <div className="pane">
        <form onSubmit={submit} noValidate={false}>
          <div className="tools enter" style={{ ['--d' as string]: '0ms' }}>
            <button type="button" className="lang-pill" onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')}>{t('app.language')}</button>
          </div>
          {settings.logo_url && <span className="logo-plate mobile-logo enter"><img src={settings.logo_url} alt={name} /></span>}
          <div className="enter" style={{ ['--d' as string]: '60ms' }}>
            <p className="greeting">{t(greetingKey())}</p>
            <h1>{t('login.title')}</h1>
            <p className="muted" style={{ margin: '4px 0 0' }}>{t('login.subtitle')}</p>
          </div>

          <div key={shake} className={`fields enter ${shake ? 'shake' : ''}`} style={{ ['--d' as string]: '120ms' }}>
            <label className="float">
              <input
                type="email"
                className="ltr"
                value={email}
                placeholder=" "
                autoComplete="username"
                autoFocus={!email}
                onChange={(e) => { setEmail(e.target.value); setError(false); }}
                required
              />
              <span>{t('login.email')}</span>
            </label>
            <label className="float has-eye">
              <input
                ref={pwRef}
                type={show ? 'text' : 'password'}
                className="ltr"
                value={password}
                placeholder=" "
                autoComplete="current-password"
                autoFocus={!!email}
                onChange={(e) => { setPassword(e.target.value); setError(false); }}
                onKeyUp={capsCheck}
                onKeyDown={capsCheck}
                onBlur={() => setCaps(false)}
                required
              />
              <span>{t('login.password')}</span>
              <button type="button" className="eye" onClick={() => setShow((s) => !s)} aria-label={show ? t('login.hidePassword') : t('login.showPassword')} aria-pressed={show}>
                <Icon name={show ? 'eyeOff' : 'eye'} />
              </button>
            </label>
            <div className="login-msg" aria-live="polite">
              {message ? <span className="err">{message}</span> : error ? <span className="err">{t('login.error')}</span> : caps ? <span className="warn">⇪ {t('login.capsLock')}</span> : null}
            </div>
          </div>

          <button className={`btn primary signin enter ${busy ? 'busy' : ''}`} style={{ ['--d' as string]: '180ms' }} disabled={busy}>
            {busy ? <><span className="spinner" aria-hidden="true" /> {t('login.signingIn')}</> : t('login.submit')}
          </button>

          {!serverFixed() && (
            <div className="server-line enter" style={{ ['--d' as string]: '220ms' }}>
              {editServer ? (
                <div className="server-edit">
                  <input
                    type="url"
                    className="ltr"
                    value={serverInput}
                    placeholder={t('login.serverPlaceholder')}
                    aria-label={t('login.server')}
                    onChange={(e) => setServerInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void connectServer(); } }}
                    autoFocus
                  />
                  <button type="button" className="btn sm primary" onClick={() => void connectServer()} disabled={!serverInput.trim()}>{t('login.connect')}</button>
                  <button type="button" className="btn sm ghost" onClick={() => { setEditServer(false); setServerMsg(null); }}>{t('common.cancel')}</button>
                </div>
              ) : server ? (
                <span>
                  {t('login.server')}: <b className="ltr">{new URL(server).host}</b>{' '}
                  <button type="button" className="linkbtn" onClick={() => { setServerInput(server); setEditServer(true); }}>{t('login.changeServer')}</button>
                </span>
              ) : (
                <button type="button" className="linkbtn" onClick={() => setEditServer(true)}>{t('login.connectServer')}</button>
              )}
              {serverMsg && <div className="small muted">{serverMsg}</div>}
            </div>
          )}

          {firstRun && !server && (
            <div className="creds enter" style={{ ['--d' as string]: '240ms' }}>
              {t('login.firstRun')}
              <div className="role-chips">
                {DEFAULT_LOGINS.map((l) => (
                  <button
                    key={l.email}
                    type="button"
                    className="chip-btn"
                    onClick={() => { setEmail(l.email); setPassword(l.password); setError(false); }}
                  >
                    <b>{t(`roles.${l.role}`)}</b>
                    <span className="ltr">{l.email} · {l.password}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
