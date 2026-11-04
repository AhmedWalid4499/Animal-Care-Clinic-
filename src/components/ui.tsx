import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useApp, useQuery } from '../lib/app';
import { searchPets, type PetOption } from '../db/repo';
import { openWhatsApp } from '../lib/whatsapp';

// ---------- icons (inline, stroke) ----------
const paths: Record<string, string> = {
  home: 'M3 11l9-7 9 7M5 10v10h14V10',
  users: 'M16 19v-1a4 4 0 00-4-4H7a4 4 0 00-4 4v1M9.5 10a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM21 19v-1a4 4 0 00-3-3.9M16 3.1a3.5 3.5 0 010 6.8',
  calendar: 'M4 5h16v15H4zM4 9h16M9 3v4M15 3v4',
  receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3',
  settings: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z',
  plus: 'M12 5v14M5 12h14',
  search: 'M11 18a7 7 0 100-14 7 7 0 000 14zM21 21l-5-5',
  phone: 'M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 012.1 4.2 2 2 0 014.1 2h3a2 2 0 012 1.7c.1 1 .4 1.9.7 2.8a2 2 0 01-.5 2.1L8 9.9a16 16 0 006 6l1.3-1.3a2 2 0 012.1-.5c.9.3 1.8.6 2.8.7a2 2 0 011.7 2z',
  chat: 'M21 11.5a8.4 8.4 0 01-12.3 7.4L3 21l2.1-5.6A8.4 8.4 0 1121 11.5z',
  print: 'M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6z',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z',
  x: 'M18 6L6 18M6 6l12 12',
  stethoscope: 'M5 3v6a5 5 0 0010 0V3M10 14v2a5 5 0 0010 0v-2M20 11a2 2 0 100 4 2 2 0 000-4z',
  file: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 100-6 3 3 0 000 6z',
  eyeOff: 'M3 3l18 18M10.6 5.1A10.6 10.6 0 0112 5c6.4 0 10 7 10 7a17.6 17.6 0 01-3.2 4.2M6.6 6.6A17.4 17.4 0 002 12s3.6 7 10 7a10 10 0 005.4-1.6M9.9 9.9a3 3 0 004.2 4.2',
  paw: 'M12 13c-3 0-5 3-5 5s2 2.5 5 2.5 5-.5 5-2.5-2-5-5-5zM6 9a2 2 0 100-4 2 2 0 000 4zM18 9a2 2 0 100-4 2 2 0 000 4zM9.5 6a2 2 0 100-4 2 2 0 000 4zM14.5 6a2 2 0 100-4 2 2 0 000 4z',
};
export function Icon({ name }: { name: keyof typeof paths | string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[name] ?? ''} />
    </svg>
  );
}

export const speciesEmoji: Record<string, string> = { DOG: '🐕', CAT: '🐈', BIRD: '🐦', RABBIT: '🐇', REPTILE: '🦎', OTHER: '🐾' };

export function PetAvatar({ photo, species, size }: { photo?: string | null; species: string; size?: 'sm' }) {
  return <div className={`avatar ${size ?? ''}`}>{photo ? <img src={photo} alt="" /> : <span aria-hidden>{speciesEmoji[species] ?? '🐾'}</span>}</div>;
}

// ---------- form primitives ----------
/** Labelled form field. Use group for content with several controls/buttons (a <label> would hijack clicks). */
export function Field({ label, children, hint, error, optional, className, group }: { label: string; children: ReactNode; hint?: string; error?: string | null; optional?: boolean; className?: string; group?: boolean }) {
  const { t } = useApp();
  const Tag = group ? 'div' : 'label';
  return (
    <Tag className={`field ${className ?? ''}`} role={group ? 'group' : undefined} aria-label={group ? label : undefined}>
      <span>
        {label} {optional && <em>({t('common.optional')})</em>}
      </span>
      {children}
      {error ? <small className="err">{error}</small> : hint ? <small className="hint">{hint}</small> : null}
    </Tag>
  );
}

