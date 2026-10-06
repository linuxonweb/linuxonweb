// Pure Nightly benchmark contracts; --self-test writes synthetic evidence only.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { DIAGNOSTIC_ENV_KEYS, PROC_LIMIT } from './benchmark-diagnostics.sys.mjs';
import { guestCpuChecks } from './firefox-host-cpus.mjs';

export const TASK = '/mnt/p6/build/firefox-nightly-benchmark-gate-20261002';
export const FIXTURE_SHA256 = 'b07d647a19177c276ea5c94df60d7557405d0a69a767d21d471d3071fa5e31d8';
export const EXPECTED = { 'int-loop': 49995000, 'call-recursion': 377, 'throw-flat': 500, 'throw-deep': 100, 'throw-error': 1700, 'prop-mono': 4003, 'native-call': 3999, json: 19900 };
const assert = (ok, message) => { if (!ok) throw Error(message); };
const digest = s => /^[a-f0-9]{64}$/.test(s || '');
const sha = b => createHash('sha256').update(b).digest('hex');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const median = xs => { const s = xs.slice().sort((a, b) => a - b), n = s.length; return n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2; };
export const fatalLines = logs => logs.split('\n').filter(l => /MOZ_CRASH|Assertion failure|panicked|Hit MOZ_|Segmentation fault|RuntimeError:|indirect call (?:type mismatch|to null)|wasm trap|\bAborted\b|\bSIGABRT\b|\bSIGSEGV\b|out of memory|oom-kill|Killed process|memory allocation failed/i.test(l));
export function payloads(logs, prefix) {
  return logs.split('\n').flatMap(l => { const i = l.indexOf('console.log: '); if (i < 0) return []; try { const s = JSON.parse(l.slice(i + 13)); return typeof s === 'string' && s.startsWith(prefix) ? [JSON.parse(s.slice(prefix.length))] : []; } catch { return []; } });
}

export function ownedBrowserEndpoint(activePortText, version, child) {
  assert(Number.isInteger(child?.pid) && child.pid > 0 && child.alive === true && child.ownedProfileArgument === true && child.exitCode === null && child.signalCode === null && !child.spawnError, 'live spawned Chromium child with owned profile/port arguments required');
  assert(child.freshProfile === true && child.activePortRegularFile === true && Number.isFinite(child.spawnedAt) && Number.isFinite(child.activePortMtimeMs) && child.activePortMtimeMs >= child.spawnedAt, 'fresh owned DevToolsActivePort required');
  const lines = activePortText.trim().split('\n');
  assert(lines.length === 2 && /^[1-9][0-9]*$/.test(lines[0]), 'invalid owned DevToolsActivePort');
  const port = Number(lines[0]), browserPath = lines[1];
  assert(Number.isInteger(port) && port <= 65535 && /^\/devtools\/browser\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(browserPath), 'invalid owned browser port/id');
  const url = new URL(version?.webSocketDebuggerUrl);
  assert(url.protocol === 'ws:' && url.hostname === '127.0.0.1' && Number(url.port) === port && url.pathname === browserPath && !url.username && !url.password && !url.search && !url.hash, 'CDP version endpoint differs from owned browser port/id');
  return { verified: true, port, browserPath, browserWebSocketURL: url.href, spawnedPid: child.pid, spawnedAt: child.spawnedAt, activePortMtimeMs: child.activePortMtimeMs, childAliveChecked: true, ownedProfileArgument: true, freshProfile: true, activePortRegularFile: true };
}

export function ownedPageEndpoint(target, endpoint) {
  assert(endpoint?.verified === true && target?.type === 'page' && typeof target.id === 'string' && /^[a-zA-Z0-9-]+$/.test(target.id), 'owned page target required');
  const url = new URL(target.webSocketDebuggerUrl);
  assert(url.protocol === 'ws:' && url.hostname === '127.0.0.1' && Number(url.port) === endpoint.port && url.pathname === '/devtools/page/' + target.id && !url.username && !url.password && !url.search && !url.hash, 'page websocket differs from owned browser endpoint');
  return url.href;
}

// Raw option values remain numeric. Presence/API evidence prevents a missing
// getter or property from being interpreted as the disabled arm.
export function runtimeTierChecks(actual, enabled) {
  return {
    realRestartPref: typeof actual?.restartPref === 'boolean' && actual.restartPref === enabled,
    testingFunctionsAvailable: actual?.jitTestingFunctionsAvailable === true,
    getterAvailable: actual?.jitCompilerOptionsGetterAvailable === true,
    enablePropertyAvailable: actual?.pblEnableOwnProperty === true,
    warmupPropertyAvailable: actual?.pblWarmupOwnProperty === true,
    strictNumericOption: typeof actual?.portableBaselineOption === 'number' && [0, 1].includes(actual.portableBaselineOption) && actual.portableBaselineOption === Number(enabled),
    actualWarmup10: typeof actual?.pblWarmupThreshold === 'number' && actual.pblWarmupThreshold === 10,
  };
}
export function benchmarkContentTierChecks(actual, enabled, label) {
  return {
    ...runtimeTierChecks(actual, enabled),
    targetContentContext: actual?.optionContext === 'benchmark-target-content',
    targetDocumentURI: actual?.documentURI === 'file:///home/admin/pblbench/pblbench-' + label + '.html',
    liveCurrentGlobal: actual?.liveCurrentGlobal === true && actual?.wrappedContentWindowMatches === true,
    actualWindowID: typeof actual?.windowId === 'string' && /^[1-9][0-9]*$/.test(actual.windowId),
    actualProcessID: Number.isSafeInteger(actual?.processID) && actual.processID > 0,
    // Single-process Firefox may use processType 0; remote content uses 2.
    actualProcessType: actual?.processType === 0 || actual?.processType === 2,
    sameTargetJSContext: actual?.getterSameJSContextAsTarget === true,
    beforeTimedStart: actual?.acquiredBeforeTimedStart === true && actual?.acquisitionEvent === 'DOMContentLoaded' && actual?.acquisitionEventTrusted === true && actual?.acquisitionTargetDocumentURI === actual?.documentURI && actual?.acquisitionDocumentReadyState === 'interactive' && actual?.unchangedSettleMs === 15000 && Number.isFinite(actual?.targetPerformanceBeforeMs) && actual.targetPerformanceBeforeMs >= 0 && Number.isFinite(actual?.targetPerformanceAfterMs) && actual.targetPerformanceAfterMs >= actual.targetPerformanceBeforeMs && actual.targetPerformanceAfterMs < 15000 && Number.isFinite(actual?.targetTimeOrigin) && actual.targetTimeOrigin > 0,
    parentTargetBinding: actual?.parentWindowIdMatches === true && actual?.parentProcessIDMatches === true && actual?.parentCurrentGlobalMatches === true,
    acquisitionStatus: actual?.kind === 'actual-firefox-benchmark-content-options-v1' && actual?.status === 'recorded' && actual?.label === label,
  };
}

