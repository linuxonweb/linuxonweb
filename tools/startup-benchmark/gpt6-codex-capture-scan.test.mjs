import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const source = fs.readFileSync(new URL('../nightly-jit-safety/guest-runner/capture-launch.sh', import.meta.url), 'utf8');
const scan = source.match(/  for item in \/proc\/\[0-9\]\*\/stat; do\n[\s\S]*?\n  done/);
assert.ok(scan, 'unique production process scan required');
assert.equal(source.split(scan[0]).length, 2);

function snapshot(records) {
  assert.ok(process.env.TMPDIR?.startsWith('/mnt/'), 'explicit disk scratch required');
  const root = fs.mkdtempSync(path.join(process.env.TMPDIR, 'scan-'));
  for (const [pid, raw] of Object.entries(records)) {
    fs.mkdirSync(path.join(root, pid));
    fs.writeFileSync(path.join(root, pid, 'stat'), raw);
  }
  fs.writeFileSync(path.join(root, 'firefox-group-terminal.txt'), '');
  const command = 'set -e\nchild=71\nbase="$1"\n' + scan[0].replace('/proc/[0-9]*/stat', '"$base"/[0-9]*/stat');
  const result = spawnSync('/bin/sh', ['-c', command, 'scan', root], {
    env: { PATH: path.join(root, 'no-executables') }, timeout: 2000, maxBuffer: 65536,
  });
  assert.equal(result.error, undefined);
  return { status: result.status, output: fs.readFileSync(path.join(root, 'firefox-group-terminal.txt'), 'utf8') };
}

const stat = (pid, group, state = 'S') => `${pid} (name ) with spaces\\suffix) ${state} 1 ${group} 71 ${Array(17).fill('0').join(' ')}\n`;

test('terminal process scan records exact live and zombie group members without external executables', () => {
  const live = stat(72, 71), zombie = stat(73, 71, 'Z');
  const result = snapshot({ 72: live, 73: zombie, 74: stat(74, 99) });
  assert.equal(result.status, 0);
  assert.equal(result.output, live + zombie);
});

test('terminal process scan fails closed on malformed readable process records', () => {
  assert.equal(snapshot({ 72: '72 (broken) S 1 71\n' }).status, 98);
});

test('terminal process scan reports empty only when no owned group members exist', () => {
  for (const records of [{}, { 74: stat(74, 99) }]) {
    const result = snapshot(records);
    assert.equal(result.status, 0);
    assert.equal(result.output, '');
  }
});
