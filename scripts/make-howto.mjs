// Render docs/how-to/how-to.html (Arabic page + English page) to an A4 PDF for printing.
// Usage: node scripts/make-howto.mjs  → docs/how-to/Animal-Care-Clinic-How-to.pdf
import { createRequire } from 'node:module';
import path from 'node:path';

const { chromium } = createRequire(import.meta.url)('playwright');
const src = path.resolve('docs/how-to/how-to.html');
const out = path.resolve('docs/how-to/Animal-Care-Clinic-How-to.pdf');
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`file://${src}`);
await page.evaluate(() => document.fonts.ready);
const overflow = await page.evaluate(() => [...document.querySelectorAll('.page')].map((p) => p.scrollHeight - p.clientHeight));
if (overflow.some((o) => o > 0)) console.warn('content taller than the page by', overflow, 'px');
await page.pdf({ path: out, format: 'A4', printBackground: true, preferCSSPageSize: true });
await browser.close();
console.log('wrote', out);
