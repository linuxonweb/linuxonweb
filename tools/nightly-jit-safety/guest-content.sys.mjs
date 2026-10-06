/* Actual guest privileged content driver. Loaded in the target process through
 * a narrowly registered JSWindowActor, including for remote Firefox tabs. */
const { Services } = ChromeUtils.importESModule('resource://gre/modules/Services.sys.mjs');
const { setTimeout } = ChromeUtils.importESModule('resource://gre/modules/Timer.sys.mjs');
const scopes = { 'gc-debug-coverage':'run', incremental:'incremental', 'slice-gc':'sliceGC', interrupt:'interrupt' };
const bounded = (value, label, mismatch=false) => { if (!value) { const error=Error(label);error.gateMismatch=mismatch;throw error; } };

export async function invoke(targetWindow, options, IOUtils) {
  const { label, scope, expectedBuildID, portableBaseline } = options;
  bounded(/^[A-Za-z0-9_-]{1,64}$/.test(label), 'owned label required');
  const base = '/home/admin/nightly-jit-safety/' + label + '/';
  const url = 'file://' + base + label + '.html';
  const result = { schema:1, kind:'actual-firefox-jit-gate-operation', label, scope,
    status:'pending', guestAcceptance:false, fullJITAcceptance:false, gpuAcceptance:false };
  const logs = []; let sandbox;
  try {
    bounded(scope === 'identity' || Object.hasOwn(scopes, scope), 'unknown privileged scope');
    bounded(targetWindow.document.documentURI === url, 'actor target is not the owned fixture');
    const child = targetWindow.windowGlobalChild;
    bounded(child?.isCurrentGlobal && !child.isClosed && Components.utils.waiveXrays(child.contentWindow) === Components.utils.waiveXrays(targetWindow), 'live local content global required');
    bounded(Services.appinfo.version === '159.0a1' && Services.appinfo.appBuildID === expectedBuildID && Services.appinfo.platformBuildID === expectedBuildID, 'actual compiled Nightly identity mismatch', true);
    const testing = Components.utils.getJSTestingFunctions();
    bounded(typeof testing.getJitCompilerOptions === 'function', 'actual JIT option API unavailable');
    const options = testing.getJitCompilerOptions();
    bounded(options['pbl.enable'] === Number(portableBaseline) && options['pbl.warmup.threshold'] === 10, 'actual portable tier option/threshold mismatch', true);
    result.identity = { version:Services.appinfo.version, applicationBuildID:Services.appinfo.appBuildID,
      platformBuildID:Services.appinfo.platformBuildID, processID:Services.appinfo.processID,
      processType:Services.appinfo.processType, windowId:String(child.innerWindowId),
      actualJitOptions:options, startupPref:Services.prefs.getBoolPref('javascript.options.portable_baseline'),
      contentHardwareConcurrency:targetWindow.navigator.hardwareConcurrency, documentURI:url };
    bounded(result.identity.startupPref === portableBaseline, 'startup preference mismatch', true);
    const target = Components.utils.waiveXrays(targetWindow);
    result.fixture = { mainDone:target.nightlySafetyMainDone === true, workerDone:target.nightlySafetyWorkerDone === true, error:target.nightlySafetyError || null };
    if (scope === 'identity') { result.status = 'recorded'; return result; }
    bounded(portableBaseline === true, 'privileged specializer gates require enabled arm');
    bounded(result.fixture.mainDone && result.fixture.workerDone && !result.fixture.error, 'actual main and Worker fixture not completed');
    for (const name of ['gcstate','startgc','finishgc','gcslice']) bounded(typeof testing[name] === 'function', 'privileged API unavailable: ' + name);
    if (scope === 'gc-debug-coverage') {
      bounded(typeof Components.utils.forceGC === 'function', 'forceGC API unavailable');
      const { addDebuggerToGlobal } = ChromeUtils.importESModule('resource://gre/modules/jsdebugger.sys.mjs');
      bounded(typeof addDebuggerToGlobal === 'function', 'actual Debugger installation unavailable');
    }
    const observerLogPath = base + 'observer.stderr';
    bounded(await IOUtils.exists(observerLogPath), 'direct native observer stderr missing');
    sandbox = Components.utils.Sandbox(Services.scriptSecurityManager.getSystemPrincipal(),
      { sandboxName:'NightlyJitSafety-' + label, freshCompartment:true, wantGlobalProperties:['TextDecoder'] });
    Object.assign(sandbox, { Services, Components, ChromeUtils, IOUtils, TextDecoder, setTimeout,
      console:{ log(line) { bounded(typeof line === 'string' && line.startsWith('NJS_PRIV '), 'unexpected privileged transcript');
        bounded(logs.length < 128 && line.length < 65536, 'privileged transcript cap'); logs.push(line); console.log(line); } } });
    Services.scriptloader.loadSubScript('file://' + base + 'privileged-driver.js', sandbox);
    bounded(typeof sandbox.NightlySafetyDriver?.[scopes[scope]] === 'function', 'actual driver unavailable');
    result.status = 'running';
    await sandbox.NightlySafetyDriver[scopes[scope]](targetWindow, observerLogPath);
    result.status = 'recorded'; // Native raw check is independent; no acceptance here.
  } catch (error) {
    result.status = result.status === 'running' || error.gateMismatch ? 'failed' : 'pending';
    result.error = String(error); result.stack = error.stack;
  } finally {
    if (sandbox) Components.utils.nukeSandbox(sandbox);
    if (scope !== 'identity') {
      await IOUtils.writeUTF8(base + scope + '-console.txt', logs.join('\n') + '\n');
      await IOUtils.writeJSON(base + scope + '-result.json', result);
    }
  }
  return result;
}
