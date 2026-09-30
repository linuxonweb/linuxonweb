// Actual Naga translation of the A4 sampled-texture SPIR-V through both pinned
// translators (WGSL for WebGPU, GLSL ES 300 for WebGL2). No GPU claim.
// Optional 5th/6th arguments: earlier suites' fixture directories whose
// translations must stay byte-identical against the previous translator pair
// (arguments 7 and 8), proving the combined-sampler adapter is inert for them.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, realpath, statfs } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { translateGraphics } from '../guest-vulkan-graphics/translator/abi.mjs';
import { translateWebGLGraphics } from '../guest-vulkan-webgl/translator/abi.mjs';

const [wgslPath, glslPath, fixturesDir, outDir, ...regression] = process.argv.slice(2);
const root = '/mnt/p6/build/guest-vulkan-a4-20260929';
async function disk(path, anyRoot = false) {
  const actual = await realpath(path);
  assert.ok(anyRoot ? actual.startsWith('/mnt/p6/build/') : actual.startsWith(root + sep), 'inside task root: ' + actual);
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
const tex = (group, binding) => ({ group, binding, type: 'texture', samplerBinding: binding + 16 });
const expected = {
  'tex.vert': [],
  'tex.frag': [tex(0, 0)],
  'pair.frag': [tex(0, 0), tex(0, 1), { group: 0, binding: 2, type: 'uniform', size: 16 }],
  'vfetch.vert': [tex(0, 3)],
  'vcolor.frag': [],
};
const rejections = {
  'bad-separate.frag': /separate (images|samplers) unsupported/, 'bad-array.frag': /arrays of images/, 'bad-3d.frag': /combined sampler2D/,
  'bad-shadow.frag': /combined sampler2D/, 'bad-integer.frag': /combined sampler2D/, 'bad-param.frag': /function parameters/,
  'bad-fetch.frag': /sampled through its combined sampler/, 'bad-binding.frag': /set\/binding outside profile/,
};
const report = { wgslSha256: wgsl.sha256, glslSha256: glsl.sha256, fixtures: {}, rejected: {}, regression: {} };
for (const [name, fixture] of Object.entries(manifest.fixtures)) {
  const bytes = new Uint8Array(await readFile(resolve(fixturesDir, fixture.file)));
  check(hash(bytes) === fixture.sha256 && bytes.length === fixture.bytes, name + ' identity');
  if (name.startsWith('bad-')) {
    for (const [label, fn, inst] of [['wgsl', translateGraphics, wgsl.instance], ['glsl', translateWebGLGraphics, glsl.instance]]) {
      let error = null;
      try { fn(inst, bytes); } catch (e) { error = String(e.message || e); }
      check(error !== null, name + ' rejected by ' + label);
      check(rejections[name].test(error), name + ' ' + label + ' reason: ' + error);
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
      check(got.group === item.group && got.binding === item.binding && got.type === item.type, name + ' ' + label + ' resource identity');
      if (item.type === 'texture') {
        check(got.samplerBinding === item.samplerBinding, name + ' ' + label + ' sampler binding');
        if (label === 'glsl') check(typeof got.samplerName === 'string' && new RegExp('uniform highp sampler2D ' + got.samplerName + ';').test(g.glsl),
          name + ' GLSL sampler2D uniform ' + got.samplerName);
        else check(!('samplerName' in got), name + ' WGSL has no sampler name');
      } else check(got.size === item.size, name + ' ' + label + ' uniform size');
    });
  }
  for (const item of expected[name].filter(r => r.type === 'texture')) {
    check(new RegExp(`@group\\(${item.group}\\) @binding\\(${item.binding}\\)\\s*var \\w+: texture_2d<f32>;`).test(w.wgsl), name + ' WGSL texture_2d');
    check(new RegExp(`@group\\(${item.group}\\) @binding\\(${item.samplerBinding}\\)\\s*var \\w+: sampler;`).test(w.wgsl), name + ' WGSL sampler');
  }
  if (name === 'tex.frag') {
    check(/textureSample\(/.test(w.wgsl), 'WGSL textureSample');
    check(/texture\(/.test(g.glsl), 'GLSL texture()');
  }
  if (name === 'vfetch.vert') {
    check(/textureSampleLevel\(/.test(w.wgsl), 'WGSL textureSampleLevel');
    check(/textureLod\(/.test(g.glsl), 'GLSL textureLod');
  }
  await writeFile(resolve(outDir, name + '.wgsl'), w.wgsl);
  await writeFile(resolve(outDir, name + '.glsl'), g.glsl);
  const strip = ({ wgsl: _a, glsl: _b, ...meta }) => meta;
  report.fixtures[name] = { spvSha256: fixture.sha256, wgsl: strip(w), glsl: strip(g), wgslSha256: hash(w.wgsl), glslSha256: hash(g.glsl) };
}

// Regression: every earlier fixture translates byte-identically (source and
// metadata) with the old and new translators, or is rejected by both.
if (regression.length) {
  const [oldWgslPath, oldGlslPath, ...dirs] = regression;
  await disk(oldWgslPath, true); await disk(oldGlslPath, true);
  const oldW = await load(oldWgslPath), oldG = await load(oldGlslPath);
  report.regression.oldWgslSha256 = oldW.sha256; report.regression.oldGlslSha256 = oldG.sha256;
  const { readdir } = await import('node:fs/promises');
  const run = (fn, inst, bytes) => { try { return JSON.stringify(fn(inst, bytes)); } catch (e) { return 'ERROR ' + String(e.message || e); } };
  for (const dir of dirs) {
    await disk(dir, true);
    for (const file of (await readdir(dir)).filter(f => f.endsWith('.spv')).sort()) {
      const bytes = new Uint8Array(await readFile(resolve(dir, file)));
      const pairs = [['wgsl', translateGraphics, oldW, wgsl], ['glsl', translateWebGLGraphics, oldG, glsl]];
      const entry = {};
      for (const [label, fn, before, after] of pairs) {
        const a = run(fn, before.instance, bytes), b = run(fn, after.instance, bytes);
        check(a === b, `regression ${dir}/${file} ${label} identical`);
        entry[label] = a.startsWith('ERROR') ? a : hash(a);
      }
      report.regression[dir + '/' + file] = entry;
    }
  }
}
report.checks = checks; report.pass = true;
await writeFile(resolve(outDir, 'result.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ pass: true, checks, rejected: report.rejected, regressionFiles: Object.keys(report.regression).length - (regression.length ? 2 : 0) }));
