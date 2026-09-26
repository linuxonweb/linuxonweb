// Regression for the sampling normalization found while implementing WebGL.
import assert from 'node:assert/strict';
import { readFile, writeFile, realpath, statfs } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve, sep } from 'node:path';
import { translateGraphics } from '../guest-vulkan-graphics/translator/abi.mjs';
const [artifact, reportPath] = process.argv.slice(2);
const root = '/mnt/p6/build/guest-vulkan-webgl-20260926';
const graphics = '/mnt/p6/build/guest-vulkan-graphics-20260926';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
for (const path of [artifact, dirname(reportPath), ...['TMPDIR', 'TMP', 'TEMP'].map(k => process.env[k])]) {
  const actual = await realpath(path), fs = await statfs(actual);
  assert.ok([root, graphics].some(base => actual.startsWith(base + sep)));
  assert.ok(![0x01021994, 0x858458f6].includes(fs.type));
}
assert.ok(resolve(reportPath).startsWith(root + sep));
let assertions = 0;
function check(value, message) { assert.ok(value, message); assertions++; }
const bytes = await readFile(artifact);
const { instance } = await WebAssembly.instantiate(bytes, {});
check(instance.exports.translator_version() === 0x47520001, 'WGSL graphics ABI');
const fixtureBytes = await readFile(root + '/coordinate-fixtures-run1/fixtures.json');
const fixtures = JSON.parse(fixtureBytes);
check(fixtures.pass, 'independent compiler and validator passed');
const rejected = [];
for (const name of ['centroid-direct.frag', 'centroid-member.frag', 'sample-direct.frag', 'sample-member.frag']) {
  const item = fixtures.fixtures[name];
  const input = await readFile(root + '/coordinate-fixtures-run1/' + item.file);
  check(sha(input) === item.sha256, name + ' compiler output identity');
  let diagnostic;
  try { translateGraphics(instance, input); } catch (error) { diagnostic = error.message; }
  check(diagnostic?.includes('only center sampling supported (raw SPIR-V decoration)'), name + ' reject before normalization');
  check(instance.exports.metadata_len() === 0, name + ' metadata cleared');
  rejected.push({ name, diagnostic, spvSha256: item.sha256 });
}
const original = JSON.parse(await readFile(graphics + '/translator-check-run3/result.json'));
const current = JSON.parse(await readFile(graphics + '/translator-check-run4/result.json'));
check(original.pass && current.pass && current.artifactSha256 === sha(bytes), 'old/new acceptance identities');
check(original.artifactSha256 === 'c1506c293785db309df6de17e481a9fb62ca9001823d3150f7a39cecc2575636', 'immutable predecessor');
const unchangedPrograms = [];
for (const [name, previous] of Object.entries(original.outputs)) {
  const input = await readFile(graphics + '/translator-fixtures-run1/' + name + '.spv');
  check(sha(input) === previous.spvSha256, name + ' original SPIR-V identity');
  const translated = translateGraphics(instance, input);
  check(sha(translated.wgsl) === previous.wgslSha256 && current.outputs[name].wgslSha256 === previous.wgslSha256,
    name + ' shader bytes unchanged');
  const { wgsl, ...metadata } = translated;
  assert.deepEqual(metadata, previous.metadata); assertions++;
  unchangedPrograms.push(name);
}
await writeFile(reportPath, JSON.stringify({ pass: true, assertions, artifactSha256: sha(bytes),
  fixtureManifestSha256: sha(fixtureBytes), rejected, unchangedPrograms,
  scope: 'Four independent sampling rejections and five unchanged emitted WGSL programs; new artifact guest/Worker run remains pending' }, null, 2) + '\n');
console.log(JSON.stringify({ pass: true, assertions, reportPath }));
