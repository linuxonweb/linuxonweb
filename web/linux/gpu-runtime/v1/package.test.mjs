// Packaging/retained-evidence checks; no live GPU or Firefox acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {join,resolve} from 'node:path';
import {checkEgl} from '../../tests/guest-vulkan-wgpu/check-egl.mjs';
import {approvedRoutes} from '../../../sites/release-runtime.mjs';
import {validateTextureDescriptor,validateDepthAttachment} from './graphics-renderer.mjs';
const root=resolve(fileURLToPath(new URL('../../../../',import.meta.url)));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const load=name=>readFile(new URL(name,import.meta.url));

test('stable runtime preserves accepted real Rust module, validators and bridge behavior',async()=>{
  const provenance=JSON.parse(await load('provenance.json'));
  assert.equal(provenance.newRustBuild,false);
  assert.equal(provenance.freshRuntimeAcceptance,false);
  for(const pin of provenance.artifacts){
    const bytes=await load(pin.file);
    assert.equal(bytes.length,pin.bytes);assert.equal(sha(bytes),pin.sha256);
    assert.equal(sha(await readFile(pin.path)),pin.sha256);
  }
  const wasm=await load('guest_vulkan_wgpu_host_bg.wasm');
  const module=await WebAssembly.compile(wasm);
  const exports=WebAssembly.Module.exports(module).map(e=>e.name);
  for(const name of ['renderer_create','renderer_render','renderer_readback','renderer_close'])assert.ok(exports.includes(name),name);
  assert.equal(WebAssembly.Module.customSections(module,'.debug_info').length,0);
  assert.equal(WebAssembly.validate(wasm.subarray(0,wasm.length-1)),false);
  const originalBridge=await readFile(provenance.promotionSources[0].path,'utf8');
  const bridge=(await load('bridge.mjs')).toString();
  assert.equal(bridge,originalBridge.replace("from '../guest-vulkan-graphics/renderer.mjs'","from './graphics-renderer.mjs'")
    .replace("import('./candidate/guest_vulkan_wgpu_host.js')","import('./guest_vulkan_wgpu_host.js')"));
  assert.equal(sha(await load('graphics-renderer.mjs')),provenance.promotionSources[1].sha256);
  assert.equal(sha(await load(provenance.notices.file)),provenance.notices.sha256);
  assert.throws(()=>validateTextureDescriptor({width:1,height:1,format:'unsupported'}));
  assert.throws(()=>validateDepthAttachment({target:1,loadOp:'clear',storeOp:'store',clearValue:2}));
});

test('actual promoted dependency subgraph closes under production allowlist',async()=>{
  const owner=await readFile(join(root,'web/linux/dist/guest-gpu-vk.js'),'utf8');
  assert.ok(owner.includes('import("../gpu-runtime/v1/bridge.mjs")'));
  assert.ok(!owner.includes('guest-vulkan-wgpu/bridge.mjs'));
  const seen=new Set(),pending=['/linux/gpu-runtime/v1/bridge.mjs'];
  while(pending.length){
    const route=pending.pop();if(seen.has(route))continue;
    assert.ok(approvedRoutes.includes(route),route);seen.add(route);
    if(!/\.m?js$/.test(route))continue;
    const source=await readFile(join(root,'web'+route),'utf8');
    const imports=[...source.matchAll(/^\s*import\s+[^;]*?\sfrom\s*["']([^"']+)["']/gm),
      ...source.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g),
      ...source.matchAll(/new URL\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url\s*\)/g)];
    for(const match of imports)pending.push(new URL(match[1],'https://runtime.invalid'+route).pathname);
  }
  assert.deepEqual([...seen].sort(),['bridge.mjs','graphics-renderer.mjs','guest_vulkan_wgpu_host.js','guest_vulkan_wgpu_host_bg.wasm'].map(n=>'/linux/gpu-runtime/v1/'+n).sort());
  assert.ok(!seen.has('/linux/gpu-runtime/v1/candidate/guest_vulkan_wgpu_host.js'));
});

test('retained three-arm actual Mesa GPU evidence binds the promoted Rust bytes',async()=>{
  const provenance=JSON.parse(await load('provenance.json'));
  for(const arm of ['hardware','software','gl']){
    const path='/mnt/p6/project/build/guest-vulkan-wgpu-20261003/egl-final-'+arm+'/result.json';
    const report=JSON.parse(await readFile(path));
    const checked=checkEgl(report);
    assert.equal(checked.pass,true,JSON.stringify(checked.checks));
    assert.equal(checked.firefoxGpuAcceptance,false);
    for(const pin of provenance.artifacts){
      const served=report.result.guest.package.wgpuArtifacts[pin.file];
      assert.equal(served.sha256,pin.sha256);assert.equal(served.bytes,pin.bytes);
    }
    const tampered=structuredClone(report);
    tampered.result.guest.package.wgpuArtifacts['guest_vulkan_wgpu_host_bg.wasm'].sha256='0'.repeat(64);
    assert.equal(checkEgl(tampered).pass,false);
  }
});
