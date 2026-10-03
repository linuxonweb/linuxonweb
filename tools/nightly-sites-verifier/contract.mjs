import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, realpath } from 'node:fs/promises';
import { resolve, relative } from 'node:path';

export const PROJECT = 'appgprj_6ab78cc88a948191a1abaabd04b81fe0';
export const ORIGIN = 'https://linuxonweb.exact-coot-7512.chatgpt.site';
export const V10 = Object.freeze({ runtime: 'ce0d881dec8c', savedVersion: PROJECT + '~appgver_d95d358ac7f081918db3fa181f4387ba', deployment: 'appgdep_6abf9e40b8248191ad11721dd367e7a2', firefoxSHA256: 'ce0d881dec8cea0728c5f513461f66de736c631c837e0e4c847cdf315c996745' });
export const OFFICIAL = Object.freeze({ version: '159.0a1', buildID: '20261002211853', hg: 'dfc77f7a6d716f1a20a2576597638d4fc21cd916', gitMirror: 'bf9757d91e2e53b8ab836f2a08bf4c0275fdcd23' });
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const HASH = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const equal = (actual, expected, name) => assert.deepEqual(actual, expected, name);
const requireNames = (actual, required, name) => { assert.ok(Array.isArray(actual), name); assert.equal(new Set(actual.map(x => x.name)).size, actual.length, name + ' duplicates'); for (const item of required) assert.ok(actual.some(x => x.name === item), name + ': missing ' + item); };
export const JIT_CASES = ['install-call-free', 'integer-correctness', 'bailout', 'interrupt-cancel', 'incremental-gc', 'debugger', 'coverage', 'handler-throw-policy', 'script-global-cache', 'worker-tls-stack', 'interpreter-fallback'];
export const BROWSER_CASES = ['default-local-page', 'typed-keyboard', 'guest-js', 'download', 'devtools'];
export const GPU_CASES = ['vulkan', 'opengl', 'firefox-webgl', 'firefox-webgpu'];
// Original eight-case fixture, pinned separately from final arm outputs.
export const PERFORMANCE_EXPECTED = Object.freeze({ 'int-loop': 49995000, 'call-recursion': 377, 'throw-flat': 500, 'throw-deep': 100, 'throw-error': 1700, 'prop-mono': 4003, 'native-call': 3999, json: 19900 });
export const PERFORMANCE_FIXTURE_SHA256 = 'b07d647a19177c276ea5c94df60d7557405d0a69a767d21d471d3071fa5e31d8';
const positiveFinite = x => Number.isFinite(x) && x > 0;
const median = xs => { const s = xs.slice().sort((a, b) => a - b), n = s.length; return n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2; };

export function checkCPU(cpu) {
  assert.ok(Number.isInteger(cpu.nproc) && cpu.nproc > 0 && cpu.nproc <= 64, 'host count exceeds reviewed UI limit or is invalid');
  for (const name of ['hardwareConcurrency', 'selected', 'requested', 'kernel']) equal(cpu[name], cpu.nproc, 'CPU ' + name);
  assert.ok(typeof cpu.kernelStartup === 'string', 'saved actual startup SMP');
  const smp = cpu.kernelStartup.split('\n').map(line => /smp: Brought up \d+ nodes?, (\d+) CPUs?\b/.exec(line)).filter(Boolean);
  assert.ok(smp.length > 0, 'saved actual startup SMP'); equal(Number(smp.at(-1)[1]), cpu.kernel, 'latest actual startup SMP');
  requireNames(cpu.observations, ['preboot', 'startup', 'after-phase', 'final'], 'fresh CPU phases');
  for (const row of cpu.observations) { equal(row.nproc, cpu.nproc, 'allocation drift'); assert.ok(Number.isFinite(row.atMs), 'CPU observation timestamp'); }
  assert.ok(cpu.observations.every((row, i) => i === 0 || row.atMs >= cpu.observations[i - 1].atMs), 'CPU ordering');
}

