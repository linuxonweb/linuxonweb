import { compositionEvents, mapKeyboardEvent } from './keyboard.mjs';
import { comboEvents, createComboMenu, keyboardInset, physicalCombo, MODIFIER_KEYS } from './extra-keys.mjs';

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

export function createMobileKeyboard({ toggle, panel, input, canvas, more = null, menu = null, view = globalThis }) {
  let sendKey = null;
  let opened = false;
  // Touch and pen taps type through the hidden edit control so the phone's
  // keyboard opens; mouse users keep the display focused for hardware keys.
  let pointerType = '';
  const touchLike = type => type === 'touch' || type === 'pen';
  const modifiers = new Set();
  const bridge = createKeyboardTextBridge((code, down) => sendKey?.(code, down));
  const modifierButtons = [...panel.querySelectorAll('[data-modifier]')];
  const keyButtons = () => [...panel.querySelectorAll('button')];
  const reset = () => { input.value = bridge.reset(); input.setSelectionRange(input.value.length, input.value.length); };
  const releaseModifiers = () => {
    for (const name of modifiers) sendKey?.(key(name), false);
    modifiers.clear();
    for (const button of modifierButtons) button.setAttribute('aria-pressed', 'false');
  };
  const send = combo => { for (const [code, down] of comboEvents(combo, modifiers)) sendKey?.(code, down); };
  const focusInput = () => {
    // This must remain synchronous in the user's tap, especially on iOS.
    input.focus({ preventScroll: true });
    input.setSelectionRange(input.value.length, input.value.length);
    return true;
  };
  // After an extra key: keep an open phone keyboard open without popping a
  // dismissed one back up; mouse clicks return focus to the display.
  const refocus = () => {
    if (!opened || !sendKey) return;
    if (!touchLike(pointerType)) canvas.focus({ preventScroll: true });
    else if (view.document?.activeElement === input) focusInput();
  };
  const placeAboveKeyboard = () => { panel.style.bottom = `${keyboardInset(view)}px`; };
  view.visualViewport?.addEventListener('resize', placeAboveKeyboard);
  view.visualViewport?.addEventListener('scroll', placeAboveKeyboard);
  const comboMenu = more && menu ? createComboMenu({
    button: more, menu, view,
    onCombo(combo) { if (!sendKey) return; send(combo); releaseModifiers(); reset(); refocus(); },
  }) : null;
  const close = (restoreFocus = false) => {
    releaseModifiers();
    comboMenu?.open(false);
    opened = false;
    input.blur();
    panel.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    (toggle.querySelector('.label') ?? toggle).textContent = 'Keyboard';
    reset();
    if (restoreFocus) canvas.focus({ preventScroll: true });
  };
  toggle.addEventListener('pointerdown', event => { pointerType = event.pointerType; });
  toggle.addEventListener('click', event => {
    if (opened) { close(true); return; }
    if (event.detail === 0) pointerType = '';
    opened = true;
    panel.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    (toggle.querySelector('.label') ?? toggle).textContent = 'Hide keyboard';
    reset();
    placeAboveKeyboard();
    if (!sendKey) return;
    if (touchLike(pointerType)) focusInput();
    else canvas.focus({ preventScroll: true });
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
  input.addEventListener('keydown', event => {
    if (bridge.composing) return;
    // Printable keys use input/composition only, avoiding duplicate soft keys;
    // hardware shortcuts, controls and function keys go to Linux as keys.
    const combo = physicalCombo(event);
    if (!combo) return;
    event.preventDefault(); send(combo); releaseModifiers(); reset();
  });
  input.addEventListener('blur', releaseModifiers);
  // A latched Ctrl/Alt also applies to the next hardware key on the display.
  canvas.addEventListener('keyup', event => {
    if (!modifiers.size || Object.prototype.hasOwnProperty.call(MODIFIER_KEYS, event.key)) return;
    // After the display's own keyup handler has released the key.
    view.setTimeout(releaseModifiers, 0);
  });
  for (const button of panel.querySelectorAll('[data-key], [data-modifier]')) {
    button.addEventListener('pointerdown', event => { pointerType = event.pointerType; event.preventDefault(); });
    button.addEventListener('click', event => {
      if (!sendKey) return;
      if (event.detail === 0) pointerType = '';
      if (button.dataset.modifier) {
        const name = button.dataset.modifier;
        const down = !modifiers.has(name);
        if (down) modifiers.add(name); else modifiers.delete(name);
        sendKey(key(name), down);
        button.setAttribute('aria-pressed', String(down));
      } else {
        send(button.dataset.key);
        releaseModifiers();
        reset();
      }
      refocus();
    });
  }
  more?.addEventListener('pointerdown', event => { pointerType = event.pointerType; }, true);
  reset();
  for (const button of keyButtons()) button.disabled = true;
  return {
    setKeyHandler(handler) {
      // The panel stays available before boot and across restarts; its keys
      // only work while a guest accepts input.
      releaseModifiers();
      comboMenu?.open(false);
      if (!handler && view.document?.activeElement === input) input.blur();
      sendKey = handler;
      for (const button of keyButtons()) button.disabled = !handler;
      reset();
    },
    /** Display pointerdown: true when the phone keyboard took focus instead. */
    focusDisplay(type = 'touch') {
      // Only touch: main.js cancels its default, so the display does not take
      // focus back from the edit control after this pointerdown.
      if (!opened || !sendKey || type !== 'touch') return false;
      pointerType = type;
      releaseModifiers(); reset();
      return focusInput();
    },
    close,
  };
}
