// Ownership/cancellation regression checks. Stubbed renderer; not GPU acceptance.
import assert from 'node:assert/strict';
import {createReadbackPresentation} from '../../web/linux/tests/guest-vulkan-graphics/readback-presentation.mjs';
import {serveGPU} from '../../web/linux/tests/guest-gpu/host.mjs';
const canvases = [];
class Canvas {
  constructor(width, height) { this.width=width; this.height=height; this.images=[]; this.bitmaps=[]; canvases.push(this); }
  getContext(kind) { assert.equal(kind,'2d'); return {putImageData: image => this.images.push(image)}; }
  transferToImageBitmap() { const b={closed:0,close(){this.closed++;}}; this.bitmaps.push(b); return b; }
}
globalThis.OffscreenCanvas=Canvas;
globalThis.ImageData=class { constructor(data,width,height){this.data=data;this.width=width;this.height=height;} };
const image = (width=2,height=2) => ({width,height,format:'rgba8unorm',rowOrder:'top-to-bottom',pixels:new Uint8Array(width*height*4).fill(9)});
function native({width=2,height=2,read}={}) {
 let state='open',calls=0;
 const base=Object.freeze({get capability(){return 17;},targetExtent(){return {width,height,format:'rgba8unorm'};},
  readback(){calls++;return read?read():Promise.resolve(image(width,height));},close(){state='closed';},getStats(){return {state,resources:state==='closed'?0:1};}});
 return {base,get calls(){return calls;}};
}
let checks=0;
const check=(name,fn)=>Promise.resolve().then(fn).then(()=>{checks++;console.log('PASS '+name);});
await check('oversize rejected before GPU readback/allocation',async()=>{const n=native({width:513});const r=createReadbackPresentation(n.base);await assert.rejects(r.present({},1,null,()=>{}),/512x512/);assert.equal(n.calls,0);r.close();});
await check('close during readback prevents late display',async()=>{let resolve;const n=native({read:()=>new Promise(r=>resolve=r)}),r=createReadbackPresentation(n.base);let shown=0;const p=r.present({},1,null,()=>shown++);r.close();resolve(image());await assert.rejects(p,/cancelled/);assert.equal(shown,0);assert.equal(r.getStats().readbackPresentation.canvasBytes,0);assert.equal(r.getStats().resources,0);});
await check('forget during readback prevents resurrection',async()=>{let resolve;const r=createReadbackPresentation(native({read:()=>new Promise(r=>resolve=r)}).base);const p=r.present({},3,null,()=>assert.fail('late frame'));r.forgetSurface(3);resolve(image());await assert.rejects(p,/cancelled/);assert.equal(r.getStats().readbackPresentation.surfaces,0);r.close();});
await check('sink throw closes exactly owned bitmap',async()=>{const r=createReadbackPresentation(native().base);let bitmap;await assert.rejects(r.present({},1,null,b=>{bitmap=b;throw Error('sink broke');}),/sink broke/);assert.equal(bitmap.closed,1);r.close();assert.equal(r.getStats().readbackPresentation.surfaces,0);});
await check('invalid returned layout cannot reach canvas',async()=>{const r=createReadbackPresentation(native({read:()=>Promise.resolve({...image(),rowOrder:'bottom-to-top'})}).base);const before=canvases.length;await assert.rejects(r.present({},1,null,()=>assert.fail('bad frame')),/pixel layout/);assert.equal(canvases.length,before);r.close();});
await check('single in-flight frame enforced before readback',async()=>{let resolve;const n=native({read:()=>new Promise(r=>resolve=r)}),r=createReadbackPresentation(n.base);const p=r.present({},1,null,b=>b.close());await assert.rejects(r.present({},2,null,()=>{}),/in-flight/);assert.equal(n.calls,1);resolve(image());await p;r.close();});
await check('surface budget and cleanup bound CPU stores',async()=>{const r=createReadbackPresentation(native().base);for(let i=0;i<16;i++)await r.present({},i,null,b=>b.close());await assert.rejects(r.present({},16,null,()=>{}),/surface budget/);assert.equal(r.getStats().readbackPresentation.surfaces,16);r.close();assert.equal(r.getStats().readbackPresentation.canvasBytes,0);});
await check('attached/private switch releases previous store',async()=>{const r=createReadbackPresentation(native().base),attached=new Canvas(2,2);await r.present({},1,attached,b=>assert.equal(b,null));await r.present({},1,null,b=>b.close());assert.equal(attached.width,0);assert.equal(attached.height,0);assert.equal(r.getStats().readbackPresentation.attachedFrames,1);assert.equal(r.getStats().readbackPresentation.bitmapFrames,1);r.close();});
await check('delegated capabilities and read-only snapshots preserved',async()=>{const r=createReadbackPresentation(native().base);assert.equal(r.capability,17);assert(Object.isFrozen(r));assert(Object.isFrozen(r.getStats().readbackPresentation));r.close();});
await check('wrong backend contract rejected before acquisition',async()=>{let requested=0,closed=0;const report=await serveGPU({close(){closed++;}},{gpu:{requestAdapter(){requested++;}},allowGraphics:true,allowLargeColorTargets:true,allowWebGL:true,presentSink(){},graphicsPresentation:'readback-2d'});assert.match(report.error,/no fallback/);assert.equal(requested,0);assert.equal(closed,1);});
await check('unknown presentation mode fails closed',async()=>{let requested=0;const report=await serveGPU({close(){}},{gpu:{requestAdapter(){requested++;}},graphicsPresentation:'guess'});assert.match(report.error,/unknown graphics presentation/);assert.equal(requested,0);});
console.log(JSON.stringify({pass:true,checks,scope:'stubbed ownership/cancellation and explicit-backend rejection; no native GPU acceptance'}));
