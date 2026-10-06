/* Import this from the actual Browser Console. It owns only its file fixture
 * actor; it does not change startup tier preferences, kill Firefox, or quit. */
const { Services } = ChromeUtils.importESModule('resource://gre/modules/Services.sys.mjs');
const { setTimeout, clearTimeout } = ChromeUtils.importESModule('resource://gre/modules/Timer.sys.mjs');
Components.utils.importGlobalProperties(['IOUtils']);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function query(actor, data, milliseconds) {
  let timer;
  try {
    return await Promise.race([
      actor.sendQuery('NightlyJitSafety:Invoke', data),
      new Promise((resolve, reject) => { timer = setTimeout(() => reject(Error('bounded content query deadline: ' + data.scope)), milliseconds); }),
    ]);
  } finally { clearTimeout(timer); }
}
function mismatch(message) { const error = Error(message); error.gateMismatch = true; throw error; }

export async function run(sessionPath) {
  if (!/^\/home\/admin\/nightly-jit-safety\/[A-Za-z0-9_-]{1,64}\/session\.json$/.test(sessionPath)) throw Error('owned session path required');
  const contract = await IOUtils.readJSON(sessionPath);
  const base = sessionPath.slice(0, -'session.json'.length), label = contract.label;
  if (base !== '/home/admin/nightly-jit-safety/' + label + '/' || contract.kind !== 'nightly-jit-guest-session-preparation-v1' || contract.version !== '159.0a1' || contract.buildIdentityBound !== true || contract.nativeEnvironmentSlotCount !== 23 || !/^\d{14}$/.test(contract.localBuildID) || typeof contract.portableBaseline !== 'boolean') throw Error('invalid or unbuilt session contract');
  const result = { schema:1, kind:'actual-firefox-jit-gate-session', label,
    portableBaseline:contract.portableBaseline, status:'pending', operations:[],
    fullJITAcceptance:false, guestAcceptance:false, gpuAcceptance:false,
    limitations:['Recorded operations require independently pinned native stderr and raw checkers.', 'Outer runner owns the finite wall deadline and actual kernel/host/browser CPU evidence.', 'Native TLS/stack, mutation guards, baseline/TLS and all eight performance comparisons remain independent.'] };
  const name = 'NightlyJitSafety'; let registered = false;
  try {
    const main = Services.wm.getMostRecentWindow('navigator:browser');
    if (!main?.gBrowser) throw Error('actual Firefox browser required');
    const url = 'file://' + base + label + '.html';
    ChromeUtils.registerWindowActor(name, { child:{esModuleURI:'file://' + base + 'NightlyJitSafetyChild.sys.mjs'}, parent:{esModuleURI:'file://' + base + 'NightlyJitSafetyParent.sys.mjs'}, matches:[url], allFrames:false });
    registered = true;
    const browser = main.gBrowser.selectedBrowser;
    browser.loadURI(Services.io.newURI(url), { triggeringPrincipal:Services.scriptSecurityManager.getSystemPrincipal() });
    const deadline = Date.now() + 90000;
    let identity;
    while (Date.now() < deadline) {
      const global = browser.browsingContext.currentWindowGlobal;
      if (global?.documentURI.spec === url) {
        identity = await query(global.getActor(name), { label, scope:'identity', expectedBuildID:contract.localBuildID, portableBaseline:contract.portableBaseline }, Math.min(15000, deadline - Date.now()));
        if (identity.status === 'recorded' && identity.fixture.mainDone && identity.fixture.workerDone) break;
        if (identity.status === 'failed') mismatch('content identity failed: ' + JSON.stringify(identity));
        if (identity.fixture?.error) mismatch(identity.fixture.error);
      }
      await delay(200);
    }
    result.identity = identity;
    if (!identity || identity.status !== 'recorded' || !identity.fixture.mainDone || !identity.fixture.workerDone) throw Error('bounded identity/main/Worker readiness pending: ' + JSON.stringify(identity));
    if (identity.identity.contentHardwareConcurrency !== contract.requestedGuestCpus) mismatch('Firefox content CPU count mismatch');
    result.status = 'recorded';
    if (contract.portableBaseline) {
      for (const scope of ['gc-debug-coverage','incremental','slice-gc','interrupt']) {
        const global = browser.browsingContext.currentWindowGlobal;
        if (String(global.innerWindowId) !== identity.identity.windowId) mismatch('fixture window replaced');
        const operation = await query(global.getActor(name), { label, scope, expectedBuildID:contract.localBuildID, portableBaseline:true }, 30000);
        result.operations.push(operation);
        if (operation.status !== 'recorded') { result.status = operation.status; break; }
      }
    }
  } catch (error) { result.status = error.gateMismatch ? 'failed' : 'pending'; result.error = String(error); result.stack = error.stack; }
  finally {
    if (registered) ChromeUtils.unregisterWindowActor(name);
    await IOUtils.writeJSON(base + 'session-result.json', result);
    console.log('NJS_SESSION ' + JSON.stringify(result));
  }
  return result;
}
