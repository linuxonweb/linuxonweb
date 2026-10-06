/* Actual parent acquisition followed by the existing narrowly scoped actor driver. */
Components.utils.importGlobalProperties(['IOUtils']);
export async function run(sessionPath) {
  if (!/^\/home\/admin\/nightly-jit-safety\/[A-Za-z0-9_-]{1,64}\/session\.json$/.test(sessionPath)) throw Error('owned session path required');
  const base = sessionPath.slice(0, -'session.json'.length), contract = await IOUtils.readJSON(sessionPath);
  const testing = Components.utils.getJSTestingFunctions();
  if (typeof testing.getJitCompilerOptions !== 'function') throw Error('actual parent option API unavailable');
  const actualJitOptions = testing.getJitCompilerOptions();
  const parent = { kind:'actual-nightly-broad-parent-options-v1', label:contract.label,
    version:Services.appinfo.version, applicationBuildID:Services.appinfo.appBuildID,
    platformBuildID:Services.appinfo.platformBuildID, processID:Services.appinfo.processID,
    processType:Services.appinfo.processType, startupPref:Services.prefs.getBoolPref('javascript.options.portable_baseline'),
    actualJitOptions, observerEnabled:Services.env.get('PBLJIT_OBSERVE'), logBudget:Services.env.get('PBLJIT_LOG') };
  await IOUtils.writeJSON(base + 'parent-option.json', parent);
  console.log('NJS_PARENT ' + JSON.stringify(parent));
  if (parent.version !== '159.0a1' || parent.applicationBuildID !== contract.localBuildID || parent.platformBuildID !== contract.localBuildID || parent.processType !== 0 || parent.startupPref !== contract.portableBaseline || !Object.hasOwn(actualJitOptions,'pbl.enable') || actualJitOptions['pbl.enable'] !== Number(contract.portableBaseline) || actualJitOptions['pbl.warmup.threshold'] !== 10 || parent.observerEnabled !== '1' || parent.logBudget !== '0') throw Error('actual parent build/options/environment mismatch');
  const entry = ChromeUtils.importESModule(import.meta.url.replace(/[^/]+$/, 'guest-entry.sys.mjs'));
  const result = await entry.run(sessionPath);
  console.log('NJS_RUNNER_DONE ' + JSON.stringify({label:contract.label,status:result.status,parentProcessID:parent.processID}));
  return result;
}