export function primaryDiagnosticsChecks(actual) {
  const proof = actual?.primaryDiagnostics;
  const processOff = row => row?.kind === 'actual-firefox-primary-diagnostics-v1' && row.boundedComplete === true && row.primaryDiagnosticsOff === true &&
    Number.isSafeInteger(row.processID) && row.processID > 0 &&
    [row.commandLine,row.environment].every(raw => Number.isInteger(raw?.bytes) && raw.bytes > 0 && raw.bytes <= PROC_LIMIT && digest(raw.sha256)) &&
    Number.isSafeInteger(row.commandLine.argc) && row.commandLine.argc > 0 && row.commandLine.diagnosticArguments?.length === 0 &&
    DIAGNOSTIC_ENV_KEYS.every(key => typeof row.startup?.[key]?.exists === 'boolean' && (row.startup[key].exists ? typeof row.startup[key].value === 'string' : row.startup[key].value === null) && same(row.startup[key],row.current?.[key])) &&
    row.startup.PBLJIT_LOG.exists && row.startup.PBLJIT_LOG.value === '0' && row.startup.PBLJIT_OBSERVE.value !== '1' &&
    (!row.startup.PBLJIT.exists || row.startup.PBLJIT.value === '1');
  return { actualParentDiagnosticsOff:processOff(proof?.parent), actualTargetDiagnosticsOff:processOff(proof?.target),
    targetEnvironmentBinding:same(proof?.target?.current,actual?.diagnosticEnvironment) && !!actual?.diagnosticEnvironment,
    processBinding:proof?.target?.processID === actual?.processID && proof?.parent?.processID === actual?.parentObservedProcessID &&
      (actual?.processType === 0 ? actual.parentObservedInProcess === true && actual.parentObservedOSPid === -1 && actual.parentObservedProcessID === actual.processID :
        actual?.processType === 2 && actual.parentObservedInProcess === false && actual.parentObservedOSPid === actual.processID),
    beforeTimedStart:proof?.acquiredBeforeTimedStart === true && Number.isFinite(proof?.targetAgeMs) && proof.targetAgeMs >= actual?.targetPerformanceAfterMs && proof.targetAgeMs < 15000 };
}

export function tierEvidenceContract(tier, binding, enabled) {
  assert(tier?.kind === 'caller-reviewed-actual-nightly-same-binary-tier-evidence-v1' && tier.pass === true && tier.portableBaseline === enabled, 'actual tier acquisition required');
  for (const key of ['finalBinarySHA256', 'rawBinarySHA256', 'runtimeInventorySHA256']) assert(digest(binding[key]) && tier[key] === binding[key], 'actual tier acquisition identity mismatch ' + key);
  assert(tier.localBuildID === binding.compiled?.localBuildID && tier.originalFixtureSHA256 === FIXTURE_SHA256 && same(tier.nativeRawBinarySHA256, binding.nativeRawBinarySHA256), 'actual tier source/raw binding mismatch');
  const artifacts = tier.artifacts;
  assert(digest(tier.acquisitionSHA256) && digest(tier.reviewSHA256) && tier.acquisitionSHA256 !== tier.reviewSHA256 && Array.isArray(artifacts) && artifacts.length >= 2 && artifacts.every(e => e.path && digest(e.sha256)) && artifacts.some(e => e.sha256 === tier.acquisitionSHA256) && artifacts.some(e => e.sha256 === tier.reviewSHA256), 'raw acquisition/review artifact pins required');
  assert(Object.values(runtimeTierChecks(tier.startupIdentity, enabled)).every(Boolean), 'actual numeric startup getter proof required');
  // Worker evidence uses the frozen native ContextOptions getter observer.
  // Workers do not need an invented Cu/Services privileged JavaScript API.
  const worker = tier.workerOptionEvidence;
  assert(worker?.getterAvailable === true && typeof worker.option === 'number' && [0, 1].includes(worker.option) && worker.option === Number(enabled) && worker.threshold === 10 && tier.workerDistinctThread === true, 'actual numeric native Worker getter proof required');
  assert(tier.rawObservationComplete === true && tier.observerExhaustion === false, 'complete unexhausted raw observations required');
  assert(Number.isSafeInteger(tier.installCount) && Number.isSafeInteger(tier.executeCount) && tier.installCount >= 0 && tier.executeCount >= 0, 'actual native event counts required');
  assert(enabled ? tier.broadMainAdmissions === 14 && tier.broadWorkerAdmissions === 14 && tier.installCount > 0 && tier.executeCount > 0 && tier.originalIntLoopInstall === true && tier.originalIntLoopNormal === true : tier.installCount === 0 && tier.executeCount === 0, 'actual disabled/broad enabled source execution evidence required');
}

