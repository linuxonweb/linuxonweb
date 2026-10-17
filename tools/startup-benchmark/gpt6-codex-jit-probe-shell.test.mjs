import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { jitIdentityScript } from './gpt6-codex-jit-identity.mjs';

const script = jitIdentityScript('0123456789abcdef0123456789abcdef');
const run = source => spawnSync('sh', ['-s'], {
  input: source, encoding: 'utf8', timeout: 5000, maxBuffer: 131072,
});

test('probe avoids the noglob option rejected by the actual guest shell', () => {
  assert.doesNotMatch(script, /^\s*set -f\s*$/m);
});

test('generated probe enumerates numeric proc directories with its actual shell options', () => {
  const boundary = '    IFS= read -r process_name';
  assert.equal(script.split(boundary).length, 2);
  const prefix = script.slice(0, script.indexOf(boundary));
  const result = run(prefix + '    printf "%s\\n" "$directory"\n  done\n  break\ndone\n');
  assert.equal(result.status, 0, result.stderr);
  const directories = result.stdout.trim().split('\n');
  assert.ok(directories.includes(`/proc/${process.pid}`), 'Live test process must be enumerated');
  assert.ok(directories.every(directory => /^\/proc\/[1-9][0-9]*$/.test(directory)));
});

test('generated stat reader returns actual start ticks without disabling caller globbing', () => {
  const boundary = '\nattempt=0\n';
  assert.equal(script.split(boundary).length, 2);
  const prefix = script.slice(0, script.indexOf(boundary));
  const stat = fs.readFileSync(`/proc/${process.pid}/stat`, 'utf8');
  const expected = stat.slice(stat.lastIndexOf(')') + 2).split(/\s+/)[19];
  const result = run(prefix + `\nobserved=$(proc_start /proc/${process.pid}) || exit 1\nprintf '%s\\n' "$observed"\nfor directory in /proc/[0-9]*; do printf '%s\\n' "$directory"; done\n`);
  assert.equal(result.status, 0, result.stderr);
  const [observed, ...directories] = result.stdout.trim().split('\n');
  assert.equal(observed, expected);
  assert.ok(directories.includes(`/proc/${process.pid}`), 'Stat reader must preserve caller enumeration');
});