export function Dialog({ title, children, footer, onClose, wide }: { title: string; children: ReactNode; footer?: ReactNode; onClose: () => void; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`dialog ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <h2>{title}</h2>
          <button className="btn ghost sm" onClick={onClose} aria-label="close"><Icon name="x" /></button>
        </header>
        <div className="body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}

export function Confirm({ title, body, confirmLabel, danger, onConfirm, onClose }: { title: string; body: ReactNode; confirmLabel?: string; danger?: boolean; onConfirm: () => void; onClose: () => void }) {
  const { t } = useApp();
  return (
    <Dialog
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button className={`btn ${danger ? 'danger' : 'primary'}`} onClick={() => { onConfirm(); onClose(); }}>{confirmLabel ?? t('common.confirm')}</button>
        </>
      }
    >
      <p style={{ margin: 0 }}>{body}</p>
    </Dialog>
  );
}

export function Badge({ kind, children }: { kind?: 'ok' | 'warn' | 'bad' | 'info'; children: ReactNode }) {
  return <span className={`badge ${kind ?? ''}`}>{children}</span>;
}

const statusKind: Record<string, 'ok' | 'warn' | 'bad' | 'info' | undefined> = {
  PAID: 'ok', PARTIAL: 'warn', UNPAID: 'bad', VOID: undefined, SCHEDULED: 'info', DONE: 'ok', NO_SHOW: 'bad', CANCELLED: undefined,
  ACTIVE: 'ok', DECEASED: undefined, TRANSFERRED: undefined, ARCHIVED: undefined,
};
export function StatusBadge({ ns, value }: { ns: string; value: string }) {
  const { t } = useApp();
  return <Badge kind={statusKind[value]}>{t(`${ns}.${value}`)}</Badge>;
}

/** WhatsApp click-to-chat button. onSent runs after opening (sets reminder_sent_at). */
export function WaButton({ phone, text, onSent, label, small }: { phone: string | null | undefined; text: string; onSent?: () => void; label?: string; small?: boolean }) {
  const { t } = useApp();
  return (
    <button
      type="button"
      className={`btn wa ${small ? 'sm' : ''}`}
      disabled={!phone}
      onClick={(e) => {
        e.stopPropagation();
        if (openWhatsApp(phone, text)) onSent?.();
      }}
      title={t('common.whatsapp')}
    >
      <Icon name="chat" /> {label ?? t('common.whatsapp')}
    </button>
  );
}

/** Pet search-and-pick used by New visit, appointments and invoices. */
export function PetPicker({ value, onChange, autoFocus }: { value: PetOption | null; onChange: (p: PetOption | null) => void; autoFocus?: boolean }) {
  const { t } = useApp();
  const [q, setQ] = useState('');
  const results = useQuery(() => (q.trim().length >= 1 ? searchPets(q, 12) : []), [q]);
  const ref = useRef<HTMLInputElement>(null);
  if (value)
    return (
      <div className="chosen">
        <span aria-hidden>{speciesEmoji[value.species]}</span>
        <div style={{ flex: 1 }}>
          <b>{value.name}</b> <span className="muted small">· {value.owner_name} · <span className="ltr">{value.owner_phone}</span></span>
        </div>
        <button type="button" className="btn ghost sm" onClick={() => onChange(null)}>{t('common.edit')}</button>
      </div>
    );
  return (
    <div>
      <div className="searchbox">
        <Icon name="search" />
        <input ref={ref} type="search" value={q} autoFocus={autoFocus} placeholder={t('visits.pickPetHint')} onChange={(e) => setQ(e.target.value)} />
      </div>
      {q.trim() && (
        <div className="picker">
          {results.length === 0 && <div className="empty" style={{ padding: 12 }}>{t('common.noResults')}</div>}
          {results.map((p) => (
            <button type="button" key={p.id} onClick={() => onChange(p)} className={p.status !== 'ACTIVE' ? 'greyed' : ''}>
              <span aria-hidden>{speciesEmoji[p.species]}</span>
              <span style={{ flex: 1 }}>
                <b>{p.name}</b> <span className="muted small">· {p.owner_name}</span>
              </span>
              <span className="muted small ltr">{p.owner_phone}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Read a picked image, scale it down and return a JPEG data URL (pet photos, clinic logo). */
export function imageToDataUrl(file: File | Blob, max = 360): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s);
      c.height = Math.round(img.height * s);
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.85));
    };
    img.onerror = reject;
    img.src = url;
  });
}
