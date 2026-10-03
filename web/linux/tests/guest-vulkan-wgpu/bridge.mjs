// The protocol adapter validates descriptors; Rust wgpu owns every GPU object.
import { GRAPHICS_LIMITS, GraphicsRendererError, validatePipelineDescriptor, validateTargetDescriptor } from '../guest-vulkan-graphics/renderer.mjs';
const bad = message => { throw new GraphicsRendererError(message); };
const integer = (v,min,max,label) => {if(!Number.isSafeInteger(v)||v<min||v>max)bad(label);return v;};
let initialized;
export async function createWgpuRenderer({backend='auto',forceFallbackAdapter=false}={}) {
  const module=await import('./candidate/guest_vulkan_wgpu_host.js');
  initialized ??= module.default(); await initialized;
  const native=await module.Renderer.create(backend,forceFallbackAdapter);
  const adapter=JSON.parse(native.adapter_info()), resources=new Map();let recording=null,closed=false,bytes=0;
  const get=(id,kind)=>{if(closed)bad('renderer closed');const r=resources.get(id);if(!r||r.kind!==kind)bad('foreign/stale resource');return r;};
  const add=(id,kind,descriptor,size=0)=>{resources.set(id,{kind,descriptor,size});bytes+=size;return id;};
  const budget=size=>{if(resources.size>=64||bytes+size>GRAPHICS_LIMITS.maxBytes)bad('resource budget exceeded');};
  const call=async f=>{try{return await f();}catch(error){throw new GraphicsRendererError(String(error.message),'gpu');}};
  return Object.freeze({adapter,limits:Object.freeze({...GRAPHICS_LIMITS,maxStride:adapter.maxVertexStride}),integerViewport:adapter.integerViewport,
    pipelineUniforms(id){get(id,'pipeline');return [];},
    getStats(){return {...JSON.parse(native.stats()),state:closed?'closed':'open',allocatedBytes:bytes,recordingDraws:recording?.draws.length??0};},
    async createPipeline(input){const d=validatePipelineDescriptor(input);if(d.vertexBuffers.some(v=>v.stride>adapter.maxVertexStride))bad("vertex stride exceeds wgpu backend limit");budget(0);return add(await call(()=>native.create_pipeline(JSON.stringify(d))),'pipeline',d);},
    async createVertexBuffer(input){const size=integer(input.size,4,65536,'buffer size');if(size%4)bad('buffer alignment');budget(size);return add(await call(()=>native.create_buffer(size)),'buffer',{size},size);},
    async uploadVertexBuffer(id,offset,data){const r=get(id,'buffer');integer(offset,0,r.size,'upload offset');if(!(data instanceof Uint8Array)||!data.length||data.length%4||offset%4||offset+data.length>r.size)bad('upload range');await call(()=>native.upload(id,offset,data.slice()));},
    async createTarget(input){const d=validateTargetDescriptor(input);const size=d.width*d.height*4;budget(size);return add(await call(()=>native.create_target(d.width,d.height)),'target',d,size);},
    begin(input){if(recording)bad('pass already recording');get(input.target,'target');if(!['load','clear'].includes(input.loadOp)||input.storeOp!=='store')bad('attachment operations');if(input.loadOp==='clear'&&(!Array.isArray(input.clearColor)||input.clearColor.length!==4||input.clearColor.some(n=>!Number.isFinite(n)||n<0||n>1)))bad('clear color');recording={...input,draws:[]};},
    draw(input){if(!recording)bad('draw outside pass');if(recording.draws.length>=256)bad('draw budget');const p=get(input.pipeline,'pipeline').descriptor,t=get(recording.target,'target').descriptor;
      const count=integer(input.vertexCount,3,65536,'vertex count'),first=integer(input.firstVertex??0,0,65536,'first vertex');if(count%3||(input.instanceCount??1)!==1||(input.firstInstance??0)!==0)bad('unsupported draw');
      if(!Array.isArray(input.vertexBuffers)||input.vertexBuffers.length!==p.vertexBuffers.length)bad('vertex bindings');
      const bindings=input.vertexBuffers.map((b,i)=>{const r=get(b.buffer,'buffer'),offset=integer(b.offset??0,0,r.size,'binding offset'),size=integer(b.size??r.size-offset,1,r.size-offset,'binding size');const layout=p.vertexBuffers[i],extent=Math.max(...layout.attributes.map(a=>a.offset+Number(a.format.slice(-1))*4));if(offset%4||size%4||(first+count-1)*layout.stride+extent>size)bad('binding range');return {buffer:b.buffer,offset,size};});
      const rect=(input,viewport)=>{const d=input??{x:0,y:0,width:t.width,height:t.height,...(viewport?{minDepth:0,maxDepth:1}:{})};for(const k of ['x','y','width','height'])if(!Number.isFinite(d[k])||(!viewport&&!Number.isInteger(d[k])))bad('rectangle');if(d.x<0||d.y<0||d.width<=0||d.height<=0||d.x+d.width>t.width||d.y+d.height>t.height)bad('rectangle range');if(viewport&&adapter.integerViewport&&['x','y','width','height'].some(k=>!Number.isInteger(d[k])))bad('integer viewport required');if(viewport&&(d.minDepth!==0||d.maxDepth!==1))bad('depth range');return d;};
      recording.draws.push({...input,vertexBuffers:bindings,firstVertex:first,vertexCount:count,viewport:rect(input.viewport,true),scissor:rect(input.scissor,false)});},
    abort(){recording=null;},
    async end(){if(!recording)bad('no pass');const pass=recording;recording=null;await call(()=>native.render(JSON.stringify(pass)));},
    async readback(id){const t=get(id,'target').descriptor;const pixels=await call(()=>native.readback(id));return {...t,pixels:new Uint8Array(pixels),rowOrder:'top-to-bottom'};},
    destroy(id){const r=resources.get(id);if(!r)bad('unknown resource');native.destroy(id);resources.delete(id);bytes-=r.size;},
    close(){if(!closed){native.close();resources.clear();bytes=0;closed=true;recording=null;}}
  });
}
