// Verify independently compiled coordinate/sampling inputs against the real ABI.
import assert from 'node:assert/strict';
import { readFile, writeFile, realpath, statfs } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { translateWebGLGraphics } from './translator/abi.mjs';

const [artifact, fixtureDir, reportPath] = process.argv.slice(2);
const root = '/mnt/p6/build/guest-vulkan-webgl-20260926';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
for (const path of [artifact, fixtureDir, dirname(reportPath), ...['TMPDIR', 'TMP', 'TEMP'].map(k => process.env[k])]) {
  const actual = await realpath(path), fs = await statfs(actual);
  assert.ok(actual.startsWith(root + sep));
  assert.ok(![0x01021994, 0x858458f6].includes(fs.type));
}
let assertions = 0;
function check(value, message) { assert.ok(value, message); assertions++; }
const artifactBytes = await readFile(artifact);
const { instance } = await WebAssembly.instantiate(artifactBytes, {});
check(instance.exports.translator_version() === 0x474c0001, 'WebGL ABI');
const manifestBytes = await readFile(resolve(fixtureDir, 'fixtures.json'));
const manifest = JSON.parse(manifestBytes);
check(manifest.pass && Object.keys(manifest.fixtures).length === 8, 'independent compiler/validator results');
const results = {};
for (const [name, fixture] of Object.entries(manifest.fixtures)) {
  const input = await readFile(resolve(fixtureDir, fixture.file));
  check(sha(input) === fixture.sha256 && input.length === fixture.bytes, name + ' binary identity');
  check(sha(await readFile(resolve(fixtureDir, name))) === fixture.sourceSha256, name + ' compiler input identity');
  if (fixture.reject === 'sampling') {
    const wantedOpcode = name.includes('-member') ? 72 : 71;
    const wantedDecoration = name.startsWith('centroid') ? 16 : 17;
    let found = false;
    for (let i = 20; i < input.length;) {
      const word = input.readUInt32LE(i), bytes = (word >>> 16) * 4;
      check(bytes > 0 && i + bytes <= input.length, name + ' SPIR-V instruction bounds');
      if ((word & 65535) === wantedOpcode) {
        const relative = wantedOpcode === 72 ? 12 : 8;
        if (bytes >= relative + 4 && input.readUInt32LE(i + relative) === wantedDecoration) found = true;
      }
      i += bytes;
    }
    check(found, name + ' independent compiler emitted intended sampling decoration');
  }
  if (fixture.reject) {
    let diagnostic;
    try { translateWebGLGraphics(instance, input); } catch (error) { diagnostic = error.message; }
    check(typeof diagnostic === 'string' && diagnostic.includes(fixture.reject === 'sampling' ? 'center sampling' : 'linear/noperspective'), name + ' explicit rejection');
    check(instance.exports.metadata_len() === 0, name + ' metadata cleared');
    results[name] = { rejected: true, diagnostic, spvSha256: fixture.sha256 };
  } else {
    const result = translateWebGLGraphics(instance, input);
    check(result.stage === 'vertex' && result.originalEntryPoint === 'main', name + ' entry reflection');
    check(result.inputs.length === 2 && result.outputs.length === 2 && result.resources.length === 0, name + ' bounded interface');
    const path = reportPath + '.' + name;
    await writeFile(path, result.glsl);
    const { glsl, ...metadata } = result;
    results[name] = { rejected: false, path, glslSha256: sha(glsl), metadata, spvSha256: fixture.sha256 };
  }
}
const recovery = await readFile(resolve(fixtureDir, manifest.fixtures['perspective.vert'].file));
check(translateWebGLGraphics(instance, recovery).stage === 'vertex', 'recovery after sampling failures');
await writeFile(reportPath, JSON.stringify({ pass: true, assertions, artifactSha256: sha(artifactBytes),
  fixtureManifestSha256: sha(manifestBytes), results,
  scope: 'Real translation of independent coordinate inputs and sampling rejection; GPU pixel parity remains required' }, null, 2) + '\n');
console.log(JSON.stringify({ pass: true, assertions, reportPath }));
