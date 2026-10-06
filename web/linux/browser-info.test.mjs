import assert from 'node:assert/strict';
import test from 'node:test';
import { codecSupport, collectBrowserInfo, startRenderingDemo } from './browser-info.mjs';
test('configuration preferences stay hints when browser accepts all configurations',async()=>{
 const calls=[];const support=await codecSupport({isConfigSupported:async config=>{calls.push(config);return {supported:true,config};}},'vp8',true);
 assert.deepEqual(support,{supported:true,hardwareHint:true,softwareHint:true});assert.equal(calls.length,3);assert.equal('hardware' in support,false);
});
test('unavailable APIs and masked WebGL identity are explicit; probe context is released',async()=>{
 let releases=0;const gl={VENDOR:1,RENDERER:2,VERSION:3,getParameter:n=>['','Browser','Masked renderer','WebGL 1'][n],getExtension:name=>name==='WEBGL_lose_context'?{loseContext(){releases++;}}:null};
 const info=await collectBrowserInfo({userAgent:'test',platform:'test',language:'en',hardwareConcurrency:6},()=>({getContext:name=>name==='webgl'?gl:null}),{crossOriginIsolated:true,isSecureContext:true});
 assert.equal(info.webgpu.status,'API unavailable');assert.equal(info.webgl.webgl2.status,'Unavailable');assert.equal(info.webgl.webgl.identity,'Masked browser identity');assert.equal(info.codecs[0].decoder.supported,null);assert.equal(releases,1);
});
