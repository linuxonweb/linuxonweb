import test from 'node:test';
import assert from 'node:assert/strict';
import { LogHistory, createLogViewer, revealLogPanel } from './log-viewer.mjs';

test('latest hundred and older pages preserve order', () => {
  const history = new LogHistory();
  history.write(Array.from({ length: 350 }, (_, i) => `log ${i}\n`).join(''));
  assert.equal(history.length, 350);
  assert.equal(history.page().length, 100);
  assert.equal(history.page()[0].text, 'log 250');
  assert.equal(history.page(250)[0].text, 'log 150');
  assert.equal(history.page(50).length, 50);
});

test('streaming UTF-8, formatting and carriage returns survive chunk boundaries', () => {
  const history = new LogHistory();
  const bytes = new TextEncoder().encode('你好\n');
  history.write(bytes.subarray(0, 2));
  history.write(bytes.subarray(2));
  history.write('\x1b[3');
  history.write('1mred\x1b[0m\r\nprogress 1\rprogress 2\n');
  history.write('\x1b]0;ignored title');
  history.write('\x1b\\done\n');
  assert.deepEqual(history.page().map(row => row.text), ['你好', 'red', 'progress 2', 'done']);
});

test('history bounds lines, total text and individual lines', () => {
  const history = new LogHistory({ maxLines: 120, maxChars: 600, maxLineLength: 20 });
  for (let i = 0; i < 10000; i++) history.write(`line ${i}\n`);
  assert.ok(history.length <= 120);
  assert.ok(history.chars <= 600);
  assert.equal(history.page().at(-1).text, 'line 9999');
  history.write('x'.repeat(500));
  assert.equal(history.page().at(-1).text.length, 20);
  assert.ok(history.page(0).length === 0);
  history.clear();
  assert.equal(history.length, 0);
  history.write('fresh\n');
  assert.deepEqual(history.page(), [{ id: 0, text: 'fresh' }]);
});

test('independent console streams cannot corrupt each other’s partial UTF-8', () => {
  const history = new LogHistory();
  const bytes = new TextEncoder().encode('é');
  history.write(bytes.subarray(0, 1), 'guest');
  history.write('[host] message\n', 'host');
  history.write(bytes.subarray(1), 'guest');
  history.write('\n', 'guest');
  assert.deepEqual(history.page().map(row => row.text), ['[host] message', 'é']);
});

// Just enough DOM for createLogViewer: elements, fragments and click events.
class FakeElement {
  constructor(tag) { this.tag = tag; this.children = []; this.listeners = {}; this.attributes = {}; this.dataset = {}; this.scrolls = []; this.scrollTop = 0; this.scrollHeight = 0; this.clientHeight = 0; }
  append(...nodes) { for (const node of nodes) { if (node.tag === '#fragment') this.children.push(...node.children); else { node.parentNode = this; this.children.push(node); } } }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  remove() { this.parentNode?.children.splice(this.parentNode.children.indexOf(this), 1); this.parentNode = null; }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  click() { for (const fn of this.listeners.click ?? []) fn(); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  querySelector() { return null; }
  scrollIntoView(options) { this.scrolls.push(options); }
}
function withFakeDocument(fn) {
  const saved = globalThis.document;
  globalThis.document = { createElement: tag => new FakeElement(tag), createDocumentFragment: () => new FakeElement('#fragment') };
  try { return fn(); } finally { if (saved === undefined) delete globalThis.document; else globalThis.document = saved; }
}
const motion = reduce => ({ matchMedia: query => ({ matches: reduce && query === '(prefers-reduced-motion: reduce)' }) });

test('showing logs from the toggle centres the panel; hiding does not scroll', () => withFakeDocument(() => {
  const toggle = new FakeElement('button'), parent = new FakeElement('div');
  const viewer = createLogViewer({ toggle, parent, view: motion(false) });
  viewer.write('hello\n');
  toggle.click();
  const panel = parent.children[0];
  assert.equal(panel.id, 'guest-logs');
  assert.equal(toggle.attributes['aria-expanded'], 'true');
  assert.deepEqual(panel.scrolls, [{ block: 'center', inline: 'nearest', behavior: 'smooth' }]);
  toggle.click();
  assert.equal(parent.children.length, 0);
  assert.equal(toggle.attributes['aria-expanded'], 'false');
  assert.equal(panel.scrolls.length, 1);
  viewer.open();
  assert.equal(parent.children[0].scrolls.length, 0, 'programmatic open does not move the page');
}));

test('reduced motion reveals the log panel without smooth scrolling', () => {
  const panel = new FakeElement('section');
  revealLogPanel(panel, motion(true));
  revealLogPanel(panel, {});
  assert.deepEqual(panel.scrolls.map(options => options.behavior), ['auto', 'smooth']);
  revealLogPanel(null, motion(false));
});
