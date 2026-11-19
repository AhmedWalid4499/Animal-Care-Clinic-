// 32-bit Windows build (7 Nov 2026, at Ahmed's request), for clinic PCs on 32-bit Windows and on Windows 7 / 8 / 8.1
// (32- or 64-bit). Same app and settings as the 64-bit build in package.json "build"; only the architecture, the
// Electron version, the output folder and the file names differ. On Windows the update feed is named by channel, not
// architecture, so this build's latest.yml is published as ia32.yml (.github/workflows/windows.yml) and 32-bit installs
// read that one (electron/updater.cjs). Don't rename these files: installed 32-bit apps update from them.
const base = require('./package.json').build;

// Electron 22 is the last release that runs on Windows 7 / 8 / 8.1 (14 Nov 2026). The first 32-bit build used
// Electron 43, whose exe is marked "Windows 10 or later": Windows 7 refuses it with "... is not a valid Win32
// application". 22 is the last version Windows 7 can start, so the 32-bit build stays on it. It is out of support
// (Chromium 108, no security fixes since Oct 2023) — acceptable for an app that only loads its own files and talks to
// the clinic server, but the long-term answer for those PCs is Windows 10/11 64-bit (the main build).
// Keep the code working on it: no net.fetch in Windows main-process code (updater.cjs getText() falls back), every CSS
// color-mix() has a plain colour before it, and PetPicker sits in <Field group>, not a <label>. scripts/check-legacy.mjs
// checks the exe header and the CSS; CI runs it and starts the 32-bit exe (--smoke).
const ELECTRON_32BIT = '22.3.27';

module.exports = {
  ...base,
  electronVersion: ELECTRON_32BIT,
  directories: { ...base.directories, output: 'release-ia32' },
  win: {
    ...base.win,
    target: [
      { target: 'nsis', arch: ['ia32'] },
      { target: 'portable', arch: ['ia32'] },
    ],
  },
  nsis: { ...base.nsis, artifactName: 'AnimalCareClinic-Setup-${version}-32bit.${ext}' },
  portable: { ...base.portable, artifactName: 'AnimalCareClinic-${version}-32bit-portable.exe' },
};
