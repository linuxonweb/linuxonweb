// Actual Naga translation and ABI checks; no GPU/guest execution claim.
import assert from 'node:assert/strict';
import { readFile, writeFile, realpath, statfs } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { translateWebGLGraphics } from './abi.mjs';

const [artifact, fixturesDir, reportPath] = process.argv.slice(2);
const root = '/mnt/p6/build/guest-vulkan-webgl-20260926';
const fixtureRoot = '/mnt/p6/build/guest-vulkan-graphics-20260926/translator-fixtures-run1';
async function disk(path, allowed = root) {
  const actual = await realpath(path);
  assert.ok((actual === allowed || actual.startsWith(allowed + sep)), 'resolved path is inside its designated disk task');
  const fs = await statfs(actual);
  assert.ok(fs.type !== 0x01021994 && fs.type !== 0x858458f6, 'not tmpfs/ramfs');
}
for (const name of ['TMPDIR', 'TMP', 'TEMP']) await disk(process.env[name]);
assert.ok(resolve(reportPath).startsWith(root + sep));
await disk(dirname(reportPath)); await disk(artifact); await disk(fixturesDir, fixtureRoot);
const hash = data => createHash('sha256').update(data).digest('hex');
let assertions = 0;
function check(condition, message) { assert.ok(condition, message); assertions++; }
const moduleBytes = await readFile(artifact);
const module = await WebAssembly.compile(moduleBytes);
check(WebAssembly.Module.imports(module).length === 0, 'standalone translator has no imports');
const instance = await WebAssembly.instantiate(module, {});
const api = instance.exports;
check(api.translator_version() === 0x474c0001, 'independent graphics ABI');
const manifest = JSON.parse(await readFile(resolve(fixturesDir, 'fixtures.json'), 'utf8'));
check(manifest.pass === true, 'fixture compilation manifest');
const inputs = new Map(), outputs = {}, rejected = [];
for (const [name, fixture] of Object.entries(manifest.fixtures)) {
  const bytes = await readFile(resolve(fixturesDir, fixture.file));
  check(hash(bytes) === fixture.sha256 && bytes.length === fixture.bytes, name + ' source identity');
  inputs.set(name, bytes);
  if (name === 'resource.frag') continue;
  const result = translateWebGLGraphics(instance, bytes);
  check(result.stage === fixture.stage, name + ' reflected stage');
  check(result.originalEntryPoint === fixture.entryPoint, name + ' original entry');
  check(result.coordinateAdjustment === true && result.resources.length === 0, name + ' coordinate/resources contract');
  check(result.glsl.startsWith('#version 300 es\n') && /void main\s*\(/.test(result.glsl), name + ' actual GLSL ES 300 main');
  check(result.backend === 'glsl-es-300' && result.backendCoordinateAdjustment === true, name + ' backend coordinate configuration');
  check(result.varyingBindings.length === 0, name + ' ES 300 has no host-assigned bindings');
  check(!result.glsl.includes('#extension'), name + ' bounded fixture requires no GLSL extensions');
  check(result.inputs.length > 0 && result.outputs.length > 0, name + ' IR interface present');
  if (fixture.stage === 'vertex') {
    check(result.outputs.filter(item => item.builtin === 'position').length === 1, name + ' required position');
    check(result.inputs.some(item => item.location === 0 && item.type.components === 2), name + ' position attribute');
    check(result.inputs.some(item => item.location === 1 && item.type.components === 3), name + ' color attribute');
  } else {
    check(result.outputs.length === 1 && result.outputs[0].location === 0 && result.outputs[0].type.components === 4, name + ' color output');
  }
  const path = reportPath + '.' + name + '.glsl';
  await writeFile(path, result.glsl);
  const { glsl, ...metadata } = result;
  outputs[name] = { metadata, glslPath: path, glslSha256: hash(glsl), spvSha256: hash(bytes) };
}
check(outputs['pair-a.vert'].glslSha256 !== outputs['pair-b.vert'].glslSha256, 'independent vertex programs');
check(outputs['pair-a.frag'].glslSha256 !== outputs['pair-b.frag'].glslSha256, 'independent fragment programs');
check(outputs['pair-a.vert'].metadata.entryPoint !== 'vertex.main-a', 'punctuated entry renamed');
check(outputs['pair-b.vert'].metadata.entryPoint !== 'VertexPayload', 'type/entry collision renamed');
check(outputs['pair-b.frag'].metadata.entryPoint !== 'if', 'reserved original name maps to GLSL main');
check(outputs['mismatch.frag'].metadata.inputs.find(item => item.location === 0).type.components === 2, 'mismatching interface reflected honestly');
const valid = inputs.get('pair-a.vert');
const badMagic = Buffer.from(valid); badMagic.writeUInt32LE(0, 0);
const badBound = Buffer.from(valid); badBound.writeUInt32LE(0xffffffff, 12);
const badInstruction = Buffer.from(valid); badInstruction.writeUInt32LE(0, 20);
// SPIR-V decoration edits create general negative inputs, not emitted-source rewriting.
function decorateInput(source, decoration) {
  const bytes = Buffer.from(source); let target, annotationOffset;
  for (let offset = 20; offset < bytes.length;) {
    const word = bytes.readUInt32LE(offset), count = word >>> 16, opcode = word & 65535;
    if (opcode === 59 && count >= 4 && bytes.readUInt32LE(offset + 12) === 1) target ??= bytes.readUInt32LE(offset + 8);
    if (opcode === 71) annotationOffset ??= offset;
    offset += count * 4;
  }
  assert.ok(target !== undefined && annotationOffset !== undefined);
  const instruction = Buffer.alloc(12);
  instruction.writeUInt32LE((3 << 16) | 71, 0); instruction.writeUInt32LE(target, 4); instruction.writeUInt32LE(decoration, 8);
  return Buffer.concat([bytes.subarray(0, annotationOffset), instruction, bytes.subarray(annotationOffset)]);
}
const linear = decorateInput(inputs.get('pair-a.frag'), 13);
const centroid = decorateInput(inputs.get('pair-a.frag'), 16);
const sample = decorateInput(inputs.get('pair-a.frag'), 17);
const flat = translateWebGLGraphics(instance, decorateInput(inputs.get('pair-a.frag'), 14));
check(flat.inputs.some(item => item.interpolation?.mode === 'flat'), 'flat interpolation accepted and reflected');
const highLocation = Buffer.from(valid);
for (let offset = 20; offset < highLocation.length;) {
  const word = highLocation.readUInt32LE(offset), count = word >>> 16;
  if ((word & 65535) === 71 && count >= 4 && highLocation.readUInt32LE(offset + 8) === 30) {
    highLocation.writeUInt32LE(8, offset + 12); break;
  }
  offset += count * 4;
}
let multipleEntries;
for (let offset = 20; offset < valid.length;) {
  const word = valid.readUInt32LE(offset), bytes = (word >>> 16) * 4;
  if ((word & 65535) === 15) {
    multipleEntries = Buffer.concat([valid.subarray(0, offset), valid.subarray(offset, offset + bytes), valid.subarray(offset)]);
    break;
  }
  offset += bytes;
}
check(multipleEntries !== undefined, 'entry instruction located for negative fixture');
for (const [name, bytes] of [['resource', inputs.get('resource.frag')], ['magic', badMagic], ['bound', badBound],
  ['instruction', badInstruction], ['linear-interpolation', linear], ['centroid-sampling', centroid], ['sample-sampling', sample], ['location-bound', highLocation], ['truncated', valid.subarray(0, valid.length - 4)], ['multiple-entries', multipleEntries]]) {
  let diagnostic;
  try { translateWebGLGraphics(instance, bytes); } catch (error) { diagnostic = error.message; }
  check(typeof diagnostic === 'string' && diagnostic.length > 0 && diagnostic.length <= 2048, name + ' rejected');
  check(api.metadata_len() === 0, name + ' clears stale metadata');
  if (name === 'linear-interpolation') check(diagnostic.includes('linear/noperspective'), 'explicit linear profile rejection');
  if (name === 'centroid-sampling' || name === 'sample-sampling') check(diagnostic.includes('center sampling'), 'explicit sampling profile rejection');
  if (name === 'multiple-entries') check(diagnostic.includes('entry point declaration'), 'raw declaration count rejection');
  rejected.push({ name, diagnostic });
}
check(api.input_reserve(65540) === 0 && api.metadata_len() === 0 && api.output_len() === 0, 'oversize reserve clears state');
check(api.input_reserve(21) === 0, 'unaligned reserve rejected');
api.input_reserve(valid.length);
check(api.translate(valid.length - 4) !== 0 && api.metadata_len() === 0, 'reservation mismatch rejected');
check(translateWebGLGraphics(instance, valid).originalEntryPoint === manifest.fixtures['pair-a.vert'].entryPoint, 'recovery after errors');
await writeFile(reportPath, JSON.stringify({ pass: true, assertions, artifact, artifactSha256: hash(moduleBytes),
  fixtureManifestSha256: hash(await readFile(resolve(fixturesDir, 'fixtures.json'))), outputs, rejected,
  scope: 'Real Naga runtime translation and IR metadata checks only; GPU and guest execution remain untested here' }, null, 2) + '\n');
console.log(JSON.stringify({ pass: true, assertions, reportPath }));
