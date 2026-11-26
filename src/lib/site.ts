// The address in every link or QR code people are given (26 Nov 2026, Ahmed: "I want it animalcarecliniceg, not
// production"). A laptop may be connected to the clinic server through its Railway address (*.up.railway.app): it is
// the same server and keeps syncing that way, but links use the clinic's own domain (`site` in clinic-info.json).
// The server sends public pages opened on the Railway address to the domain too (server/clinic.mjs).
import info from './clinic-info.json';
import { serverUrl } from '../sync/engine';

const isRailway = (url: string) => {
  try {
    return /\.up\.railway\.app$/i.test(new URL(url).hostname);
  } catch {
    return false;
  }
};
/** The clinic server's address for links (booking page, owner page, collar tag, lab, clinic QR); null when not linked. */
export function publicBase(): string | null {
  const s = serverUrl();
  if (!s) return null;
  return isRailway(s) ? info.site.replace(/\/+$/, '') : s.replace(/\/+$/, '');
}
