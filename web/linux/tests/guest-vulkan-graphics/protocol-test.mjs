import {MAGIC,VERSION,OP,decodeHeader,serveGPU} from '../guest-gpu/host.mjs';
const report=window.graphicsProtocolTests={pass:false,checks:0,errors:[],rounds:[],rejections:[],
  scope:'Real Worker/WebGPU through byte protocol; no guest execution or physical GPU claim',
  ownership:{workersCreated:0,workersTerminated:0,devicesCreated:0,devicesDestroyed:0,buffersCreated:0,buffersDestroyed:0,texturesCreated:0,texturesDestroyed:0,submits:0}};
const check=(ok,label)=>{report.checks++;if(!ok)throw Error(label);};
const encoder=new TextEncoder(),decoder=new TextDecoder();
const json=value=>encoder.encode(JSON.stringify(value));
const u32=(...values)=>{const b=new Uint8Array(values.length*4),v=new DataView(b.buffer);values.forEach((n,i)=>v.setUint32(i*4,n,true));return b;};
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
function pipe(){let chunks=[],size=0,closed=false,waiters=[];return{
  put(bytes){if(closed)return;chunks.push(bytes.slice());size+=bytes.length;waiters.splice(0).forEach(fn=>fn());},
  async readExactly(n){while(size<n&&!closed)await new Promise(resolve=>waiters.push(resolve));const out=new Uint8Array(Math.min(n,size));let offset=0;
    while(offset<out.length){const chunk=chunks[0],count=Math.min(chunk.length,out.length-offset);out.set(chunk.subarray(0,count),offset);offset+=count;size-=count;
      if(count===chunk.length)chunks.shift();else chunks[0]=chunk.subarray(count);}return out;},
  close(){closed=true;waiters.splice(0).forEach(fn=>fn());}
};}
const sessions=[];
function harness(options){const incoming=pipe(),outgoing=pipe();let sequence=0;
  const serving=serveGPU({readExactly:n=>incoming.readExactly(n),write:async bytes=>outgoing.put(bytes),close(){incoming.close();outgoing.close();}},options);
  const h={serving,stop(){incoming.close();outgoing.close();},async call(op,payload=new Uint8Array()){
    const header=new Uint8Array(16),v=new DataView(header.buffer);v.setUint32(0,MAGIC,true);v.setUint16(4,VERSION,true);v.setUint16(6,op,true);v.setUint32(8,++sequence,true);v.setUint32(12,payload.length,true);
    incoming.put(header.subarray(0,5));incoming.put(header.subarray(5));incoming.put(payload.subarray(0,3));incoming.put(payload.subarray(3));
    const reply=await outgoing.readExactly(16);check(reply.length===16,'complete reply header');const rv=new DataView(reply.buffer);
    check(rv.getUint32(0,true)===MAGIC&&rv.getUint16(4,true)===VERSION&&rv.getUint16(6,true)===(op|0x8000)&&rv.getUint32(8,true)===sequence,'reply identity');
    const length=rv.getUint32(12,true);check(length>=4&&length<=1048580,'bounded reply');const body=await outgoing.readExactly(length);check(body.length===length,'complete reply');
    return {status:new DataView(body.buffer).getInt32(0,true),body:body.subarray(4)};
  }};sessions.push(h);return h;
}
const positions=[[-.8,-.7],[.2,-.6],[-.5,.6]],width=73,height=51;
const layouts={interleaved:[{stride:20,attributes:[{location:0,offset:0,format:'float32x2'},{location:1,offset:8,format:'float32x3'}]}],
  separate:[{stride:8,attributes:[{location:0,offset:0,format:'float32x2'}]},{stride:12,attributes:[{location:1,offset:0,format:'float32x3'}]}]};
