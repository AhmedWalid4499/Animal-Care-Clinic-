// Screenshots for the web app's install dialog (public-cloud/manifest.webmanifest "screenshots"): Chrome shows
// them when installing on a Chromebook (wide) or an Android phone (narrow). Taken from the demo build.
// Usage: npm run build:web && node scripts/install-screenshots.mjs  → public-cloud/screenshots/*.png
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const { chromium } = createRequire(import.meta.url)('playwright');
const page = path.resolve('dist-web/index.html');
if (!fs.existsSync(page)) throw new Error('Run npm run build:web first');
const out = path.resolve('public-cloud/screenshots');
fs.mkdirSync(out, { recursive: true });

const shots = [
  // Chromebook: a common 1366×768 screen, the app in its own window (no browser bar).
  { file: 'chromebook-dashboard.png', viewport: { width: 1366, height: 768 }, scale: 1, ua: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36' },
  { file: 'phone-dashboard.png', viewport: { width: 390, height: 800 }, scale: 2, ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36' },
];

const browser = await chromium.launch();
for (const s of shots) {
  const ctx = await browser.newContext({ viewport: s.viewport, deviceScaleFactor: s.scale, userAgent: s.ua, colorScheme: 'light' });
  const p = await ctx.newPage();
  await p.goto(`file://${page}`);
  await p.waitForSelector('form');
  await p.getByRole('button', { name: 'مدير' }).click();
  await p.locator('form button.primary').click();
  await p.waitForSelector('.searchbox');
  // No demo banner in the store picture: it is the real app's look that matters.
  await p.addStyleTag({ content: '.demo-banner, .install-banner { display: none !important; }' });
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(800);
  await p.screenshot({ path: path.join(out, s.file) });
  console.log('wrote', path.join(out, s.file));
  await ctx.close();
}
await browser.close();
