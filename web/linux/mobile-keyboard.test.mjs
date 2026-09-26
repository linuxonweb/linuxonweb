import test from 'node:test';
import assert from 'node:assert/strict';
import { Key } from './dist/virtio/input.js';
import { compositionEvents } from './keyboard.mjs';
import { createKeyboardTextBridge, INPUT_SENTINEL as S } from './mobile-keyboard.mjs';

function setup() {
  const events = [];
  return { events, bridge: createKeyboardTextBridge((code, down) => events.push([code, down])) };
}
const tap = code => [[code, true], [code, false]];

test('repeated mobile text, punctuation, and deletion reach guest keys exactly once', () => {
  const { bridge, events } = setup();
  bridge.update(S + 'a');
  bridge.update(S + 'aa');
  bridge.update(S + 'aa!');
  bridge.update(S + 'aa!');
  bridge.update(S + 'aa');
  assert.deepEqual(events, [...compositionEvents('aa!'), ...tap(Key.BACKSPACE)]);
});

test('IME previews produce no keys; composition commit and final input are deduplicated', () => {
  const { bridge, events } = setup();
  bridge.startComposition();
  bridge.update(S + 'e');
  bridge.update(S + 'é');
  assert.deepEqual(events, []);
  bridge.endComposition(S + 'é');
  bridge.update(S + 'é');
  assert.deepEqual(events, compositionEvents('é'));
  bridge.update(S + 'éé');
  assert.deepEqual(events, compositionEvents('éé'));
});

test('autocorrect replaces text through backspaces and preserves suffix', () => {
  const { bridge, events } = setup();
  bridge.update(S + 'teh ');
  events.length = 0;
  bridge.update(S + 'the ');
  assert.deepEqual(events, [...tap(Key.LEFT), ...tap(Key.BACKSPACE), ...tap(Key.BACKSPACE), ...compositionEvents('he'), ...tap(Key.RIGHT)]);
});

test('newlines and tabs use X control keys, and reset forgets the old guest field', () => {
  const { bridge, events } = setup();
  bridge.update(S + 'a\n\t');
  assert.deepEqual(events, [...tap(Key.A), ...tap(Key.ENTER), ...tap(Key.TAB)]);
  events.length = 0;
  assert.equal(bridge.reset(), S);
  bridge.tap('Backspace');
  bridge.update(S + 'b');
  assert.deepEqual(events, [...tap(Key.BACKSPACE), ...tap(Key.B)]);
});

test('cancelled IME leaves committed text untouched and Unicode deletion counts characters', () => {
  const { bridge, events } = setup();
  bridge.update(S + '🙂');
  events.length = 0;
  bridge.startComposition();
  bridge.update(S + '🙂x');
  bridge.endComposition(S + '🙂');
  assert.deepEqual(events, []);
  bridge.update(S);
  assert.deepEqual(events, tap(Key.BACKSPACE));
});
