// Secure connections on old Windows (14 Nov 2026). The clinic PC with Windows 7 (32-bit build, Electron 22) said
// "Can't reach that address" for the clinic server: Electron 22 checks certificates against Windows' own list of
// trusted authorities, and an un-updated Windows 7 doesn't have the one that signs the clinic server's certificate
// (Let's Encrypt's ISRG Root X1). When — and only when — Chromium's sole objection is "authority not known", the
// chain is checked again here against the list built into the app (Node's, from Mozilla, the same one Firefox uses):
// the host name, every date, every signature, and an anchor in that list. Anything else (wrong date, wrong host,
// revoked, self-signed) keeps Chromium's verdict.
const tls = require('node:tls');
const { X509Certificate } = require('node:crypto');

let bundled = null;
function bundledRoots() {
  if (!bundled) {
    bundled = tls.rootCertificates.map((pem) => {
      try {
        return new X509Certificate(pem);
      } catch {
        return null;
      }
    }).filter(Boolean);
  }
  return bundled;
}

const inDate = (c, now) => now >= new Date(c.validFrom) && now <= new Date(c.validTo);

/**
 * Is this chain (PEM strings, the server's certificate first) valid for `hostname` at `now`, and anchored in `roots`
 * (default: the app's built-in list)?
 */
function trustedByBundledRoots(pems, hostname, now = new Date(), roots = bundledRoots()) {
  try {
    const chain = pems.map((p) => new X509Certificate(p));
    if (!chain.length || !chain[0].checkHost(hostname)) return false;
    if (!chain.every((c) => inDate(c, now))) return false;
    for (let i = 0; i + 1 < chain.length; i++) {
      const issuer = chain[i + 1];
      if (!issuer.ca || !chain[i].checkIssued(issuer) || !chain[i].verify(issuer.publicKey)) return false;
    }
    const top = chain[chain.length - 1];
    return roots.some((r) => r.ca && inDate(r, now) && (r.fingerprint256 === top.fingerprint256 || (top.checkIssued(r) && top.verify(r.publicKey))));
  } catch {
    return false;
  }
}

/** Electron's certificate (with its issuerCert links) as PEM strings, the server's first. */
function chainOf(cert) {
  const out = [];
  for (let c = cert; c && out.length < 10; c = c.issuerCert) {
    if (!c.data) break;
    out.push(c.data);
    if (c.issuerCert && c.issuerCert.fingerprint === c.fingerprint) break; // a self-signed root ends the chain
  }
  return out;
}

/** Windows only: give Chromium's "authority not known" a second check against the app's own list. */
function installCertificateFallback(session) {
  if (process.platform !== 'win32') return;
  session.setCertificateVerifyProc((req, callback) => {
    if (req.verificationResult === 'net::ERR_CERT_AUTHORITY_INVALID' && trustedByBundledRoots(chainOf(req.certificate), req.hostname)) return callback(0);
    callback(-3); // Chromium's own verdict
  });
}

/**
 * Why a server address doesn't answer, asked with Node's own network stack (its own certificate list, not Windows'):
 * { ok, status } when it answers, or { ok: false, code } (CERT_HAS_EXPIRED, CERT_NOT_YET_VALID, ENOTFOUND,
 * ETIMEDOUT, ECONNREFUSED, SELF_SIGNED_CERT_IN_CHAIN…). Used to tell the person what to fix.
 */
function probe(base) {
  return new Promise((resolve) => {
    let url;
    try {
      url = new URL(`${String(base).replace(/\/+$/, '')}/health`);
    } catch {
      return resolve({ ok: false, code: 'BAD_URL' });
    }
    const mod = url.protocol === 'http:' ? require('node:http') : require('node:https');
    const req = mod.get(url, { timeout: 8000 }, (res) => {
      res.resume();
      resolve({ ok: res.statusCode === 200, status: res.statusCode });
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
    req.on('error', (e) => resolve({ ok: false, code: e.code || 'ERROR' }));
  });
}

module.exports = { trustedByBundledRoots, chainOf, installCertificateFallback, probe };
