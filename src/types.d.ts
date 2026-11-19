declare const __CLOUD__: boolean;
/** package.json version, baked in at build time. */
declare const __APP_VERSION__: string;
/** Unique per build of the web app; the cloud build also writes it to /version.json so open apps see a new deploy. */
declare const __BUILD_ID__: string;

declare module 'sql.js/dist/sql-asm.js' {
  import type initSqlJs from 'sql.js';
  const init: typeof initSqlJs;
  export default init;
}