export function checkExpectations(e) {
  equal(e.schema, 1, 'expectation schema'); equal(e.projectID, PROJECT, 'existing project'); equal(e.origin, ORIGIN, 'same public origin');
  assert.ok(['jit', 'gpu'].includes(e.release), 'release sequence');
  equal(e.official, OFFICIAL, 'acquired Nightly identity');
  assert.match(e.rootCommit, COMMIT); assert.match(e.sitesCommit, COMMIT); assert.notEqual(e.rootCommit, '772bb8cb78fadbfaf850e1e34691d710bfcad146');
  assert.match(e.runtime, /^[a-z0-9][a-z0-9._-]+$/); assert.notEqual(e.runtime, V10.runtime);
  assert.match(e.localBuildID, /^\d{14}$/); assert.match(e.binarySHA256, HASH); assert.match(e.workerGraphSHA256, HASH);
  for (const name of ['kernel', 'rootfs', 'firefox']) { assert.match(e.images[name].sha256, HASH); assert.ok(Number.isSafeInteger(e.images[name].bytes) && e.images[name].bytes > 0); assert.ok(e.images[name].path.startsWith('/linux/')); }
  assert.notEqual(e.images.firefox.sha256, V10.firefoxSHA256, 'not historical ESR payload');
  for (const name of ['assetsSHA256', 'graphSHA256', 'provenanceSHA256', 'rootHTMLSHA256', 'tarSHA256']) assert.match(e.dist[name], HASH, name);
  assert.ok(e.dist.routeInventory && Object.keys(e.dist.routeInventory).length > 0, 'complete caller-reviewed route inventory');
  for (const [path, row] of Object.entries(e.dist.routeInventory)) { assert.ok(path.startsWith('/') && !path.includes('..') && !path.includes('?') && !path.includes('#')); assert.match(row.sha256, HASH); assert.ok(Number.isSafeInteger(row.size) && row.size > 0); }
  assert.ok(Number.isSafeInteger(e.dist.tarBytes) && e.dist.tarBytes > 0);
  if (e.release === 'jit') equal(e.rollback, V10, 'first release rollback is v10');
  else { assert.notEqual(e.rollback.runtime, V10.runtime); assert.match(e.rollback.firefoxSHA256, HASH); assert.match(e.rollback.acceptanceSHA256, HASH); assert.match(e.rollback.savedVersion, new RegExp('^' + PROJECT + '~appgver_[a-f0-9]+$')); assert.match(e.rollback.deployment, /^appgdep_[a-f0-9]+$/); }
  assert.ok(e.evidence && Object.keys(e.evidence).length > 0, 'caller-reviewed evidence pins');
  for (const [name, ref] of Object.entries(e.evidence)) { assert.match(ref.sha256, HASH, name); assert.ok(typeof ref.path === 'string' && ref.path.length, name + ' path'); }
  assert.match(e.performanceDeclarationSHA256, HASH); equal(e.evidence.performanceDeclaration?.sha256, e.performanceDeclarationSHA256, 'reviewed frozen performance declaration');
  const d = e.performanceDeclaration; assert.ok(d, 'reviewed performance declaration fields'); equal(d.order, 'ABBAAB'); equal(d.expected, PERFORMANCE_EXPECTED); equal(d.fixtureSHA256, PERFORMANCE_FIXTURE_SHA256); equal(e.evidence.benchmarkFixture?.sha256, d.fixtureSHA256);
  equal(d.repetitions, 100); equal(d.rounds, 3); equal(d.batches, 11); equal(d.candidateSHA256, e.images.firefox.sha256); equal(d.controls.v10, V10.firefoxSHA256); assert.match(d.controls['same-nightly-no-jit'], HASH);
  for (const name of [...Object.keys(PERFORMANCE_EXPECTED), 'launch', 'guestReady']) assert.ok(positiveFinite(d.maximumRatios[name]) && d.maximumRatios[name] <= 1, 'frozen strict bound ' + name);
  assert.ok(Number.isFinite(d.frozenAtMs), 'declaration freeze timestamp');
  assert.ok(typeof e.featurePolicy?.allowCompute === 'boolean', 'reviewed compute feature policy'); if (e.release === 'jit') equal(e.featurePolicy.allowCompute, false, 'conservative JIT release compute policy');
  if (e.featurePolicy.allowCompute) { assert.match(e.featurePolicy.computeShaderFixtureSHA256, HASH); equal(e.evidence.computeShaderFixture?.sha256, e.featurePolicy.computeShaderFixtureSHA256, 'reviewed compute shader fixture'); }
  return e;
}

