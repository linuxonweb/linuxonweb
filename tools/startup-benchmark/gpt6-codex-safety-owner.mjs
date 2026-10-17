import fs from 'node:fs/promises';
import path from 'node:path';
import { broadCases } from '../nightly-jit-safety/cases-broad.mjs';
import { bindingContract, completeCapture, completedSession, exactFirefoxExit, parentChecks,
  pinFile, sha, digest, LIMIT } from '../nightly-jit-safety/guest-runner/contracts.mjs';
import { fullSafetyCapture } from './gpt6-codex-safety.mjs';

const driverNames = ['privileged-driver.js', 'guest-content.sys.mjs', 'guest-entry.sys.mjs',
  'NightlyJitSafetyChild.sys.mjs', 'NightlyJitSafetyParent.sys.mjs', 'runner-entry.sys.mjs'];
const sameKeys = (object, keys) => JSON.stringify(Object.keys(object || {}).sort()) === JSON.stringify([...keys].sort());
const check = (condition, message) => { if (!condition) throw Error(message); };

export function fullSafetySession(plan, fixture, binding, bindingHash, drivers) {
  bindingContract(binding);
  check(digest(bindingHash), 'Reviewed binding hash required');
  const expectedUrl = `file:///home/admin/nightly-jit-safety/${plan.label}/`;
  const cases = ['main', 'worker'].flatMap(context => broadCases.map(entry => {
    const name = `${plan.label}-${context}-${entry.id}.js`;
    return { ...entry, context, name, url: expectedUrl + name, line: 1 };
  }));
  const fixtureNames = [...cases.map(entry => entry.name),
    ...['debugFresh', 'coverage', 'infinite'].map(name => `${plan.label}-main-${name}.js`),
    `${plan.label}-worker.js`, `${plan.label}.html`];
  check(fixture?.schema === 1 && fixture.coverage === 'broad' && fixture.label === plan.label &&
    fixture.expectedUrl === expectedUrl && JSON.stringify(fixture.cases) === JSON.stringify(cases) &&
    sameKeys(fixture.files, fixtureNames) && Object.values(fixture.files).every(digest), 'Original broad fixture differs');
  check(sameKeys(drivers, driverNames) && Object.values(drivers).every(digest), 'Original driver inventory required');
  return {
    schema: 1, kind: 'nightly-jit-guest-session-preparation-v1', label: plan.label,
    version: '159.0a1', localBuildID: binding.localBuildID, buildIdentityBound: true,
    buildBinding: binding, buildBindingSHA256: bindingHash, portableBaseline: plan.portableBaseline,
    requestedGuestCpus: plan.requestedGuestCpus, nativeEnvironmentSlotCount: 23,
    files: drivers, fixtureContract: fixture, guestAcceptance: false, status: 'prepared', pending: [],
    ...plan.bounds, fixtureClaims: plan.fixtureClaims,
    performanceCases: ['int-loop', 'recursion', 'throw-flat', 'throw-deep', 'throw-error', 'property', 'Math', 'JSON'],
  };
}

