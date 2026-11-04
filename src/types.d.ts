declare const __CLOUD__: boolean;

declare module 'sql.js/dist/sql-asm.js' {
  import type initSqlJs from 'sql.js';
  const init: typeof initSqlJs;
  export default init;
}
