// A QR code as an inline SVG, for pages the clinic server draws (same generator as the app's QrCode).
import qrcode from 'qrcode-generator';

export function qrSvg(text, { size = 120, label = '' } = {}) {
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  const n = q.getModuleCount();
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!q.isDark(r, c)) continue;
      let run = 1;
      while (c + run < n && q.isDark(r, c + run)) run++;
      d += `M${c + 4} ${r + 4}h${run}v1h-${run}z`;
      c += run - 1;
    }
  }
  const esc = (v) => String(v).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n + 8} ${n + 8}" width="${size}" height="${size}" role="img" aria-label="${esc(label)}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