// This is a caller-reviewed full-graph build review, not a substitute for its
// underlying configure/compiler/link evidence. Every supplied path is hashed.
export function armContract(id, arm, full, overlay, fullManifest, candidateManifest, build, review, acceptance) {
  assert(['A', 'B'].includes(id), 'unknown arm');
  assert(full.passPackage === true && full.candidateOnly === true && full.guestAcceptance === false, 'full Nightly package required');
  const identity = full.identity;
  assert(identity?.version === '159.0a1' && identity.officialBuildID === '20261002211853' && identity.hgRevision === 'dfc77f7a6d716f1a20a2576597638d4fc21cd916' && /^\d{14}$/.test(identity.localBuildID || ''), 'pinned Nightly159 source identity required');
  for (const key of ['sourceSha256', 'sourceManifestSha256', 'sourceIdentitySHA256', 'buildEvidenceSHA256', 'runtimeInventorySHA256', 'rawBinarySHA256', 'finalBinarySHA256', 'archiveSha256', 'guestDefaultsSHA256']) assert(digest(full[key]), 'missing full package digest ' + key);
  for (const name of ['application.ini', 'platform.ini']) assert(same(full.stamps?.[name], { version: identity.version, buildID: identity.localBuildID, sourceStamp: identity.hgRevision }), 'compiled stamp mismatch ' + name);
  assert(full.allOutsideRuntimeRecordsIdentical === true && full.tailPreserved === true, 'full package preservation required');
  assert(overlay.passPackage === true && overlay.candidateOnly === true && overlay.pageUrl === 'file:///opt/firefox/gpu-check/gpu-check.html', 'homepage overlay required');
  assert(digest(overlay.pageSha256) && digest(overlay.defaultsSha256) && overlay.defaults && overlay.added && Object.keys(overlay.added).length > 0, 'homepage/default identity required');
  assert(['homeAndProfilesUnchanged', 'initUnchanged', 'originalOrderPreserved', 'tailPreserved'].every(k => overlay[k] === true), 'homepage preservation required');
  assert(overlay.sourceSha256 === full.archiveSha256 && overlay.sourceVersion === full.version && digest(overlay.sourceManifestSha256), 'full/overlay chain mismatch');
  assert(fullManifest.version === full.version && fullManifest.assets?.firefox?.sha256 === full.archiveSha256 && fullManifest.assets.firefox.bytes === full.bytes, 'full manifest mismatch');
  assert(candidateManifest.version === arm.version && overlay.version === arm.version && candidateManifest.assets?.firefox?.sha256 === arm.archiveSha256 && overlay.archiveSha256 === arm.archiveSha256 && candidateManifest.assets.firefox.bytes === overlay.bytes, 'candidate manifest mismatch');
  assert(same(Object.keys(fullManifest.assets).sort(), Object.keys(candidateManifest.assets).sort()), 'changed asset set');
  for (const key of Object.keys(fullManifest.assets)) if (key !== 'firefox') assert(same(fullManifest.assets[key], candidateManifest.assets[key]), 'changed system asset ' + key);
  assert(build.schema === 1 && build.completeBuild === true, 'complete full-build evidence required');
  for (const key of ['sourceIdentitySHA256', 'runtimeInventorySHA256', 'rawBinarySHA256', 'finalBinarySHA256']) assert(build[key] === full[key], 'build/package mismatch ' + key);
  for (const name of ['fullBuild', 'fpcast', 'structuralValidation']) {
    const c = build.commands?.[name]; assert(c?.exitCode === 0 && Array.isArray(c.argv) && c.argv.length && c.log && digest(c.logSHA256), 'successful command required ' + name);
    if (name === 'fpcast') assert(c.argv.includes('--fpcast-emu') && c.argv.includes('--pass-arg=max-func-params@23'), 'fpcast ABI evidence required');
    if (name === 'structuralValidation') assert(['wasm-validate', 'wasm-opt'].includes(path.basename(c.argv[0])), 'Wasm validation required');
  }
  assert(review.schema === 1 && review.passReview === true && review.scope === 'nightly-coherent-full-build' && review.nativeWasm === true && review.libc === 'musl' && review.fullGraphBuild === true && review.freshObjectTree === true && review.incrementalArchiveReplacement === false && review.portableBaselineInterp === true, 'coherent native-musl full build review required ' + id);
  assert(review.sourceRoot?.startsWith('/mnt/p6/build/') && review.objectRoot?.startsWith('/mnt/p6/build/') && review.sourceRoot !== review.objectRoot, 'isolated full build roots required');
  for (const key of ['sourceIdentitySHA256', 'buildEvidenceSHA256', 'rawBinarySHA256', 'finalBinarySHA256']) assert(review[key] === full[key], 'coherent review identity mismatch ' + key);
  // Same coherent PBL build in both arms; runtime option is independently observed.
  assert(arm.portableBaseline === (id === 'B'), 'restart-only requested arm preference mismatch');
  const tier = arm.nightly?.tierEvidence;
  const nativeRaw = Object.fromEntries(Object.entries(build.nativeBinaries || {}).map(([name, row]) => [name, row.rawBinarySHA256]));
  assert(['plugin-container','xpcshell','pingsender','gfxtest','certutil','pk12util','firefox-bin'].every(name => digest(nativeRaw[name])), 'fresh complete raw executable identities required');
  tierEvidenceContract(tier, { compiled: identity, finalBinarySHA256: full.finalBinarySHA256, rawBinarySHA256: full.rawBinarySHA256, runtimeInventorySHA256: full.runtimeInventorySHA256, nativeRawBinarySHA256: nativeRaw }, arm.portableBaseline);
  assert(Array.isArray(review.evidence) && review.evidence.length >= 3 && review.evidence.every(e => e.path && digest(e.sha256)), 'configure/compiler/link review evidence required');
  if (id === 'A') {
    assert(acceptance?.schema === 1 && acceptance.passReview === true && acceptance.scope === 'accepted-nightly-baseline' && acceptance.archiveSHA256 === arm.archiveSha256 && acceptance.runtimeVersion === arm.version && acceptance.finalBinarySHA256 === full.finalBinarySHA256, 'accepted Nightly baseline required');
    assert(['fullBuild', 'nativeWasm', 'startup', 'defaultHomepage', 'savedHome', 'currentNssTls'].every(k => acceptance.gates?.[k] === true), 'baseline acceptance gates incomplete');
    assert(Object.values(runtimeTierChecks(acceptance.runtimeTierIdentity, false)).every(Boolean), 'same-binary disabled runtime baseline proof required');
    assert(Array.isArray(acceptance.evidence) && acceptance.evidence.length >= 2 && acceptance.evidence.every(e => e.path && digest(e.sha256)), 'retained baseline guest evidence required');
  }
  return { portableBaseline: arm.portableBaseline, tierEvidence: tier, rawBinarySHA256: full.rawBinarySHA256, nativeRawBinarySHA256: nativeRaw, sourceIdentitySHA256: full.sourceIdentitySHA256, runtimeInventorySHA256: full.runtimeInventorySHA256, buildEvidenceSHA256: full.buildEvidenceSHA256, compiled: identity, stamps: full.stamps, archiveSHA256: arm.archiveSha256, runtimeVersion: arm.version, finalBinarySHA256: full.finalBinarySHA256, defaultsSHA256: full.guestDefaultsSHA256, homepageDefaultsSHA256: overlay.defaultsSha256, homepageDefaults: overlay.defaults, homepageRecords: overlay.added, otherAssets: Object.fromEntries(Object.entries(candidateManifest.assets).filter(([k]) => k !== 'firefox')), reviewRoots: { source: review.sourceRoot, objects: review.objectRoot } };
}

