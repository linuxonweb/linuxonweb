// Run from the actual guest Firefox Browser Console, never the host console.
// Current Nightly159 APIs; preparation only until run in the completed guest.
const { NetUtil } = ChromeUtils.importESModule('resource://gre/modules/NetUtil.sys.mjs');
const db = Cc['@mozilla.org/security/x509certdb;1'].getService(Ci.nsIX509CertDB);
const modules = Cc['@mozilla.org/security/pkcs11moduledb;1'].getService(Ci.nsIPKCS11ModuleDB);
const ensure = (ok, message) => { if (!ok) throw Error(message); };
const normalized = cert => cert.sha256Fingerprint.replaceAll(':', '').toLowerCase();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function snapshot() {
  const certs = await db.getCerts();
  return {
    certificates: certs.map(c => ({ sha256: normalized(c), token: c.tokenName, dbKey: c.dbKey,
      ssl: db.isCertTrusted(c, Ci.nsIX509Cert.CA_CERT, Ci.nsIX509CertDB.TRUSTED_SSL),
      email: db.isCertTrusted(c, Ci.nsIX509Cert.CA_CERT, Ci.nsIX509CertDB.TRUSTED_EMAIL) })).sort((a, b) => (a.sha256 + a.token).localeCompare(b.sha256 + b.token)),
    modules: (await modules.listModules()).map(m => ({ name: m.name, libName: m.libName,
      slots: m.slots.map(s => {
        const slot = { name: s.name, status: s.status, tokenName: s.tokenName };
        try { const t = s.getToken(); return { ...slot, isInternalKeyToken: t.isInternalKeyToken,
          hasPassword: t.hasPassword, canHavePassword: t.canHavePassword, tokenSerialNumber: t.tokenSerialNumber }; }
        catch (error) { return { ...slot, tokenUnavailable: String(error) }; }
      }) })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export function comparePreservation(before, after) {
  // Startup may add new default roots. Existing certificates/trust/modules must
  // remain present. Explicit distrust versus zero trust needs behavior/raw DB.
  for (const c of before.certificates) ensure(after.certificates.some(a => JSON.stringify(a) === JSON.stringify(c)), 'existing certificate/trust changed: ' + c.sha256);
  for (const m of before.modules) ensure(after.modules.some(a => JSON.stringify(a) === JSON.stringify(m)), 'existing module/token metadata changed: ' + m.name);
  return { exposedStatePreserved: true, rawKeyPasswordMetadataPreserved: 'not established', explicitDistrustPreserved: 'requires behavioral/raw database evidence' };
}

function verify(cert, hostname, time) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('certificate verification timeout')), 30000);
    try {
      db.asyncVerifyCertAtTime(cert, Ci.nsIX509CertDB.verifyUsageTLSServer,
        Ci.nsIX509CertDB.FLAG_LOCAL_ONLY, hostname, time, [], {
          verifyCertFinished(error, chain, ev) { clearTimeout(timer); resolve({ error, chain: (chain || []).map(normalized), ev }); },
        });
    } catch (error) { clearTimeout(timer); reject(error); }
  });
}

function transport(url) {
  const channel = Services.io.newChannelFromURI(Services.io.newURI(url), null,
    Services.scriptSecurityManager.getSystemPrincipal(), null,
    Ci.nsILoadInfo.SEC_ALLOW_CROSS_ORIGIN_SEC_CONTEXT_IS_NULL, Ci.nsIContentPolicy.TYPE_OTHER);
  channel.loadFlags |= Ci.nsIRequest.LOAD_BYPASS_CACHE | Ci.nsIRequest.INHIBIT_CACHING;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { channel.cancel(Cr.NS_ERROR_ABORT); reject(Error('TLS channel timeout')); }, 30000);
    NetUtil.asyncFetch(channel, (stream, status, request) => {
      clearTimeout(timer);
      try {
        const security = request.QueryInterface(Ci.nsIChannel).securityInfo?.QueryInterface(Ci.nsITransportSecurityInfo);
        const body = Components.isSuccessCode(status) ? NetUtil.readInputStreamToString(stream, stream.available()) : '';
        resolve({ url: request.QueryInterface(Ci.nsIChannel).URI.spec, status,
          body, error: security?.errorCode ?? null, errorName: security?.errorCodeString ?? null,
          securityState: security?.securityState ?? null, serverSHA256: security?.serverCert ? normalized(security.serverCert) : null });
      } catch (error) { reject(error); }
    });
  });
}

