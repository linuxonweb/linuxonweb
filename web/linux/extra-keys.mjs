// Extra keys below the Linux display: named keys, latched modifiers and the
// More list of shortcuts. Everything is sent as Linux evdev press/release pairs.
import { Key } from './dist/virtio/input.js';
import { mapKeyboardEvent } from './keyboard.mjs';

/** Modifier names accepted in combos, in the order they are pressed. */
export const MODIFIER_KEYS = Object.freeze({ Control: Key.LEFTCTRL, Shift: Key.LEFTSHIFT, Alt: Key.LEFTALT, Meta: Key.LEFTMETA });
const aliases = { Ctrl: 'Control', Super: 'Meta', Win: 'Meta', Esc: 'Escape', PgUp: 'PageUp', PgDn: 'PageDown', Del: 'Delete' };

/** Shortcuts offered by the More button. */
export const COMBOS = Object.freeze([
  ['Ctrl+C', 'Control+C'], ['Ctrl+V', 'Control+V'], ['Ctrl+A', 'Control+A'], ['Ctrl+X', 'Control+X'],
  ['Ctrl+Z', 'Control+Z'], ['Ctrl+D', 'Control+D'], ['Ctrl+L', 'Control+L'], ['Ctrl+S', 'Control+S'],
  ['Ctrl+Shift+C', 'Control+Shift+C'], ['Ctrl+Shift+V', 'Control+Shift+V'],
  ['Alt+Tab', 'Alt+Tab'], ['Alt+Space', 'Alt+Space'], ['Alt+F4', 'Alt+F4'], ['Shift+Tab', 'Shift+Tab'],
  ['Home', 'Home'], ['End', 'End'], ['Insert', 'Insert'], ['Delete', 'Delete'], ['Backspace', 'Backspace'], ['Space', 'Space'],
  ...Array.from({ length: 12 }, (_, i) => [`F${i + 1}`, `F${i + 1}`]),
].map(([label, combo]) => Object.freeze({ label, combo })));

/** One key name (KeyboardEvent key or code) to its Linux code, or null. */
export function keyCode(name) {
  const resolved = aliases[name] ?? name;
  if (Object.prototype.hasOwnProperty.call(MODIFIER_KEYS, resolved)) return MODIFIER_KEYS[resolved];
  return mapKeyboardEvent({ code: resolved, key: resolved });
}

/** "Control+Shift+C" -> { modifiers: ['Control', 'Shift'], key: 'C' }. */
export function parseCombo(text) {
  const parts = String(text ?? '').split('+').map(part => part.trim());
  // A trailing empty part means the key itself is "+", which no combo uses.
  if (parts.some(part => !part)) throw new Error(`Invalid key combo: ${text}`);
  const key = aliases[parts.at(-1)] ?? parts.at(-1);
  const modifiers = parts.slice(0, -1).map(part => aliases[part] ?? part);
  for (const name of modifiers) if (!Object.prototype.hasOwnProperty.call(MODIFIER_KEYS, name)) throw new Error(`Unknown modifier: ${name}`);
  if (keyCode(key) == null) throw new Error(`Unknown key: ${key}`);
  return { modifiers: [...new Set(modifiers)], key };
}

/**
 * Press/release sequence for a combo. Modifiers already held (latched by the
 * Ctrl/Alt buttons) are neither pressed nor released here; the rest are
 * pressed in order and released in reverse after the key.
 */
export function comboEvents(text, held = []) {
  const { modifiers, key } = parseCombo(text);
  const already = new Set([...held].map(name => aliases[name] ?? name));
  const pressed = modifiers.filter(name => !already.has(name)).map(name => MODIFIER_KEYS[name]);
  const code = keyCode(key);
  return [
    ...pressed.map(c => [c, true]),
    [code, true], [code, false],
    ...pressed.reverse().map(c => [c, false]),
  ];
}

const textControls = new Set(['Backspace', 'Enter', 'Tab', 'Escape', 'Delete', 'Insert', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown',
  ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`)]);

/**
 * A hardware key typed into the text bridge that must go to Linux as a key
 * rather than text: controls, function keys and Ctrl/Alt/Meta shortcuts.
 * Returns a combo string, or null to let the input/composition path handle it.
 */
export function physicalCombo(event) {
  if (!event || event.isComposing || event.keyCode === 229 || event.key === 'Process') return null;
  if (Object.prototype.hasOwnProperty.call(MODIFIER_KEYS, event.key)) return null;
  const altGraph = event.getModifierState?.('AltGraph') ?? false;
  const shortcut = !altGraph && (event.ctrlKey || event.altKey || event.metaKey);
  if (!shortcut && !textControls.has(event.key)) return null;
  // Prefer the physical code so Ctrl+C stays C on non-QWERTY layouts too.
  const name = /^Key[A-Z]$/.test(event.code ?? '') ? event.code.slice(3)
    : /^Digit\d$/.test(event.code ?? '') ? event.code.slice(5)
      : (keyCode(event.code) != null ? event.code : event.key);
  if (keyCode(name) == null) return null;
  const modifiers = [];
  if (event.ctrlKey && !altGraph) modifiers.push('Control');
  if (event.shiftKey) modifiers.push('Shift');
  if (event.altKey && !altGraph) modifiers.push('Alt');
  if (event.metaKey) modifiers.push('Meta');
  return [...modifiers, name].join('+');
}

/** Height of an on-screen keyboard covering the layout viewport (iOS). */
export function keyboardInset(view) {
  const viewport = view?.visualViewport;
  if (!viewport) return 0;
  return Math.max(0, Math.round(view.innerHeight - viewport.offsetTop - viewport.height));
}

/**
 * The More list. It never takes focus, so an open soft keyboard stays open
 * and a focused display keeps receiving hardware keys.
 */
export function createComboMenu({ button, menu, onCombo, view = globalThis }) {
  const doc = button.ownerDocument;
  for (const { label, combo } of COMBOS) {
    const item = doc.createElement('button');
    item.type = 'button';
    item.className = 'keyboard-key';
    item.dataset.combo = combo;
    item.setAttribute('role', 'menuitem');
    item.textContent = label;
    menu.append(item);
  }
  const place = () => {
    const anchor = button.getBoundingClientRect(), bounds = menu.getBoundingClientRect();
    const above = anchor.top - 8 - bounds.height;
    menu.style.left = `${Math.max(8, Math.min(anchor.right - bounds.width, view.innerWidth - 8 - bounds.width))}px`;
    menu.style.top = `${Math.max(8, above >= 8 ? above : Math.min(anchor.bottom + 8, view.innerHeight - 8 - bounds.height))}px`;
  };
  const open = value => {
    menu.hidden = !value;
    button.setAttribute('aria-expanded', String(value));
    if (value) place();
  };
  button.addEventListener('pointerdown', event => event.preventDefault());
  button.addEventListener('click', () => open(menu.hidden));
  menu.addEventListener('pointerdown', event => event.preventDefault());
  menu.addEventListener('click', event => {
    const item = event.target.closest?.('[data-combo]');
    if (!item) return;
    open(false);
    onCombo(item.dataset.combo, event);
  });
  doc.addEventListener('pointerdown', event => {
    if (!menu.hidden && !menu.contains(event.target) && !button.contains(event.target)) open(false);
  }, true);
  doc.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !menu.hidden) { event.preventDefault(); event.stopPropagation(); open(false); }
  }, true);
  view.addEventListener?.('resize', () => { if (!menu.hidden) place(); });
  return { open, get opened() { return !menu.hidden; } };
}
