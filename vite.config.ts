import fs from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Desktop build (default): dist/ is loaded by Electron from file://, so assets use relative paths
// and the page carries a strict CSP. Web build (--mode web): one self-contained HTML file used for
// the clickable prototype (demo data in the browser's IndexedDB).
const csp: Plugin = {
  name: 'desktop-csp',
  transformIndexHtml(html) {
    return html.replace(
      '<!--CSP-->',
      `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' data: blob: https: wss: http://localhost:* ws://localhost:* http://127.0.0.1:* ws://127.0.0.1:*; object-src 'none'; base-uri 'none'">`,
    );
  },
};

// Cloud build (--mode cloud): the web app the clinic server serves at its own address (phone, browser).
// It is installable (manifest) and has a service worker for push notifications (public-cloud/).
const cloudHead: Plugin = {
  name: 'cloud-head',
  transformIndexHtml(html) {
    return html.replace(
      '</head>',
      '  <link rel="manifest" href="/manifest.webmanifest" />\n    <meta name="theme-color" content="#2e6f73" />\n    <link rel="apple-touch-icon" href="/icon-192.png" />\n  </head>',
    );
  },
};
// Every build gets its own id. The cloud build also writes it to /version.json (never cached, see
// server/index.mjs), so an app left open all day on a Chromebook or phone notices a new deploy and offers to reload.
const APP_VERSION: string = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;
const BUILD_ID = `${APP_VERSION}+${new Date().toISOString().replace(/[-:]/g, '').slice(0, 13)}.${Math.random().toString(36).slice(2, 8)}`;
const cloudVersion: Plugin = {
  name: 'cloud-version',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version: APP_VERSION, build: BUILD_ID, builtAt: new Date().toISOString() }) });
  },
};

export default defineConfig(({ mode }) => ({
  publicDir: mode === 'cloud' ? 'public-cloud' : false,
  base: mode === 'cloud' ? '/' : './',
  plugins: mode === 'web' ? [react(), viteSingleFile()] : mode === 'cloud' ? [react(), cloudHead, cloudVersion] : [react(), csp],
  define: {
    __WEB_DEMO__: JSON.stringify(mode === 'web'),
    __CLOUD__: JSON.stringify(mode === 'cloud'),
    __APP_VERSION__: JSON.stringify(APP_VERSION),
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  build: {
    outDir: mode === 'web' ? 'dist-web' : mode === 'cloud' ? 'dist-cloud' : 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 4000,
    assetsInlineLimit: mode === 'web' ? 100_000_000 : 4096,
  },
}));
