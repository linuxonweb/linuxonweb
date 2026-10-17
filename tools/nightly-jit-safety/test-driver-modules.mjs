import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

async function loadDriver(name, globals = {}) {
  const imports = [];
  const context = vm.createContext({
    Services: {},
    Components: { utils: { importGlobalProperties() {} } },
    ChromeUtils: {
      importESModule(url) {
        imports.push(url);
        if (url === 'resource://gre/modules/Timer.sys.mjs') return { setTimeout, clearTimeout };
        throw Error('Module unavailable in Firefox 159: ' + url);
      },
      registerWindowActor: (...args) => globals.register(...args),
      unregisterWindowActor: (...args) => globals.unregister(...args),
    },
    console: { log() {} },
    ...globals,
  });
  const source = process.env.NJS_DRIVER_SOURCE_DIRECTORY ? new URL(name, 'file://' + process.env.NJS_DRIVER_SOURCE_DIRECTORY + '/') : new URL(name, import.meta.url);
  const module = new vm.SourceTextModule(await fs.readFile(source, 'utf8'), {
    context,
    initializeImportMeta(meta) { meta.url = 'resource://njs-fixture/' + name; },
  });
  await module.link(() => { throw Error('Unexpected static dependency'); });
  await module.evaluate();
  return { namespace: module.namespace, imports };
}

test('current Firefox driver modules use the built-in Services global', async () => {
  for (const name of ['guest-entry.sys.mjs', 'guest-content.sys.mjs']) {
    const driver = await loadDriver(name);
    assert.deepEqual(driver.imports, ['resource://gre/modules/Timer.sys.mjs']);
    assert.equal(typeof driver.namespace[name.startsWith('guest-entry') ? 'run' : 'invoke'], 'function');
  }
});

async function privilegedFixture(componentsAvailable = true) {
  const buildID = '20261004075010', label = 'fixture';
  const base = '/home/admin/nightly-jit-safety/fixture/';
  const target = { document: { documentURI: 'file://' + base + label + '.html' },
    navigator: { hardwareConcurrency: 3 }, nightlySafetyMainDone: true, nightlySafetyWorkerDone: true };
  target.windowGlobalChild = { isCurrentGlobal: true, isClosed: false, contentWindow: target, innerWindowId: 29 };
  const state = { loaded: 0, invoked: 0, nuked: 0, writes: [] };
  const testing = { getJitCompilerOptions: () => ({ 'pbl.enable': 1, 'pbl.warmup.threshold': 10 }),
    gcstate: () => 'NotActive', startgc() {}, finishgc() {}, gcslice() {} };
  const nativeComponents = { utils: { getJSTestingFunctions: () => testing } };
  const sandbox = {};
  Object.defineProperty(sandbox, 'Components', { value: componentsAvailable ? nativeComponents : undefined, writable: false });
  const driver = await loadDriver('guest-content.sys.mjs', {
    TextDecoder,
    Services: { appinfo: { version: '159.0a1', appBuildID: buildID, platformBuildID: buildID, processID: 119, processType: 0 },
      prefs: { getBoolPref: () => true }, scriptSecurityManager: { getSystemPrincipal: () => ({}) },
      scriptloader: { loadSubScript(url, actual) {
        assert.equal(url, 'resource://njs-fixture/privileged-driver.js');
        assert.equal(actual, sandbox);
        assert.equal(actual.Components, nativeComponents);
        state.loaded++;
        actual.NightlySafetyDriver = { async incremental(window, observer) {
          assert.equal(window, target);
          assert.equal(observer, base + 'observer.stderr');
          state.invoked++;
          actual.console.log('NJS_PRIV {"event":"host-control"}');
        } };
      } } },
    Components: { utils: { importGlobalProperties() {}, waiveXrays: value => value,
      getJSTestingFunctions: () => testing, Sandbox: () => sandbox,
      nukeSandbox(actual) { assert.equal(actual, sandbox); state.nuked++; } } },
  });
  const result = await driver.namespace.invoke(target, { label, scope: 'incremental', expectedBuildID: buildID, portableBaseline: true }, {
    async exists(filename) { assert.equal(filename, base + 'observer.stderr'); return true; },
    async writeUTF8(filename, value) { state.writes.push({ filename, value }); },
    async writeJSON(filename, value) { state.writes.push({ filename, value }); },
  });
  return { state, result, sandbox, nativeComponents };
}

