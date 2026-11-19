// Checks electron/certs.cjs (the old-Windows certificate fallback) with certificates made on the spot by openssl:
// a good chain passes; a wrong host, an unknown root, a wrong clock, a missing intermediate and a non-CA issuer fail.
// Run: node scripts/cert-check.cjs   (needs openssl on the PATH)
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { X509Certificate } = require('node:crypto');
const { trustedByBundledRoots } = require('../electron/certs.cjs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cert-check-'));
const f = (n) => path.join(dir, n);
const ssl = (...a) => execFileSync('openssl', a, { stdio: 'pipe' });
fs.writeFileSync(f('ext.cnf'), '[ca]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n[leaf]\nbasicConstraints=CA:FALSE\nsubjectAltName=DNS:clinic.example.app\n');
ssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', f('root.key'), '-out', f('root.pem'), '-days', '3650', '-subj', '/CN=Test Root', '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign');
ssl('req', '-newkey', 'rsa:2048', '-nodes', '-keyout', f('int.key'), '-out', f('int.csr'), '-subj', '/CN=Test Intermediate');
ssl('x509', '-req', '-in', f('int.csr'), '-CA', f('root.pem'), '-CAkey', f('root.key'), '-CAcreateserial', '-out', f('int.pem'), '-days', '1000', '-extfile', f('ext.cnf'), '-extensions', 'ca');
ssl('req', '-newkey', 'rsa:2048', '-nodes', '-keyout', f('leaf.key'), '-out', f('leaf.csr'), '-subj', '/CN=clinic.example.app');
ssl('x509', '-req', '-in', f('leaf.csr'), '-CA', f('int.pem'), '-CAkey', f('int.key'), '-CAcreateserial', '-out', f('leaf.pem'), '-days', '90', '-extfile', f('ext.cnf'), '-extensions', 'leaf');
ssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', f('other.key'), '-out', f('other.pem'), '-days', '3650', '-subj', '/CN=Test Root', '-addext', 'basicConstraints=critical,CA:TRUE');

const r = (n) => fs.readFileSync(f(n), 'utf8');
const root = new X509Certificate(r('root.pem'));
const other = new X509Certificate(r('other.pem'));
const chain = [r('leaf.pem'), r('int.pem')];
const host = 'clinic.example.app';
const now = new Date();
const cases = [
  ['good chain, right host', trustedByBundledRoots(chain, host, now, [root]), true],
  ['chain sent with its root', trustedByBundledRoots([...chain, r('root.pem')], host, now, [root]), true],
  ['wrong host', trustedByBundledRoots(chain, 'evil.example.app', now, [root]), false],
  ['unknown root (same name, other key)', trustedByBundledRoots(chain, host, now, [other]), false],
  ['clock two years ahead', trustedByBundledRoots(chain, host, new Date(Date.now() + 2 * 365 * 864e5), [root]), false],
  ['clock in the past', trustedByBundledRoots(chain, host, new Date('2020-01-01'), [root]), false],
  ['no intermediate', trustedByBundledRoots([r('leaf.pem')], host, now, [root]), false],
  ['issuer that is not a CA', trustedByBundledRoots([r('leaf.pem'), r('leaf.pem')], host, now, [root]), false],
  ["built-in list has Let's Encrypt's ISRG Root X1", require('node:tls').rootCertificates.some((p) => new X509Certificate(p).subject.includes('ISRG Root X1')), true],
];
let bad = 0;
for (const [name, got, want] of cases) {
  console.log(`${got === want ? 'PASS' : 'FAIL'}  ${name}`);
  if (got !== want) bad++;
}
fs.rmSync(dir, { recursive: true, force: true });
console.log(bad ? `${bad} failed` : `${cases.length}/${cases.length} passed`);
process.exit(bad ? 1 : 0);
