// Fixture-only fault injection around the existing renderer. No accepted runtime
// imports this file; the shared guest-gpu protocol keeps its default behavior.
import {serveGPU, OP, decodeHeader} from '../guest-gpu/host.mjs';

export async function serveLifecycle(connection, mode, onEvent) {
  const ownership = {devicesCreated:0, devicesDestroyed:0, connectionsClosed:0,
    texturesCreated:0, texturesDestroyed:0, buffersCreated:0, buffersDestroyed:0};
  const fault = {mode, injected:false, clearCompleted:0, readbackRequests:0,
    nativeDeviceLost:false, readbackMapStarted:false};
  let closed=false, nativeDevice, destroyDevice;
  let headerPhase=true, expectedLength=16;
  const transport = {
    async readExactly(size) {
      if(size !== expectedLength)throw Error('fixture transport framing mismatch');
      const bytes = await connection.readExactly(size);
      let header;
      if(headerPhase && bytes.length === 16)header=decodeHeader(bytes,true);
      if(headerPhase) {headerPhase=false;expectedLength=header?.length ?? 0;}
      else {headerPhase=true;expectedLength=16;}
      if(header?.opcode === OP.READBACK) {
        fault.readbackRequests++;
        if(mode === 'loss-transport') {
          if(fault.clearCompleted !== 1 || fault.injected) throw Error('invalid transport injection boundary');
          fault.injected=true;
          onEvent({type:'fault',mode,boundary:'readback-header-after-completed-clear',clearCompleted:fault.clearCompleted});
          transport.close();
          throw Error('fixture transport loss after completed clear');
        }
      }
      return bytes;
    },
    write: bytes => connection.write(bytes),
    close() { if(!closed) { closed=true; ownership.connectionsClosed++; connection.close(); } },
  };
  function trackResource(object, kind) {
    ownership[kind+'Created']++;
    let destroyed=false;
    const originalDestroy=object.destroy.bind(object);
    Object.defineProperty(object,'destroy',{value:() => {
      if(!destroyed) { destroyed=true; ownership[kind+'Destroyed']++; originalDestroy(); }
    }});
    if(kind === 'buffers' && mode === 'loss-device') {
      const originalMap=object.mapAsync.bind(object);
      Object.defineProperty(object,'mapAsync',{value:async (...args) => {
        if(fault.clearCompleted !== 1 || fault.readbackRequests !== 1 || fault.injected)
          throw Error('invalid device injection boundary');
        fault.readbackMapStarted=true;
        // Attach the rejection handler before destroying the actual device.
        const mapping=originalMap(...args).then(() => null,error => error);
        fault.injected=true;
        onEvent({type:'fault',mode,boundary:'readback-map-after-copy-submit',clearCompleted:fault.clearCompleted});
        destroyDevice();
        const lost=await nativeDevice.lost;
        fault.nativeDeviceLost=true;fault.nativeDeviceLostReason=lost.reason;
        await mapping;
        throw Error('fixture native device loss during readback');
      }});
    }
    return object;
  }
  const nativeGPU=navigator.gpu;
  const gpu=mode === 'unavailable' ? null : nativeGPU && {
    async requestAdapter(options) {
      const adapter=await nativeGPU.requestAdapter(options);
      if(!adapter)return null;
      return {info:adapter.info,isFallbackAdapter:adapter.isFallbackAdapter,
        async requestDevice(descriptor) {
          const device=nativeDevice=await adapter.requestDevice(descriptor);ownership.devicesCreated++;
          let destroyed=false;
          destroyDevice=() => {if(!destroyed){destroyed=true;ownership.devicesDestroyed++;device.destroy();}};
          return new Proxy(device,{get(target,key) {
            if(key === 'destroy')return destroyDevice;
            if(key === 'createTexture')return (...args) => trackResource(target.createTexture(...args),'textures');
            if(key === 'createBuffer')return (...args) => trackResource(target.createBuffer(...args),'buffers');
            const value=Reflect.get(target,key,target);return typeof value === 'function'?value.bind(target):value;
          }});
        },
      };
    },
  };
  const event=entry => {
    if(entry.type === 'command' && entry.opcode === OP.CLEAR && entry.status === 0)fault.clearCompleted++;
    onEvent(entry);
  };
  const result=await serveGPU(transport,{gpu,timeoutMs:60000,
    allowClear:['clear','loss-transport','loss-device','exhaustion'].includes(mode),onEvent:event});
  ownership.liveDevices=ownership.devicesCreated-ownership.devicesDestroyed;
  ownership.liveTextures=ownership.texturesCreated-ownership.texturesDestroyed;
  ownership.liveBuffers=ownership.buffersCreated-ownership.buffersDestroyed;
  return {...result,ownership,fault};
}