export async function loadFullSafetyBundle(record, plan, repo, routes) {
  const pins = [];
  const readPinned = async input => {
    check((await fs.stat(input.path)).size < LIMIT, 'Safety metadata exceeds capture bound');
    pins.push(await pinFile(input));
    const bytes = await fs.readFile(input.path);
    check(sha(bytes) === input.sha256, 'Safety metadata changed during read');
    return bytes;
  };
  const descriptor = JSON.parse(await readPinned(record));
  check(descriptor.kind === 'gpt6-full-safety-bundle-v1', 'Explicit full safety bundle required');
  const bindingBytes = await readPinned(descriptor.binding);
  const binding = JSON.parse(bindingBytes);
  bindingContract(binding);
  for (const [name, key] of Object.entries({ binary: 'finalBinarySHA256', archive: 'archiveSHA256',
    manifest: 'runtimeManifestSHA256', kernel: 'kernelSHA256', buildReview: 'buildReviewSHA256' })) {
    check(descriptor[name]?.sha256 === binding[key], `Current safety build pin differs: ${name}`);
    pins.push(await pinFile(descriptor[name]));
  }
  for (const key of ['observerPblSha256', 'observerInterpreterSha256', 'optionObserverWorkerSha256', 'optionObserverStartupSha256']) {
    check(descriptor.observers?.[key]?.sha256 === binding[key], 'Current observer source pin differs: ' + key);
    pins.push(await pinFile(descriptor.observers[key]));
  }
  const review = JSON.parse(await readPinned(descriptor.buildReview));
  check(review.pass === true && review.runtimeAcceptance === false, 'Reviewed static build identity required');
  const manifest = JSON.parse(await readPinned(descriptor.manifest));
  check(routes['/linux/boot-manifest.json']?.sha256 === descriptor.manifest.sha256, 'Frozen safety manifest differs');
  for (const name of ['kernel', 'firefox']) {
    const asset = manifest.assets?.[name];
    const route = new URL(asset?.url, 'http://localhost/linux/boot-manifest.json').pathname;
    const expected = descriptor[name === 'firefox' ? 'archive' : name];
    check(asset?.sha256 === expected.sha256 && routes[route]?.sha256 === expected.sha256 &&
      routes[route]?.bytes === asset.bytes, 'Frozen safety package differs: ' + name);
  }
  const init = (await readPinned(descriptor.init)).toString('utf8');
  const preparedBytes = await readPinned(descriptor.fixtureSession);
  const prepared = JSON.parse(preparedBytes);
  const fixture = prepared.fixtureContract;
  const base = `admin/nightly-jit-safety/${plan.label}/`;
  const seed = {}, driverPins = {};
  for (const name of driverNames) {
    const directory = path.join(repo, 'tools/nightly-jit-safety', name === 'runner-entry.sys.mjs' ? 'guest-runner' : '');
    const filename = await fs.realpath(path.join(directory, name));
    const bytes = await fs.readFile(filename);
    check(bytes.length < LIMIT, 'Safety driver exceeds bound');
    driverPins[name] = sha(bytes);
    pins.push(await pinFile({ path: filename, sha256: driverPins[name] }));
    seed[base + name] = bytes;
  }
  const session = fullSafetySession(plan, fixture, binding, descriptor.binding.sha256, driverPins);
  for (const [name, hash] of Object.entries(fixture.files)) {
    const filename = await fs.realpath(path.join(path.dirname(descriptor.fixtureSession.path), name));
    seed[base + name] = await readPinned({ path: filename, sha256: hash });
  }
  for (const [key, name] of [['defaults', 'njs-autoconfig.js'], ['config', 'njs-autoconfig.cfg']]) {
    seed['admin/nightly-jit-safety/' + name] = await readPinned(descriptor.startupConfig[key]);
  }
  const capturePath = await fs.realpath(path.join(repo, 'tools/nightly-jit-safety/guest-runner/capture-launch.sh'));
  const captureBytes = await fs.readFile(capturePath);
  pins.push(await pinFile({ path: capturePath, sha256: sha(captureBytes) }));
  seed['admin/nightly-jit-safety/capture-launch.sh'] = Buffer.from(fullSafetyCapture(captureBytes.toString(), plan));
  seed['admin/nightly-jit-safety/active-label'] = Buffer.from(plan.label + '\n');
  seed['admin/.mozilla/firefox/http1-profile/user.js'] = Buffer.from(plan.preferences);
  seed[base + 'session.json'] = Buffer.from(JSON.stringify(session, null, 2) + '\n');
  seed[base + 'contract.json'] = Buffer.from(JSON.stringify(fixture, null, 2) + '\n');
  return { session, bindingBytes, init, seed, pins, descriptor, diagnosticOnly: true };
}

export function createFullSafetyCollector(plan, session, spawnedAt) {
  check(Number.isFinite(spawnedAt), 'Actual browser spawn clock required');
  const names = ['observer.stderr', 'parent-option.json', 'session-result.json', 'firefox-launch.json',
    'firefox-exit.json', 'firefox-start.stat', 'firefox-limits.txt', 'firefox-group-terminal.txt', 'shell-probe.txt',
    ...plan.scopes.flatMap(scope => [scope + '-console.txt', scope + '-result.json'])];
  const files = new Map();
  const remaining = now => {
    check(Number.isFinite(now) && now >= spawnedAt && now - spawnedAt < 150000, 'Original 150-second safety deadline expired');
    return 150000 - (now - spawnedAt);
  };
  return {
    names, remaining,
    record(name, bytes, now) {
      remaining(now);
      check(names.includes(name) && Buffer.isBuffer(bytes) && bytes.length < LIMIT, 'Invalid safety capture artifact');
      if (name === 'observer.stderr') completeCapture(files.get(name) || Buffer.alloc(0), bytes);
      files.set(name, bytes);
    },
    ready() { return ['session-result.json', 'parent-option.json', 'firefox-exit.json'].every(name => files.get(name)?.length); },
    complete(now) {
      remaining(now);
      check(names.every(name => files.has(name)), 'Required full safety artifacts missing');
      const read = name => files.get(name).toString('utf8');
      const parse = name => JSON.parse(read(name));
      const raw = files.get('observer.stderr');
      check(raw.length > 0 && raw.at(-1) === 10, 'Complete direct native transcript requires final newline');
      const parent = parse('parent-option.json');
      completedSession(parse('session-result.json'), plan.arm, session.label);
      parentChecks(parent, session, raw);
      exactFirefoxExit(parse('firefox-launch.json'), parse('firefox-exit.json'), read('firefox-start.stat'),
        read('firefox-group-terminal.txt'), read('firefox-limits.txt'), parent);
      check(/^PBL_SHELL_PROBE errexit=pass required=pass procTail=pass setsid=pass fileBlocks=(2048|4096)$/m.test(read('shell-probe.txt')), 'Actual shell compatibility proof missing');
      for (const scope of plan.scopes) {
        check(files.get(scope + '-console.txt').length > 0, 'Actual privileged transcript missing');
        const operation = parse(scope + '-result.json');
        check(operation.scope === scope && operation.status === 'recorded', 'Actual privileged result incomplete');
      }
      return { status: 'captured-awaiting-independent-review', captureComplete: true, pass: false,
        fullJITAcceptance: false, scopes: plan.scopes, elapsedMs: now - spawnedAt };
    },
  };
}
