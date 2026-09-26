import {serveGPU} from '../guest-gpu/host.mjs';
export async function serveCompute(connection, mode, onEvent) {
  if(mode!=='compute')throw Error('unsupported compute fixture mode');
  const ownership={devicesCreated:0,devicesDestroyed:0,buffersCreated:0,buffersDestroyed:0,connectionsClosed:0};
  let connectionClosed=false;
  const nativeGPU=navigator.gpu;
  const gpu=nativeGPU&&{async requestAdapter(options){
    const adapter=await nativeGPU.requestAdapter(options);if(!adapter)return null;
    return {info:adapter.info,isFallbackAdapter:adapter.isFallbackAdapter,async requestDevice(descriptor){
      const device=await adapter.requestDevice(descriptor);ownership.devicesCreated++;
      let destroyed=false;
      return new Proxy(device,{get(target,key){
        if(key==='destroy')return ()=>{if(!destroyed){destroyed=true;ownership.devicesDestroyed++;target.destroy();}};
        if(key==='createBuffer')return (...args)=>{
          const buffer=target.createBuffer(...args);ownership.buffersCreated++;let released=false;
          const destroy=buffer.destroy.bind(buffer);
          Object.defineProperty(buffer,'destroy',{value:()=>{if(!released){released=true;ownership.buffersDestroyed++;destroy();}}});
          return buffer;
        };
        const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
      }});
    }};
  }};
  const transport={readExactly:n=>connection.readExactly(n),write:b=>connection.write(b),close(){
    if(!connectionClosed){connectionClosed=true;ownership.connectionsClosed++;connection.close();}
  }};
  const result=await serveGPU(transport,{gpu,allowCompute:true,timeoutMs:90000,onEvent,
    translatorOptions:{url:new URL('./translator/candidate/translator.wasm',import.meta.url),sha256:'e4a7cadc55a68b712eb9b56758fd7624860cecc9f4da6ada8ac7928c61455fea'}});
  ownership.liveDevices=ownership.devicesCreated-ownership.devicesDestroyed;
  ownership.liveBuffers=ownership.buffersCreated-ownership.buffersDestroyed;
  return {...result,ownership};
}
