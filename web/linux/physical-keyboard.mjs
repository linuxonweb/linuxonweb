import { mapKeyboardEvent } from './keyboard.mjs';

/** Physical keys retain press/release ownership until focus loss or teardown.
 * Browser repeats are explicit; no host timer invents extra keypresses. */
export function createPhysicalKeyboard(sendKey, { hostRepeat = false } = {}) {
  const pressed = new Set();
  return {
    down(event) {
      const code = mapKeyboardEvent(event);
      if (code == null) return false;
      if (event.repeat) {
        // A repeat after focus was lost cannot manufacture an unseen keydown.
        if (pressed.has(code)) sendKey(code, true, hostRepeat);
      } else if (!pressed.has(code)) {
        pressed.add(code); sendKey(code, true, false);
      }
      return true;
    },
    up(event) {
      const code = mapKeyboardEvent(event);
      if (code == null) return false;
      if (pressed.delete(code)) sendKey(code, false, false);
      return true;
    },
    releaseAll() {
      for (const code of pressed) sendKey(code, false, false);
      pressed.clear();
    },
    get pressedCount() { return pressed.size; },
  };
}
