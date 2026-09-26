import test from 'node:test';
import assert from 'node:assert/strict';
import { LogHistory } from './log-viewer.mjs';

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
