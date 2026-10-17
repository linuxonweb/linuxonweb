import assert from 'node:assert/strict';
import { test } from 'node:test';

// Minimal element stub: enough for the panel's createElement/append/replaceChildren use.
class El {
  constructor(tag) { this.tag = tag; this.children = []; this.dataset = {}; this.attrs = {}; this.hidden = false; this.textContent = ''; this.className = ''; }
  setAttribute(name, value) { this.attrs[name] = value; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
}
globalThis.document = { createElement: tag => new El(tag) };
const { installDownloadPanel } = await import('./download-panel.mjs');
const { downloadFile } = await import('./download-progress.mjs');

function streamed(bytes) {
  return new Response(new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } }));
}

test('panel shows package sizes during download and hides 5s after the batch finishes', async t => {
  const container = new El('div');
  const { panel } = installDownloadPanel(container, { hideAfter: 5000 });
  assert.equal(panel.hidden, true);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { bytes: first } = await downloadFile('http://x/a', { id: 'a', label: 'Kernel', total: 1048576, fetchImpl: async () => streamed(new Uint8Array(1048576)) });
  assert.equal(first.byteLength, 1048576);
  assert.equal(panel.hidden, false, 'shown after the first download');
  assert.equal(panel.children[0].children[2].textContent, '1.0 MB · done');
  // Still inside the batch: no hide pending yet, so a second package keeps the first row.
  await downloadFile('http://x/b', { id: 'b', label: 'Desktop', total: 2 * 1048576, fetchImpl: async () => streamed(new Uint8Array(2 * 1048576)) });
  assert.equal(panel.children.length, 2);
  assert.equal(panel.hidden, false);
  t.mock.timers.tick(4999);
  assert.equal(panel.hidden, false, 'not hidden before 5s');
  t.mock.timers.tick(1);
  assert.equal(panel.hidden, true, 'hidden at 5s');
});