export function pairContract(a, b) {
  tierEvidenceContract(a.tierEvidence, a, false);
  tierEvidenceContract(b.tierEvidence, b, true);
  assert(a.archiveSHA256 === b.archiveSHA256 && a.finalBinarySHA256 === b.finalBinarySHA256 && a.rawBinarySHA256 === b.rawBinarySHA256 && same(a.nativeRawBinarySHA256, b.nativeRawBinarySHA256), 'identical candidate package and fresh raw/final executable set required');
  assert(same(a.compiled,b.compiled) && same(a.stamps,b.stamps) && a.sourceIdentitySHA256 === b.sourceIdentitySHA256 && a.runtimeInventorySHA256 === b.runtimeInventorySHA256 && a.buildEvidenceSHA256 === b.buildEvidenceSHA256, 'identical BuildID/source/runtime/full-build binding required');
  assert(a.portableBaseline === false && b.portableBaseline === true, 'disabled/enabled runtime arms required');
  assert(a.defaultsSHA256 === b.defaultsSHA256 && a.homepageDefaultsSHA256 === b.homepageDefaultsSHA256 && same(a.homepageDefaults, b.homepageDefaults) && same(a.homepageRecords, b.homepageRecords), 'identical defaults/homepage required');
  assert(same(a.otherAssets, b.otherAssets), 'identical non-Firefox assets required');
  assert(a.reviewRoots.source === b.reviewRoots.source && a.reviewRoots.objects === b.reviewRoots.objects, 'identical coherent PBL source/object roots required');
}
export function guestIdentityChecks(actual, compiled, label) {
  return { exactGuestVersion: actual?.version === compiled.version, exactGuestPlatformVersion: actual?.platformVersion === compiled.version, exactGuestBuildID: actual?.appBuildID === compiled.localBuildID, exactGuestPlatformBuildID: actual?.platformBuildID === compiled.localBuildID, identityLabel: actual?.label === label, identityNativeWasm: actual?.OS === 'Linux' && actual?.XPCOMABI === 'wasm32-gcc3' };
}
export function caseChecks(rows) {
  const expected = Object.entries(EXPECTED), seen = new Set();
  const complete = Array.isArray(rows) && rows.length === 24 && rows.every(c => {
    const key = c.round + ':' + c.name, value = EXPECTED[c.name];
    if (!Number.isInteger(c.round) || c.round < 0 || c.round > 2 || value === undefined || seen.has(key)) return false;
    seen.add(key);
    return c.reps === 100 && c.checksum === (value * 1100 | 0) && Array.isArray(c.batchMs) && c.batchMs.length === 11 && c.batchMs.every(x => Number.isFinite(x) && x > 0) && c.medianBatchMs === median(c.batchMs);
  });
  return { exactRowsAndChecksums: complete && expected.every(([name]) => [0, 1, 2].every(r => seen.has(r + ':' + name))) };
}
export function benchmarkAcceptance(report) {
  const boots = report.boots || [], verdicts = {}, checks = {};
  checks.order = same(report.order, 'ABBAAB'.split('')) && boots.length === 6 && boots.every((b, i) => b.index === i + 1 && b.arm === report.order[i]);
  checks.boots = boots.length === 6 && boots.every(b => b.pass === true && b.browserExit?.code === 0 && !b.forcedTermination && !b.error && b.outerErrors?.length === 0 && b.fatalLines?.length === 0 && b.benchOk === true && b.errorLines?.length === 0 && ['version', 'isolated', 'config', 'oneStart', 'oneDone', 'noFatalLogs', 'noFixtureErrors'].every(k => b.checks?.[k] === true) && Object.values(b.checks).every(x => x === true) && b.state?.isolated === true && b.state.system === report.arms?.[b.arm]?.version);
  checks.rows = boots.reduce((n, b) => n + (b.cases?.length || 0), 0) === 144 && boots.every(b => caseChecks(b.cases).exactRowsAndChecksums);
  const count = report.comparisonHostNproc;
  const phaseMatches = p => p?.hostNprocObserved === count && p.browserHardwareConcurrencyObserved === count && p.selectedGuestCpus === count;
  checks.cpu = Number.isInteger(count) && count > 0 && count <= 64 && report.finalHostNproc === count && boots.every(b => b.cpu?.hostNproc === count && b.cpu.browserHardwareConcurrency === count && b.cpu.browserHardwareConcurrencyAtBoot === count && b.cpu.selectedGuestCpus === count && b.cpu.requestedGuestCpus === count && b.cpu.guestBootCpus === count && phaseMatches(b.prebootCpu) && b.cpu.hostNprocObserved === count && phaseMatches(b.identityFinalCpu) && phaseMatches(b.finalCpu) && b.hardwareConcurrency === count && Object.values(guestCpuChecks(b.cpu, b.state || {}, count)).every(Boolean));
  checks.guestIdentities = boots.length === 6 && boots.every(b => report.arms?.[b.arm]?.nightlyIdentity && Object.values(guestIdentityChecks(b.guestIdentity, report.arms[b.arm].nightlyIdentity.compiled, b.label)).every(Boolean) && /Firefox\/159(?:\.0)?(?:\s|$)/.test(b.userAgent || ''));
  checks.runtimeTierOptions = boots.length === 6 && boots.every(b => {
    const expected = b.arm === 'B', identity = b.guestIdentity;
    return Object.values(runtimeTierChecks(identity, expected)).every(Boolean) && b.primaryDiagnosticsOff === true && Object.values(primaryDiagnosticsChecks(b.contentTierIdentity)).every(Boolean);
  });
  checks.benchmarkContentTierOptions = boots.length === 6 && boots.every(b => Object.values(benchmarkContentTierChecks(b.contentTierIdentity, b.arm === 'B', b.label)).every(Boolean) && Object.values(guestIdentityChecks(b.contentTierIdentity, report.arms?.[b.arm]?.nightlyIdentity?.compiled, b.label)).every(Boolean));
  checks.contentAcquisitionArtifacts = boots.length === 6 && boots.every(b => b.contentBridgeRegisteredBeforeNavigation === true && b.contentTierAcquisitionArtifact?.path && digest(b.contentTierAcquisitionArtifact.sha256) && report.inputs?.[b.contentTierAcquisitionArtifact.path] === b.contentTierAcquisitionArtifact.sha256 && b.contentPhaseTranscript?.fixtureStartBeforeAcquisition === true && b.contentPhaseTranscript?.noTimedOutputBeforeAcquisitionReceipt === true);
  checks.checkerExecutionBinding = report.checkerExecutionBinding?.source && digest(report.checkerExecutionBinding.sha256) && report.inputs?.[report.checkerExecutionBinding.source] === report.checkerExecutionBinding.sha256;
  checks.sameBinaryTierEvidence = (() => {
    try { pairContract(report.arms.A.nightlyIdentity, report.arms.B.nightlyIdentity); return true; }
    catch { return false; }
  })();
  for (const name of Object.keys(EXPECTED)) {
    const values = id => boots.filter(b => b.arm === id).map(b => median((b.cases || []).filter(c => c.name === name).flatMap(c => c.batchMs)) / 100);
    const a = values('A'), b = values('B'), ratio = median(b) / median(a);
    verdicts[name] = { baselineMsPerRep: a, pblMsPerRep: b, ratio, noRegression: a.length === 3 && b.length === 3 && Number.isFinite(ratio) && ratio > 0 && ratio <= 1 };
  }
  const launch = key => { const values = id => boots.filter(b => b.arm === id).map(b => b[key]), a = values('A'), b = values('B'), ratio = median(b) / median(a); return { baseline: a, pbl: b, ratio, noRegression: a.length === 3 && b.length === 3 && [...a, ...b].every(x => Number.isFinite(x) && x > 0) && Number.isFinite(ratio) && ratio <= 1 }; };
  const launchMs = launch('launchMs'), guestReadyMs = launch('guestReadyMs');
  checks.noRegression = Object.values(verdicts).every(v => v.noRegression) && launchMs.noRegression && guestReadyMs.noRegression;
  checks.inputs = report.inputsUnchanged === true && report.hostAllocationStable === true;
  checks.cleanup = report.serverClosed === true && boots.length === 6 && boots.every(b => b.groupCleanup?.kind === 'owned-browser-exact-group-cleanup-v1' && b.groupCleanup.owner?.pid === b.browserPid && b.groupCleanup.owner?.pgid === b.browserPid && b.groupCleanup.owner?.sid === b.browserPid && /^[0-9]+$/.test(b.groupCleanup.owner?.leaderStartTicks || '') && Array.isArray(b.groupCleanup.stages) && b.groupCleanup.stages.some(stage => stage.stage === 'natural' && Number.isFinite(stage.elapsedMs) && stage.elapsedMs >= 0 && Array.isArray(stage.members) && stage.members.length === 0) && b.groupCleanup.naturalGroupEmpty === true && b.groupCleanup.physicalGroupEmpty === true && b.groupCleanup.forced === false && b.groupCleanup.pass === true && !b.cleanupError);
  checks.browserOwnership = boots.length === 6 && boots.every(b => {
    try {
      const e = b.endpointOwnership;
      if (e?.spawnedPid !== b.browserPid) return false;
      const owned = ownedBrowserEndpoint(e.activePortText, { webSocketDebuggerUrl: e.browserWebSocketURL }, { pid: e.spawnedPid, alive: e.childAliveChecked, ownedProfileArgument: e.ownedProfileArgument, exitCode: null, signalCode: null, freshProfile: e.freshProfile, activePortRegularFile: e.activePortRegularFile, spawnedAt: e.spawnedAt, activePortMtimeMs: e.activePortMtimeMs });
      return e.verified === true && e.port === owned.port && e.browserPath === owned.browserPath && ownedPageEndpoint(e.pageTarget, owned) === e.pageTarget.webSocketDebuggerUrl;
    } catch { return false; }
  });
  return { pass: Object.values(checks).every(Boolean), checks, verdicts, launchMs, guestReadyMs };
}

