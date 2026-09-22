// Browser keyboard events to Linux evdev codes.
import { Key } from "./dist/virtio/input.js";

/** Browser KeyboardEvent.code -> Linux KEY_* (physical, layout independent). */
export const codeToLinux = Object.freeze({
  Escape: Key.ESC,
  Digit1: Key["1"], Digit2: Key["2"], Digit3: Key["3"], Digit4: Key["4"], Digit5: Key["5"],
  Digit6: Key["6"], Digit7: Key["7"], Digit8: Key["8"], Digit9: Key["9"], Digit0: Key["0"],
  Minus: Key.MINUS, Equal: Key.EQUAL, Backspace: Key.BACKSPACE, Tab: Key.TAB,
  KeyQ: Key.Q, KeyW: Key.W, KeyE: Key.E, KeyR: Key.R, KeyT: Key.T,
  KeyY: Key.Y, KeyU: Key.U, KeyI: Key.I, KeyO: Key.O, KeyP: Key.P,
  BracketLeft: Key.LEFTBRACE, BracketRight: Key.RIGHTBRACE, Enter: Key.ENTER,
  ControlLeft: Key.LEFTCTRL, ControlRight: Key.RIGHTCTRL,
  KeyA: Key.A, KeyS: Key.S, KeyD: Key.D, KeyF: Key.F, KeyG: Key.G,
  KeyH: Key.H, KeyJ: Key.J, KeyK: Key.K, KeyL: Key.L,
  Semicolon: Key.SEMICOLON, Quote: Key.APOSTROPHE, Backquote: Key.GRAVE,
  ShiftLeft: Key.LEFTSHIFT, ShiftRight: Key.RIGHTSHIFT, Backslash: Key.BACKSLASH,
  KeyZ: Key.Z, KeyX: Key.X, KeyC: Key.C, KeyV: Key.V, KeyB: Key.B,
  KeyN: Key.N, KeyM: Key.M, Comma: Key.COMMA, Period: Key.DOT, Slash: Key.SLASH,
  AltLeft: Key.LEFTALT, AltRight: Key.RIGHTALT, Space: Key.SPACE, CapsLock: Key.CAPSLOCK,
  MetaLeft: Key.LEFTMETA, MetaRight: Key.RIGHTMETA, ContextMenu: Key.MENU,
  F1: Key.F1, F2: Key.F2, F3: Key.F3, F4: Key.F4, F5: Key.F5, F6: Key.F6,
  F7: Key.F7, F8: Key.F8, F9: Key.F9, F10: Key.F10, F11: Key.F11, F12: Key.F12,
  PrintScreen: Key.SYSRQ, ScrollLock: Key.SCROLLLOCK, Pause: Key.PAUSE,
  NumLock: Key.NUMLOCK,
  NumpadDivide: Key.KPSLASH, NumpadMultiply: Key.KPASTERISK,
  NumpadSubtract: Key.KPMINUS, NumpadAdd: Key.KPPLUS, NumpadEnter: Key.KPENTER,
  Numpad0: Key.KP0, Numpad1: Key.KP1, Numpad2: Key.KP2, Numpad3: Key.KP3,
  Numpad4: Key.KP4, Numpad5: Key.KP5, Numpad6: Key.KP6, Numpad7: Key.KP7,
  Numpad8: Key.KP8, Numpad9: Key.KP9, NumpadDecimal: Key.KPDOT,
  ArrowUp: Key.UP, ArrowDown: Key.DOWN, ArrowLeft: Key.LEFT, ArrowRight: Key.RIGHT,
  Home: Key.HOME, End: Key.END, PageUp: Key.PAGEUP, PageDown: Key.PAGEDOWN,
  Insert: Key.INSERT, Delete: Key.DELETE,
});

const keyToLinux = {
  Escape: Key.ESC, Esc: Key.ESC, Enter: Key.ENTER, Return: Key.ENTER,
  Backspace: Key.BACKSPACE, Tab: Key.TAB, " ": Key.SPACE, Spacebar: Key.SPACE,
  Shift: Key.LEFTSHIFT, Control: Key.LEFTCTRL, Ctrl: Key.LEFTCTRL, Alt: Key.LEFTALT,
  Meta: Key.LEFTMETA, OS: Key.LEFTMETA, Super: Key.LEFTMETA, CapsLock: Key.CAPSLOCK,
  NumLock: Key.NUMLOCK, ScrollLock: Key.SCROLLLOCK, Pause: Key.PAUSE,
  PrintScreen: Key.SYSRQ, Insert: Key.INSERT, Delete: Key.DELETE,
  Home: Key.HOME, End: Key.END, PageUp: Key.PAGEUP, PageDown: Key.PAGEDOWN,
  ArrowUp: Key.UP, ArrowDown: Key.DOWN, ArrowLeft: Key.LEFT, ArrowRight: Key.RIGHT,
};
for (let i = 1; i <= 12; i++) keyToLinux[`F${i}`] = Key[`F${i}`];
for (const [digit, code] of Object.entries({ 0: Key["0"], 1: Key["1"], 2: Key["2"], 3: Key["3"], 4: Key["4"], 5: Key["5"], 6: Key["6"], 7: Key["7"], 8: Key["8"], 9: Key["9"] })) keyToLinux[digit] = code;
for (const [letter, code] of Object.entries({ A: Key.A, B: Key.B, C: Key.C, D: Key.D, E: Key.E, F: Key.F, G: Key.G, H: Key.H, I: Key.I, J: Key.J, K: Key.K, L: Key.L, M: Key.M, N: Key.N, O: Key.O, P: Key.P, Q: Key.Q, R: Key.R, S: Key.S, T: Key.T, U: Key.U, V: Key.V, W: Key.W, X: Key.X, Y: Key.Y, Z: Key.Z })) keyToLinux[letter] = code;

