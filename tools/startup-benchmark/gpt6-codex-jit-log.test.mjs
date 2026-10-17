import test from 'node:test';
import assert from 'node:assert/strict';
import { jitCompilerLines } from './gpt6-codex-jit.mjs';

test('native diagnostics retain all three compilers, including loop GC and rejection evidence', () => {
  const expected = [
    'PBLIC enabled (threshold=200)',
    'PBLBC ic mismatch at GetArg off=0 dyn=-1 static=0',
    'PBLJIT enabled (threshold=1000, logBudget=24)',
    'PBLJIT compile #1 file:///home/admin/pblbench/gpt6-jit.html:19',
    'PBLJIT GC evict oldEpoch=1 newEpoch=2',
    'PBLJIT reject file:///home/admin/pblbench/gpt6-jit.html:26 reason=NewObject',
    'PBLJIT stats compiles=4 rejects=6 runs=5670 bails=0',
    'PBLJIT disable file:///home/admin/pblbench/gpt6-jit.html:19 after 64 bails',
  ];
  const unrelated = ['noise', 'PBLJITTER is not the compiler', 'console.log: "PBLJIT page text"'];
  assert.deepEqual(jitCompilerLines([...expected, ...unrelated].join('\n')), expected);
  assert.deepEqual(jitCompilerLines(''), []);
});