export async function selfTest(out, taskRoot = TASK) {
  assert(out.startsWith(taskRoot + '/') && ![taskRoot, taskRoot + '/'].includes(out), 'dedicated fresh output required');
  const parent = await fs.realpath(path.dirname(out)); assert(parent === taskRoot || parent.startsWith(taskRoot + '/'), 'output parent escapes dedicated task');
  for (const key of ['TMPDIR', 'TMP', 'TEMP']) { const p = await fs.realpath(process.env[key]), s = await fs.statfs(p); assert(p.startsWith(taskRoot + '/') && ![0x01021994, 0x858458f6].includes(s.type) && s.bavail * s.bsize >= 20 * 1024 ** 3, 'disk-backed scratch/reserve required'); }
  assert(Number(execFileSync('du', ['-sb', taskRoot], { encoding: 'utf8' }).split(/\s/)[0]) < 2 * 1024 ** 3, 'task cap');
  await fs.mkdir(out); const checks = [], check = (name, fn) => { fn(); checks.push({ name, pass: true }); }, reject = fn => { let bad = false; try { fn(); } catch { bad = true; } assert(bad, 'expected rejection'); }, clone = o => structuredClone(o);
  const browserPath = '/devtools/browser/12345678-1234-1234-1234-123456789abc', activePortText = '41001\n' + browserPath + '\n', browserVersion = { webSocketDebuggerUrl: 'ws://127.0.0.1:41001' + browserPath };
  const childEvidence = { pid: 12345, alive: true, ownedProfileArgument: true, exitCode: null, signalCode: null, spawnedAt: 1000, activePortMtimeMs: 1001, freshProfile: true, activePortRegularFile: true };
  const invokeEndpoint = (text = activePortText, version = browserVersion, child = childEvidence) => ownedBrowserEndpoint(text, version, child);
  check('fresh dynamic owned CDP endpoint accepted', () => assert(invokeEndpoint().port === 41001, 'dynamic owned endpoint'));
  for (const [name, mutate] of [ ['exited Chromium', c => { c.exitCode = 1; }], ['signaled Chromium', c => { c.signalCode = 'SIGTERM'; }], ['spawn error', c => { c.spawnError = 'failed'; }], ['not live spawned child', c => { c.alive = false; }], ['missing spawned PID', c => { delete c.pid; }], ['wrong process profile arguments', c => { c.ownedProfileArgument = false; }], ['profile not fresh', c => { c.freshProfile = false; }], ['stale DevToolsActivePort', c => { c.activePortMtimeMs = 999; }], ['symlink DevToolsActivePort', c => { c.activePortRegularFile = false; }] ]) check(name + ' endpoint refused', () => { const c = clone(childEvidence); mutate(c); reject(() => invokeEndpoint(activePortText, browserVersion, c)); });
  for (const [name, text] of [ ['missing browser ID', '41001\n'], ['zero port', '0\n' + browserPath], ['out-of-range port', '65536\n' + browserPath], ['invalid browser ID', '41001\n/devtools/browser/user'], ['extra port-file line', activePortText + 'unexpected'], ['foreign port-file URL', '41001\nws://localhost/devtools/browser/user'] ]) check(name + ' refused', () => reject(() => invokeEndpoint(text)));
  for (const [name, url] of [ ['other browser on9411', 'ws://127.0.0.1:9411' + browserPath], ['other browser ID', 'ws://127.0.0.1:41001/devtools/browser/12345678-1234-1234-1234-123456789abd'], ['non-loopback browser', 'ws://example.com:41001' + browserPath], ['wrong WebSocket scheme', 'wss://127.0.0.1:41001' + browserPath], ['URL credentials', 'ws://user@127.0.0.1:41001' + browserPath], ['URL query', browserVersion.webSocketDebuggerUrl + '?other'], ['URL fragment', browserVersion.webSocketDebuggerUrl + '#other'] ]) check(name + ' refused before connection', () => reject(() => invokeEndpoint(activePortText, { webSocketDebuggerUrl: url })));
  const page = { type: 'page', id: 'abcdef123456', webSocketDebuggerUrl: 'ws://127.0.0.1:41001/devtools/page/abcdef123456' };
  check('owned page websocket accepted', () => assert(ownedPageEndpoint(page, invokeEndpoint()) === page.webSocketDebuggerUrl, 'page endpoint'));
  for (const [name, mutate] of [ ['foreign page port', p => { p.webSocketDebuggerUrl = p.webSocketDebuggerUrl.replace('41001', '9411'); }], ['foreign page host', p => { p.webSocketDebuggerUrl = p.webSocketDebuggerUrl.replace('127.0.0.1', 'example.com'); }], ['wrong page ID', p => { p.id = 'different'; }], ['browser target in page list', p => { p.type = 'browser'; }] ]) check(name + ' refused', () => { const p = clone(page); mutate(p); reject(() => ownedPageEndpoint(p, invokeEndpoint())); });
  check('unverified page endpoint refused', () => reject(() => ownedPageEndpoint(page, { verified: false })));
  const h = 'a'.repeat(64), identity = { version: '159.0a1', officialBuildID: '20261002211853', localBuildID: '20261003042618', hgRevision: 'dfc77f7a6d716f1a20a2576597638d4fc21cd916' };
  const full = { passPackage: true, candidateOnly: true, guestAcceptance: false, identity, stamps: Object.fromEntries(['application.ini', 'platform.ini'].map(n => [n, { version: identity.version, buildID: identity.localBuildID, sourceStamp: identity.hgRevision }])), ...Object.fromEntries(['sourceSha256', 'sourceManifestSha256', 'sourceIdentitySHA256', 'buildEvidenceSHA256', 'runtimeInventorySHA256', 'rawBinarySHA256', 'finalBinarySHA256', 'archiveSha256', 'guestDefaultsSHA256'].map(k => [k, h])), allOutsideRuntimeRecordsIdentical: true, tailPreserved: true, version: 'full', bytes: 12 };
  const overlay = { passPackage: true, candidateOnly: true, pageUrl: 'file:///opt/firefox/gpu-check/gpu-check.html', pageSha256: h, defaultsSha256: h, defaults: { gpu: true }, homeAndProfilesUnchanged: true, initUnchanged: true, originalOrderPreserved: true, tailPreserved: true, sourceSha256: h, sourceVersion: 'full', sourceManifestSha256: h, version: 'overlay', archiveSha256: h, bytes: 14, added: { page: h } };
  const manifest = { version: 'full', assets: { firefox: { sha256: h, bytes: 12 }, kernel: { sha256: h, bytes: 8 } } }, candidate = clone(manifest); candidate.version = 'overlay'; candidate.assets.firefox.bytes = 14;
  const build = { schema: 1, completeBuild: true, ...Object.fromEntries(['sourceIdentitySHA256', 'runtimeInventorySHA256', 'rawBinarySHA256', 'finalBinarySHA256'].map(k => [k, h])), commands: Object.fromEntries(['fullBuild', 'fpcast', 'structuralValidation'].map(k => [k, { exitCode: 0, argv: k === 'fpcast' ? ['wasm-opt', '--fpcast-emu', '--pass-arg=max-func-params@23'] : [k === 'structuralValidation' ? 'wasm-validate' : 'mach'], log: '/mnt/p6/build/log', logSHA256: h }])) };
  const review = { schema: 1, passReview: true, scope: 'nightly-coherent-full-build', nativeWasm: true, libc: 'musl', fullGraphBuild: true, freshObjectTree: true, incrementalArchiveReplacement: false, portableBaselineInterp: true, sourceRoot: '/mnt/p6/build/a/source', objectRoot: '/mnt/p6/build/a/obj', ...Object.fromEntries(['sourceIdentitySHA256', 'buildEvidenceSHA256', 'rawBinarySHA256', 'finalBinarySHA256'].map(k => [k, h])), evidence: Array.from({ length: 3 }, () => ({ path: '/mnt/p6/build/proof', sha256: h })) };
  const runtimeIdentity = enabled => ({ restartPref: enabled, jitTestingFunctionsAvailable: true, jitCompilerOptionsGetterAvailable: true, pblEnableOwnProperty: true, pblWarmupOwnProperty: true, portableBaselineOption: Number(enabled), pblWarmupThreshold: 10 });
  build.nativeBinaries = Object.fromEntries(['plugin-container','xpcshell','pingsender','gfxtest','certutil','pk12util','firefox-bin'].map(name => [name, { rawBinarySHA256: h }]));
  const makeTier = enabled => ({ kind: 'caller-reviewed-actual-nightly-same-binary-tier-evidence-v1', pass: true, portableBaseline: enabled, finalBinarySHA256: h, rawBinarySHA256: h, runtimeInventorySHA256: h, localBuildID: identity.localBuildID, originalFixtureSHA256: FIXTURE_SHA256, nativeRawBinarySHA256: Object.fromEntries(Object.keys(build.nativeBinaries).map(name => [name, h])), acquisitionSHA256: h, reviewSHA256: 'b'.repeat(64), artifacts: [{ path: '/synthetic-only/acquisition', sha256: h }, { path: '/synthetic-only/review', sha256: 'b'.repeat(64) }], startupIdentity: runtimeIdentity(enabled), workerOptionEvidence: { getterAvailable: true, option: Number(enabled), threshold: 10 }, workerDistinctThread: true, rawObservationComplete: true, observerExhaustion: false, installCount: enabled ? 28 : 0, executeCount: enabled ? 28 : 0, broadMainAdmissions: 14, broadWorkerAdmissions: 14, originalIntLoopInstall: enabled, originalIntLoopNormal: enabled });
  const accepted = { runtimeTierIdentity: runtimeIdentity(false), schema: 1, passReview: true, scope: 'accepted-nightly-baseline', archiveSHA256: h, runtimeVersion: 'overlay', finalBinarySHA256: h, gates: Object.fromEntries(['fullBuild', 'nativeWasm', 'startup', 'defaultHomepage', 'savedHome', 'currentNssTls'].map(k => [k, true])), evidence: review.evidence };
  const arm = { portableBaseline: false, nightly: { tierEvidence: makeTier(false) }, version: 'overlay', archiveSha256: h }, invoke = (f = full, o = overlay, m = candidate, b = build, r = review, a = accepted) => armContract('A', arm, f, o, manifest, m, b, r, a);
  check('valid accepted baseline package chain', () => invoke());
  for (const [name, mutate] of [ ['128 identity', f => { f.identity.version = '128.14.0'; }], ['missing local BuildID', f => { delete f.identity.localBuildID; }], ['wrong pinned source', f => { f.identity.hgRevision = 'b'.repeat(40); }], ['wrong compiled application stamp', f => { f.stamps['application.ini'].buildID = '20261002000000'; }], ['wrong platform version', f => { f.stamps['platform.ini'].version = '128.0'; }], ['missing build hash', f => { delete f.buildEvidenceSHA256; }], ['unpreserved runtime', f => { f.allOutsideRuntimeRecordsIdentical = false; }] ]) check(name, () => { const f = clone(full); mutate(f); reject(() => invoke(f)); });
  check('old promoted overlay refused', () => { const o = clone(overlay); o.sourceSha256 = 'b'.repeat(64); reject(() => invoke(full, o)); });
  check('candidate manifest hash mismatch', () => { const m = clone(candidate); m.assets.firefox.sha256 = 'b'.repeat(64); reject(() => invoke(full, overlay, m)); });
  check('failed full build refused', () => { const b = clone(build); b.commands.fullBuild.exitCode = 2; reject(() => invoke(full, overlay, candidate, b)); });
  check('fpcast ABI missing refused', () => { const b = clone(build); b.commands.fpcast.argv.pop(); reject(() => invoke(full, overlay, candidate, b)); });
  check('three-object replacement refused', () => { const r = clone(review); r.incrementalArchiveReplacement = true; reject(() => invoke(full, overlay, candidate, build, r)); });
  check('compiletime-disabled A config refused', () => { const r = clone(review); r.portableBaselineInterp = false; reject(() => invoke(full, overlay, candidate, build, r)); });
  check('unaccepted baseline refused', () => reject(() => invoke(full, overlay, candidate, build, review, null)));
  check('TLS pending baseline refused', () => { const a = clone(accepted); a.gates.currentNssTls = false; reject(() => invoke(full, overlay, candidate, build, review, a)); });
  const aIdentity = invoke(), enabledArm = { ...arm, portableBaseline: true, nightly: { tierEvidence: makeTier(true) } };
  const bIdentity = armContract('B', enabledArm, full, overlay, manifest, candidate, build, review, null);
  check('same binary/coherent roots with runtime A/B accepted', () => pairContract(aIdentity, bIdentity));
  for (const [name, mutate] of [ ['different final binary', b => { b.finalBinarySHA256 = 'c'.repeat(64); }], ['different raw helper', b => { b.nativeRawBinarySHA256.xpcshell = 'c'.repeat(64); }], ['different archive', b => { b.archiveSHA256 = 'c'.repeat(64); }], ['different roots', b => { b.reviewRoots.objects += '-other'; }], ['different BuildID', b => { b.compiled.localBuildID = '20261002000000'; }], ['different defaults', b => { b.defaultsSHA256 = 'c'.repeat(64); }], ['different homepage defaults', b => { b.homepageDefaultsSHA256 = 'c'.repeat(64); }], ['different page', b => { b.homepageRecords.page = 'c'.repeat(64); }], ['different system asset', b => { b.otherAssets.kernel.sha256 = 'c'.repeat(64); }], ['missing tier sidecar', b => { delete b.tierEvidence; }], ['missing pinned review', b => { b.tierEvidence.artifacts.pop(); }], ['exhausted observer', b => { b.tierEvidence.observerExhaustion = true; }], ['incomplete observation', b => { b.tierEvidence.rawObservationComplete = false; }], ['missing original body proof', b => { b.tierEvidence.originalIntLoopNormal = false; }], ['Worker option differs', b => { b.tierEvidence.workerOptionEvidence.option = 0; }] ]) check(name + ' refused', () => { const b = clone(bIdentity); mutate(b); reject(() => pairContract(aIdentity, b)); });
  check('B cannot use compiletime-disabled config', () => { const r = clone(review); r.portableBaselineInterp = false; reject(() => armContract('B', enabledArm, full, overlay, manifest, candidate, build, r, null)); });
  check('disabled arm actual native event refused', () => { const a = clone(aIdentity); a.tierEvidence.installCount = 1; reject(() => pairContract(a, bIdentity)); });
  for (const enabled of [false, true]) {
    check('numeric option ' + Number(enabled) + ' accepted', () => assert(Object.values(runtimeTierChecks(runtimeIdentity(enabled), enabled)).every(Boolean), 'strict numeric getter'));
    for (const [name, mutate] of [ ['missing enable', a => { delete a.portableBaselineOption; }], ['Boolean enable', a => { a.portableBaselineOption = enabled; }], ['string enable', a => { a.portableBaselineOption = String(Number(enabled)); }], ['null enable', a => { a.portableBaselineOption = null; }], ['nonbinary enable', a => { a.portableBaselineOption = 2; }], ['NaN enable', a => { a.portableBaselineOption = NaN; }], ['missing API proof', a => { delete a.jitTestingFunctionsAvailable; }], ['missing getter proof', a => { delete a.jitCompilerOptionsGetterAvailable; }], ['missing enable property proof', a => { a.pblEnableOwnProperty = false; }], ['missing warmup property proof', a => { delete a.pblWarmupOwnProperty; }], ['string warmup', a => { a.pblWarmupThreshold = '10'; }], ['wrong warmup', a => { a.pblWarmupThreshold = 11; }], ['requested pref only', a => { delete a.portableBaselineOption; delete a.jitCompilerOptionsGetterAvailable; }] ]) check(name + ' arm ' + Number(enabled) + ' refused', () => { const a = runtimeIdentity(enabled); mutate(a); assert(!Object.values(runtimeTierChecks(a, enabled)).every(Boolean), 'bad getter evidence accepted'); });
  }
  const cpu = { hostNproc: 8, browserHardwareConcurrency: 8, requestedGuestCpus: 8, guestBootCpus: 8, hostNprocObserved: 8, browserHardwareConcurrencyAtBoot: 8, selectedGuestCpus: 8 };
  const sample = { order: 'ABBAAB'.split(''), arms: { A: { version: 'overlay', nightlyIdentity: aIdentity }, B: { version: 'overlay', nightlyIdentity: bIdentity } }, comparisonHostNproc: 8, finalHostNproc: 8, inputsUnchanged: true, hostAllocationStable: true, serverClosed: true };
  sample.boots = sample.order.map((arm, i) => ({ index: i + 1, arm, label: 'boot-' + i, pass: true, browserExit: { code: 0 }, outerErrors: [], fatalLines: [], benchOk: true, errorLines: [], checks: Object.fromEntries(['version', 'isolated', 'config', 'oneStart', 'oneDone', 'noFatalLogs', 'noFixtureErrors'].map(k => [k, true])), cpu: clone(cpu), prebootCpu: { hostNprocObserved: 8, browserHardwareConcurrencyObserved: 8, selectedGuestCpus: 8 }, identityFinalCpu: { hostNprocObserved: 8, browserHardwareConcurrencyObserved: 8, selectedGuestCpus: 8 }, finalCpu: { hostNprocObserved: 8, browserHardwareConcurrencyObserved: 8, selectedGuestCpus: 8 }, hardwareConcurrency: 8, state: { system: 'overlay', isolated: true, browserHardwareConcurrency: 8, selectedGuestCpus: 8 }, primaryDiagnosticsOff: true, guestIdentity: { ...runtimeIdentity(arm === 'B'), ...identity, label: 'boot-' + i, platformVersion: identity.version, appBuildID: identity.localBuildID, platformBuildID: identity.localBuildID, OS: 'Linux', XPCOMABI: 'wasm32-gcc3' }, userAgent: 'Firefox/159.0', launchMs: 1000, guestReadyMs: 2000, cases: [0, 1, 2].flatMap(round => Object.entries(EXPECTED).map(([name, value]) => ({ round, name, reps: 100, checksum: value * 1100 | 0, batchMs: Array(11).fill(100), medianBatchMs: 100 }))) }));
  for (const b of sample.boots) b.contentTierIdentity = { ...runtimeIdentity(b.arm === 'B'), optionContext: 'benchmark-target-content', documentURI: 'file:///home/admin/pblbench/pblbench-' + b.label + '.html', liveCurrentGlobal: true, wrappedContentWindowMatches: true, windowId: String(100 + b.index), processID: 900, processType: 2, getterSameJSContextAsTarget: true, acquiredBeforeTimedStart: true };
  for (const b of sample.boots) { b.browserPid = 12345 + b.index; b.endpointOwnership = { ...invokeEndpoint(activePortText, browserVersion, { ...childEvidence, pid: b.browserPid }), activePortText, pageTarget: page }; }
  sample.inputs = { '/synthetic-only/checker':h };
  sample.checkerExecutionBinding = { source:'/synthetic-only/checker', sha256:h };
  for (const b of sample.boots) {
    Object.assign(b.contentTierIdentity, { ...b.guestIdentity, kind:'actual-firefox-benchmark-content-options-v1', status:'recorded', label:b.label, acquisitionEvent:'DOMContentLoaded', acquisitionEventTrusted:true, acquisitionTargetDocumentURI:b.contentTierIdentity.documentURI, acquisitionDocumentReadyState:'interactive', targetPerformanceBeforeMs:1, targetPerformanceAfterMs:2, targetTimeOrigin:1700000000000, unchangedSettleMs:15000, parentWindowIdMatches:true, parentProcessIDMatches:true, parentCurrentGlobalMatches:true });
    b.contentBridgeRegisteredBeforeNavigation = true;
    b.contentTierAcquisitionArtifact = { path:'/synthetic-only/content-' + b.index, sha256:h };
    sample.inputs[b.contentTierAcquisitionArtifact.path] = h;
    b.contentPhaseTranscript = { fixtureStartBeforeAcquisition:true, noTimedOutputBeforeAcquisitionReceipt:true };
    b.groupCleanup = { kind:'owned-browser-exact-group-cleanup-v1', owner:{ pid:b.browserPid, pgid:b.browserPid, sid:b.browserPid, leaderStartTicks:'1' }, naturalGroupEmpty:true, physicalGroupEmpty:true, forced:false, pass:true, stages:[{stage:'natural',elapsedMs:100,members:[]}] };
  }
  for (const b of sample.boots) {
    const environment = { PBLJIT:{exists:false,value:null}, PBLJIT_LOG:{exists:true,value:'0'}, PBLJIT_OBSERVE:{exists:true,value:'0'} };
    const row = processID => ({ kind:'actual-firefox-primary-diagnostics-v1', processID, startup:clone(environment), current:clone(environment), commandLine:{bytes:16,sha256:h,argc:2,diagnosticArguments:[]}, environment:{bytes:36,sha256:h}, boundedComplete:true,primaryDiagnosticsOff:true });
    Object.assign(b.contentTierIdentity,{ diagnosticEnvironment:clone(environment),parentObservedProcessID:800,parentObservedOSPid:900,parentObservedInProcess:false,primaryDiagnostics:{parent:row(800),target:row(900),acquiredBeforeTimedStart:true,targetAgeMs:3} });
  }
  check('all144 equal original rows accepted', () => assert(benchmarkAcceptance(sample).pass, 'equal fixture'));
  const failures = [ ['missing boot', r => r.boots.pop()], ['missing boot predicates', r => { r.boots[0].checks = {}; }], ['wrong served runtime', r => { r.boots[0].state.system = 'old128'; }], ['missing isolation', r => { r.boots[0].state.isolated = false; }], ['wrong boot order', r => { r.order = 'ABAABB'.split(''); }], ['lost case row', r => r.boots[0].cases.pop()], ['duplicate row', r => { r.boots[0].cases[1] = r.boots[0].cases[0]; }], ['wrong checksum', r => { r.boots[0].cases[0].checksum++; }], ['lost timed batch', r => r.boots[0].cases[0].batchMs.pop()], ['NaN batch', r => { r.boots[0].cases[0].batchMs[0] = NaN; }], ['zero batch', r => { r.boots[0].cases[0].batchMs[0] = 0; }], ['wrong reps', r => { r.boots[0].cases[0].reps = 1; }], ['fatal despite prior pass', r => { r.boots[1].fatalLines.push('MOZ_CRASH'); }], ['error event', r => r.boots[0].errorLines.push({ error: 'wrong' })], ['forced cleanup', r => { r.boots[0].forcedTermination = true; }], ['server open', r => { r.serverClosed = false; }], ['input drift', r => { r.inputsUnchanged = false; }], ['wrong live version', r => { r.boots[1].guestIdentity.version = '128.14.0'; }], ['privacy build ID insufficient', r => { r.boots[1].guestIdentity.appBuildID = '20181001000000'; }], ['wrong platform build ID', r => { r.boots[1].guestIdentity.platformBuildID = '20261002000000'; }], ['missing identity', r => { delete r.boots[1].guestIdentity; }], ['stale identity label', r => { r.boots[1].guestIdentity.label = 'old'; }], ['wrong architecture', r => { r.boots[1].guestIdentity.XPCOMABI = 'x86_64'; }], ['128 UA', r => { r.boots[1].userAgent = 'Firefox/128.0'; }], ['cross-arm CPU mismatch', r => { r.boots[1].cpu.hostNproc = 6; }], ['kernel CPU mismatch', r => { r.boots[1].cpu.guestBootCpus = 2; }], ['guest navigator CPU mismatch', r => { r.boots[1].hardwareConcurrency = 2; }], ['phase nproc drift', r => { r.boots[1].prebootCpu.hostNprocObserved = 6; }], ['identity phase nproc drift', r => { r.boots[1].identityFinalCpu.hostNprocObserved = 6; }], ['missing identity CPU phase', r => { delete r.boots[1].identityFinalCpu; }], ['startup browser CPU drift', r => { r.boots[1].cpu.browserHardwareConcurrencyAtBoot = 6; }], ['preboot selection drift', r => { r.boots[1].prebootCpu.selectedGuestCpus = 6; }], ['final nproc drift', r => { r.finalHostNproc = 6; }], ['UI clamp cannot prove exact CPUs above64', r => { r.comparisonHostNproc = 65; }], ['slower launch', r => { for (const b of r.boots.filter(b => b.arm === 'B')) b.launchMs = 1001; }], ['slower guest readiness', r => { for (const b of r.boots.filter(b => b.arm === 'B')) b.guestReadyMs = 2001; }] ];
  failures.push(['missing content option acquisition', r => { delete r.boots[0].contentTierIdentity; }], ['parent-only content proof', r => { r.boots[0].contentTierIdentity.optionContext = 'browser-console'; }], ['wrong target document', r => { r.boots[0].contentTierIdentity.documentURI = 'about:blank'; }], ['stale content window', r => { r.boots[0].contentTierIdentity.liveCurrentGlobal = false; }], ['unmatched wrapped content window', r => { r.boots[0].contentTierIdentity.wrappedContentWindowMatches = false; }], ['unknown target JSContext', r => { delete r.boots[0].contentTierIdentity.getterSameJSContextAsTarget; }], ['late target option acquisition', r => { r.boots[0].contentTierIdentity.acquiredBeforeTimedStart = false; }], ['missing diagnostics-off evidence', r => { delete r.boots[0].primaryDiagnosticsOff; }], ['missing getter proof', r => { delete r.boots[0].guestIdentity.jitCompilerOptionsGetterAvailable; }], ['Boolean option masks missing getter', r => { r.boots[0].guestIdentity.portableBaselineOption = false; }], ['wrong actual warmup', r => { r.boots[1].guestIdentity.pblWarmupThreshold = 11; }], ['missing reviewed original-body sidecar', r => { delete r.arms.B.nightlyIdentity.tierEvidence; }]);
  failures.push(['no current exact group cleanup', r => { delete r.boots[0].groupCleanup; }], ['leader only group zombie retained', r => { r.boots[0].groupCleanup.physicalGroupEmpty = false; }], ['forced group cleanup', r => { r.boots[0].groupCleanup.forced = true; }], ['forged different cleanup owner', r => { r.boots[0].groupCleanup.owner.pgid++; }], ['unbound checker copy', r => { r.checkerExecutionBinding.sha256 = 'c'.repeat(64); }], ['unbound raw content artifact', r => { delete r.inputs[r.boots[0].contentTierAcquisitionArtifact.path]; }], ['untrusted acquisition event', r => { r.boots[0].contentTierIdentity.acquisitionEventTrusted = false; }], ['late numeric timestamp', r => { r.boots[0].contentTierIdentity.targetPerformanceAfterMs = 15000; }], ['mismatched parent global', r => { r.boots[0].contentTierIdentity.parentCurrentGlobalMatches = false; }], ['missing phase transcript', r => { delete r.boots[0].contentPhaseTranscript; }]);
  failures.push(['missing cleanup natural stage',r=>{delete r.boots[0].groupCleanup.stages;}],
    ['missing cleanup leader identity',r=>{delete r.boots[0].groupCleanup.owner.leaderStartTicks;}],
    ['changed target currentenv',r=>{r.boots[0].contentTierIdentity.diagnosticEnvironment.PBLJIT_LOG.value='24';}],
    ['missing actual diagnostic process proof',r=>{delete r.boots[0].contentTierIdentity.primaryDiagnostics;}],
    ['log default cannot be diagnostics off',r=>{r.boots[0].contentTierIdentity.primaryDiagnostics.target.startup.PBLJIT_LOG={exists:false,value:null};}],
    ['native observer on cannot pass',r=>{const p=r.boots[0].contentTierIdentity.primaryDiagnostics.target; p.startup.PBLJIT_OBSERVE.value=p.current.PBLJIT_OBSERVE.value='1';}],
    ['different target diagnostics PID',r=>{r.boots[0].contentTierIdentity.primaryDiagnostics.target.processID++;}],
    ['unbounded diagnostic raw bytes',r=>{r.boots[0].contentTierIdentity.primaryDiagnostics.parent.environment.bytes=PROC_LIMIT+1;}],
    ['late diagnostic proof',r=>{r.boots[0].contentTierIdentity.primaryDiagnostics.targetAgeMs=15000;}],
    ['debugger argv proof cannot pass',r=>{r.boots[0].contentTierIdentity.primaryDiagnostics.parent.commandLine.diagnosticArguments=['--jsdebugger'];}]);
  for (const name of Object.keys(EXPECTED)) failures.push(['strict slower ' + name, r => { for (const b of r.boots.filter(b => b.arm === 'B')) for (const c of b.cases.filter(c => c.name === name)) { c.batchMs.fill(100.001); c.medianBatchMs = 100.001; } }]);
  failures.push(['missing endpoint ownership evidence', r => { delete r.boots[0].endpointOwnership; }], ['ownership evidence PID mismatch', r => { r.boots[0].endpointOwnership.spawnedPid++; }], ['ownership browser ID changed', r => { r.boots[0].endpointOwnership.browserWebSocketURL = r.boots[0].endpointOwnership.browserWebSocketURL.replace('789abc', '789abd'); }], ['ownership live child check absent', r => { r.boots[0].endpointOwnership.childAliveChecked = false; }]);
  for (const [name, mutate] of failures) check(name, () => { const r = clone(sample); mutate(r); assert(!benchmarkAcceptance(r).pass, 'mutation escaped ' + name); });
  for (const line of ['MOZ_CRASH', 'RuntimeError: unreachable', 'RuntimeError: indirect call type mismatch', 'Assertion failure', 'panicked at probe', 'Segmentation fault', 'Aborted', 'SIGABRT', 'SIGSEGV', 'Out of memory: Killed process 123', 'oom-kill', 'memory allocation failed']) check('fatal recognized ' + line, () => assert(fatalLines(line).length === 1, 'fatal recognition'));
  check('honest unavailable GPU nonfatal', () => assert(fatalLines('FEATURE_FAILURE_WEBGL_EXHAUSTED_DRIVERS').length === 0, 'GPU availability'));
  check('guest console JSON parsed', () => assert(payloads('console.log: ' + JSON.stringify('PBLIDENTITY ' + JSON.stringify({ label: 'b' })), 'PBLIDENTITY ')[0].label === 'b', 'parser'));
  check('malformed console ignored', () => assert(payloads('console.log: invalid', 'PBLIDENTITY ').length === 0, 'parser malformed'));
  const result = { schema: 1, pass: true, checks, count: checks.length, syntheticOnly: true, browserStarted: false, guestStarted: false, guestAcceptance: false, jitAcceptance: false, gpuAcceptance: false, inputs: { [fileURLToPath(import.meta.url)]: sha(await fs.readFile(fileURLToPath(import.meta.url))) } };
  await fs.writeFile(out + '/sample.json', JSON.stringify(sample, null, 2) + '\n'); await fs.writeFile(out + '/result.json', JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify({ pass: true, checks: checks.length, out }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert(process.argv[2] === '--self-test' && process.argv.length === 4, 'usage: --self-test TASK/NEW'); await selfTest(path.resolve(process.argv[3]));
}
