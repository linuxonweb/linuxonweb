import fs from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
const T=process.env.GLIBC_TASK;
const D=process.env.GLIBC_HOST_CONTROLS_OUT || T+'/logs/host-controls';
await fs.mkdir(D);
await fs.writeFile(D+'/command.json',JSON.stringify({argv:process.argv,cwd:process.cwd(),hostABIOnly:true},null,2)+'\n');
function test({catchBytes,cleanupBytes}){
 const trap=new WebAssembly.Instance(new WebAssembly.Module(Uint8Array.from([0,97,115,109,1,0,0,0,1,4,1,96,0,0,3,2,1,0,7,8,1,4,116,114,97,112,0,0,10,5,1,3,0,0,11]))).exports.trap;
 let captured;try{trap();}catch(e){captured=e;}
 const mod=new WebAssembly.Module(Uint8Array.from(catchBytes));
 const rows=[];
 for(const [name,fn,expected] of [['symbol',()=>{throw Symbol('halt');},'caught'],['constructed-RuntimeError',()=>{throw new WebAssembly.RuntimeError('synthetic');},'caught'],['direct-trap',trap,'escaped'],['captured-real-trap-rethrow',()=>{throw captured;},'escaped']]){
  const f=new WebAssembly.Instance(mod,{env:{throw_control:fn}}).exports.catch_control;
  let outcome,error;try{outcome=f()===1?'caught':'returned';}catch(e){outcome='escaped';error={runtimeError:e instanceof WebAssembly.RuntimeError,sameCaptured:e===captured,message:e.message};}
  rows.push({name,expected,outcome,error,pass:outcome===expected});
 }

 const cmod=new WebAssembly.Module(Uint8Array.from(cleanupBytes));
 const symbol=Symbol('ordinary JS exception'),constructed=new WebAssembly.RuntimeError('unreachable');
 const tag=new WebAssembly.Tag({parameters:['i32']}),nativeException=new WebAssembly.Exception(tag,[853]);
 let secondTrap;try{trap();}catch(e){secondTrap=e;}
 for(const [name,fn,expectedCleanup,expectedIdentity] of [['C-symbol',()=>{throw symbol;},1,symbol],['C-constructed-RuntimeError',()=>{throw constructed;},1,constructed],['C-native-tag',()=>{throw nativeException;},1,nativeException],['C-direct-trap',trap,0,null],['C-captured-kernel-trap',()=>{throw captured;},0,captured],['C-captured-exec-trap',()=>{throw secondTrap;},0,secondTrap]]){
  const seen=[];let abortCalls=0,error;
  const f=new WebAssembly.Instance(cmod,{env:{throw_control:fn,record_cleanup:x=>seen.push(x),unexpected_abort:()=>{abortCalls++;throw new Error('unexpected host ABI abort');}}}).exports.c_entry;
  try{f();}catch(e){error=e;}
  rows.push({name,cleanup:seen,abortCalls,identityPreserved:expectedIdentity===null?error instanceof WebAssembly.RuntimeError:error===expectedIdentity,pass:seen.length===expectedCleanup&&seen.every(x=>x===1)&&abortCalls===0&&!!error&&(expectedIdentity===null?error instanceof WebAssembly.RuntimeError:error===expectedIdentity)});
 }
 let ordinaryTrap;try{trap();}catch(e){ordinaryTrap=e;}
 const classify=e=>e===captured?'kernel':e===secondTrap?'exec':null;
 rows.push({name:'exact-distinct-worker-local-identities',pass:captured!==secondTrap&&classify(captured)==='kernel'&&classify(secondTrap)==='exec'&&classify(ordinaryTrap)===null&&classify(constructed)===null});
 return {pass:rows.every(r=>r.pass),rows,hostABIOnly:true,abortStubNeverCalled:true};
}
const bytes={catchBytes:[...await fs.readFile(T+'/objects/catch-control.wasm')],cleanupBytes:[...await fs.readFile(T+'/objects/host-c-cleanup.wasm')]};
const node=test(bytes);await fs.writeFile(D+'/node-result.json',JSON.stringify(node,null,2)+'\n');console.log('NODE',JSON.stringify(node));
const port=Number(process.env.GLIBC_CONTROL_CDP_PORT || 9428);
if(await fetch(`http://127.0.0.1:${port}/json/version`).then(()=>true,()=>false))throw Error('CDP port already occupied');
const browserArgs=['--headless','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--remote-debugging-port='+port,'--user-data-dir='+D+'/profile','--disk-cache-dir='+D+'/cache','about:blank'];
const child=spawn(process.env.GLIBC_CHROMIUM,browserArgs,{stdio:['ignore','ignore','ignore']});
await fs.writeFile(D+'/browser-command.json',JSON.stringify({pid:child.pid,argv:[process.env.GLIBC_CHROMIUM,...browserArgs]},null,2)+'\n');
let ws;let closed=false;let exitInfo;const exited=once(child,'exit').then(x=>{closed=true;exitInfo=x;return x;});
try{
 let info;for(let i=0;i<100;i++){try{info=await fetch('http://127.0.0.1:'+port+'/json/list').then(r=>r.json());break;}catch{await new Promise(r=>setTimeout(r,100));}}
 ws=new WebSocket(info.find(x=>x.type==='page').webSocketDebuggerUrl);await once(ws,'open');
 let id=0;const waiting=new Map();ws.addEventListener('message',e=>{const r=JSON.parse(e.data);if(r.id){waiting.get(r.id)?.(r);waiting.delete(r.id);}});
 const call=(method,params)=>new Promise(r=>{const n=++id;waiting.set(n,r);ws.send(JSON.stringify({id:n,method,params}));});
 const result=await call('Runtime.evaluate',{expression:'('+test.toString()+')('+JSON.stringify(bytes)+')',returnByValue:true});
 if(result.result.exceptionDetails)throw Error(JSON.stringify(result.result.exceptionDetails));const chromium=result.result.result.value;
 await fs.writeFile(D+'/chromium-result.json',JSON.stringify(chromium,null,2)+'\n');console.log('CHROMIUM',JSON.stringify(chromium));
 await call('Browser.close',{});ws.close();await exited;if(!node.pass||!chromium.pass)process.exitCode=1;
}finally{ws?.close();if(!closed){child.kill('SIGTERM');await exited;}await fs.writeFile(D+'/browser-terminal.json',JSON.stringify({pid:child.pid,exit:exitInfo,closed},null,2)+'\n');}
