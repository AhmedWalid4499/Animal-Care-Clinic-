// QR codes (owner page card, collar tags, and the clinic QR at the bottom left of every printed document).
import { useMemo } from 'react';
import qrcode from 'qrcode-generator';
import { serverUrl } from '../sync/engine';
import info from '../lib/clinic-info.json';

/** The clinic's own page on the clinic server (server/clinic-page.mjs): name, head, address, phone, InstaPay. */
export const clinicPageUrl = () => `${serverUrl() ?? info.site}/clinic`;

/** QR code as crisp SVG (one path; dark modules on white with the 4-module quiet zone scanners need). */
export function QrCode({ text, size = 176, label }: { text: string; size?: number; label?: string }) {
  const { d, n } = useMemo(() => {
    const q = qrcode(0, 'M');
    q.addData(text);
    q.make();
    const count = q.getModuleCount();
    let path = '';
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) {
        if (!q.isDark(r, c)) continue;
        let run = 1;
        while (c + run < count && q.isDark(r, c + run)) run++;
        path += `M${c + 4} ${r + 4}h${run}v1h-${run}z`;
        c += run - 1;
      }
    }
    return { d: path, n: count + 8 };
  }, [text]);
  return (
    <svg className="qr" width={size} height={size} viewBox={`0 0 ${n} ${n}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect width={n} height={n} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}

