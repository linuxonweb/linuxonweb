import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkerPool } from './dist/worker-pool.mjs';

function fixture(capacity = 2) {
  const loaded = [], retired = [];
  const pool = createWorkerPool({ capacity,
    load(name) { const entry = { name, slot: { handlers: null, error: null }, worker: {} }; loaded.push(entry); return entry; },
    retire(entry, failed) { retired.push({ entry, failed }); },
  });
  return { pool, loaded, retired };
}

test('completed workers are reused without replenishing fresh workers on every task', () => {
  const { pool, loaded, retired } = fixture();
  pool.prewarm();
  assert.equal(loaded.length, 2);
  for (let index = 0; index < 100; index++) {
    const entry = pool.take('task');
    entry.slot.handlers = { on_message() {} };
    pool.release(entry);
    assert.equal(entry.slot.handlers, null);
  }
  assert.equal(loaded.length, 2);
  assert.deepEqual(retired, []);
});

test('concurrent tasks get different workers and idle retention stays bounded', () => {
  const { pool, loaded, retired } = fixture();
  const entries = Array.from({ length: 5 }, () => pool.take('task'));
  assert.equal(new Set(entries).size, 5);
  for (const entry of entries) pool.release(entry);
  assert.equal(loaded.length, 5);
  assert.deepEqual(retired.map(row => row.entry), entries.slice(2));
  assert.ok(retired.every(row => row.failed === false));
  assert.equal(pool.take('next'), entries[0]);
  assert.equal(pool.take('next'), entries[1]);
});

test('a failed preloaded worker is retired rather than assigned to a task', () => {
  const { pool, loaded, retired } = fixture();
  pool.prewarm();
  loaded[0].slot.error = new Error('failed load');
  assert.equal(pool.take('task'), loaded[1]);
  assert.deepEqual(retired, [{ entry: loaded[0], failed: true }]);
});

test('duplicate or foreign releases cannot make one worker run two tasks', () => {
  const { pool } = fixture();
  const entry = pool.take('task');
  pool.release(entry);
  assert.throws(() => pool.release(entry), /active/);
  assert.throws(() => pool.release({ slot: {} }), /active/);
});

test('closed pools admit no new tasks or prewarm work and retain no finished workers', () => {
  const { pool, loaded, retired } = fixture();
  pool.prewarm();
  const active = pool.take('task');
  pool.close();
  pool.prewarm();
  assert.equal(loaded.length, 2);
  assert.throws(() => pool.take('late'), /closed/);
  pool.release(active);
  assert.deepEqual(retired, [{ entry: active, failed: false }]);
});

test('invalid retention bounds fail before allocating workers', () => {
  for (const capacity of [-1, 0, 1.5, NaN, Infinity]) {
    assert.throws(() => fixture(capacity), /capacity/);
  }
});
