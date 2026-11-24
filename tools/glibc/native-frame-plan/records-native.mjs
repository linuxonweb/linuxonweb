import fs from 'node:fs';
const paths = process.argv.slice(2), results = [];
let assertions = 0;
function check(ok, detail) { ++assertions; if (!ok) throw new Error(detail); }
for (const path of paths) {
  const bytes = fs.readFileSync(path);
  const module = new WebAssembly.Module(bytes);
  check(WebAssembly.Module.imports(module).length === 0, 'no imports');
  function fresh() {
    const e = new WebAssembly.Instance(module).exports;
    e.record_init(); return e;
  }
  const e = fresh(), initial = e.read_sp();
  function run(name, args, expected) {
    const got = e[name](...args);
    check(got === expected, `${name} returned ${got} expected ${expected}`);
    check(e.read_sp() === initial, `${name} restores actual SP without host reset`);
    check(e.record_status() === 1, `${name} leaves empty valid chain`);
  }
  for (let i = 0; i < 30; ++i) {
    run('record_zero', [i], i * 7 + 3);
    run('record_static', [i], 1);
    for (const n of [8, 31, 128, 511, 2048]) {
      run('record_dynamic', [n], 1);
      run('record_stackrestore', [n], 1);
      check(e.record_seen(4) < e.record_seen(5), 'actual stackrestore active-SP rise');
      run('record_nested', [n], 1);
    }
    run('record_recursive', [12], 79);
  }
  check(e.record_depth() >= 13, 'genuine recursive activation chain');
  check(e.record_polls() > 1000, 'entry and source loop polls executed');
  for (const pointer of [0, 0x7fffffff]) {
    const bad = fresh(); let rejected = false;
    try { bad.record_indirect(pointer, 9); }
    catch (err) { rejected = err instanceof WebAssembly.RuntimeError; }
    check(rejected, `unadmitted indirect identity ${pointer} traps`);
  }
  const view = new DataView(e.memory.buffer), manifest = e.record_module();
  const count = view.getUint32(manifest + 16, true);
  check(count === 7, 'all seven emitted user functions have descriptors');
  for (let reason = 1; reason <= 7; ++reason) {
    const bad = fresh(); bad.record_invalidate(reason);
    let rejected = false;
    try { bad.record_zero(9); } catch (err) { rejected = err instanceof WebAssembly.RuntimeError; }
    check(rejected, `invalid owner/epoch/counter/version/module/bounds/head ${reason} traps`);
  }
  for (const offset of [0, 4, 8, 16]) {
    const bad = fresh(), memory = new DataView(bad.memory.buffer);
    memory.setUint32(bad.record_module() + offset, 0, true);
    let rejected = false;
    try { bad.record_zero(9); } catch (err) { rejected = err instanceof WebAssembly.RuntimeError; }
    check(rejected, `module admission corrupt field ${offset} traps`);
  }
  results.push({path, assertions, providerChecks:e.record_checks(), polls:e.record_polls(), depth:e.record_depth(), descriptorCount:count, SP:initial});
}
console.log(JSON.stringify({nativeRecordsOnly:true, syntheticOwnerToken:true, forcedUnwind:false, assertions, results}, null, 2));
