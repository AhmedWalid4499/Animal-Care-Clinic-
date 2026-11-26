// Settings → Clinic → Online booking (change request, 25 Nov 2026). The Admin turns the public booking page on
// and shares its link. The page lives on the clinic server (server/booking.mjs), so it needs one.
import { useState } from 'react';
import { useApp, useQuery } from '../lib/app';
import { getSettings, saveSettings } from '../db/repo';
import { platform } from '../lib/platform';
import { publicBase } from '../lib/site';
import { Icon } from './ui';

export function OnlineBookingSection() {
  const { t, toast, locale } = useApp();
  const s = useQuery(getSettings);
  const [copied, setCopied] = useState(false);
  const base = publicBase();
  const on = Number(s.online_booking) === 1;
  const link = base ? `${base}/book${locale === 'en' ? '?lang=en' : ''}` : null;
  const clinic = locale === 'ar' ? s.name_ar : s.name_en;
  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked: the link is selectable */
    }
  };
  return (
    <div className="form-section" style={{ maxWidth: 720, marginTop: 28 }}>
      <h2>{t('booking.title')}</h2>
      <p className="faint small" style={{ marginTop: 0 }}>{t('booking.hint')}</p>
      {!base ? (
        <div className="note warn">{t('booking.needsServer')}</div>
      ) : (
        <>
          <label className="row" style={{ gap: 8, marginBottom: 12 }}>
            <input
              type="checkbox"
              checked={on}
              onChange={(e) => {
                saveSettings({ online_booking: e.target.checked ? 1 : 0 });
                toast(e.target.checked ? t('booking.turnedOn') : t('booking.turnedOff'));
              }}
              style={{ width: 'auto' }}
            />
            <b>{t('booking.enable')}</b>
          </label>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', opacity: on ? 1 : 0.5 }}>
            <input type="text" readOnly value={link!} className="ltr" onFocus={(e) => e.target.select()} style={{ flex: '1 1 260px' }} aria-label={t('booking.link')} />
            <button type="button" className="btn" onClick={copy}>{copied ? '✓' : <Icon name="clipboard" />} {t('booking.copy')}</button>
            <button type="button" className="btn wa" onClick={() => void platform.openExternal(`https://wa.me/?text=${encodeURIComponent(t('booking.shareText', { clinic, link: link! }))}`)}>
              <Icon name="chat" /> {t('booking.share')}
            </button>
            <button type="button" className="btn ghost" onClick={() => void platform.openExternal(link!)}>{t('booking.open')}</button>
          </div>
          <p className="faint small">{on ? t('booking.howItWorks') : t('booking.offNote')}</p>
        </>
      )}
    </div>
  );
}
