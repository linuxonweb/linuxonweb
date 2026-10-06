import { currentEnvironment } from './benchmark-diagnostics.sys.mjs';
/* Narrow untimed acquisition only. No evaluation in the target, function
 * replacement, timer changes, Debugger, observer, or requested arm values. */
export const SETTLE_MS = 15000;
export function targetURL(label) {
  if (!/^[ab]-[1-6]$/.test(label)) throw Error('owned benchmark label required');
  return 'file:///home/admin/pblbench/pblbench-' + label + '.html';
}
export function acquire(targetWindow, event, dependencies) {
  const { Cu, Services } = dependencies;
  const document = targetWindow.document, uri = document.documentURI;
  const match = /^file:\/\/\/home\/admin\/pblbench\/pblbench-([ab]-[1-6])\.html$/.exec(uri);
  if (!match || targetURL(match[1]) !== uri) throw Error('unowned target URI');
  const child = targetWindow.windowGlobalChild;
  const live = () => child?.isCurrentGlobal === true && child.isClosed === false &&
    targetWindow.document === document && document.documentURI === uri &&
    targetWindow.windowGlobalChild === child &&
    Cu.waiveXrays(child.contentWindow) === Cu.waiveXrays(targetWindow);
  if (!live()) throw Error('live matching target WindowGlobal required');
  if (event.type !== 'DOMContentLoaded' || event.isTrusted !== true || event.target !== document || document.readyState !== 'interactive') throw Error('actual target DOMContentLoaded required');
  const before = targetWindow.performance.now();
  if (!Number.isFinite(before) || before < 0 || before >= SETTLE_MS) throw Error('untimed acquisition deadline missed');
  if (typeof Cu.getJSTestingFunctions !== 'function') throw Error('JSTestingFunctions unavailable');
  const testing = Cu.getJSTestingFunctions();
  if (!testing || typeof testing.getJitCompilerOptions !== 'function') throw Error('getJitCompilerOptions unavailable');
  // Direct synchronous call in the child actor's target content process/main
  // thread JSContext. Do not move into parent console or a fresh sandbox.
  const options = testing.getJitCompilerOptions();
  if (!options || typeof options !== 'object') throw Error('compiler options unavailable');
  const hasEnable = Object.prototype.hasOwnProperty.call(options, 'pbl.enable');
  const hasWarmup = Object.prototype.hasOwnProperty.call(options, 'pbl.warmup.threshold');
  const enable = Reflect.get(options, 'pbl.enable'), warmup = Reflect.get(options, 'pbl.warmup.threshold');
  if (!hasEnable || !hasWarmup || typeof enable !== 'number' || (enable !== 0 && enable !== 1) || typeof warmup !== 'number' || warmup !== 10) throw Error('missing or invalid numeric PBL compiler options');
  const restartPref = Services.prefs.getBoolPref('javascript.options.portable_baseline');
  if (typeof restartPref !== 'boolean') throw Error('actual boolean restart preference required');
  const after = targetWindow.performance.now(), windowId = String(child.innerWindowId);
  if (!live() || !/^[1-9][0-9]*$/.test(windowId) || !Number.isFinite(after) || after < before || after >= SETTLE_MS) throw Error('target changed or acquisition late');
  const app = Services.appinfo;
  if (!Number.isSafeInteger(app.processID) || app.processID <= 0 || ![0, 2].includes(app.processType)) throw Error('actual content process identity required');
  return { schema:1, kind:'actual-firefox-benchmark-content-options-v1', status:'recorded', label:match[1],
    diagnosticEnvironment:currentEnvironment(Services), optionContext:'benchmark-target-content', documentURI:uri, windowId, processID:app.processID, processType:app.processType,
    version:app.version, platformVersion:app.platformVersion, OS:app.OS, XPCOMABI:app.XPCOMABI, appBuildID:app.appBuildID, platformBuildID:app.platformBuildID,
    liveCurrentGlobal:true, wrappedContentWindowMatches:true, getterSameJSContextAsTarget:true,
    restartPref, jitTestingFunctionsAvailable:true, jitCompilerOptionsGetterAvailable:true,
    pblEnableOwnProperty:hasEnable, pblWarmupOwnProperty:hasWarmup, portableBaselineOption:enable, pblWarmupThreshold:warmup,
    acquisitionEvent:event.type, acquisitionEventTrusted:event.isTrusted, acquisitionTargetDocumentURI:uri, acquisitionDocumentReadyState:document.readyState, targetPerformanceBeforeMs:before,
    targetPerformanceAfterMs:after, targetTimeOrigin:targetWindow.performance.timeOrigin, unchangedSettleMs:SETTLE_MS,
    acquiredBeforeTimedStart:true, runtimeAcceptance:false, fullJITAcceptance:false, gpuAcceptance:false };
}
