import {serveGPU} from '../guest-gpu/host.mjs';
// The independent counters observe actual native objects. No extra error scope
// surrounds the shared renderer: its device-global scopes must remain serial.
export async function serveGraphics(connection, mode, onEvent) {
  if(mode!=='graphics')throw Error('unsupported graphics fixture mode');
  const ownership={workersCreated:0,workersTerminated:0,devicesCreated:0,devicesDestroyed:0,
    buffersCreated:0,buffersDestroyed:0,texturesCreated:0,texturesDestroyed:0,connectionsClosed:0,submits:0};
  const workers=new Set(),devices=new Set(),buffers=new Set(),textures=new Set();
  const NativeWorker=globalThis.Worker,translatorWorker=new URL('./translator/worker.mjs',import.meta.url).href;
  class ObservedWorker extends NativeWorker {
    constructor(url,options){super(url,options);if(new URL(String(url),location.href).href===translatorWorker){workers.add(this);ownership.workersCreated++;}}
    terminate(){if(workers.delete(this))ownership.workersTerminated++;super.terminate();}
  }
  globalThis.Worker=ObservedWorker;
  const tracked=(object,set,kind)=>{
    set.add(object);ownership[kind+'Created']++;const destroy=object.destroy.bind(object);
    object.destroy=()=>{if(set.delete(object)){ownership[kind+'Destroyed']++;destroy();}};return object;
  };
  const nativeGPU=navigator.gpu;
  const gpu=nativeGPU&&{async requestAdapter(options){
    const adapter=await nativeGPU.requestAdapter(options);if(!adapter)return null;
    return {info:adapter.info,isFallbackAdapter:adapter.isFallbackAdapter,async requestDevice(descriptor){
      const device=tracked(await adapter.requestDevice(descriptor),devices,'devices');
      const createBuffer=device.createBuffer.bind(device),createTexture=device.createTexture.bind(device),submit=device.queue.submit.bind(device.queue);
      device.createBuffer=(...args)=>tracked(createBuffer(...args),buffers,'buffers');
      device.createTexture=(...args)=>tracked(createTexture(...args),textures,'textures');
      device.queue.submit=(...args)=>{ownership.submits++;return submit(...args);};return device;
    }};
  }};
  let connectionClosed=false,cleaned=false;
  const transport={readExactly:n=>connection.readExactly(n),write:b=>connection.write(b),close(){
    if(!connectionClosed){connectionClosed=true;ownership.connectionsClosed++;connection.close();}
  }};
  window.guestGraphicsCleanup=()=>{
    if(cleaned)return;cleaned=true;transport.close();
    for(const worker of workers)worker.terminate();for(const buffer of buffers)buffer.destroy();
    for(const texture of textures)texture.destroy();for(const device of devices)device.destroy();
    if(globalThis.Worker===ObservedWorker)globalThis.Worker=NativeWorker;
  };
  try {
    const result=await serveGPU(transport,{gpu,allowGraphics:true,timeoutMs:120000,onEvent,
      graphicsTranslatorOptions:{url:new URL('./candidate/translator.wasm',import.meta.url),sha256:'c1506c293785db309df6de17e481a9fb62ca9001823d3150f7a39cecc2575636'}});
    // Copy counters BEFORE the runner can invoke emergency cleanup.
    return {...result,ownership:{...ownership,liveWorkers:workers.size,liveDevices:devices.size,
      liveBuffers:buffers.size,liveTextures:textures.size,beforeEmergencyCleanup:!cleaned}};
  } finally {
    if(globalThis.Worker===ObservedWorker)globalThis.Worker=NativeWorker;
  }
}
