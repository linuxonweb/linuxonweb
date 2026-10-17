import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { restoreConfiguration } from './machine-settings.mjs';

const source = fs.readFileSync(new URL('./main.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const definition = source.match(/^const defaults = (.+);$/m)?.[1];

function defaultsFor(width, firefoxMode, resumeMode) {
  assert.ok(definition, 'Application default configuration must exist');
  return vm.runInNewContext(`(${definition})`, {
    window: { innerWidth: width }, defaultCpus: 8, firefoxMode, resumeMode,
  });
}

test('fresh desktop and mobile loads default to 2 GiB in every boot mode', () => {
  for (const width of [390, 1280]) {
    for (const firefoxMode of [false, true]) {
      for (const resumeMode of [null, 'plain', 'firefox']) {
        assert.equal(defaultsFor(width, firefoxMode, resumeMode).ram, 2048);
      }
    }
  }
});

test('the initial HTML memory selector agrees with the application default', () => {
  const selector = html.match(/<select\b[^>]*\bid="ram"[^>]*>([\s\S]*?)<\/select>/)?.[1];
  assert.ok(selector);
  const selected = [...selector.matchAll(/<option\b([^>]*)>/g)]
    .map(match => match[1]).filter(attributes => /\bselected\b/.test(attributes));
  assert.equal(selected.length, 1);
  assert.match(selected[0], /\bvalue="2048"/);
});

test('an explicit saved RAM choice is not overwritten by the new default', () => {
  const defaults = defaultsFor(1280, true, null);
  const options = { resolutions: ['1280x720'], ramValues: [512, 1024, 2048, 4096], maxCpus: 8 };
  for (const ram of options.ramValues) {
    const restored = restoreConfiguration({ ...defaults, ram }, defaults, options);
    assert.equal(restored.configuration.ram, ram);
    assert.equal(restored.ramChosen, true);
  }
});
