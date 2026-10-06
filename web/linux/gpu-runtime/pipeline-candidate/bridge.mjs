// The protocol adapter validates descriptors; Rust wgpu owns every GPU object.
import { GRAPHICS_LIMITS, GraphicsRendererError, validatePipelineDescriptor, validateTargetDescriptor, profileOptions, validateTranslatedShader, validateUniformBufferDescriptor, validateDrawUniforms, validateTextureDescriptor, validateTextureUpload, validateSamplerDescriptor, validateDrawTextures, validateDepthAttachment, DEPTH_FORMATS } from './graphics-renderer.mjs';
const bad = message => { throw new GraphicsRendererError(message); };
const integer = (v,min,max,label) => {if(!Number.isSafeInteger(v)||v<min||v>max)bad(label);return v;};
let initialized;
export async function createWgpuRenderer({backend='auto',forceFallbackAdapter=false,allowResources=false}={}) {
  const module=await import('./guest_vulkan_wgpu_host.js');
  initialized ??= module.default(); await initialized;
  if(typeof allowResources!=="boolean")bad("resource profile flag");
  const options=profileOptions({allowUniforms:allowResources,allowTextures:allowResources,allowDepth:allowResources});
  const native=await module.Renderer.create(backend,forceFallbackAdapter);
  const adapter=JSON.parse(native.adapter_info()), resources=new Map();let recording=null,closed=false,bytes=0;
  // Only the actual Rust implementation may advertise new pipeline semantics.
  const caps=typeof native.pipeline_capabilities==='function'?JSON.parse(native.pipeline_capabilities()):null;
  const triangleProvokingVertex=caps?.triangleProvokingVertex;
  const pipelineStateProfile=caps?.pipelineStateProfile===1&&caps?.colorWriteMaskBits===15&&
    ['first','last'].includes(triangleProvokingVertex)&&triangleProvokingVertex===(adapter.backend==='Gl'?'last':adapter.backend==='BrowserWebGpu'?'first':null)?1:0;
  const get=(id,kind)=>{if(closed)bad('renderer closed');const r=resources.get(id);if(!r||r.kind!==kind)bad('foreign/stale resource');return r;};
  const texture=id=>{const r=resources.get(id);if(!r||!(r.kind==="texture"||(allowResources&&r.kind==="target"&&r.descriptor.width<=128&&r.descriptor.height<=128)))bad("unknown sampled texture");return r;};
  const add=(id,kind,descriptor,size=0)=>{resources.set(id,{kind,descriptor,size});bytes+=size;return id;};
  const budget=size=>{if(resources.size>=64||bytes+size>GRAPHICS_LIMITS.maxBytes)bad('resource budget exceeded');};
  const call=async f=>{try{return await f();}catch(error){throw new GraphicsRendererError(String(error.message),'gpu');}};
  return Object.freeze({adapter,pipelineStateProfile,triangleProvokingVertex,supportsSampledTargets:allowResources,limits:Object.freeze({...GRAPHICS_LIMITS,maxStride:adapter.maxVertexStride}),integerViewport:adapter.integerViewport,
    pipelineUniforms(id){return get(id,'pipeline').descriptor.uniforms;},
    getStats(){return {...JSON.parse(native.stats()),state:closed?'closed':'open',allocatedBytes:bytes,recordingDraws:recording?.draws.length??0};},
    async createPipeline(input){const d=validatePipelineDescriptor(input,validateTranslatedShader,options);if(d.colorWriteMask!==15&&!pipelineStateProfile)bad('color writes not negotiated by Rust');if(d.vertexBuffers.some(v=>v.stride>adapter.maxVertexStride))bad("vertex stride exceeds wgpu backend limit");budget(0);return add(await call(()=>native.create_pipeline(JSON.stringify(d))),'pipeline',d);},
    async createVertexBuffer(input){const size=integer(input.size,4,65536,'buffer size');if(size%4)bad('buffer alignment');budget(size);return add(await call(()=>native.create_buffer(size)),'buffer',{size},size);},
    async uploadVertexBuffer(id,offset,data){const r=get(id,'buffer');integer(offset,0,r.size,'upload offset');if(!(data instanceof Uint8Array)||!data.length||data.length%4||offset%4||offset+data.length>r.size)bad('upload range');await call(()=>native.upload(id,offset,data.slice()));},
    async createUniformBuffer(input){if(!allowResources)bad('uniforms not negotiated');const d=validateUniformBufferDescriptor(input);budget(d.size);return add(await call(()=>native.create_uniform_buffer(d.size)),'uniform',d,d.size);},
    async uploadUniformBuffer(id,offset,data){const r=get(id,'uniform');integer(offset,0,r.size,'uniform offset');if(!(data instanceof Uint8Array)||!data.length||data.length%4||offset%4||offset+data.length>r.size)bad('uniform upload range');await call(()=>native.upload_uniform(id,offset,data.slice()));},
    async createTexture(input){if(!allowResources)bad('textures not negotiated');const d=validateTextureDescriptor(input),size=d.width*d.height*4;budget(size);return add(await call(()=>native.create_texture(d.width,d.height,'')),'texture',d,size);},
    async uploadTexture(id,data){const r=texture(id),copy=validateTextureUpload(r,data);await call(()=>native.upload_texture(id,copy));r.initialized=true;},
    async createSampler(input){if(!allowResources)bad('samplers not negotiated');const d=validateSamplerDescriptor(input);budget(0);return add(await call(()=>native.create_sampler(JSON.stringify(d))),'sampler',d);},
    async createDepthTarget(input){if(!allowResources)bad('depth not negotiated');if(!DEPTH_FORMATS.includes(input.format))bad('depth format');const d={...validateTargetDescriptor({width:input.width,height:input.height}),format:input.format},size=d.width*d.height*(d.format==='depth16unorm'?2:4);budget(size);return add(await call(()=>native.create_texture(d.width,d.height,d.format)),'depth',d,size);},
    async createTarget(input){const d=validateTargetDescriptor(input);const size=d.width*d.height*4;budget(size);return add(await call(()=>native.create_target(d.width,d.height,allowResources)),'target',d,size);},
    begin(input){if(recording)bad('pass already recording');get(input.target,'target');if(!['load','clear'].includes(input.loadOp)||input.storeOp!=='store')bad('attachment operations');if(input.loadOp==='clear'&&(!Array.isArray(input.clearColor)||input.clearColor.length!==4||input.clearColor.some(n=>!Number.isFinite(n)||n<0||n>1)))bad('clear color');const depth=input.depth===undefined?undefined:validateDepthAttachment(input.depth);if(depth){if(!allowResources)bad("depth not negotiated");const d=get(depth.target,"depth").descriptor,t=get(input.target,"target").descriptor;if(d.width!==t.width||d.height!==t.height)bad("depth extent mismatch");}recording={...input,...(depth?{depth}:{}),draws:[]};},
    draw(input){if(!recording)bad('draw outside pass');if(recording.draws.length>=256)bad('draw budget');const p=get(input.pipeline,'pipeline').descriptor,t=get(recording.target,'target').descriptor;
      const count=integer(input.vertexCount,3,65536,'vertex count'),first=integer(input.firstVertex??0,0,65536,'first vertex');if(count%3||(input.instanceCount??1)!==1||(input.firstInstance??0)!==0)bad('unsupported draw');
      if(!Array.isArray(input.vertexBuffers)||input.vertexBuffers.length!==p.vertexBuffers.length)bad('vertex bindings');
      const bindings=input.vertexBuffers.map((b,i)=>{const r=get(b.buffer,'buffer'),offset=integer(b.offset??0,0,r.size,'binding offset'),size=integer(b.size??r.size-offset,1,r.size-offset,'binding size');const layout=p.vertexBuffers[i],extent=Math.max(...layout.attributes.map(a=>a.offset+Number(a.format.slice(-1))*4));if(offset%4||size%4||(first+count-1)*layout.stride+extent>size)bad('binding range');return {buffer:b.buffer,offset,size};});
      const rect=(input,viewport)=>{const d=input??{x:0,y:0,width:t.width,height:t.height,...(viewport?{minDepth:0,maxDepth:1}:{})};for(const k of ['x','y','width','height'])if(!Number.isFinite(d[k])||(!viewport&&!Number.isInteger(d[k])))bad('rectangle');if(d.x<0||d.y<0||d.width<=0||d.height<=0||d.x+d.width>t.width||d.y+d.height>t.height)bad('rectangle range');if(viewport&&adapter.integerViewport&&['x','y','width','height'].some(k=>!Number.isInteger(d[k])))bad('integer viewport required');if(viewport&&(d.minDepth!==0||d.maxDepth!==1))bad('depth range');return d;};
      const uniforms=validateDrawUniforms(input.uniforms,p,allowResources,id=>get(id,"uniform")),textures=validateDrawTextures(input.textures,p,allowResources,texture,id=>get(id,"sampler"));
      if(p.depth&&(!recording.depth||get(recording.depth.target,"depth").descriptor.format!==p.depth.format))bad("pipeline depth mismatch");
      recording.draws.push({...input,...(allowResources?{uniforms,textures}:{}),vertexBuffers:bindings,firstVertex:first,vertexCount:count,viewport:rect(input.viewport,true),scissor:rect(input.scissor,false)});},
    abort(){recording=null;},
    async end(){if(!recording)bad('no pass');const pass=recording;recording=null;await call(()=>native.render(JSON.stringify(pass)));get(pass.target,"target").initialized=true;},
    async readback(id){const t=get(id,'target').descriptor;const pixels=await call(()=>native.readback(id));return {...t,pixels:new Uint8Array(pixels),rowOrder:'top-to-bottom'};},
    destroy(id){const r=resources.get(id);if(!r)bad('unknown resource');native.destroy(id);resources.delete(id);bytes-=r.size;},
    close(){if(!closed){native.close();resources.clear();bytes=0;closed=true;recording=null;}}
  });
}
