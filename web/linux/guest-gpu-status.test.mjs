import test from 'node:test';
import assert from 'node:assert/strict';
import {newGuestGpuState,observeGuestGpuMessage,guestGpuLabels} from './guest-gpu-status.mjs';
import {guestGpuOwnerConfig,guestGpuHostcallOptions,guestGpuUrl} from './guest-gpu-config.mjs';
import {restoreConfiguration,displayOnlyChange} from './machine-settings.mjs';

test('guest Vulkan requires an explicit WebGL choice in both services',()=>{
 for(const backend of [undefined,'auto','invalid','webgpu']) {
  assert.equal(guestGpuOwnerConfig('',backend).vk.backend,'webgpu');
  assert.equal(guestGpuHostcallOptions('?gpuruntime=rust',backend).ownerConfig.vk.wgpuBackend,'webgpu');
 }
 assert.equal(guestGpuOwnerConfig('','webgl').vk.backend,'webgl');
 assert.equal(guestGpuOwnerConfig('?gpuruntime=rust','webgl').vk.wgpuBackend,'webgl');
});
test('direct WebGL does not request the WebGPU-only sampled-target capability',()=>{
 for(const query of ['', '?gpulargesampledtargets=1']) {
  const direct=guestGpuOwnerConfig(query,'webgl').vk;
  assert.equal(direct.backend,'webgl');assert.equal(direct.allowLargeColorTargets,true);
  assert.equal(direct.allowLargeSampledTargets,undefined);
 }
 assert.equal(guestGpuOwnerConfig('','webgpu').vk.allowLargeSampledTargets,true);
 assert.equal(guestGpuOwnerConfig('?gpulargesampledtargets=0','webgpu').vk.allowLargeSampledTargets,undefined);
 assert.equal(guestGpuOwnerConfig('?gpulargetargets=0','webgpu').vk.allowLargeColorTargets,undefined);
 assert.equal(guestGpuOwnerConfig('?gpuruntime=rust&gpulargetargets=1&gpulargesampledtargets=1','webgl').vk.allowLargeSampledTargets,true);
});
test('guest backend URLs preserve unrelated settings',()=>{
 const url=new URL(guestGpuUrl('https://example.test/linux/?firefox=1&renderer=webgl&gpuruntime=rust','webgpu'));
 assert.equal(url.searchParams.get('firefox'),'1');assert.equal(url.searchParams.get('renderer'),'webgl');assert.equal(url.searchParams.get('gpuruntime'),'rust');assert.equal(url.searchParams.get('gpubackend'),'webgpu');
 assert.throws(()=>guestGpuUrl(url.href,'auto'),TypeError);
});
test('guest selection persists without turning a backend change into presentation-only',()=>{
 const defaults={resolution:'1280x720',cpus:3,ram:2048,backend:'auto',guestBackend:'webgpu'};
 const options={resolutions:['1280x720','900x1200'],ramValues:[2048],maxCpus:3};
 const saved=restoreConfiguration({...defaults,guestBackend:'webgl'},defaults,options).configuration;
 assert.equal(saved.guestBackend,'webgl');assert.equal(restoreConfiguration({...defaults,guestBackend:'auto'},defaults,options).configuration.guestBackend,'webgpu');
 assert.equal(displayOnlyChange(defaults,{...defaults,backend:'webgl'}),true);
 assert.equal(displayOnlyChange(defaults,{...defaults,backend:'webgl',guestBackend:'webgl'}),false);
});
test('GLES status uses observed identity without claiming complete Firefox acceleration',()=>{
 const before=newGuestGpuState();assert.match(guestGpuLabels(before).gl,/waiting/);
 const state=observeGuestGpuMessage(before,'gpu-owner: gl context 2 open: ANGLE (NVIDIA Corporation, NVIDIA GeForce MX110, OpenGL 4.5.0)');
 assert.match(guestGpuLabels(state).gl,/GLES bridge → WebGL2.*NVIDIA/);
 assert.doesNotMatch(guestGpuLabels(state).gl,/Firefox|conformant|full OpenGL/);
 assert.equal(observeGuestGpuMessage(state,'unrelated runtime log'),state);
});
test('Vulkan status reports actual backend, software identity and failure',()=>{
 const state=observeGuestGpuMessage(newGuestGpuState(),'vk session 7 backend=webgpu adapter={"description":"SwiftShader","fallback":true}');
 assert.match(guestGpuLabels(state).vulkan,/WebGPU.*SwiftShader.*software adapter/);
 const failed=observeGuestGpuMessage(state,'vk session 7 failed: WebGPU adapter unavailable');
 assert.match(guestGpuLabels(failed).vulkan,/unavailable.*no automatic switch/);
 const recovered=observeGuestGpuMessage(failed,'vk session 8 backend=Gl adapter={"name":"NVIDIA MX110"}');
 assert.equal(recovered.vulkanFailure,null);assert.match(guestGpuLabels(recovered).vulkan,/WebGL.*NVIDIA/);
});
test('malformed adapter data does not replace valid status',()=>{
 const state=newGuestGpuState('webgl');assert.equal(observeGuestGpuMessage(state,'vk session 1 backend=webgpu adapter={bad}'),state);
 assert.match(guestGpuLabels(observeGuestGpuMessage(state,'vk session 1 closed commands=1 error="device lost"')).vulkan,/device lost/);
});
