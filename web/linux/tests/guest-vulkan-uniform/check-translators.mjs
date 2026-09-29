// Actual Naga translation of the A3 uniform SPIR-V through both pinned
// translators (WGSL for WebGPU, GLSL ES 300 for WebGL2). No GPU claim.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, realpath, statfs } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { translateGraphics } from '../guest-vulkan-graphics/translator/abi.mjs';
import { translateWebGLGraphics } from '../guest-vulkan-webgl/translator/abi.mjs';

const [wgslPath, glslPath, fixturesDir, outDir] = process.argv.slice(2);
const root = '/mnt/p6/build/guest-vulkan-a3-20260928';
async function disk(path) {
  const actual = await realpath(path);
  assert.ok(actual.startsWith(root + sep), 'inside task root: ' + actual);
  const fs = await statfs(actual);
  assert.ok(fs.type !== 0x01021994 && fs.type !== 0x858458f6, 'not tmpfs/ramfs');
}
for (const name of ['TMPDIR', 'TMP', 'TEMP']) await disk(process.env[name]);
await mkdir(outDir, { recursive: false });
for (const p of [wgslPath, glslPath, fixturesDir, outDir]) await disk(p);
const hash = data => createHash('sha256').update(data).digest('hex');
let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks++; };
const load = async path => {
  const bytes = await readFile(path);
  return { sha256: hash(bytes), instance: await WebAssembly.instantiate(await WebAssembly.compile(bytes), {}) };
};
const wgsl = await load(wgslPath), glsl = await load(glslPath);
const manifest = JSON.parse(await readFile(resolve(fixturesDir, 'fixtures.json'), 'utf8'));
const expected = {
  'index.vert': [{ group: 0, binding: 0, size: 160, members: [['mat4x4', 0, 0], ['vec4', 6, 64]], block: 'Transform' }],
  'color.frag': [{ group: 1, binding: 0, size: 16, members: [['vec4', 0, 0]], block: 'Material' }],
  'offset.vert': [{ group: 0, binding: 1, size: 32, members: [['vec4', 0, 0], ['vec4', 0, 16]], block: 'Params' }],
  'tint.frag': [{ group: 0, binding: 1, size: 32, members: [['vec4', 0, 0], ['vec4', 0, 16]], block: 'Params' }],
};
const report = { wgslSha256: wgsl.sha256, glslSha256: glsl.sha256, fixtures: {}, rejected: {} };
for (const [name, fixture] of Object.entries(manifest.fixtures)) {
  const bytes = new Uint8Array(await readFile(resolve(fixturesDir, fixture.file)));
  check(hash(bytes) === fixture.sha256 && bytes.length === fixture.bytes, name + ' identity');
  if (name.startsWith('bad-')) {
    for (const [label, fn, inst] of [['wgsl', translateGraphics, wgsl.instance], ['glsl', translateWebGLGraphics, glsl.instance]]) {
      let error = null;
      try { fn(inst, bytes); } catch (e) { error = String(e.message || e); }
      check(error !== null, name + ' rejected by ' + label);
      report.rejected[name + ':' + label] = error;
    }
    continue;
  }
  const w = translateGraphics(wgsl.instance, bytes), g = translateWebGLGraphics(glsl.instance, bytes);
  for (const [label, result] of [['wgsl', w], ['glsl', g]]) {
    check(result.stage === fixture.stage, name + ' ' + label + ' stage');
    const want = expected[name];
    check(result.resources.length === want.length, name + ' ' + label + ' resource count');
    want.forEach((item, i) => {
      const got = result.resources[i];
      check(got.group === item.group && got.binding === item.binding && got.size === item.size && got.type === 'uniform',
        name + ' ' + label + ' resource identity');
      check(JSON.stringify(got.members.map(m => [m.type, m.arrayLength, m.offset])) === JSON.stringify(item.members),
        name + ' ' + label + ' members');
      if (label === 'glsl') check(typeof got.blockName === 'string' && got.blockName.length > 0, name + ' block name');
    });
  }
  check(/@group\(\d\) @binding\(\d+\)\s*var<uniform>/.test(w.wgsl), name + ' WGSL var<uniform>');
  check(/layout\(std140\)/.test(g.glsl) && /uniform\s+\w+/.test(g.glsl), name + ' GLSL std140 uniform block');
  if (name === 'index.vert') {
    check(w.inputs.some(i => i.builtin === 'vertex_index'), 'WGSL vertex_index input');
    check(/@builtin\(vertex_index\)/.test(w.wgsl), 'WGSL vertex_index builtin');
    check(g.inputs.some(i => i.builtin === 'vertex_index') && /gl_VertexID/.test(g.glsl), 'GLSL gl_VertexID');
    check(!g.inputs.some(i => i.location !== undefined), 'no vertex attributes');
  }
  await writeFile(resolve(outDir, name + '.wgsl'), w.wgsl);
  await writeFile(resolve(outDir, name + '.glsl'), g.glsl);
  const strip = ({ wgsl: _a, glsl: _b, ...meta }) => meta;
  report.fixtures[name] = { spvSha256: fixture.sha256, wgsl: strip(w), glsl: strip(g), wgslSha256: hash(w.wgsl), glslSha256: hash(g.glsl) };
}
report.checks = checks; report.pass = true;
await writeFile(resolve(outDir, 'result.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ pass: true, checks, rejected: report.rejected }));