// Evidence must be frozen by the caller's independent review, never discovered
// from the public response or pinned by this verifier to make a failure pass.
export async function loadEvidence(e, base) {
  checkExpectations(e); const records = {}, root = await realpath(base);
  for (const [name, ref] of Object.entries(e.evidence)) {
    const path = await realpath(resolve(root, ref.path));
    assert.ok(!relative(root, path).startsWith('..') && path !== root, 'evidence outside reviewed packet');
    if (ref.kind === 'raw') {
      const hash = createHash('sha256'); let size = 0, prefix = Buffer.alloc(0);
      for await (const bytes of createReadStream(path)) { hash.update(bytes); size += bytes.length; if (prefix.length < 512) prefix = Buffer.concat([prefix, bytes.subarray(0, 512 - prefix.length)]); }
      equal(hash.digest('hex'), ref.sha256, 'retained raw evidence ' + name);
      records[name] = { retainedArtifactSHA256: ref.sha256, bytes: size, prefixHex: prefix.toString('hex') };
    } else { const bytes = await readFile(path); equal(sha(bytes), ref.sha256, 'retained evidence ' + name); records[name] = JSON.parse(bytes); }
  }
  return records;
}

function guest(subject, e, name) {
  equal(subject.execution, 'linux-wasm-guest', name + ' actual execution');
  equal(subject.runtime, e.runtime, name + ' runtime'); equal(subject.firefoxSHA256, e.images.firefox.sha256, name + ' payload');
  equal(subject.binarySHA256, e.binarySHA256, name + ' binary'); equal(subject.version, OFFICIAL.version, name + ' version'); equal(subject.buildID, e.localBuildID, name + ' build');
  assert.ok(subject.rawEvidence?.length > 0, name + ' raw references');
}
function successCases(rows, names, e, label) {
  requireNames(rows, names, label);
  for (const row of rows) { guest(row, e, label + '/' + row.name); assert.ok(Number.isInteger(row.assertions) && row.assertions > 0); equal(row.failures, [], label + '/' + row.name); assert.ok(row.observed && Object.keys(row.observed).length > 0, label + ' observations'); checkCPU(row.cpu); }
}
function checkQA(q, e, publicRun) {
  equal(q.origin, publicRun ? e.origin : q.reviewedPrivateOrigin, 'QA origin'); if (!publicRun) assert.match(q.reviewedPrivateOrigin, /^http:\/\/(127\.0\.0\.1|localhost):\d+$/);
  requireNames(q.boots, ['cold', 'warm', 'update'], 'actual QA boots');
  for (const b of q.boots) {
    guest(b, e, 'QA ' + b.name); checkCPU(b.cpu); equal(b.crossOriginIsolated, true); equal(b.sharedArrayBuffer, true);
    equal(b.manifestSHA256, q.activeManifestSHA256); equal(b.ready, 'firefox-window'); equal(b.shutdown, 'normal');
    assert.ok(Array.isArray(b.imageRequests)); if (b.name !== 'cold') equal(b.imageRequests, [], 'cached warm/update restart');
    if (b.name === 'update') { equal(b.fromRuntime, e.rollback.runtime); equal(b.updateAction, 'Update & restart'); equal(b.sameOrigin, true); }
  }
  assert.ok(q.boots.every(b => b.cpu.nproc === q.boots[0].cpu.nproc), 'QA CPU allocation drift');
  assert.match(q.activeManifestSHA256, HASH);
  successCases(q.cases, BROWSER_CASES, e, 'browser');
  equal(q.defaultPage.url, 'file:///opt/firefox/gpu-check/gpu-check.html'); equal(q.defaultPage.automaticLaunch, true); equal(q.defaultPage.forceEnabledDefaults, true);
  // navigator.buildID may be privacy-reduced or absent. Exact app/compiled
  // identity is checked above on actual guest records and retained application.ini.
  assert.match(q.defaultPage.reportedUserAgent, /Firefox\/159(?:\.0)?(?:\s|$)/, 'page reported major version'); assert.ok(q.defaultPage.reportedBuildID === null || typeof q.defaultPage.reportedBuildID === 'string', 'page raw BuildID display');
  assert.ok(q.defaultPage.animationFrames > 1); assert.ok(q.defaultPage.statusText?.length > 0);
  equal(q.profile.baselineRuntime, e.rollback.runtime); equal(q.profile.beforeClosed, 'normal'); equal(q.profile.afterClosed, 'normal'); equal(q.profile.reopened, true);
  for (const name of ['home', 'savedHomepage', 'userJS', 'downloads', 'trustChoices', 'explicitDistrust', 'sdrKey']) { assert.match(q.profile.before[name], HASH, name); equal(q.profile.after[name], q.profile.before[name], 'profile preservation ' + name); }
  equal(q.cleanup.browser, 'normal'); equal(q.cleanup.server, 'normal');
  successCases(q.jit, JIT_CASES, e, 'public/private JIT');
  if (e.release === 'gpu') checkGPU(q.gpu, e);
}
function checkGPU(g, e) {
  equal(g.nightlyHg, OFFICIAL.hg); assert.match(g.nativeFFISHA256, HASH); assert.match(g.generatedGoldensSHA256, HASH); assert.match(g.decoderSHA256, HASH);
  assert.notEqual(g.decoderSHA256, '2f0c575b700a9220aea6365a60201f29600ff446c26eeeb78d703ccb11cd248e', 'old Firefox128 decoder cannot prove Nightly GPU');
  equal(g.goldenSourceVersion, OFFICIAL.version); equal(g.malformedFailures, []); assert.ok(g.malformedCases > 0);
  successCases(g.cases, GPU_CASES, e, 'GPU');
  for (const row of g.cases) { assert.ok(row.observed.frames > 1); assert.match(row.observed.readbackSHA256, HASH); equal(row.observed.readbackSHA256, row.observed.expectedReadbackSHA256); assert.ok(row.observed.backend?.length > 0); equal(row.observed.recovery, 'passed'); equal(row.observed.shutdown, 'normal'); assert.ok(row.observed.limits && Object.keys(row.observed.limits).length > 0); }
}

