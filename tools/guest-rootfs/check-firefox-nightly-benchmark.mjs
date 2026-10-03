// Pure Nightly benchmark contracts; --self-test writes synthetic evidence only.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
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
  assert(review.schema === 1 && review.passReview === true && review.scope === 'nightly-coherent-full-build' && review.nativeWasm === true && review.libc === 'musl' && review.fullGraphBuild === true && review.freshObjectTree === true && review.incrementalArchiveReplacement === false && review.portableBaselineInterp === (id === 'B'), 'coherent native-musl full build review required ' + id);
  assert(review.sourceRoot?.startsWith('/mnt/p6/build/') && review.objectRoot?.startsWith('/mnt/p6/build/') && review.sourceRoot !== review.objectRoot, 'isolated full build roots required');
  for (const key of ['sourceIdentitySHA256', 'buildEvidenceSHA256', 'rawBinarySHA256', 'finalBinarySHA256']) assert(review[key] === full[key], 'coherent review identity mismatch ' + key);
  assert(Array.isArray(review.evidence) && review.evidence.length >= 3 && review.evidence.every(e => e.path && digest(e.sha256)), 'configure/compiler/link review evidence required');
  if (id === 'A') {
    assert(acceptance?.schema === 1 && acceptance.passReview === true && acceptance.scope === 'accepted-nightly-baseline' && acceptance.archiveSHA256 === arm.archiveSha256 && acceptance.runtimeVersion === arm.version && acceptance.finalBinarySHA256 === full.finalBinarySHA256, 'accepted Nightly baseline required');
    assert(['fullBuild', 'nativeWasm', 'startup', 'defaultHomepage', 'savedHome', 'currentNssTls'].every(k => acceptance.gates?.[k] === true), 'baseline acceptance gates incomplete');
    assert(Array.isArray(acceptance.evidence) && acceptance.evidence.length >= 2 && acceptance.evidence.every(e => e.path && digest(e.sha256)), 'retained baseline guest evidence required');
  }
  return { compiled: identity, stamps: full.stamps, archiveSHA256: arm.archiveSha256, runtimeVersion: arm.version, finalBinarySHA256: full.finalBinarySHA256, defaultsSHA256: full.guestDefaultsSHA256, homepageDefaultsSHA256: overlay.defaultsSha256, homepageDefaults: overlay.defaults, homepageRecords: overlay.added, otherAssets: Object.fromEntries(Object.entries(candidateManifest.assets).filter(([k]) => k !== 'firefox')), reviewRoots: { source: review.sourceRoot, objects: review.objectRoot } };
}

