// 32-bit Windows build (7 Nov 2026, at Ahmed's request), for clinic PCs running 32-bit Windows 10/11.
// Same app and settings as the 64-bit build in package.json "build"; only the architecture, the output folder and the
// file names differ. On Windows the update feed is named by channel, not architecture, so this build's latest.yml is
// published as ia32.yml (.github/workflows/windows.yml) and 32-bit installs read that one (electron/updater.cjs).
// Don't rename these files: installed 32-bit apps update from them.
const base = require('./package.json').build;

// Electron stopped publishing 32-bit Windows builds at v44 (the 64-bit app runs on 44). The 43 series still has them
// and gets security fixes until it reaches end of life in January 2027; after that there is no supported 32-bit
// Electron, and 32-bit PCs should move to 64-bit Windows (or use the clinic server in Chrome).
const ELECTRON_32BIT = '43.8.7';

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
