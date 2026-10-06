import test from 'node:test';
import assert from 'node:assert/strict';
import { restoreConfiguration, needsFirefoxMemoryChoice, presentationStatus, presentationChoice, withPresentationChoice, displayOnlyChange, settingsRecord, PRESENTATION_VERSION } from './machine-settings.mjs';

const firefoxDefaults = { resolution: '1280x720', cpus: 2, ram: 4096, backend: 'auto' };
const options = { resolutions: ['400x300', '1280x720', '1920x1080'], ramValues: [128, 256, 512, 1024, 2048, 4096], maxCpus: 6 };

test('a saved 1 GB or 2 GB choice boots Firefox without the memory prompt', () => {
  for (const ram of [1024, 2048]) {
    const { configuration, ramChosen } = restoreConfiguration({ resolution: '1920x1080', cpus: 4, ram, backend: 'webgl' }, firefoxDefaults, options);
    assert.deepEqual(configuration, { resolution: '1920x1080', cpus: 4, ram, backend: 'webgl' });
    assert.equal(needsFirefoxMemoryChoice('firefox', configuration.ram, ramChosen), false);
  }
});

test('saved memory survives a core count this host no longer offers', () => {
  const { configuration, ramChosen } = restoreConfiguration({ resolution: '400x300', cpus: 8, ram: 2048, backend: 'auto' }, firefoxDefaults, options);
  assert.deepEqual(configuration, { resolution: '400x300', cpus: 2, ram: 2048, backend: 'auto' });
  assert.equal(needsFirefoxMemoryChoice('firefox', configuration.ram, ramChosen), false);
});

test('any explicitly saved memory size, including keeping 4 GB, is not asked again', () => {
  for (const ram of [512, 4096]) {
    const { configuration, ramChosen } = restoreConfiguration({ ...firefoxDefaults, ram }, firefoxDefaults, options);
    assert.equal(configuration.ram, ram);
    assert.equal(needsFirefoxMemoryChoice('firefox', configuration.ram, ramChosen), false);
  }
});

test('the prompt appears only for an unchosen Firefox default that may not fit', () => {
  for (const saved of [null, undefined, 'text', {}, { ...firefoxDefaults, ram: 3000 }, { ...firefoxDefaults, ram: '2048' }]) {
    const { configuration, ramChosen } = restoreConfiguration(saved, firefoxDefaults, options);
    assert.equal(ramChosen, false);
    assert.equal(configuration.ram, 4096);
    assert.equal(needsFirefoxMemoryChoice('firefox', configuration.ram, ramChosen), true);
  }
  assert.equal(needsFirefoxMemoryChoice('firefox', 2048, false), false);
  assert.equal(needsFirefoxMemoryChoice('startx', 4096, false), false);
});

test('invalid saved fields fall back to defaults individually', () => {
  const { configuration } = restoreConfiguration({ resolution: '9x9', cpus: 0, ram: 1024, backend: 'vulkan' }, firefoxDefaults, options);
  assert.deepEqual(configuration, { ...firefoxDefaults, ram: 1024 });
});

test('a saved Auto stays Auto, which now means WebGPU first with a prompt on failure', () => {
  const { configuration } = restoreConfiguration({ ...firefoxDefaults, ram: 2048, backend: 'auto' }, firefoxDefaults, options);
  assert.equal(configuration.backend, 'auto');
});

test('Canvas 2D saved as the old default becomes the WebGPU default; an explicit choice stays', () => {
  const old = restoreConfiguration({ resolution: '1920x1080', cpus: 4, ram: 2048, backend: 'canvas2d' }, firefoxDefaults, options);
  assert.deepEqual(old.configuration, { resolution: '1920x1080', cpus: 4, ram: 2048, backend: 'auto' });
  assert.equal(old.ramChosen, true);
  const explicit = restoreConfiguration(settingsRecord({ resolution: '1920x1080', cpus: 4, ram: 2048, backend: 'canvas2d' }), firefoxDefaults, options);
  assert.equal(explicit.configuration.backend, 'canvas2d');
  assert.equal(settingsRecord({ backend: 'webgl' }).presentationVersion, PRESENTATION_VERSION);
  assert.equal(restoreConfiguration({ ...firefoxDefaults, backend: 'webgl' }, firefoxDefaults, options).configuration.backend, 'webgl');
});

test('the WebGPU prompt offers only WebGL or Canvas 2D; anything else is cancel', () => {
  assert.equal(presentationChoice('webgl'), 'webgl');
  assert.equal(presentationChoice('canvas2d'), 'canvas2d');
  for (const value of ['', 'cancel', 'auto', 'webgpu', undefined]) assert.equal(presentationChoice(value), null);
});

test('a presentation choice is saved without turning an unchosen memory size into a choice', () => {
  const active = { resolution: '1280x720', cpus: 2, ram: 4096, backend: 'auto' };
  const unchosen = restoreConfiguration(withPresentationChoice(active, 'webgl', false), firefoxDefaults, options);
  assert.deepEqual(unchosen.configuration, { ...active, backend: 'webgl' });
  assert.equal(unchosen.ramChosen, false);
  assert.equal(needsFirefoxMemoryChoice('firefox', unchosen.configuration.ram, unchosen.ramChosen), true);
  const chosen = restoreConfiguration(withPresentationChoice({ ...active, ram: 2048 }, 'canvas2d', true), firefoxDefaults, options);
  assert.deepEqual(chosen.configuration, { ...active, ram: 2048, backend: 'canvas2d' });
  assert.equal(chosen.ramChosen, true);
  assert.equal(active.backend, 'auto', 'the active configuration object is not mutated');
});

test('only a presenter-only change applies to a running guest without restart', () => {
  const active = { resolution: '1280x720', cpus: 2, ram: 2048, backend: 'auto' };
  assert.equal(displayOnlyChange(active, { ...active, backend: 'webgl' }), true);
  assert.equal(displayOnlyChange(active, { ...active }), false);
  assert.equal(displayOnlyChange(active, { ...active, backend: 'webgl', cpus: 4 }), false);
  assert.equal(displayOnlyChange(active, { ...active, backend: 'webgl', resolution: '800x600' }), false);
  assert.equal(displayOnlyChange(active, { ...active, backend: 'webgl', ram: 1024 }), false);
});

test('presentation status names the presenter, a paused WebGPU failure and WebGL fallback', () => {
  assert.equal(presentationStatus({ backend: 'webgpu', fallbackAdapter: false }), 'WebGPU');
  assert.equal(presentationStatus({ backend: 'webgpu', fallbackAdapter: true }), 'WebGPU · software fallback adapter');
  assert.equal(presentationStatus({ backend: 'none', awaitingChoice: false }), 'starting WebGPU…');
  assert.equal(presentationStatus({ backend: 'none', awaitingChoice: true, failure: 'WebGPU unavailable' }), 'WebGPU not working: WebGPU unavailable · display paused');
  assert.equal(presentationStatus({ backend: 'canvas2d', requested: 'webgl', fallbackReason: 'WebGL unavailable' }), 'Canvas 2D · WebGL failed: WebGL unavailable');
  assert.equal(presentationStatus({ backend: 'canvas2d', requested: 'canvas2d', fallbackReason: null }), 'Canvas 2D');
  assert.equal(presentationStatus(null), '');
});