export function pairContract(a, b) {
  assert(a.archiveSHA256 !== b.archiveSHA256 && a.finalBinarySHA256 !== b.finalBinarySHA256, 'distinct baseline/JIT binaries required');
  assert(a.defaultsSHA256 === b.defaultsSHA256 && a.homepageDefaultsSHA256 === b.homepageDefaultsSHA256 && same(a.homepageDefaults, b.homepageDefaults) && same(a.homepageRecords, b.homepageRecords), 'identical defaults/homepage required');
  assert(same(a.otherAssets, b.otherAssets), 'identical non-Firefox assets required');
  assert(a.reviewRoots.source !== b.reviewRoots.source && a.reviewRoots.objects !== b.reviewRoots.objects, 'separate full PBL source/object roots required');
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
  for (const name of Object.keys(EXPECTED)) {
    const values = id => boots.filter(b => b.arm === id).map(b => median((b.cases || []).filter(c => c.name === name).flatMap(c => c.batchMs)) / 100);
    const a = values('A'), b = values('B'), ratio = median(b) / median(a);
    verdicts[name] = { baselineMsPerRep: a, pblMsPerRep: b, ratio, noRegression: a.length === 3 && b.length === 3 && Number.isFinite(ratio) && ratio > 0 && ratio <= 1 };
  }
  const launch = key => { const values = id => boots.filter(b => b.arm === id).map(b => b[key]), a = values('A'), b = values('B'), ratio = median(b) / median(a); return { baseline: a, pbl: b, ratio, noRegression: a.length === 3 && b.length === 3 && [...a, ...b].every(x => Number.isFinite(x) && x > 0) && Number.isFinite(ratio) && ratio <= 1 }; };
  const launchMs = launch('launchMs'), guestReadyMs = launch('guestReadyMs');
  checks.noRegression = Object.values(verdicts).every(v => v.noRegression) && launchMs.noRegression && guestReadyMs.noRegression;
  checks.inputs = report.inputsUnchanged === true && report.hostAllocationStable === true;
  checks.cleanup = report.serverClosed === true;
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

async function selfTest(out) {
  assert(out.startsWith(TASK + '/') && ![TASK, TASK + '/'].includes(out), 'dedicated fresh output required');
  const parent = await fs.realpath(path.dirname(out)); assert(parent === TASK || parent.startsWith(TASK + '/'), 'output parent escapes dedicated task');
  for (const key of ['TMPDIR', 'TMP', 'TEMP']) { const p = await fs.realpath(process.env[key]), s = await fs.statfs(p); assert(p.startsWith(TASK + '/') && ![0x01021994, 0x858458f6].includes(s.type) && s.bavail * s.bsize >= 20 * 1024 ** 3, 'disk-backed scratch/reserve required'); }
  assert(Number(execFileSync('du', ['-sb', TASK], { encoding: 'utf8' }).split(/\s/)[0]) < 2 * 1024 ** 3, 'task cap');
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
  const review = { schema: 1, passReview: true, scope: 'nightly-coherent-full-build', nativeWasm: true, libc: 'musl', fullGraphBuild: true, freshObjectTree: true, incrementalArchiveReplacement: false, portableBaselineInterp: false, sourceRoot: '/mnt/p6/build/a/source', objectRoot: '/mnt/p6/build/a/obj', ...Object.fromEntries(['sourceIdentitySHA256', 'buildEvidenceSHA256', 'rawBinarySHA256', 'finalBinarySHA256'].map(k => [k, h])), evidence: Array.from({ length: 3 }, () => ({ path: '/mnt/p6/build/proof', sha256: h })) };
  const accepted = { schema: 1, passReview: true, scope: 'accepted-nightly-baseline', archiveSHA256: h, runtimeVersion: 'overlay', finalBinarySHA256: h, gates: Object.fromEntries(['fullBuild', 'nativeWasm', 'startup', 'defaultHomepage', 'savedHome', 'currentNssTls'].map(k => [k, true])), evidence: review.evidence };
  const arm = { version: 'overlay', archiveSha256: h }, invoke = (f = full, o = overlay, m = candidate, b = build, r = review, a = accepted) => armContract('A', arm, f, o, manifest, m, b, r, a);
  check('valid accepted baseline package chain', () => invoke());
  for (const [name, mutate] of [ ['128 identity', f => { f.identity.version = '128.14.0'; }], ['missing local BuildID', f => { delete f.identity.localBuildID; }], ['wrong pinned source', f => { f.identity.hgRevision = 'b'.repeat(40); }], ['wrong compiled application stamp', f => { f.stamps['application.ini'].buildID = '20261002000000'; }], ['wrong platform version', f => { f.stamps['platform.ini'].version = '128.0'; }], ['missing build hash', f => { delete f.buildEvidenceSHA256; }], ['unpreserved runtime', f => { f.allOutsideRuntimeRecordsIdentical = false; }] ]) check(name, () => { const f = clone(full); mutate(f); reject(() => invoke(f)); });
  check('old promoted overlay refused', () => { const o = clone(overlay); o.sourceSha256 = 'b'.repeat(64); reject(() => invoke(full, o)); });
  check('candidate manifest hash mismatch', () => { const m = clone(candidate); m.assets.firefox.sha256 = 'b'.repeat(64); reject(() => invoke(full, overlay, m)); });
  check('failed full build refused', () => { const b = clone(build); b.commands.fullBuild.exitCode = 2; reject(() => invoke(full, overlay, candidate, b)); });
  check('fpcast ABI missing refused', () => { const b = clone(build); b.commands.fpcast.argv.pop(); reject(() => invoke(full, overlay, candidate, b)); });
  check('three-object replacement refused', () => { const r = clone(review); r.incrementalArchiveReplacement = true; reject(() => invoke(full, overlay, candidate, build, r)); });
  check('wrong baseline PBL config refused', () => { const r = clone(review); r.portableBaselineInterp = true; reject(() => invoke(full, overlay, candidate, build, r)); });
  check('unaccepted baseline refused', () => reject(() => invoke(full, overlay, candidate, build, review, null)));
  check('TLS pending baseline refused', () => { const a = clone(accepted); a.gates.currentNssTls = false; reject(() => invoke(full, overlay, candidate, build, review, a)); });
  const aIdentity = invoke(), bIdentity = clone(aIdentity); bIdentity.archiveSHA256 = 'b'.repeat(64); bIdentity.finalBinarySHA256 = 'b'.repeat(64); bIdentity.reviewRoots = { source: '/mnt/p6/build/b/source', objects: '/mnt/p6/build/b/obj' };
  check('separate matching A/B resources accepted', () => pairContract(aIdentity, bIdentity));
  for (const [name, mutate] of [ ['identical binary refused', b => { b.finalBinarySHA256 = h; }], ['shared PBL objects refused', b => { b.reviewRoots.objects = aIdentity.reviewRoots.objects; }], ['different full defaults refused', b => { b.defaultsSHA256 = 'c'.repeat(64); }], ['different homepage defaults refused', b => { b.homepageDefaultsSHA256 = 'c'.repeat(64); }], ['different page resource refused', b => { b.homepageRecords.page = 'c'.repeat(64); }], ['different system asset refused', b => { b.otherAssets.kernel.sha256 = 'c'.repeat(64); }] ]) check(name, () => { const b = clone(bIdentity); mutate(b); reject(() => pairContract(aIdentity, b)); });
  check('full coherent B config accepted', () => { const r = clone(review); r.portableBaselineInterp = true; armContract('B', arm, full, overlay, manifest, candidate, build, r, null); });
  check('B cannot silently use PBL-disabled config', () => reject(() => armContract('B', arm, full, overlay, manifest, candidate, build, review, null)));
  const cpu = { hostNproc: 8, browserHardwareConcurrency: 8, requestedGuestCpus: 8, guestBootCpus: 8, hostNprocObserved: 8, browserHardwareConcurrencyAtBoot: 8, selectedGuestCpus: 8 };
  const sample = { order: 'ABBAAB'.split(''), arms: { A: { version: 'overlay', nightlyIdentity: { compiled: identity } }, B: { version: 'overlay', nightlyIdentity: { compiled: identity } } }, comparisonHostNproc: 8, finalHostNproc: 8, inputsUnchanged: true, hostAllocationStable: true, serverClosed: true };
  sample.boots = sample.order.map((arm, i) => ({ index: i + 1, arm, label: 'boot-' + i, pass: true, browserExit: { code: 0 }, outerErrors: [], fatalLines: [], benchOk: true, errorLines: [], checks: Object.fromEntries(['version', 'isolated', 'config', 'oneStart', 'oneDone', 'noFatalLogs', 'noFixtureErrors'].map(k => [k, true])), cpu: clone(cpu), prebootCpu: { hostNprocObserved: 8, browserHardwareConcurrencyObserved: 8, selectedGuestCpus: 8 }, identityFinalCpu: { hostNprocObserved: 8, browserHardwareConcurrencyObserved: 8, selectedGuestCpus: 8 }, finalCpu: { hostNprocObserved: 8, browserHardwareConcurrencyObserved: 8, selectedGuestCpus: 8 }, hardwareConcurrency: 8, state: { system: 'overlay', isolated: true, browserHardwareConcurrency: 8, selectedGuestCpus: 8 }, guestIdentity: { ...identity, label: 'boot-' + i, platformVersion: identity.version, appBuildID: identity.localBuildID, platformBuildID: identity.localBuildID, OS: 'Linux', XPCOMABI: 'wasm32-gcc3' }, userAgent: 'Firefox/159.0', launchMs: 1000, guestReadyMs: 2000, cases: [0, 1, 2].flatMap(round => Object.entries(EXPECTED).map(([name, value]) => ({ round, name, reps: 100, checksum: value * 1100 | 0, batchMs: Array(11).fill(100), medianBatchMs: 100 }))) }));
  for (const b of sample.boots) { b.browserPid = 12345 + b.index; b.endpointOwnership = { ...invokeEndpoint(activePortText, browserVersion, { ...childEvidence, pid: b.browserPid }), activePortText, pageTarget: page }; }
  check('all144 equal original rows accepted', () => assert(benchmarkAcceptance(sample).pass, 'equal fixture'));
  const failures = [ ['missing boot', r => r.boots.pop()], ['missing boot predicates', r => { r.boots[0].checks = {}; }], ['wrong served runtime', r => { r.boots[0].state.system = 'old128'; }], ['missing isolation', r => { r.boots[0].state.isolated = false; }], ['wrong boot order', r => { r.order = 'ABAABB'.split(''); }], ['lost case row', r => r.boots[0].cases.pop()], ['duplicate row', r => { r.boots[0].cases[1] = r.boots[0].cases[0]; }], ['wrong checksum', r => { r.boots[0].cases[0].checksum++; }], ['lost timed batch', r => r.boots[0].cases[0].batchMs.pop()], ['NaN batch', r => { r.boots[0].cases[0].batchMs[0] = NaN; }], ['zero batch', r => { r.boots[0].cases[0].batchMs[0] = 0; }], ['wrong reps', r => { r.boots[0].cases[0].reps = 1; }], ['fatal despite prior pass', r => { r.boots[1].fatalLines.push('MOZ_CRASH'); }], ['error event', r => r.boots[0].errorLines.push({ error: 'wrong' })], ['forced cleanup', r => { r.boots[0].forcedTermination = true; }], ['server open', r => { r.serverClosed = false; }], ['input drift', r => { r.inputsUnchanged = false; }], ['wrong live version', r => { r.boots[1].guestIdentity.version = '128.14.0'; }], ['privacy build ID insufficient', r => { r.boots[1].guestIdentity.appBuildID = '20181001000000'; }], ['wrong platform build ID', r => { r.boots[1].guestIdentity.platformBuildID = '20261002000000'; }], ['missing identity', r => { delete r.boots[1].guestIdentity; }], ['stale identity label', r => { r.boots[1].guestIdentity.label = 'old'; }], ['wrong architecture', r => { r.boots[1].guestIdentity.XPCOMABI = 'x86_64'; }], ['128 UA', r => { r.boots[1].userAgent = 'Firefox/128.0'; }], ['cross-arm CPU mismatch', r => { r.boots[1].cpu.hostNproc = 6; }], ['kernel CPU mismatch', r => { r.boots[1].cpu.guestBootCpus = 2; }], ['guest navigator CPU mismatch', r => { r.boots[1].hardwareConcurrency = 2; }], ['phase nproc drift', r => { r.boots[1].prebootCpu.hostNprocObserved = 6; }], ['identity phase nproc drift', r => { r.boots[1].identityFinalCpu.hostNprocObserved = 6; }], ['missing identity CPU phase', r => { delete r.boots[1].identityFinalCpu; }], ['startup browser CPU drift', r => { r.boots[1].cpu.browserHardwareConcurrencyAtBoot = 6; }], ['preboot selection drift', r => { r.boots[1].prebootCpu.selectedGuestCpus = 6; }], ['final nproc drift', r => { r.finalHostNproc = 6; }], ['UI clamp cannot prove exact CPUs above64', r => { r.comparisonHostNproc = 65; }], ['slower launch', r => { for (const b of r.boots.filter(b => b.arm === 'B')) b.launchMs = 1001; }], ['slower guest readiness', r => { for (const b of r.boots.filter(b => b.arm === 'B')) b.guestReadyMs = 2001; }] ];
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
