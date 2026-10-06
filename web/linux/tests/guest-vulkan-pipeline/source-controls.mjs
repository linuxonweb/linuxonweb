// Source/protocol controls only. No real GPU or guest acceptance is asserted.
import assert from 'node:assert/strict';
import {validatePipelineDescriptor as candidate} from '../../gpu-runtime/pipeline-candidate/graphics-renderer.mjs';
import {validatePipelineDescriptor as frozen} from '../../gpu-runtime/v1/graphics-renderer.mjs';
import {serveGPU,MAGIC,VERSION,OP} from '../guest-gpu/host.mjs';
let checks=0;const check=x=>{checks++;assert(x);};
const shader={inputs:[],outputs:[],resources:[]};
const descriptor={vertex:shader,fragment:shader,vertexBuffers:[]};
const shaderIdentity=x=>x;
check(candidate(descriptor,shaderIdentity).colorWriteMask===15);
for(let mask=0;mask<16;mask++)check(candidate({...descriptor,colorWriteMask:mask},shaderIdentity).colorWriteMask===mask);
for(const mask of [-1,16,1.5,NaN,Infinity,'7',null,{},[],true]){checks++;assert.throws(()=>candidate({...descriptor,colorWriteMask:mask},shaderIdentity));}
checks++;assert.throws(()=>candidate({...descriptor,topology:'triangle-fan'},shaderIdentity));
checks++;assert.throws(()=>frozen({...descriptor,colorWriteMask:7},shaderIdentity));
check(!Object.hasOwn(frozen(descriptor,shaderIdentity),'colorWriteMask'));
async function hello(profile){
 const reply=[],queue=[];for(const [op,seq]of[[OP.HELLO,1],[OP.CLOSE,2]]){const h=new Uint8Array(16),v=new DataView(h.buffer);v.setUint32(0,MAGIC,true);v.setUint16(4,VERSION,true);v.setUint16(6,op,true);v.setUint32(8,seq,true);queue.push(h,new Uint8Array());}
 const report=await serveGPU({async readExactly(){return queue.shift();},async write(bytes){reply.push(bytes.slice());},close(){}},{allowGraphics:true,timeoutMs:2000,graphicsTranslatorFactory:async()=>({close(){}}),graphicsBackendFactory:async()=>({backend:'webgpu',adapter:{name:'source double'},renderer:{pipelineStateProfile:profile,triangleProvokingVertex:'first',limits:{maxStride:2048},integerViewport:false,close(){},getStats(){return{resources:0,nativeObjects:0};}}})});
 check(report.error===null);const data=reply[0];check(new DataView(data.buffer).getInt32(16,true)===0);return JSON.parse(new TextDecoder().decode(data.subarray(20)));
}
check(!Object.hasOwn(await hello(0),'pipelineStateProfile'));check((await hello(1)).pipelineStateProfile===1);
// Execute the actual C oracle's facing expressions on independently specified
// framebuffer triangles. The expected rows come from Vulkan's signed shoelace
// rule (positive viewport), including reversed winding and zero-area vertices.
const {readFileSync}=await import('node:fs');
const oracle=readFileSync(new URL('./client.c',import.meta.url),'utf8');
const facingExpression=oracle.match(/int facing=([^;]+);/)[1].replaceAll('VK_FRONT_FACE_COUNTER_CLOCKWISE','0');
const areaExpression=oracle.match(/double framebuffer_area=([^;]+);/)?.[1];
const facing=new Function('area','front',(areaExpression?`const framebuffer_area=${areaExpression};`:'')+`return Number(${facingExpression});`);
for(const [points,ccw]of [
 [[[0,0],[64,0],[0,64]],false],
 [[[0,0],[0,64],[64,0]],true],
 [[[10,17],[50,17],[10,57]],false],
 [[[0,0],[32,32],[64,64]],null],
 [[[4,8],[4,8],[12,18]],null]
]){
 const [[ax,ay],[bx,by],[cx,cy]]=points;
 const cross=(bx-ax)*(cy-ay)-(by-ay)*(cx-ax);
 check(facing(cross,0)===Number(ccw===true));
 check(facing(cross,1)===Number(ccw===false));
 for(const front of [0,1])for(const cull of [0,1,2]){
  const isFront=front===0?ccw===true:ccw===false;
  check(((cull===1&&!!facing(cross,front))||(cull===2&&!facing(cross,front)))===((cull===1&&isFront)||(cull===2&&!isFront)));
 }
}
check(oracle.includes('VkViewport viewport={0,0,W,H,0,1}'));
console.log(JSON.stringify({pass:true,checks,scope:'source/protocol controls with transport/renderer doubles; no GPU acceptance'}));
