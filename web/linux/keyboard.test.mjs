import test from "node:test";
import assert from "node:assert/strict";
import { Key } from "./dist/virtio/input.js";
import { compositionEvents, mapKeyboardEvent } from "./keyboard.mjs";

test("maps physical printable keys and controls to Linux evdev", () => {
  assert.equal(mapKeyboardEvent({ code: "KeyA", key: "q" }), Key.A);
  assert.equal(mapKeyboardEvent({ code: "Digit1", key: "&" }), Key["1"]);
  assert.equal(mapKeyboardEvent({ code: "Enter", key: "Enter" }), Key.ENTER);
  assert.equal(mapKeyboardEvent({ code: "Backspace", key: "Backspace" }), Key.BACKSPACE);
  assert.equal(mapKeyboardEvent({ code: "ArrowLeft", key: "ArrowLeft" }), Key.LEFT);
  assert.equal(mapKeyboardEvent({ code: "ControlRight", key: "Control" }), Key.RIGHTCTRL);
});

test("accepts synthetic and legacy keyboard event fields", () => {
  assert.equal(mapKeyboardEvent({ key: "a" }), Key.A);
  assert.equal(mapKeyboardEvent({ key: "Enter" }), Key.ENTER);
  assert.equal(mapKeyboardEvent({ keyCode: 37 }), Key.LEFT);
  assert.equal(mapKeyboardEvent({ which: 90 }), Key.Z);
  assert.equal(mapKeyboardEvent({ key: "Unmapped", code: "Unmapped" }), null);
});

test("converts composed text to X Unicode input sequences", () => {
  const ascii = compositionEvents("A!");
  assert.deepEqual(ascii.slice(0, 4), [
    [Key.LEFTSHIFT, true], [Key.A, true], [Key.A, false], [Key.LEFTSHIFT, false],
  ]);
  const unicode = compositionEvents("é");
  assert.deepEqual(unicode.slice(0, 6), [
    [Key.LEFTCTRL, true], [Key.LEFTSHIFT, true], [Key.U, true], [Key.U, false],
    [Key.E, true], [Key.E, false],
  ]);
  assert.deepEqual(unicode.slice(-4), [
    [Key.ENTER, true], [Key.ENTER, false], [Key.LEFTSHIFT, false], [Key.LEFTCTRL, false],
  ]);
});