function oracle(bytes,vertex,fragment){check(bytes.length===width*height*4,'packed readback');
  const tri=positions.map(([x,y])=>{if(vertex==='b'){x=x*.5+.25;y=y*.75-.1;}return [(x+1)*width/2,(y+1)*height/2];});
  const [[ax,ay],[bx,by],[cx,cy]]=tri,denominator=(by-cy)*(ax-cx)+(cx-bx)*(ay-cy);let inside=0,outside=0;
  for(let y=2;y<height;y+=4)for(let x=2;x<width;x+=4){const a=((by-cy)*(x+.5-cx)+(cx-bx)*(y+.5-cy))/denominator;
    const b=((cy-ay)*(x+.5-cx)+(ax-cx)*(y+.5-cy))/denominator,m=Math.min(a,b,1-a-b);if(m>-.12&&m<.09)continue;
    const expected=m>=.09?(fragment==='a'?[255,0,0,255]:[0,0,255,255]):[0,255,0,255];m>=.09?inside++:outside++;
    check(expected.every((n,i)=>n===bytes[(y*width+x)*4+i]),`shader-dependent pixel ${vertex}/${fragment} ${x},${y}`);}
  check(inside>=2&&outside>=20,'independent interior/exterior oracle');return {inside,outside};
}
document.querySelector('#run').onclick=async()=>{
  document.querySelector('#run').disabled=true;
  const NativeWorker=globalThis.Worker,workers=new Set(),devices=new Set(),buffers=new Set(),textures=new Set(),counts=report.ownership;
  const tracked=(object,set,kind)=>{set.add(object);counts[kind+'Created']++;const destroy=object.destroy.bind(object);object.destroy=()=>{if(set.delete(object)){counts[kind+'Destroyed']++;destroy();}};return object;};
  let cleanupDone=false;
  window.graphicsProtocolCleanup=()=>{if(cleanupDone)return;cleanupDone=true;for(const session of sessions)session.stop();
    for(const worker of workers)worker.terminate();for(const buffer of buffers)buffer.destroy();for(const texture of textures)texture.destroy();for(const device of devices)device.destroy();globalThis.Worker=NativeWorker;};
  try{
    check(crossOriginIsolated&&document.visibilityState==='visible','isolated visible browser');
    globalThis.Worker=class extends NativeWorker{constructor(...args){super(...args);workers.add(this);counts.workersCreated++;}terminate(){if(workers.delete(this)){counts.workersTerminated++;super.terminate();}}};
    const gpu={async requestAdapter(){const adapter=await navigator.gpu.requestAdapter();check(!!adapter,'real adapter');return{info:adapter.info,async requestDevice(){
      const device=tracked(await adapter.requestDevice(),devices,'devices');const createBuffer=device.createBuffer.bind(device),createTexture=device.createTexture.bind(device),submit=device.queue.submit.bind(device.queue);
      device.createBuffer=(...args)=>tracked(createBuffer(...args),buffers,'buffers');device.createTexture=(...args)=>tracked(createTexture(...args),textures,'textures');
      device.queue.submit=(...args)=>{counts.submits++;return submit(...args);};return device;
    }};}};
    const manifestBytes=new Uint8Array(await(await fetch('./candidate/qa-inputs.json',{cache:'no-store'})).arrayBuffer());
    check(await digest(manifestBytes)==='f7a2eb74e688b6f79aa41f7a0dde28d817ad1e7bb164907727879fe5110c32cc','pinned fixture manifest');
    const manifest=JSON.parse(decoder.decode(manifestBytes)),fixtures={};report.manifestSha256=await digest(manifestBytes);
    for(const [name,item] of Object.entries(manifest.fixtures)){const bytes=new Uint8Array(await(await fetch('./candidate/'+item.url,{cache:'no-store'})).arrayBuffer());check(await digest(bytes)===item.sha256,'SPIR-V SHA '+name);fixtures[name]=bytes;}
    const header=new Uint8Array(16),headerView=new DataView(header.buffer);headerView.setUint32(0,MAGIC,true);headerView.setUint16(4,VERSION,true);headerView.setUint16(6,OP.GRAPHICS_SHADER,true);headerView.setUint32(8,1,true);
    let rejected=false;try{decodeHeader(header,true,true);}catch{rejected=true;}check(rejected,'graphics disabled by default');
    check(decodeHeader(header,false,false,true).opcode===OP.GRAPHICS_SHADER,'explicit graphics header profile');
    const h=harness({gpu,allowGraphics:true,graphicsTranslatorOptions:{url:new URL('./candidate/translator.wasm',location.href),sha256:manifest.translator.sha256}});
    const ok=async(op,payload)=>{const r=await h.call(op,payload);check(r.status===0,`success ${op}: ${decoder.decode(r.body).slice(0,100)}`);return r.body;};
    const reject=async(op,payload,label,status=-22)=>{const before=counts.submits,r=await h.call(op,payload);check(r.status===status,label);check(counts.submits===before,'no submission on '+label);report.rejections.push({label,status:r.status});};
    const create=async(op,payload)=>{const bytes=await ok(op,payload);check(bytes.length===4,'resource ID reply');return new DataView(bytes.buffer,bytes.byteOffset,4).getUint32(0,true);};
    const hello=JSON.parse(decoder.decode(await ok(OP.HELLO)));report.adapter=hello.adapter;
    check(hello.graphicsProfile===1&&!hello.computeProfile&&!hello.clearImage,'independent capability negotiation');
    await reject(OP.COMPUTE_PIPELINE,u32(1),'compute remains disabled');await reject(OP.CLEAR,new Uint8Array(20),'legacy clear remains disabled');
    await reject(OP.GRAPHICS_SHADER,fixtures['resource.frag'],'resource shader rejection');await reject(OP.GRAPHICS_SHADER,new Uint8Array(20),'malformed shader rejection');
    await reject(OP.GRAPHICS_PIPELINE,encoder.encode('{"__proto__":{}}'),'reserved JSON key');
    const modules={};for(const name of ['pair-a.vert','pair-b.vert','pair-a.frag','pair-b.frag','mismatch.frag'])modules[name]=await create(OP.GRAPHICS_SHADER,fixtures[name]);
    const ref=name=>({shader:modules[name],entryPoint:manifest.fixtures[name].entryPoint});
    const descriptor=(vertex,fragment,layout)=>({vertex:ref(`pair-${vertex}.vert`),fragment:ref(`pair-${fragment}.frag`),vertexBuffers:layouts[layout]});
    await reject(OP.GRAPHICS_PIPELINE,json({...descriptor('a','a','interleaved'),vertex:{...ref('pair-a.vert'),entryPoint:'wrong'}}),'original entry point mismatch');
    await reject(OP.GRAPHICS_PIPELINE,json({...descriptor('a','a','interleaved'),vertex:ref('pair-a.frag')}),'stage mismatch');
    await reject(OP.GRAPHICS_PIPELINE,json({...descriptor('a','a','interleaved'),fragment:ref('mismatch.frag')}),'varying mismatch');
    const target=await create(OP.GRAPHICS_TARGET,u32(width,height));await reject(OP.GRAPHICS_READBACK,u32(target),'uninitialized target');
    await reject(OP.GRAPHICS_TARGET,u32(513,1),'oversize target');await reject(OP.VERTEX_BUFFER,u32(3),'misaligned vertex allocation');
    const pipelines={};for(const vertex of ['a','b'])for(const fragment of ['a','b'])for(const layout of Object.keys(layouts))pipelines[`${vertex}/${fragment}/${layout}`]=await create(OP.GRAPHICS_PIPELINE,json(descriptor(vertex,fragment,layout)));
    for(const id of Object.values(modules))await ok(OP.DESTROY,u32(id));
    await reject(OP.GRAPHICS_PIPELINE,json(descriptor('a','a','interleaved')),'destroyed shader handle');
    const interleaved=await create(OP.VERTEX_BUFFER,u32(60)),position=await create(OP.VERTEX_BUFFER,u32(24)),color=await create(OP.VERTEX_BUFFER,u32(36));
    const upload=async(id,data)=>{const bytes=new Uint8Array(new Float32Array(data).buffer),payload=new Uint8Array(12+bytes.length);payload.set(u32(id,0,bytes.length));payload.set(bytes,12);await ok(OP.VERTEX_UPLOAD,payload);};
    await upload(interleaved,positions.flatMap(([x,y])=>[x,y,1,0,0]));await upload(position,positions.flat());await upload(color,[1,0,0,1,0,0,1,0,0]);
    const badUpload=new Uint8Array(16);badUpload.set(u32(position,24,4));await reject(OP.VERTEX_UPLOAD,badUpload,'vertex upload bounds');
    const makeDraw=key=>({pipeline:pipelines[key],vertexBuffers:(key.endsWith('interleaved')?[interleaved]:[position,color]).map(buffer=>({buffer})),vertexCount:3});
    const pass=draws=>({target,loadOp:'clear',storeOp:'store',clearColor:[0,1,0,1],draws});
    const hashByProgram=new Map();let last;
    for(const [key] of Object.entries(pipelines)){const [vertex,fragment,layout]=key.split('/'),before=counts.submits;
      await ok(OP.GRAPHICS_PASS,json(pass([makeDraw(key)])));check(counts.submits===before+1,'one pass submission');last=await ok(OP.GRAPHICS_READBACK,u32(target));
      const samples=oracle(last,vertex,fragment),sha256=await digest(last),program=`${vertex}/${fragment}`;
      if(hashByProgram.has(program))check(hashByProgram.get(program)===sha256,'same shader output across layouts');else hashByProgram.set(program,sha256);
      report.rounds.push({vertex,fragment,layout,sha256,...samples});}
    check(new Set(hashByProgram.values()).size===4,'both shaders independently affect pixels');
    const valid=makeDraw('a/a/interleaved');
    await reject(OP.GRAPHICS_PASS,json(pass([valid,{...valid,vertexCount:6}])),'later draw bounds rejects whole pass');
    await reject(OP.GRAPHICS_PASS,json({...pass([valid]),unknown:true}),'unknown pass field');
    await reject(OP.GRAPHICS_PASS,json(pass([{...valid,vertexBuffers:[{buffer:target}]}])),'wrong resource kind');
    await reject(OP.GRAPHICS_PASS,json({...pass([]),draws:Array(257).fill(valid)}),'draw count limit');
    const after=await ok(OP.GRAPHICS_READBACK,u32(target));check(await digest(after)===await digest(last),'rejected passes preserve every target byte');
    await ok(OP.GRAPHICS_PASS,json({target,loadOp:'load',storeOp:'store',draws:[]}));check(await digest(await ok(OP.GRAPHICS_READBACK,u32(target)))===await digest(last),'empty load preserves every byte');
    const stale=await create(OP.VERTEX_BUFFER,u32(60));await ok(OP.DESTROY,u32(stale));await reject(OP.GRAPHICS_PASS,json(pass([{...valid,vertexBuffers:[{buffer:stale}]}])),'stale buffer');
    const extras=[]; // Twelve resources remain: eight pipelines, target, three buffers.
    for(let i=0;i<52;i++)extras.push(await create(OP.VERTEX_BUFFER,u32(4)));
    const beforeBuffers=counts.buffersCreated;await reject(OP.VERTEX_BUFFER,u32(4),'shared resource budget',-12);check(counts.buffersCreated===beforeBuffers,'budget refusal precedes native allocation');
    await ok(OP.DESTROY,u32(extras.pop()));const recovered=await create(OP.VERTEX_BUFFER,u32(4));await ok(OP.DESTROY,u32(recovered));
    await ok(OP.GRAPHICS_PASS,json(pass([valid])));oracle(await ok(OP.GRAPHICS_READBACK,u32(target)),'a','a');
    // Leave live resources deliberately: CLOSE must release them without caller help.
    await ok(OP.CLOSE);report.host=await h.serving;
    check(!report.host.error&&report.host.graphicsTranslations===5&&report.host.graphicsTranslatorsCreated===1&&report.host.graphicsTranslatorsClosed===1,'graphics session report');
    check(report.host.graphics.resources===0&&report.host.graphics.nativeObjects===0&&report.host.graphics.allocatedBytes===0,'renderer empty after session close');
    check(workers.size===0&&devices.size===0&&buffers.size===0&&textures.size===0,'independent ownership empty before emergency cleanup');
    check(counts.workersCreated===1&&counts.workersTerminated===1&&counts.devicesCreated===1&&counts.devicesDestroyed===1&&counts.buffersCreated===counts.buffersDestroyed&&counts.texturesCreated===counts.texturesDestroyed,'native ownership balanced');
    report.pass=true;document.documentElement.dataset.result='pass';
  }catch(error){report.errors.push(String(error.stack??error));document.documentElement.dataset.result='fail';}
  finally{report.ownershipBeforeEmergencyCleanup={workers:workers.size,devices:devices.size,buffers:buffers.size,textures:textures.size};window.graphicsProtocolCleanup();document.querySelector('#output').textContent=JSON.stringify(report,null,2);}
};
