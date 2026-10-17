import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as safety from './gpt6-codex-safety.mjs';
import * as homeTools from './gpt6-codex-safety-home.mjs';

const root = 'admin/nightly-jit-safety/safety-test/';
const profile = 'admin/.mozilla/firefox/http1-profile/user.js';
const bytes = text => new TextEncoder().encode(text);

function memoryHome() {
  const nodes = new Map([['', { path: '', directory: true }]]);
  const calls = [];
  const home = {
    root: nodes.get(''), nodes, calls,
    async lookup(parent, name) { calls.push('lookup'); return nodes.get(parent.path ? `${parent.path}/${name}` : name); },
    async mkdir(parent, name, attributes) {
      const node = { path: parent.path ? `${parent.path}/${name}` : name, directory: true, attributes };
      nodes.set(node.path, node);
      return node;
    },
    async create(parent, name, flags, attributes) {
      const node = { path: `${parent.path}/${name}`, data: new Uint8Array(), attributes };
      nodes.set(node.path, node);
      calls.push('create');
      return { node, handle: 1 };
    },
    async write(node, handle, offset, data) { calls.push('write'); node.data = data.slice(); return data.length; },
    async getattr(node) { return { size: BigInt(node.data.length), mode: 0o100644 }; },
    async open() { calls.push('open'); return 1; },
    async read(node, handle, offset, length) { calls.push('read'); return node.data.slice(Number(offset), Number(offset) + length); },
    async release() { calls.push('release'); },
    async destroy() { calls.push('destroy'); },
  };
  return home;
}

test('full-safety seeding retains exact binary bytes and never overwrites a profile', async () => {
  const home = memoryHome();
  const files = { [root + 'session.json']: bytes('{"label":"safety-test"}\n'), [profile]: bytes('preferences\n') };
  await homeTools.seedFullSafety(home, files);
  for (const [name, data] of Object.entries(files)) {
    assert.deepEqual(home.nodes.get(name).data, data);
    assert.deepEqual(home.nodes.get(name).attributes, { mode: 0o644, uid: 1000, gid: 1000 });
  }
  const created = home.calls.filter(call => call === 'create').length;
  await assert.rejects(homeTools.seedFullSafety(home, { [root + 'new.json']: bytes('new'), [profile]: bytes('overwrite') }), /existing/);
  assert.equal(home.calls.filter(call => call === 'create').length, created);
  assert.deepEqual(home.nodes.get(profile).data, files[profile]);
});

test('full-safety seeds validate every path and bound before touching home', async () => {
  for (const files of [ {}, { '../escape': bytes('bad') }, { [root + '../escape']: bytes('bad') },
    { [root + '']: bytes('bad') }, { '/home/' : bytes('bad') }, { [root + 'text']: 'not bytes' },
    { [root + 'huge']: new Uint8Array(2097153) },
    { [root + 'one']: new Uint8Array(2097152), [root + 'two']: new Uint8Array(2097152), [root + 'three']: bytes('over') },
    Object.fromEntries(Array.from({ length: 129 }, (_, index) => [root + index, bytes('small')])) ]) {
    const home = memoryHome();
    await assert.rejects(homeTools.seedFullSafety(home, files));
    assert.equal(home.calls.length, 0);
  }
});

test('seed failures release open handles and retain failed evidence', async () => {
  for (const write of [async () => 1, async () => { throw Error('write failed'); }]) {
    const home = memoryHome();
    home.write = write;
    await assert.rejects(homeTools.seedFullSafety(home, { [root + 'session.json']: bytes('data') }));
    assert.equal(home.calls.filter(call => call === 'release').length, 1);
    assert.ok(home.nodes.has(root + 'session.json'));
  }
});

test('artifact observation opens read-only and returns exact bytes without writing home', async () => {
  const home = memoryHome();
  const data = Uint8Array.from([0, 255, 10, 128, 1]);
  await homeTools.seedFullSafety(home, { [root + 'observer.stderr']: data });
  home.calls.length = 0;
  const openHome = async options => { assert.deepEqual(options, { readOnly: true }); return home; };
  assert.deepEqual(await homeTools.readFullSafetyArtifact(openHome, root + 'observer.stderr'), data);
  assert.equal(home.calls.includes('write'), false);
  assert.equal(home.calls.includes('create'), false);
  assert.deepEqual(home.calls.slice(-2), ['release', 'destroy']);
  assert.equal(await homeTools.readFullSafetyArtifact(openHome, root + 'missing'), null);
  assert.equal(home.calls.at(-1), 'destroy');
});

test('artifact observation refuses overflow, nonregular files and incomplete reads', async () => {
  for (const size of [-1, 1.5, Number.NaN, 2097152, 2097153, -1n, 2097152n, '4']) {
    const home = memoryHome();
    await homeTools.seedFullSafety(home, { [root + 'observer.stderr']: bytes('data') });
    home.getattr = async () => ({ size, mode: 0o100644 });
    home.calls.length = 0;
    await assert.rejects(homeTools.readFullSafetyArtifact(async () => home, root + 'observer.stderr'));
    assert.equal(home.calls.includes('read'), false);
    assert.equal(home.calls.at(-1), 'destroy');
  }
  for (const change of [{ getattr: async () => ({ size: 4, mode: 0o120777 }) },
    { read: async () => bytes('bad') }, { read: async () => { throw Error('read failed'); } }]) {
    const home = memoryHome();
    await homeTools.seedFullSafety(home, { [root + 'observer.stderr']: bytes('data') });
    Object.assign(home, change);
    home.calls.length = 0;
    await assert.rejects(homeTools.readFullSafetyArtifact(async () => home, root + 'observer.stderr'));
    if (change.read) assert.deepEqual(home.calls.slice(-2), ['release', 'destroy']);
    else assert.equal(home.calls.at(-1), 'destroy');
  }
  let opened = false;
  await assert.rejects(homeTools.readFullSafetyArtifact(async () => { opened = true; }, '../escape'));
  assert.equal(opened, false);
});

test('private init overlay rejects mismatched packaged init before changing its launch', async () => {
  const sourceUrl = new URL('../../web/linux/desktop-extras.mjs', import.meta.url);
  const source = readFileSync(sourceUrl, 'utf8');
  const init = '#!/bin/busybox sh\nlaunch_firefox() {\n  /bin/su -s /bin/sh -c "export HOME=$home; exec /bin/firefox --no-remote --new-instance -profile /home/admin/.mozilla/firefox/http1-profile" "$account"\n}\n';
  const changed = safety.instrumentFullSafetyInit(source, init);
  assert.notEqual(changed, source);
  assert.throws(() => safety.instrumentFullSafetyInit(changed, init));
  assert.throws(() => safety.instrumentFullSafetyInit(source + source, init));
  const portable = changed.replace(/from '(\.\/[^']+)'/g, (_, name) => `from ${JSON.stringify(new URL(name, sourceUrl).href)}`);
  const module = await import('data:text/javascript,' + encodeURIComponent(portable));
  const actual = module.desktopInitOverlay(module.cpioEntry('init', bytes(init)));
  const text = new TextDecoder().decode(actual);
  assert.ok(text.includes(safety.fullSafetyInit(init)));
  assert.ok(text.includes('/bin/clipboard-bridge &'));
  assert.ok(text.includes('/bin/linuxonweb-run-agent &'));
  assert.ok(text.includes('network-smoke-skip'));
  assert.throws(() => module.desktopInitOverlay(module.cpioEntry('init', bytes(init + '\n'))), /packaged init/);
});
