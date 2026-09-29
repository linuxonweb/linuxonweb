import { compositionEvents, mapKeyboardEvent } from './keyboard.mjs';

export const INPUT_SENTINEL = '\u200b';
const key = name => mapKeyboardEvent({ key: name });

// Keep the browser's composition buffer intact until it commits. Comparing the
// resulting text also absorbs the final input event after compositionend.
export function createKeyboardTextBridge(send) {
  let previous = '';
  let composing = false;
  const tap = name => { const code = key(name); if (code != null) { send(code, true); send(code, false); } };
  const text = value => {
    for (const character of value) {
      if (character === '\n' || character === '\r') tap('Enter');
      else if (character === '\t') tap('Tab');
      else for (const [code, down] of compositionEvents(character)) send(code, down);
    }
  };
  const update = value => {
    if (composing) return false;
    const current = value.startsWith(INPUT_SENTINEL) ? value.slice(1) : value;
    const before = Array.from(previous), after = Array.from(current);
    let prefix = 0, suffix = 0;
    while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
    while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++;
    const removed = before.length - prefix - suffix;
    const inserted = after.slice(prefix, after.length - suffix).join('');
    if (!removed && !inserted) return false;
    for (let i = 0; i < suffix; i++) tap('ArrowLeft');
    for (let i = 0; i < removed; i++) tap('Backspace');
    text(inserted);
    for (let i = 0; i < suffix; i++) tap('ArrowRight');
    previous = current;
    return true;
  };
  return {
    update, tap,
    reset() { previous = ''; composing = false; return INPUT_SENTINEL; },
    startComposition() { composing = true; },
    endComposition(value) { composing = false; return update(value); },
    get composing() { return composing; },
  };
}

export function createMobileKeyboard({ toggle, panel, input, canvas }) {
  let sendKey = null;
  let opened = false;
  const modifiers = new Set();
  const bridge = createKeyboardTextBridge((code, down) => sendKey?.(code, down));
  const modifierButtons = [...panel.querySelectorAll('[data-modifier]')];
  const reset = () => { input.value = bridge.reset(); input.setSelectionRange(input.value.length, input.value.length); };
  const releaseModifiers = () => {
    for (const name of modifiers) sendKey?.(key(name), false);
    modifiers.clear();
    for (const button of modifierButtons) button.setAttribute('aria-pressed', 'false');
  };
  const focus = () => {
    if (!opened || !sendKey) return false;
    // This must remain synchronous in the user's tap, especially on iOS.
    input.focus({ preventScroll: true });
    input.setSelectionRange(input.value.length, input.value.length);
    return true;
  };
  const close = (restoreFocus = false) => {
    releaseModifiers();
    opened = false;
    input.blur();
    panel.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    (toggle.querySelector('.label') ?? toggle).textContent = 'Keyboard';
    reset();
    if (restoreFocus) canvas.focus({ preventScroll: true });
  };
  toggle.addEventListener('click', () => {
    if (!sendKey) return;
    if (opened) { close(true); return; }
    opened = true;
    panel.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    (toggle.querySelector('.label') ?? toggle).textContent = 'Hide keyboard';
    reset();
    focus();
  });
  input.addEventListener('compositionstart', () => bridge.startComposition());
  input.addEventListener('compositionend', () => {
    if (bridge.endComposition(input.value)) releaseModifiers();
  });
  input.addEventListener('input', event => {
    if (event.isComposing || bridge.composing) return;
    if (bridge.update(input.value)) releaseModifiers();
    if (!input.value) reset();
  });
  input.addEventListener('beforeinput', event => {
    if (event.isComposing || bridge.composing) return;
    if (event.inputType === 'insertLineBreak' || event.inputType === 'insertParagraph') {
      event.preventDefault(); bridge.tap('Enter'); releaseModifiers(); reset();
    } else if (event.inputType === 'deleteContentBackward' && input.selectionStart <= INPUT_SENTINEL.length && input.selectionEnd <= INPUT_SENTINEL.length) {
      event.preventDefault(); bridge.tap('Backspace'); releaseModifiers(); reset();
    }
  });
  const controls = new Set(['Backspace', 'Enter', 'Tab', 'Escape', 'Delete', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']);
  input.addEventListener('keydown', event => {
    if (event.isComposing || bridge.composing || event.keyCode === 229 || event.key === 'Process') return;
    // Printable keys use input/composition only, avoiding duplicate soft keys.
    if (controls.has(event.key)) {
      event.preventDefault(); bridge.tap(event.key); releaseModifiers(); reset();
    }
  });
  input.addEventListener('blur', releaseModifiers);
  for (const button of panel.querySelectorAll('button')) {
    button.addEventListener('pointerdown', event => event.preventDefault());
    button.addEventListener('click', () => {
      if (!sendKey) return;
      if (button.dataset.modifier) {
        const name = button.dataset.modifier;
        const down = !modifiers.has(name);
        if (down) modifiers.add(name); else modifiers.delete(name);
        sendKey(key(name), down);
        button.setAttribute('aria-pressed', String(down));
      } else {
        bridge.tap(button.dataset.key);
        releaseModifiers();
        reset();
      }
      focus();
    });
  }
  reset();
  return {
    setKeyHandler(handler) {
      close();
      sendKey = handler;
      toggle.disabled = !handler;
    },
    focusDisplay() {
      if (!opened) return false;
      releaseModifiers(); reset();
      return focus();
    },
    close,
  };
}