test('privileged driver preserves read-only sandbox Components and its trusted resource alias', async () => {
  const { state, result, sandbox, nativeComponents } = await privilegedFixture();
  assert.equal(result.status, 'recorded', result.error);
  assert.equal(sandbox.Components, nativeComponents);
  assert.equal(state.loaded, 1);
  assert.equal(state.invoked, 1);
  assert.equal(state.nuked, 1);
  assert.equal(state.writes.length, 2);
  assert.equal(state.writes[1].value, result);
  assert.equal(result.fullJITAcceptance, false);
});

test('privileged driver refuses missing native sandbox APIs without injecting replacements', async () => {
  const { state, result, sandbox } = await privilegedFixture(false);
  assert.equal(result.status, 'pending');
  assert.match(result.error, /sandbox Components API unavailable/);
  assert.equal(sandbox.Components, undefined);
  assert.equal(state.loaded, 0);
  assert.equal(state.invoked, 0);
  assert.equal(state.nuked, 1);
  assert.equal(state.writes.length, 2);
});

test('actor modules retain the trusted resource alias and the exact file fixture match', async () => {
  const label = 'fixture';
  const base = '/home/admin/nightly-jit-safety/' + label + '/';
  const fixture = 'file://' + base + label + '.html';
  const registrations = [], removed = [], writes = [];
  const browser = {
    browsingContext: { currentWindowGlobal: {
      documentURI: { spec: fixture },
      getActor(name) {
        assert.equal(name, 'NightlyJitSafety');
        return { async sendQuery(kind, data) {
          assert.equal(kind, 'NightlyJitSafety:Invoke');
          assert.equal(data.scope, 'identity');
          return { status: 'recorded', fixture: { mainDone: true, workerDone: true, error: null },
            identity: { contentHardwareConcurrency: 2 } };
        } };
      },
    } },
    loadURI(uri) { assert.equal(uri, fixture); },
  };
  const driver = await loadDriver('guest-entry.sys.mjs', {
    Services: { wm: { getMostRecentWindow: () => ({ gBrowser: { selectedBrowser: browser } }) },
      io: { newURI: value => value }, scriptSecurityManager: { getSystemPrincipal: () => ({}) } },
    IOUtils: {
      async readJSON(filename) {
        assert.equal(filename, base + 'session.json');
        return { label, kind: 'nightly-jit-guest-session-preparation-v1', version: '159.0a1',
          buildIdentityBound: true, nativeEnvironmentSlotCount: 23, localBuildID: '20261004075010',
          portableBaseline: false, requestedGuestCpus: 2 };
      },
      async writeJSON(filename, value) { writes.push({ filename, value }); },
    },
    register: (name, options) => registrations.push({ name, options }),
    unregister: name => removed.push(name),
  });
  const result = await driver.namespace.run(base + 'session.json');
  assert.equal(result.status, 'recorded');
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].name, 'NightlyJitSafety');
  assert.equal(registrations[0].options.child.esModuleURI, 'resource://njs-fixture/NightlyJitSafetyChild.sys.mjs');
  assert.equal(registrations[0].options.parent.esModuleURI, 'resource://njs-fixture/NightlyJitSafetyParent.sys.mjs');
  assert.equal(JSON.stringify(registrations[0].options.matches), JSON.stringify([fixture]));
  assert.equal(registrations[0].options.allFrames, false);
  assert.deepEqual(removed, ['NightlyJitSafety']);
  assert.equal(writes[0].filename, base + 'session-result.json');
  assert.equal(writes[0].value, result);
  assert.equal(result.fullJITAcceptance, false);
});

