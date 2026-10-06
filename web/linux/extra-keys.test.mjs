import test from 'node:test';
import assert from 'node:assert/strict';
import { Key } from './dist/virtio/input.js';
import { COMBOS, comboEvents, keyboardInset, parseCombo, physicalCombo } from './extra-keys.mjs';

const tap = code => [[code, true], [code, false]];

test('combos press modifiers in order and release them in reverse after the key', () => {
  assert.deepEqual(comboEvents('Control+C'), [[Key.LEFTCTRL, true], ...tap(Key.C), [Key.LEFTCTRL, false]]);
  assert.deepEqual(comboEvents('Alt+Tab'), [[Key.LEFTALT, true], ...tap(Key.TAB), [Key.LEFTALT, false]]);
  assert.deepEqual(comboEvents('Alt+Space'), [[Key.LEFTALT, true], ...tap(Key.SPACE), [Key.LEFTALT, false]]);
  assert.deepEqual(comboEvents('Control+Shift+V'), [
    [Key.LEFTCTRL, true], [Key.LEFTSHIFT, true], ...tap(Key.V), [Key.LEFTSHIFT, false], [Key.LEFTCTRL, false],
  ]);
});

test('plain extra keys are single taps', () => {
  const cases = { Escape: Key.ESC, Tab: Key.TAB, Enter: Key.ENTER, ArrowUp: Key.UP, ArrowDown: Key.DOWN,
    ArrowLeft: Key.LEFT, ArrowRight: Key.RIGHT, Y: Key.Y, N: Key.N, PageUp: Key.PAGEUP, PageDown: Key.PAGEDOWN,
    Home: Key.HOME, End: Key.END, Delete: Key.DELETE, F1: Key.F1, F12: Key.F12, Esc: Key.ESC, PgDn: Key.PAGEDOWN };
  for (const [name, code] of Object.entries(cases)) assert.deepEqual(comboEvents(name), tap(code), name);
});

test('latched modifiers are neither pressed again nor released by a combo', () => {
  assert.deepEqual(comboEvents('Y', new Set(['Control'])), tap(Key.Y));
  assert.deepEqual(comboEvents('Control+Shift+C', ['Control']), [[Key.LEFTSHIFT, true], ...tap(Key.C), [Key.LEFTSHIFT, false]]);
  assert.deepEqual(comboEvents('Alt+Tab', ['Ctrl']), [[Key.LEFTALT, true], ...tap(Key.TAB), [Key.LEFTALT, false]]);
});

test('invalid combos are rejected instead of sending partial input', () => {
  assert.throws(() => parseCombo('Hyper+C'), /Unknown modifier/);
  assert.throws(() => parseCombo('Control+Nope'), /Unknown key/);
  assert.throws(() => parseCombo('Control+'), /Invalid/);
  assert.deepEqual(parseCombo('Ctrl+Ctrl+A'), { modifiers: ['Control'], key: 'A' });
});

test('the More list has the requested shortcuts and every entry resolves', () => {
  const labels = COMBOS.map(item => item.label);
  for (const wanted of ['Ctrl+C', 'Ctrl+V', 'Ctrl+A', 'Alt+Tab', 'Alt+Space']) assert.ok(labels.includes(wanted), wanted);
  assert.equal(new Set(labels).size, labels.length);
  for (const { combo } of COMBOS) assert.ok(comboEvents(combo).length >= 2, combo);
});

test('hardware shortcuts typed into the phone text bridge go to Linux as keys', () => {
  const event = init => ({ key: '', code: '', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...init });
  assert.equal(physicalCombo(event({ key: 'c', code: 'KeyC', ctrlKey: true })), 'Control+C');
  // Physical position wins on other layouts (AZERTY "a" is KeyQ).
  assert.equal(physicalCombo(event({ key: 'a', code: 'KeyQ', ctrlKey: true })), 'Control+Q');
  assert.equal(physicalCombo(event({ key: 'Tab', code: 'Tab', shiftKey: true })), 'Shift+Tab');
  assert.equal(physicalCombo(event({ key: 'Tab', code: 'Tab', altKey: true })), 'Alt+Tab');
  assert.equal(physicalCombo(event({ key: 'PageDown', code: 'PageDown' })), 'PageDown');
  assert.equal(physicalCombo(event({ key: 'F5', code: 'F5' })), 'F5');
  assert.equal(physicalCombo(event({ key: 'Enter' })), 'Enter');
  // Printable text, composition and AltGr characters stay on the text path.
  assert.equal(physicalCombo(event({ key: 'a', code: 'KeyA' })), null);
  assert.equal(physicalCombo(event({ key: 'A', code: 'KeyA', shiftKey: true })), null);
  assert.equal(physicalCombo(event({ key: 'Process', keyCode: 229 })), null);
  assert.equal(physicalCombo(event({ key: 'Enter', isComposing: true })), null);
  assert.equal(physicalCombo(event({ key: '@', code: 'KeyQ', ctrlKey: true, altKey: true, getModifierState: name => name === 'AltGraph' })), null);
  assert.equal(physicalCombo(event({ key: 'Control', code: 'ControlLeft', ctrlKey: true })), null);
});

test('soft keyboard inset follows the visual viewport', () => {
  assert.equal(keyboardInset({ innerHeight: 800 }), 0);
  assert.equal(keyboardInset({ innerHeight: 800, visualViewport: { offsetTop: 0, height: 800 } }), 0);
  assert.equal(keyboardInset({ innerHeight: 800, visualViewport: { offsetTop: 50, height: 450 } }), 300);
  assert.equal(keyboardInset({ innerHeight: 800, visualViewport: { offsetTop: 0, height: 900 } }), 0);
});
