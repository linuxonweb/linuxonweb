import fs from 'node:fs';
import assert from 'node:assert/strict';

const [file, mode, output] = process.argv.slice(2);
assert.ok(['linux-default', 'wasm-cxxabi'].includes(mode));
const module = new WebAssembly.Module(fs.readFileSync(file));
assert.deepEqual(WebAssembly.Module.imports(module), []);
const {exports: e} = new WebAssembly.Instance(module);
assert.equal(e.member_size(), 8);
const result = {
  mode, module: file, imports: [],
  memberWords: [0, 1].map(i => [e.member_word(i, 0), e.member_word(i, 1)]),
  adjustedWords: [e.adjusted_word(0), e.adjusted_word(1)],
  passed: 0, rejected: 0, failures: [],
};
function check(kind, inputs, expected, call) {
  try {
    const actual = call();
    if (actual === expected) result.passed++;
    else {
      result.rejected++;
      result.failures.push({kind, inputs, expected, actual});
    }
  } catch (error) {
    if (!(error instanceof WebAssembly.RuntimeError)) throw error;
    result.rejected++;
    result.failures.push({kind, inputs, expected, trap: error.message});
  }
}
for (let i = 0; i < 64; i++) {
  const value = 700 + i * 19, n = i * 7 - 193;
  for (let which = 0; which < 2; which++) {
    check('plain', [which, value, n], which ? value - n - 23 : value + n + 11,
      () => e.plain(which, value, n));
  }
  check('virtual', [value, n], value + n + 71, () => e.polymorphic(value, n));
  check('adjusted', [value, n], value + n + 101, () => e.adjusted(value, n));
}
fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
if (mode === 'wasm-cxxabi') assert.equal(result.rejected, 0);
else {
  assert.ok(result.memberWords.some(words => words[0] & 1), 'must exercise odd table index');
  assert.ok(result.rejected > 0, 'default ABI hazard must be observed');
}
console.log(JSON.stringify({mode, passed: result.passed, rejected: result.rejected,
  memberWords: result.memberWords, adjustedWords: result.adjustedWords}));