/**
 * Resolve a browser or synthetic KeyboardEvent to one Linux evdev code.
 * `code` wins because it describes the physical key; key/keyCode are fallbacks
 * for older browsers and automation APIs that omit `code`.
 */
export function mapKeyboardEvent(event) {
  if (!event) return null;
  const code = typeof event.code === "string" ? event.code : "";
  if (Object.prototype.hasOwnProperty.call(codeToLinux, code)) return codeToLinux[code];
  const key = typeof event.key === "string" ? event.key : "";
  if (Object.prototype.hasOwnProperty.call(keyToLinux, key)) return keyToLinux[key];
  if (key.length === 1) {
    const upper = key.toUpperCase();
    if (Object.prototype.hasOwnProperty.call(keyToLinux, upper)) return keyToLinux[upper];
  }
  const keyCode = Number(event.keyCode ?? event.which);
  const legacy = {
    8: Key.BACKSPACE, 9: Key.TAB, 13: Key.ENTER, 16: Key.LEFTSHIFT,
    17: Key.LEFTCTRL, 18: Key.LEFTALT, 20: Key.CAPSLOCK, 27: Key.ESC,
    32: Key.SPACE, 33: Key.PAGEUP, 34: Key.PAGEDOWN, 35: Key.END,
    36: Key.HOME, 37: Key.LEFT, 38: Key.UP, 39: Key.RIGHT, 40: Key.DOWN,
    45: Key.INSERT, 46: Key.DELETE,
  };
  if (legacy[keyCode] !== undefined) return legacy[keyCode];
  const legacyLetters = [Key.A, Key.B, Key.C, Key.D, Key.E, Key.F, Key.G, Key.H, Key.I, Key.J, Key.K, Key.L, Key.M, Key.N, Key.O, Key.P, Key.Q, Key.R, Key.S, Key.T, Key.U, Key.V, Key.W, Key.X, Key.Y, Key.Z];
  if (keyCode >= 65 && keyCode <= 90) return legacyLetters[keyCode - 65];
  if (keyCode >= 48 && keyCode <= 57) return Key[`${keyCode - 48}`];
  return null;
}

const printableKey = new Map([
  ...[Key.A, Key.B, Key.C, Key.D, Key.E, Key.F, Key.G, Key.H, Key.I, Key.J, Key.K, Key.L, Key.M, Key.N, Key.O, Key.P, Key.Q, Key.R, Key.S, Key.T, Key.U, Key.V, Key.W, Key.X, Key.Y, Key.Z].map((code, i) => [String.fromCharCode(97 + i), code]),
  ...Array.from("0123456789", (c) => [c, Key[c]]),
  ["-", Key.MINUS], ["=", Key.EQUAL], ["[", Key.LEFTBRACE], ["]", Key.RIGHTBRACE],
  [";", Key.SEMICOLON], ["'", Key.APOSTROPHE], ["`", Key.GRAVE], ["\\", Key.BACKSLASH],
  [",", Key.COMMA], [".", Key.DOT], ["/", Key.SLASH], [" ", Key.SPACE],
]);
const shiftedPrintable = new Map([
  ["~", "`"], ["!", "1"], ["@", "2"], ["#", "3"], ["$", "4"], ["%", "5"], ["^", "6"],
  ["&", "7"], ["*", "8"], ["(", "9"], [")", "0"], ["_", "-"], ["+", "="], ["{", "["],
  ["}", "]"], [":", ";"], ["\"", "'"], ["|", "\\"], ["<", ","], [">", "."], ["?", "/"],
]);

/** Return the evdev sequence needed to enter one Unicode string through X. */
export function compositionEvents(text) {
  const events = [];
  const emit = (code, down) => events.push([code, down]);
  for (const character of String(text ?? "")) {
    const lower = character.toLowerCase();
    const direct = printableKey.get(lower);
    const shifted = shiftedPrintable.get(character);
    if (direct !== undefined || shifted !== undefined) {
      const code = direct ?? printableKey.get(shifted);
      const needsShift = shifted !== undefined || (/[A-Z]/.test(character) && character === character.toUpperCase());
      if (needsShift) emit(Key.LEFTSHIFT, true);
      emit(code, true); emit(code, false);
      if (needsShift) emit(Key.LEFTSHIFT, false);
      continue;
    }
    const hex = character.codePointAt(0).toString(16);
    emit(Key.LEFTCTRL, true); emit(Key.LEFTSHIFT, true);
    emit(Key.U, true); emit(Key.U, false);
    for (const digit of hex) { const code = printableKey.get(digit); emit(code, true); emit(code, false); }
    emit(Key.ENTER, true); emit(Key.ENTER, false);
    emit(Key.LEFTSHIFT, false); emit(Key.LEFTCTRL, false);
  }
  return events;
}
