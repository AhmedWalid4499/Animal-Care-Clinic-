import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// The clinic's street address (14 Nov 2026), and the placeholder seeded before it was known.
export const CLINIC_ADDRESS = '23 Montasser St, Al Huwaiteyah, Agouza, Giza Governorate 3753701';
export const OLD_ADDRESS = 'Giza · الجيزة';
/** The address the owner page and the collar tag page show: the street address while the settings hold the placeholder. */
export const clinicAddress = (v) => (typeof v !== 'string' || !v.trim() || v.trim() === OLD_ADDRESS ? CLINIC_ADDRESS : v);

// The clinic's own web address (26 Nov 2026, Ahmed: links must be animalcarecliniceg.com, never the Railway address).
// The Railway address (*.up.railway.app) is the same server and keeps working for apps already connected with it, but
// every link or QR code a person is given uses the domain: `site` in src/lib/clinic-info.json (PUBLIC_SITE overrides).
const info = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'lib', 'clinic-info.json'), 'utf8'));
export const PUBLIC_SITE = String(process.env.PUBLIC_SITE || info.site || '').replace(/\/+$/, '');
export const isRailwayHost = (host) => /\.up\.railway\.app$/i.test(String(host ?? '').split(':')[0]);
/** The address to put in links on a page served to `req`: the clinic's domain when it was reached on the Railway address. */
export function siteFor(req) {
  if (PUBLIC_SITE && isRailwayHost(req.headers.host)) return PUBLIC_SITE;
  const proto = req.headers['x-forwarded-proto'] === 'http' || (!req.headers['x-forwarded-proto'] && !req.socket.encrypted) ? 'http' : 'https';
  return `${proto}://${req.headers.host}`;
}
/**
 * Public pages people open from a link or QR code (booking page, clinic page, owner page, collar tag, lab extranet)
 * opened on the Railway address are sent to the same page on the clinic's domain. Only the page itself: the apps'
 * API, files, calendar feeds and live updates keep answering on both addresses.
 */
export function redirectToSite(req, res, url) {
  if (!PUBLIC_SITE || (req.method !== 'GET' && req.method !== 'HEAD') || !isRailwayHost(req.headers.host)) return false;
  const p = url.pathname;
  const page = /^\/(book|clinic|lab)\/?$/.test(p) || /^\/(o|t)\/[^/]+\/?$/.test(p);
  if (!page) return false;
  res.writeHead(302, { Location: `${PUBLIC_SITE}${p}${url.search}`, 'Cache-Control': 'no-cache' });
  res.end();
  return true;
}