async function contentFixture() {
  const label = 'fixture', buildID = '20261004075010';
  const url = 'file:///home/admin/nightly-jit-safety/fixture/fixture.html';
  const state = { starts: 0, exports: 0, gc: 'Mark', reads: 0 };
  const target = {
    document: { documentURI: url, readyState: 'loading' },
    navigator: { hardwareConcurrency: 3 },
    nightlySafetyStart(readiness) {
      state.starts++;
      this.nightlySafetyStarted = true;
      state.readiness = readiness;
    },
  };
  target.windowGlobalChild = { isCurrentGlobal: true, isClosed: false, contentWindow: target, innerWindowId: 29 };
  const testing = {
    getJitCompilerOptions: () => ({ 'pbl.enable': 0, 'pbl.warmup.threshold': 10 }),
    gcstate() { state.reads++; return state.gc; },
  };
  const driver = await loadDriver('guest-content.sys.mjs', {
    Services: { appinfo: { version: '159.0a1', appBuildID: buildID, platformBuildID: buildID,
      processID: 119, processType: 0 }, prefs: { getBoolPref: () => false } },
    Components: { utils: {
      importGlobalProperties() {}, waiveXrays: value => value, getJSTestingFunctions: () => testing,
      exportFunction(callback, destination) { assert.equal(destination, target); state.exports++; return callback; },
    } },
  });
  return { state, target, testing, invoke: () => driver.namespace.invoke(target,
    { label, scope: 'identity', expectedBuildID: buildID, portableBaseline: false }, {}) };
}

test('deferred original fixture starts once after load with a live GC-readiness callback', async () => {
  const fixture = await contentFixture();
  assert.equal((await fixture.invoke()).status, 'recorded');
  assert.equal(fixture.state.starts, 0);
  fixture.target.document.readyState = 'complete';
  const result = await fixture.invoke();
  assert.equal(result.status, 'recorded');
  assert.equal(fixture.state.starts, 1);
  assert.equal(fixture.state.exports, 1);
  assert.equal(fixture.state.readiness(), 'Mark');
  fixture.state.gc = 'NotActive';
  assert.equal(fixture.state.readiness(), 'NotActive');
  assert.equal(fixture.state.reads, 2);
  assert.equal(result.fixture.mainDone, false);
  assert.equal(result.fixture.workerDone, false);
  fixture.target.nightlySafetyMainDone = true;
  fixture.target.nightlySafetyWorkerDone = true;
  const completed = await fixture.invoke();
  assert.equal(completed.fixture.mainDone, true);
  assert.equal(completed.fixture.workerDone, true);
  assert.equal(fixture.state.starts, 1);
});

test('readiness callback rejects stale window and changed fixture identities', async () => {
  const fixture = await contentFixture();
  fixture.target.document.readyState = 'complete';
  await fixture.invoke();
  assert.equal(typeof fixture.state.readiness, 'function');
  fixture.target.windowGlobalChild.isClosed = true;
  assert.throws(() => fixture.state.readiness(), /GC readiness target changed/);
  fixture.target.windowGlobalChild.isClosed = false;
  fixture.target.windowGlobalChild.isCurrentGlobal = false;
  assert.throws(() => fixture.state.readiness(), /GC readiness target changed/);
  fixture.target.windowGlobalChild.isCurrentGlobal = true;
  fixture.target.document.documentURI = 'file:///another.html';
  assert.throws(() => fixture.state.readiness(), /GC readiness target changed/);
  assert.equal(fixture.state.reads, 0);
});

test('deferred startup requires the actual GC getter and preserves automatic fixtures', async () => {
  const fixture = await contentFixture();
  fixture.target.document.readyState = 'complete';
  delete fixture.testing.gcstate;
  const missing = await fixture.invoke();
  assert.equal(missing.status, 'pending');
  assert.match(missing.error, /actual GC state API unavailable/);
  assert.equal(fixture.state.starts, 0);
  delete fixture.target.nightlySafetyStart;
  fixture.target.nightlySafetyMainDone = true;
  fixture.target.nightlySafetyWorkerDone = true;
  const automatic = await fixture.invoke();
  assert.equal(automatic.status, 'recorded');
  assert.equal(automatic.fixture.mainDone, true);
  assert.equal(automatic.fixture.workerDone, true);
  assert.equal(fixture.state.starts, 0);
});
