import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const [directory, output] = process.argv.slice(2);
const results = [];
for (const mode of ['native', 'fpcast']) {
  const module = new WebAssembly.Module(fs.readFileSync(path.join(directory, `${mode}.wasm`)));
  assert.deepEqual(WebAssembly.Module.imports(module), []);
  const instance = new WebAssembly.Instance(module, {});
  assert.equal(instance.exports.run(), 19);
  const table = instance.exports.__indirect_function_table;
  assert.equal(table.length, 2);
  const provider = table.get(1);
  if (mode === 'native') {
    assert.equal(provider(37), 48);
  } else {
    assert.equal(provider.length, 23);
    assert.equal(provider(...Array(23).fill(37n)), 48n);
  }
  results.push({mode, pass: true, imports: 0, tableLength: table.length, providerResult: 48});
}
fs.writeFileSync(output, JSON.stringify({pass: true, results}, null, 2) + '\n');
