// electron-builder afterPack hook (macOS only).
// There is no Apple Developer ID yet, so mac.identity is null and electron-builder skips signing.
// Apple Silicon Macs refuse to run an app whose signature is broken ("is damaged and can't be opened"),
// so we give the finished .app an ad-hoc signature. Gatekeeper still warns on first open (unidentified
// developer), which is handled by right-click → Open, see README.
// When a Developer ID certificate is bought: set mac.identity, enable notarize, and delete this hook.
const { execFileSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  // For a universal build this hook also runs on the x64/arm64 halves before they are merged;
  // signing those would make the halves differ and break the merge. Sign only the final app.
  if (context.appOutDir.endsWith('-temp')) return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
  console.log(`  • ad-hoc signed ${app}`);
};
