import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const names = ['dom.max_script_run_time', 'dom.always_stop_slow_scripts', 'dom.global_stop_script'];
const source = await fs.readFile(process.env.NJS_PRIVILEGED_DRIVER || new URL('./privileged-driver.js', import.meta.url), 'utf8');

function fixture({ defaults = [[names[0], 5]], users = [], fail = false, corrupt = false } = {}) {
  const defaultValues = new Map(defaults), userValues = new Map(users);
  const originalDefaults = [...defaultValues], originalUsers = [...userValues];
  const events = [], scripts = [], writes = [];
  const effective = name => userValues.has(name) ? userValues.get(name) : defaultValues.get(name);
  const prefType = name => typeof effective(name) === 'boolean' ? 128 : typeof effective(name) === 'number' ? 64 : 0;
  const get = (name, type) => {
    if (prefType(name) !== type) throw Error('Preference unavailable or wrong type: ' + name);
    return effective(name);
  };
  const set = (name, value) => { userValues.set(name, value); writes.push([name, value]); };
  const prefs = {
    prefHasUserValue: name => userValues.has(name),
    getPrefType: prefType,
    getIntPref: name => get(name, 64),
    getBoolPref: name => get(name, 128),
    setIntPref: set,
    setBoolPref: set,
    clearUserPref(name) {
      userValues.delete(name);
      if (corrupt && name === names[1]) userValues.set(name, false);
    },
  };
  const target = {
    windowGlobalChild: { innerWindowId: 29 },
    document: {
      createElement: () => ({ textContent: '', remove() {} }),
      documentElement: {
        appendChild(script) {
          scripts.push(script.textContent);
          assert.equal(get(names[0], 64), 1);
          assert.equal(get(names[1], 128), true);
          assert.equal(get(names[2], 128), false);
          if (fail) throw Error('Injected script insertion failure');
          target.nightlyInterruptRecovered = 8386560;
        },
      },
    },
  };
  const context = vm.createContext({ Services: { prefs }, setTimeout, Date });
  vm.runInContext(source, context);
  const driver = context.NightlySafetyDriver;
  driver.context = async () => ({ target, emit: event => events.push(event),
    read: async () => new Uint8Array([10]), requireBaseline() {}, source: name => name,
    finish: async (_before, event, fields) => events.push({ event, ...fields }),
    done: () => events.push({ event: 'driver-done' }) });
  return { run: () => driver.interrupt(target, '/owned/observer.stderr'), events, scripts, writes,
    restored: () => { assert.deepEqual([...userValues], originalUsers); assert.deepEqual([...defaultValues], originalDefaults); } };
}

test('absent boolean preferences are restored to absence after interrupt recovery', async () => {
  const state = fixture();
  await state.run();
  state.restored();
  assert.equal(state.scripts.length, 1);
  assert.equal(state.scripts[0], 'setTimeout(function(){ njs_infinite(); },0); setTimeout(function(){globalThis.nightlyInterruptRecovered=njs_sum();},0);');
  assert.ok(state.events.some(event => event.event === 'interrupt-start' && event.timeoutSeconds === 1 && event.globalStopScript === false));
  assert.ok(state.events.some(event => event.event === 'interrupt-cleanup' && event.prefsRestored));
  assert.ok(state.events.some(event => event.event === 'driver-done'));
});

test('missing preferences remain absent after an exception', async () => {
  const state = fixture({ fail: true });
  await assert.rejects(state.run(), /Injected script insertion failure/);
  state.restored();
  assert.ok(state.events.some(event => event.event === 'interrupt-cleanup' && event.prefsRestored));
  assert.ok(!state.events.some(event => event.event === 'driver-done'));
});

test('existing default and user values retain both values and user bits', async () => {
  const state = fixture({ defaults: [[names[0], 5], [names[1], false], [names[2], true]],
    users: [[names[0], 9], [names[1], true]] });
  await state.run();
  state.restored();
});

test('mistyped existing preference is rejected before mutation', async () => {
  const state = fixture({ users: [[names[1], 42]] });
  await assert.rejects(state.run(), /wrong type/);
  assert.equal(state.writes.length, 0);
  state.restored();
});

test('failure to restore absence is rejected', async () => {
  const state = fixture({ corrupt: true });
  await assert.rejects(state.run(), /interrupt pref cleanup/);
  assert.ok(!state.events.some(event => event.event === 'driver-done'));
});
