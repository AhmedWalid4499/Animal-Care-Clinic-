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
export default defineConfig(({ mode }) => ({
  base: mode === 'cloud' ? '/' : './',
  plugins: mode === 'web' ? [react(), viteSingleFile()] : mode === 'cloud' ? [react()] : [react(), csp],
  define: { __WEB_DEMO__: JSON.stringify(mode === 'web'), __CLOUD__: JSON.stringify(mode === 'cloud') },
  build: {
    outDir: mode === 'web' ? 'dist-web' : mode === 'cloud' ? 'dist-cloud' : 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 4000,
    assetsInlineLimit: mode === 'web' ? 100_000_000 : 4096,
  },
}));