function checkPerformance(e, r) {
  const p = r.performance, d = e.performanceDeclaration;
  equal(r.performanceDeclaration, d, 'retained declaration matches independent review'); equal(p.declarationSHA256, e.performanceDeclarationSHA256); assert.ok(p.rawEvidence.includes('performanceDeclaration') && p.rawEvidence.includes('benchmarkFixture'), 'performance frozen/raw input references');
  equal(r.benchmarkFixture.retainedArtifactSHA256, d.fixtureSHA256); assert.ok(r.benchmarkFixture.bytes > 0); equal(p.sameNightlyControlSHA256, d.controls['same-nightly-no-jit']);
  equal(p.order, d.order); equal(p.frozenBeforeRun, true); equal(p.excludedSamples, []); equal(p.failures, []); requireNames(p.controls, ['v10', 'same-nightly-no-jit'], 'performance controls'); equal(p.controls.length, 2);
  for (const c of p.controls) {
    equal(c.baselineSHA256, d.controls[c.name]); equal(c.arms.length, 6); equal(c.arms.map(a => a.arm).join(''), d.order);
    requireNames(c.cases, Object.keys(PERFORMANCE_EXPECTED), 'all original eight cases'); equal(c.cases.length, 8);
    for (const a of c.arms) {
      checkCPU(a.cpu); equal(a.execution, 'linux-wasm-guest'); equal(a.runtimeSHA256, a.arm === 'A' ? c.baselineSHA256 : e.images.firefox.sha256); equal(a.ready, 'firefox-window'); assert.ok(a.rawEvidence?.length > 0);
      if (a.arm === 'B') guest(a, e, 'benchmark candidate arm');
      assert.ok(Number.isFinite(a.startedAtMs) && a.startedAtMs >= d.frozenAtMs, 'benchmark declaration was not frozen before arm');
      assert.ok(positiveFinite(a.launchMs) && positiveFinite(a.guestReadyMs), 'actual finite launch/readiness timings');
      equal(a.samples.length, 24, 'three rounds of all eight cases'); const seen = new Set();
      for (const row of a.samples) {
        assert.ok(Number.isInteger(row.round) && row.round >= 0 && row.round < d.rounds); assert.ok(Object.hasOwn(PERFORMANCE_EXPECTED, row.name));
        const key = row.round + ':' + row.name; assert.ok(!seen.has(key), 'duplicate performance row'); seen.add(key);
        equal(row.reps, d.repetitions); equal(row.checksum, PERFORMANCE_EXPECTED[row.name] * d.repetitions * d.batches | 0, 'actual benchmark checksum');
        equal(row.batchMs.length, d.batches); assert.ok(row.batchMs.every(positiveFinite), 'positive finite raw batches'); equal(row.medianBatchMs, median(row.batchMs));
      }
    }
    for (const row of c.cases) {
      const bootValues = arm => c.arms.filter(a => a.arm === arm).map(a => median(a.samples.filter(x => x.name === row.name).flatMap(x => x.batchMs)));
      equal(row.controlMedian, median(bootValues('A'))); equal(row.candidateMedian, median(bootValues('B'))); equal(row.rawSamples, 6 * d.rounds * d.batches); equal(row.frozenMaximumRatio, d.maximumRatios[row.name]); equal(row.checksumFailures, []);
      assert.ok(positiveFinite(row.controlMedian) && positiveFinite(row.candidateMedian) && row.candidateMedian / row.controlMedian <= row.frozenMaximumRatio, 'performance regression');
    }
    for (const [name, key] of [['launch', 'launchMs'], ['guestReady', 'guestReadyMs']]) {
      const control = median(c.arms.filter(a => a.arm === 'A').map(a => a[key])), candidate = median(c.arms.filter(a => a.arm === 'B').map(a => a[key]));
      equal(c[name].controlMedian, control); equal(c[name].candidateMedian, candidate); equal(c[name].frozenMaximumRatio, d.maximumRatios[name]); assert.ok(candidate / control <= c[name].frozenMaximumRatio, name + ' regression');
    }
  }
  assert.ok(p.controls.every(c => c.arms.every(a => a.cpu.nproc === p.controls[0].arms[0].cpu.nproc)), 'comparative control allocation drift');
}

