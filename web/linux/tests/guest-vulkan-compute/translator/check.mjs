// Runtime translation and ABI gate; no GPU execution claim follows this test.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const [artifact, shaderA, shaderB, reportPath] = process.argv.slice(2);
const root = '/mnt/p6/build/guest-vulkan-compute-20260926/';
for (const name of ['TMPDIR', 'TMP', 'TEMP']) assert.ok(resolve(process.env[name] ?? '/').startsWith(root));
assert.ok(resolve(reportPath).startsWith(root));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const moduleBytes = await readFile(artifact);
const module = await WebAssembly.compile(moduleBytes);
assert.deepEqual(WebAssembly.Module.imports(module), []);
const instance = await WebAssembly.instantiate(module, {});
const api = instance.exports;
assert.equal(api.translator_version(), 1);
const decoder = new TextDecoder('utf-8', { fatal: true });
const text = (pointer, length) => decoder.decode(new Uint8Array(api.memory.buffer, pointer >>> 0, length >>> 0));
let assertions = 2;
const check = (condition, message) => { assert.ok(condition, message); assertions++; };
function translate(bytes) {
  const ptr = api.input_reserve(bytes.byteLength) >>> 0;
  check(ptr > 0, 'input reserve');
  new Uint8Array(api.memory.buffer, ptr, bytes.byteLength).set(bytes);
  const status = api.translate(bytes.byteLength);
  return { status, text: text(api.output_ptr(), api.output_len()),
    entry: status === 0 ? text(api.entry_point_ptr(), api.entry_point_len()) : '' };
}
const fixtures = [];
for (const path of [shaderA, shaderB]) {
  const bytes = await readFile(path);
  const result = translate(bytes);
  check(result.status === 0, result.text);
  check(/@compute/.test(result.text) && /@workgroup_size\(64, 1, 1\)/.test(result.text), 'verified compute output');
  check(result.text.includes(`fn ${result.entry}(`), 'actual emitted entry point');
  const output = reportPath + '.' + fixtures.length + '.wgsl';
  await writeFile(output, result.text);
  fixtures.push({ path, spvSha256: hash(bytes), wgslSha256: hash(result.text), entryPoint: result.entry, output });
}
check(fixtures[0].spvSha256 !== fixtures[1].spvSha256, 'different programs supplied');
check(fixtures[0].wgslSha256 !== fixtures[1].wgslSha256, 'different programs translated');
const valid = await readFile(shaderA);
const badMagic = Buffer.from(valid); badMagic.writeUInt32LE(0, 0);
const badBound = Buffer.from(valid); badBound.writeUInt32LE(0xffffffff, 12);
const badInstruction = Buffer.from(valid); badInstruction.writeUInt32LE(0, 20);
const badWorkgroup = Buffer.from(valid);
for (let offset = 20; offset < badWorkgroup.length;) {
  const word = badWorkgroup.readUInt32LE(offset), count = word >>> 16, opcode = word & 65535;
  if (opcode === 16 && count === 6 && badWorkgroup.readUInt32LE(offset + 8) === 17) {
    badWorkgroup.writeUInt32LE(1, offset + 12); break;
  }
  offset += count * 4;
}
const rejections = [];
for (const [name, bytes] of [['magic', badMagic], ['bound', badBound], ['instruction', badInstruction],
  ['truncated', valid.subarray(0, valid.length - 4)], ['profile-workgroup', badWorkgroup]]) {
  const result = translate(bytes);
  check(result.status !== 0 && result.text.length > 0 && result.text.length <= 2048, name + ' rejected');
  check(api.entry_point_len() === 0, 'error clears previous entry metadata');
  rejections.push({ name, diagnostic: result.text });
}
check(api.input_reserve(65540) === 0, 'oversize rejected');
check(api.output_len() === 0, 'reserve clears stale output');
check(api.input_reserve(21) === 0, 'unaligned rejected');
api.input_reserve(valid.length);
check(api.translate(valid.length - 4) !== 0, 'reserved length mismatch rejected');
check(translate(valid).status === 0, 'valid input recovers after rejection');
await writeFile(reportPath, JSON.stringify({ pass: true, assertions, artifact, sha256: hash(moduleBytes),
  fixtures, rejections, scope: 'Real Naga runtime translation and raw ABI checks only; no GPU or guest execution' }, null, 2) + '\n');
console.log(JSON.stringify({ pass: true, assertions, reportPath }));