async function visiblePage(url, expectedNonce, positive) {
  const win = Services.wm.getMostRecentWindow('navigator:browser');
  ensure(win?.gBrowser, 'actual browser UI required');
  const browser = win.gBrowser.selectedBrowser;
  browser.loadURI(Services.io.newURI(url), { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
  const deadline = Date.now() + 45000;
  let result;
  do {
    await delay(200);
    result = { url: browser.currentURI.spec, documentURI: browser.browsingContext.currentWindowGlobal?.documentURI.spec,
      title: browser.contentTitle, securityState: browser.securityUI.state };
    if (positive && result.url === url && result.title === expectedNonce) break;
    if (!positive && result.url === url && /^about:(certerror|neterror)/.test(result.documentURI)) break;
  } while (Date.now() < deadline);
  ensure(positive ? result.title === expectedNonce && Boolean(result.securityState & Ci.nsIWebProgressListener.STATE_IS_SECURE) :
    /^about:(certerror|neterror)/.test(result.documentURI) && !result.title.includes(expectedNonce), 'rendered TLS page/interstitial mismatch: ' + JSON.stringify(result));
  return result;
}

async function runImpl({ expectedPath, fixturePath, endpointsPath, outputPath, installFixtures = false }) {
  ensure(Services.appinfo.version === '159.0a1', 'actual Nightly159 required');
  const expected = await IOUtils.readJSON(expectedPath);
  const result = { schema: 1, guestAcceptance: false, version: Services.appinfo.version, appBuildID: Services.appinfo.appBuildID,
    profile: PathUtils.profileDir, before: await snapshot(), cases: [], limitations: [
      'XPConnect cannot expose raw purpose/distrust-date attributes; raw module gate remains required.',
      'App identity must be bound to compiled stamps, binary/fpcast/package hashes by the outer guest runner.',
      'Fresh/no-seed before-start evidence, stopped database/key/password integrity, update/warm runs, real public chains and screenshots are separate required gates.',
    ] };
  const actualCerts = await db.getCerts();
  const found = new Set(actualCerts.map(normalized));
  for (const r of expected.records) ensure(found.has(r.sha256), 'missing current DER: ' + r.label);
  result.sourceDERPresent = true;
  // Token association and modules are retained for independent review, not
  // inferred from a localized token name or from total certificate counts.
  if (installFixtures) {
    const fixture = await IOUtils.readJSON(fixturePath);
    ensure(fixture.purpose === 'dedicated-profile-only', 'fixture scope mismatch');
    ensure(await IOUtils.readUTF8(PathUtils.join(PathUtils.profileDir, 'nightly-nss-owned-profile')) === fixture.rootSHA256 + '\n', 'dedicated profile marker required before fixture CA installation');
    const override = PathUtils.join(PathUtils.profileDir, 'cert_override.txt');
    ensure(!(await IOUtils.exists(override)) || (await IOUtils.stat(override)).size === 0, 'certificate exceptions forbidden');
    const root = db.addCertFromBase64(fixture.rootBase64, 'CT,,');
    ensure(normalized(root) === fixture.rootSHA256, 'fixture CA DER mismatch');
    const endpoints = endpointsPath && await IOUtils.readJSON(endpointsPath);
    for (const row of fixture.cases) {
      const cert = db.constructX509FromBase64(row.derBase64);
      ensure(normalized(cert) === row.sha256, 'fixture leaf DER mismatch');
      const verification = await verify(cert, fixture.hostname, fixture.verifyTime);
      ensure(verification.error === row.expectedPRError, 'unexpected certificate verification: ' + row.name + ' ' + verification.error);
      const evidence = { name: row.name, verification };
      if (endpoints) {
        const url = endpoints.urls[row.name];
        ensure(new URL(url).hostname === fixture.hostname, 'fixture endpoint hostname mismatch');
        evidence.transport = await transport(url);
        ensure(evidence.transport.error === row.expectedPRError, 'actual TLS certificate error mismatch: ' + row.name);
        if (row.expectedPRError === 0) ensure(evidence.transport.body.includes(row.nonce) && evidence.transport.serverSHA256 === row.sha256, 'valid TLS response mismatch');
        else ensure(!evidence.transport.body.includes(row.nonce), 'negative TLS nonce delivered');
        evidence.visible = await visiblePage(url, row.nonce, row.expectedPRError === 0);
      }
      result.cases.push(evidence);
    }
    const valid = db.constructX509FromBase64(fixture.cases.find(c => c.name === 'valid').derBase64);
    db.setCertTrustFromString(root, 'p,,');
    const distrust = await verify(valid, fixture.hostname, fixture.verifyTime);
    ensure(distrust.error === -8172, 'new explicit distrust not effective in same session');
    let distrustTransport;
    if (endpoints) {
      distrustTransport = await transport(endpoints.urls.valid);
      ensure(distrustTransport.error === -8172 && !distrustTransport.body.includes(fixture.cases.find(c => c.name === 'valid').nonce), 'actual TLS did not refresh explicit distrust');
    }
    db.setCertTrustFromString(root, ',,');
    const zero = await verify(valid, fixture.hostname, fixture.verifyTime);
    ensure(zero.error === -8179, 'zero-trust chain unexpectedly trusted');
    result.trustRefresh = { distrust, distrustTransport, zero };
    // Leave the fixture CA at zero trust for future actual update/warm evidence.
    result.after = await snapshot();
  }
  await IOUtils.writeJSON(outputPath, result);
  console.log('NIGHTLYNSS ' + JSON.stringify({ outputPath, guestAcceptance: false, cases: result.cases.length }));
  return result;
}

export async function run(options) {
  try { return await runImpl(options); }
  catch (error) {
    await IOUtils.writeJSON(options.outputPath, { schema: 1, guestAcceptance: false,
      preparationDriverFailed: true, error: String(error), stack: error.stack });
    throw error;
  }
}