function checkCompute(c, e, gpu) {
  equal(c.nightlyHg, e.official.hg); equal(c.nativeFFISHA256, gpu.nativeFFISHA256); equal(c.decoderSHA256, gpu.decoderSHA256); equal(c.shaderFixtureSHA256, e.featurePolicy.computeShaderFixtureSHA256); assert.ok(c.rawEvidence?.includes('computeShaderFixture'), 'retained compute shader/execution proof');
  successCases(c.cases, ['compute-dispatch-readback', 'compute-limits', 'compute-errors-recovery'], e, 'enabled compute');
  for (const row of c.cases) { assert.match(row.observed.readbackSHA256, HASH); equal(row.observed.readbackSHA256, row.observed.expectedReadbackSHA256); equal(row.observed.backend, 'current-nightly-native-wasm'); equal(row.observed.recovery, 'passed'); }
}

export function checkRelease(e, r) {
  checkExpectations(e);
  let synthetic = e.synthetic === true;
  function findSynthetic(value) { if (value && typeof value === 'object') { if (value.synthetic === true) synthetic = true; for (const x of Object.values(value)) findSynthetic(x); } } findSynthetic(r);
  for (const name of ['build', 'package', 'candidateQA', 'nss', 'jit', 'performance', 'dependency', 'promotion', 'source', 'baseline', 'save', 'deployment', 'routes', 'publicQA']) assert.ok(r[name], 'missing actual ' + name);
  const refs = new Set(Object.keys(r));
  const raw = (value) => { if (value && typeof value === 'object') { if (value.rawEvidence) for (const name of value.rawEvidence) assert.ok(refs.has(name), 'unloaded raw evidence ' + name); for (const v of Object.values(value)) raw(v); } }; raw(r);
  // Independently loaded bytes/captured argv are mandatory. A report's caller
  // pass field cannot substitute for the browser binary, application.ini or logs.
  for (const name of ['binary', 'applicationINI', 'configureLog', 'linkLog', 'compilerArgv']) { assert.ok(r[name], 'missing retained ' + name); assert.ok(r.build.rawEvidence?.includes(name), 'build does not bind ' + name); }
  equal(r.binary.retainedArtifactSHA256, e.binarySHA256); assert.ok(r.binary.bytes > 8); assert.ok(r.binary.prefixHex.startsWith('0061736d01000000'), 'actual native Wasm module header');
  equal(e.evidence.binary.sha256, e.binarySHA256, 'reviewed binary evidence pin');
  for (const name of ['applicationINI', 'configureLog', 'linkLog']) { assert.ok(r[name].bytes > 0, 'actual retained ' + name); equal(r[name].retainedArtifactSHA256, e.evidence[name].sha256); }
  const ini = Buffer.from(r.applicationINI.prefixHex, 'hex').toString('utf8'); assert.match(ini, new RegExp('(?:^|\\n)Version=' + e.official.version.replace('.', '\\.') + '(?:\\r?\\n|$)')); assert.match(ini, new RegExp('(?:^|\\n)BuildID=' + e.localBuildID + '(?:\\r?\\n|$)'));
  equal(r.compilerArgv.execution, 'full-build-actual'); assert.ok(r.compilerArgv.host.length > 0 && r.compilerArgv.guest.length > 0);
  for (const row of r.compilerArgv.host) { assert.ok(row.argv.length > 0); assert.ok(!row.argv.some(x => /wasm-enable-sjlj|fc\+\+-abi=webassembly|--target=wasm32/.test(x)), 'target flags leak into host command'); }
  for (const row of r.compilerArgv.guest) { assert.ok(row.expandedArgv.some(x => x.includes('wasm32-unknown-linux-musl'))); assert.ok(row.expandedArgv.includes('-fc++-abi=webassembly')); assert.ok(row.expandedArgv.includes('-wasm-enable-sjlj')); }
  for (const name of ['build', 'package', 'candidateQA', 'nss', 'jit', 'performance', 'dependency', 'promotion', 'source', 'baseline', 'save', 'deployment', 'publicQA']) assert.ok(r[name].rawEvidence?.length > 0, 'missing underlying pinned records for ' + name);
  equal(r.build.execution, 'full-native-wasm-linux-musl'); equal(r.build.exitCode, 0); equal(r.build.linkExitCode, 0); equal(r.build.binarySHA256, e.binarySHA256); equal(r.build.localBuildID, e.localBuildID); equal(r.build.official, e.official);
  equal(r.build.sourceHg, e.official.hg); equal(r.build.gnuObjects, []); equal(r.build.coherentPBLBuild, true); assert.ok(r.build.compilerCommands.host > 0 && r.build.compilerCommands.guest > 0); equal(r.build.guestABI, ['WebAssembly', 'SjLj']);
  equal(r.package.images, e.images); equal(r.package.binarySHA256, e.binarySHA256); equal(r.package.fullDistResources, true); equal(r.package.outsideRecordDifferences, []); equal(r.package.fpcastFailures, []); equal(r.package.validationExitCode, 0); assert.ok(r.package.inventoryCount > 0); equal(r.package.defaultOverlayInputSHA256, r.package.nightlyArchiveSHA256); assert.match(r.package.nightlyArchiveSHA256, HASH);
  checkQA(r.candidateQA, e, false); checkQA(r.publicQA, e, true);
  equal(r.baseline.runtime, e.rollback.runtime); equal(r.baseline.origin, e.origin); equal(r.baseline.closed, 'normal'); checkCPU(r.baseline.cpu); assert.match(r.baseline.profileSHA256, HASH); equal(r.publicQA.profile.baselineProfileSHA256, r.baseline.profileSHA256);
  equal(r.baseline.ready, 'firefox-window'); equal(r.baseline.input, 'typed-keyboard'); for (const name of ['downloadSHA256', 'trustSnapshotSHA256', 'keySnapshotSHA256']) assert.match(r.baseline[name], HASH);
  guest(r.nss, e, 'NSS'); equal(r.nss.certdataSHA256, r.nss.inventoryCertdataSHA256); assert.match(r.nss.certdataSHA256, HASH); equal(r.nss.expectedDER, r.nss.observedDER); assert.ok(r.nss.expectedDER.length > 0); assert.equal(new Set(r.nss.expectedDER).size, r.nss.expectedDER.length); for (const hash of r.nss.expectedDER) assert.match(hash, HASH);
  for (const stage of ['candidate', 'public']) { const t = r.nss[stage]; equal(t.origin, stage === 'public' ? e.origin : r.candidateQA.origin); equal(t.dnsRoute, '/dns'); equal(t.tcpRoute, '/tcp'); equal(t.freshNoSeed, 'passed'); equal(t.validHTTPS, 'accepted'); equal(t.selfSignedHTTPS, 'rejected'); equal(t.expiredHTTPS, 'rejected'); equal(t.hostnameMismatchHTTPS, 'rejected'); equal(t.explicitDistrustHTTPS, 'rejected'); equal(t.modulePolicy, 'reviewed'); equal(t.stoppedProfileKeysAuthTrust, 'preserved'); assert.ok(t.rawEvidence?.length > 0); }
  successCases(r.jit.cases, JIT_CASES, e, 'candidate JIT'); equal(r.jit.fatalAbort, 'guest-abort-unreachable'); equal(r.jit.postTrapContinuation, false); equal(r.jit.quotaFailure, 'safe-interpreter-fallback'); equal(r.jit.tableMemoryContract, 'current-nightly-validated');
  checkPerformance(e, r);
  equal(r.dependency.nightlyHg, e.official.hg); equal(r.dependency.unreviewedImports, []); equal(r.dependency.unreviewedAssets, []); equal(r.dependency.allowCompute, e.featurePolicy.allowCompute);
  if (e.release === 'jit') { equal(r.dependency.legacyDecoderPolicy, 'inactive-enabled-callers'); assert.ok(r.dependency.enabledNightlyCallers.length > 0); for (const c of r.dependency.enabledNightlyCallers) { equal(c.legacyDecoderInvocations, 0); equal(c.callTraceComplete, true); assert.ok(c.rawEvidence.length > 0); } }
  else { equal(r.dependency.legacyDecoderPolicy, 'replaced-current-abi'); checkGPU(r.dependency.gpu, e); if (e.featurePolicy.allowCompute) { equal(r.computeShaderFixture.retainedArtifactSHA256, e.featurePolicy.computeShaderFixtureSHA256); assert.ok(r.computeShaderFixture.bytes > 0); checkCompute(r.dependency.compute, e, r.dependency.gpu); checkCompute(r.candidateQA.compute, e, r.candidateQA.gpu); checkCompute(r.publicQA.compute, e, r.publicQA.gpu); } }
  equal(r.promotion.runtime, e.runtime); equal(r.promotion.images, e.images); equal(r.promotion.rollback, e.rollback); equal(r.promotion.freshnessFailures, []); equal(r.promotion.applyResult, 'accepted');
  equal(r.source.rootCommit, e.rootCommit); equal(r.source.sitesCommit, e.sitesCommit); equal(r.source.reviewedPathsDirty, []); equal(r.source.remoteHEAD, e.sitesCommit); equal(r.source.unitExitCode, 0); equal(r.source.workerdExitCode, 0); equal(r.source.tarSHA256, e.dist.tarSHA256); equal(r.source.tarBytes, e.dist.tarBytes); equal(r.source.provenanceSHA256, e.dist.provenanceSHA256);
  equal(r.save.projectID, e.projectID); equal(r.save.sourceSHA, e.sitesCommit); equal(r.save.localTarSHA256, e.dist.tarSHA256); assert.match(r.save.serverArchiveHash, /^sha256:[a-f0-9]{64}$/); assert.match(r.save.id, new RegExp('^' + PROJECT + '~appgver_[a-f0-9]+$')); equal(r.save.id, e.savedVersionID);
  equal(r.deployment.projectID, e.projectID); equal(r.deployment.savedVersionID, r.save.id); equal(r.deployment.id, e.deploymentID); assert.match(r.deployment.id, /^appgdep_[a-f0-9]+$/); equal(r.deployment.status, 'succeeded'); equal(r.deployment.origin, e.origin); equal(r.deployment.audienceBefore, 'public'); equal(r.deployment.audienceAfter, 'public'); equal(r.deployment.overrides, []);
  equal(r.routes.origin, e.origin); equal(r.routes.parentCommit, e.rootCommit); equal(r.routes.workerGraphSHA256, e.workerGraphSHA256); equal(r.routes.assetsSHA256, e.dist.assetsSHA256); equal(r.routes.complete, true); equal(r.routes.failures, []); equal(r.routes.expectedRouteCount, r.routes.routes.length);
  equal(r.routes.routes.map(x => x.path).sort(), Object.keys(e.dist.routeInventory).sort(), 'every reviewed public route exactly once');
  for (const row of r.routes.routes) { const pin = e.dist.routeInventory[row.path]; equal(row.sha256 ?? row.normalizedSHA256, pin.sha256, 'public route hash ' + row.path); equal(row.size ?? row.normalizedSize, pin.size, 'public route size ' + row.path); }
  if (e.release === 'gpu') {
    assert.ok(r.rollbackAcceptance, 'accepted immediate Nightly JIT rollback proof'); equal(e.evidence.rollbackAcceptance.sha256, e.rollback.acceptanceSHA256, 'frozen previous acceptance');
    equal(r.rollbackAcceptance.release, 'jit'); equal(r.rollbackAcceptance.releaseAcceptance, true); equal(r.rollbackAcceptance.runtime, e.rollback.runtime);
    equal(r.rollbackAcceptance.firefoxSHA256, e.rollback.firefoxSHA256); equal(r.rollbackAcceptance.savedVersionID, e.rollback.savedVersion); equal(r.rollbackAcceptance.deploymentID, e.rollback.deployment);
  }
  return { schema: 1, release: e.release, runtime: e.runtime, firefoxSHA256: e.images.firefox.sha256, savedVersionID: r.save.id, deploymentID: r.deployment.id, contractValid: true, synthetic, releaseAcceptance: !synthetic, trustBoundary: 'Caller independently reviews and freezes every report and its raw artifacts; this contract does not authenticate guest execution or platform records.' };
}
