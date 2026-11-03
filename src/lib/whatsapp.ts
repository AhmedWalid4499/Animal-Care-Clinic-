// The one integration: WhatsApp click-to-chat (https://wa.me/<E164>?text=<encoded>).
// No WhatsApp Business API — the message opens pre-filled and staff press send.
import type { T } from './app';
import { platform } from './platform';

/** Egyptian numbers: 010… → 2010…; already-international numbers are kept. */
export function toE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = raw.replace(/[^\d+]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  else if (d.startsWith('00')) d = d.slice(2);
  else if (d.startsWith('0')) d = `20${d.slice(1)}`;
  return d.length >= 10 ? d : null;
}

export function waUrl(phone: string | null | undefined, text: string): string | null {
  const n = toE164(phone);
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : null;
}

export type WaTemplate = 'vaccination' | 'appointment' | 'balance' | 'general';

export function waMessage(t: T, template: WaTemplate, vars: Record<string, string>) {
  return t(`wa.${template}`, vars);
}

/** Open WhatsApp with the message; returns false when the number is unusable. */
export function openWhatsApp(phone: string | null | undefined, text: string): boolean {
  const url = waUrl(phone, text);
  if (!url) return false;
  platform.openExternal(url);
  return true;
}

export function telUrl(phone: string) {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}
