import assert from 'node:assert/strict';
import test from 'node:test';
import { installRendererWorker, TRIANGLE_PIPELINE } from './worker.mjs';
import { createInfoWgpuRenderer } from './renderer.mjs';
import { startRenderingDemo } from '../browser-info.mjs';

const turn = () => new Promise(resolve => setTimeout(resolve, 0));
const defer = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return {promise,resolve}; };
function workerHarness(create) {
  const events = [], scope = {postMessage(message){events.push(message);}};
  installRendererWorker(scope, async () => ({create}));
  const send = data => scope.onmessage({data});
  return { events, send };
}
function nativeHarness() {
  const calls = [];
  const native = {close(){calls.push('close');},free(){calls.push('free');},
    async create_pipeline(value){calls.push(['pipeline',JSON.parse(value)]);return 1;},
    async create_target(...args){calls.push(['target',...args]);return 2;},
    adapter_info(){return JSON.stringify({backend:'BrowserWebGpu',deviceType:'Cpu',name:'Software'});},stats(){return '{}';},
    async render(value){calls.push(['render',JSON.parse(value)]);},async readback(){calls.push('readback');return new Uint8Array(160*90*4);}};
  return {native,calls};
}
test('worker closes and frees a late device acquired after close, without creating resources',async()=>{
  const device=defer(),{native,calls}=nativeHarness(),{send,events}=workerHarness(()=>device.promise);
  const pending=send({type:'init',id:1,backend:'webgpu',width:160,height:90});await turn();
  await send({type:'close'});device.resolve(native);await pending;
  assert.deepEqual(calls,['close','free']);assert.equal(events[0].type,'closed');assert.deepEqual(events[0].stats,{});
});
test('worker uses no vertex/uniform buffers and waits for render before readback; close during render skips pixels',async()=>{
  const {native,calls}=nativeHarness(),{send,events}=workerHarness(async()=>native);
  await send({type:'init',id:1,backend:'webgpu',width:160,height:90});
  assert.deepEqual(TRIANGLE_PIPELINE.vertexBuffers,[]);assert.deepEqual(TRIANGLE_PIPELINE.uniforms,[]);
  assert.deepEqual(calls.find(x=>x[0]==='target'),['target',160,90,false]);
  const rendered=defer();native.render=async value=>{calls.push(['render',JSON.parse(value)]);await rendered.promise;};
  const frame=send({type:'frame',id:2,time:1});await turn();
  assert.equal(calls.includes('readback'),false);
  await send({type:'frame',id:3,time:2});assert.match(events.at(-1).message,/already in flight/);
  await send({type:'close'});rendered.resolve();await frame;
  assert.equal(calls.includes('readback'),false);assert.deepEqual(calls.slice(-2),['close','free']);
  assert.equal(events.some(x=>x.type==='frame'),false);
  assert.equal(calls.find(x=>x[0]==='render')[1].draws[0].firstVertex,3072);
});
test('OOM reports allocation stage, releases Rust and never reacquires a device',async()=>{
  const {native,calls}=nativeHarness();let acquisitions=0;
  native.create_target=async()=>{throw new Error('vkAllocateMemory VK_ERROR_OUT_OF_DEVICE_MEMORY');};
  const {send,events}=workerHarness(async()=>{acquisitions++;return native;});
  await send({type:'init',id:1,backend:'webgpu',width:160,height:90});
  assert.match(events[0].message,/target allocation.*VK_ERROR_OUT_OF_DEVICE_MEMORY/);
  assert.deepEqual(calls.slice(-2),['close','free']);
  await send({type:'init',id:2,backend:'webgpu',width:160,height:90});assert.equal(acquisitions,1);
});
test('returned frame transfers actual Rust pixels and software adapter identity is preserved',async()=>{
  const {native,calls}=nativeHarness(),{send,events}=workerHarness(async()=>native);
  await send({type:'init',id:1,backend:'webgpu',width:160,height:90});
  assert.equal(events[0].adapter.deviceType,'Cpu');
  await send({type:'frame',id:2,time:4});assert.equal(events[1].pixels.byteLength,160*90*4);
  assert.deepEqual(calls.slice(-2).map(x=>Array.isArray(x)?x[0]:x),['render','readback']);
  await send({type:'close'});assert.deepEqual(calls.slice(-2),['close','free']);
});
test('host closes initialization, rejects pending work and terminates on close acknowledgement',async()=>{
  let worker,terminated=0;
  class Worker {constructor(){worker=this;this.messages=[];}postMessage(data){this.messages.push(data);}terminate(){terminated++;}}
  const canvas={width:160,height:90,getContext:()=>({putImageData(){throw Error('closed renderer must never present');}})};
  const renderer=createInfoWgpuRenderer({canvas,backend:'webgpu',environment:{Worker}});
  const rejected=assert.rejects(renderer.ready,/closed/);renderer.close();await rejected;
  worker.onmessage({data:{type:'ready',id:1,adapter:{}}});
  worker.onmessage({data:{type:'closed'}});assert.equal(terminated,1);
  assert.deepEqual(worker.messages.map(x=>x.type),['init','close']);
});
test('watchdog closes and terminates an unresponsive worker after bounded acquisition and cleanup waits',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});let worker,terminated=0;
  class Worker {constructor(){worker=this;this.messages=[];}postMessage(data){this.messages.push(data);}terminate(){terminated++;}}
  const renderer=createInfoWgpuRenderer({canvas:{width:160,height:90,getContext:()=>({})},backend:'webgpu',environment:{Worker}});
  const rejected=assert.rejects(renderer.ready,/init timed out/);
  t.mock.timers.tick(5000);await rejected;
  assert.deepEqual(worker.messages.map(x=>x.type),['init','close']);assert.equal(terminated,0);
  t.mock.timers.tick(5000);assert.equal(terminated,1);
});
function domHarness(factory) {
  let view;const listeners={},frames=[];
  const document={hidden:false,addEventListener(name,fn){listeners[name]=fn;},removeEventListener(name){delete listeners[name];},
    createElement(){return {ownerDocument:document,handlers:{},children:[],dataset:{},isConnected:true,setAttribute(){},removeAttribute(){},
      addEventListener(type,fn){this.handlers[type]=fn;},append(...children){this.children.push(...children);},replaceWith(){},remove(){this.isConnected=false;}};}};
  const environment={createInfoWgpuRenderer:factory,requestAnimationFrame(fn){frames.push(fn);return frames.length;},cancelAnimationFrame(){}};
  const stop=startRenderingDemo({ownerDocument:document,append(node){view=node;}},'webgpu',environment);
  return {view,document,listeners,frames,stop};
}
test('Info idle creates no renderer; double click stays single; hiding during a frame cancels all future frames',async()=>{
  let acquired=0,closed=0;const drawn=defer();
  const h=domHarness(()=>{acquired++;return {ready:Promise.resolve({adapter:{backend:'BrowserWebGpu',deviceType:'Cpu',name:'Software'}}),draw:()=>drawn.promise,close(){closed++;}};});
  assert.equal(acquired,0);h.view.handlers.click();h.view.handlers.click();await turn();assert.equal(acquired,1);
  assert.match(h.view.children[2].textContent,/device type Cpu/);
  const tick=h.frames[0](1000);await turn();assert.equal(h.frames.length,1);
  h.document.hidden=true;h.listeners.visibilitychange();drawn.resolve();await tick;
  assert.equal(closed,1);assert.equal(h.frames.length,1);assert.equal(h.view.dataset.frames,undefined);
  h.stop();assert.equal(closed,1);
});
test('Info rejects a mismatched real backend rather than silently relabeling WebGL as WebGPU',async()=>{
  let closed=0;const h=domHarness(()=>({ready:Promise.resolve({adapter:{backend:'Gl'}}),close(){closed++;}}));
  h.view.handlers.click();await turn();assert.equal(h.view.dataset.state,'error');assert.equal(h.frames.length,0);assert.equal(closed,1);
  assert.match(h.view.children[2].textContent,/wgpu selected Gl/);h.stop();
});
