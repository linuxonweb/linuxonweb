import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {spawn,spawnSync} from 'node:child_process';
const repo=process.cwd(),run=path.resolve(process.argv[2]);
const started=performance.now();
const result={startedUtc:new Date().toISOString(),scope:'isolated NVIDIA EGL-only headless WebGL2 smoke; no hardware WebGPU, guest boot or Firefox performance claim',errors:[]};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function guard(){const g=spawnSync('python3',[path.join(repo,'tools/guest-packages/bounded.py'),'--check-tree',String(process.pid)],{encoding:'utf8',timeout:10000});const d=JSON.parse(g.stdout);if(g.status!==0||!d.valid)throw Error('shared quota preflight failed: '+g.stdout);return d;}
result.ownerQuota=guard();
const allowed=fs.readFileSync('/proc/self/status','utf8').match(/^Cpus_allowed_list:\s*(.+)$/m)[1].split(',').flatMap(x=>{const[a,b]=x.split('-').map(Number);return Array.from({length:(b??a)-a+1},(_,i)=>a+i);}).slice(0,3);
const launcher=spawnSync('which',['chromium'],{encoding:'utf8'}).stdout.trim();
const binary=path.resolve(path.dirname(launcher),'../lib/chromium/chromium');
if(!binary)throw Error('chromium absent');
const args=['--headless=new','--ignore-gpu-blocklist','--disable-features=Vulkan','--disable-extensions','--disable-component-extensions-with-background-pages','--use-gl=angle','--use-angle=gl-egl','--disable-software-rasterizer','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-sync','--disable-breakpad','--disable-crash-reporter','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0','--window-size=800,600',`--user-data-dir=${run}/profile`,`--disk-cache-dir=${run}/cache`,'about:blank'];
const gpuEnv={__EGL_VENDOR_LIBRARY_FILENAMES:'/usr/share/glvnd/egl_vendor.d/10_nvidia.json',__NV_PRIME_RENDER_OFFLOAD:'1',__GLX_VENDOR_LIBRARY_NAME:'nvidia',__VK_LAYER_NV_optimus:''};
const env={...process.env,...gpuEnv,TMPDIR:`${run}/tmp`,TMP:`${run}/tmp`,TEMP:`${run}/tmp`,XDG_CACHE_HOME:`${run}/cache`,DBUS_SESSION_BUS_ADDRESS:`unix:path=${run}/no-bus.sock`};
delete env.VK_ICD_FILENAMES;delete env.VK_DRIVER_FILES;
result.launch={binary,args,gpuEnv,affinity:allowed.join(','),privateDbus:true};
const log=fs.openSync(`${run}/browser.log`,'wx');
const browser=spawn('taskset',['-c',allowed.join(','),binary,...args],{env,stdio:['ignore',log,log]});fs.closeSync(log);
result.browserPid=browser.pid;
const server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'});res.end('<!doctype html><meta charset="utf-8"><title>Isolated GPU smoke</title><pre id="out">Headless GPU smoke</pre>');});
const sockets=[];
async function connect(url){const ws=new WebSocket(url);sockets.push(ws);await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});let seq=0;const pending=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}};return(method,params={})=>new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method));},15000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});}
let browserSend;
try{
 await new Promise((res,rej)=>{server.once('error',rej);server.listen(0,'127.0.0.1',res);});
 let port=0;
 for(let i=0;i<150&&!port;i++){if(browser.exitCode!==null)throw Error('browser exited '+browser.exitCode);try{port=Number(fs.readFileSync(`${run}/profile/DevToolsActivePort`,'utf8').split('\n')[0]);}catch{}if(!port)await sleep(100);}
 if(!port)throw Error('DevTools unavailable after 15 seconds');
 const version=await(await fetch(`http://127.0.0.1:${port}/json/version`)).json();
 result.browserVersion={Browser:version.Browser,'User-Agent':version['User-Agent'],'V8-Version':version['V8-Version']};
 browserSend=await connect(version.webSocketDebuggerUrl);
 const targets=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();
 result.initialTargets=targets.map(({type,url,title})=>({type,url,title}));
 const pages=targets.filter(t=>t.type==='page');
 if(pages.length!==1||pages[0].url!=='about:blank'||targets.some(t=>['worker','shared_worker','service_worker'].includes(t.type)))throw Error('fresh profile isolation failed');
 const send=await connect(pages[0].webSocketDebuggerUrl);
 await send('Runtime.enable');await send('Page.enable');
 result.preWorkloadQuota=guard();
 const nav=await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/`});if(nav.errorText)throw Error(nav.errorText);
 for(let i=0;i<40;i++){const r=await send('Runtime.evaluate',{expression:'document.readyState',returnByValue:true});if(r.result.value==='complete')break;await sleep(50);}
 const probe=await send('Runtime.evaluate',{awaitPromise:true,returnByValue:true,expression:`(async()=>{
 const r={cpus:navigator.hardwareConcurrency,secureContext:isSecureContext,ua:navigator.userAgent};
 const canvas=document.createElement('canvas');canvas.width=4;canvas.height=4;document.body.append(canvas);
 const gl=canvas.getContext('webgl2',{antialias:false,preserveDrawingBuffer:true});
 if(gl){const ext=gl.getExtension('WEBGL_debug_renderer_info');const pixel=new Uint8Array(4);gl.clearColor(.25,.5,.75,1);gl.clear(gl.COLOR_BUFFER_BIT);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);r.webgl={version:gl.getParameter(gl.VERSION),vendor:ext?gl.getParameter(ext.UNMASKED_VENDOR_WEBGL):gl.getParameter(gl.VENDOR),renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),pixel:[...pixel],error:gl.getError(),pass:pixel.every((v,i)=>Math.abs(v-[64,128,191,255][i])<=1)};}else r.webgl={pass:false,error:'WebGL2 context unavailable'};
 r.webgpu={skipped:true,reason:'Explicit EGL-only route; no hardware WebGPU acceptance'};
 document.querySelector('#out').textContent=JSON.stringify(r,null,2);return r;
})()`});
 if(probe.exceptionDetails)throw Error('page exception '+JSON.stringify(probe.exceptionDetails));
 result.probe=probe.result.value;
 await sleep(5200);
 result.systemInfo=await browserSend('SystemInfo.getInfo');
 result.postWorkloadQuota=guard();
 const shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(`${run}/screenshot.png`,Buffer.from(shot.data,'base64'));
 const gl=result.probe.webgl;result.hardwareWebglAcceptance=!!(gl.pass&&/NVIDIA/i.test(gl.renderer)&&!/swiftshader|llvmpipe|lavapipe/i.test(gl.renderer)&&result.probe.cpus===allowed.length);result.hardwareWebgpuAcceptance=false;result.pass=result.hardwareWebglAcceptance;
 if(!result.pass)result.errors.push('NVIDIA EGL WebGL pixel/identity acceptance incomplete');
}catch(e){result.pass=false;result.errors.push(String(e));}
finally{
 if(browserSend)try{await browserSend('Browser.close');}catch(e){result.cleanupCloseError=String(e);}
 for(const ws of sockets)ws.close();
 await new Promise(r=>server.close(r));
 for(let i=0;i<50&&browser.exitCode===null;i++)await sleep(100);
 result.browserExitCode=browser.exitCode;
 if(browser.exitCode===null){result.pass=false;result.errors.push('browser did not exit naturally; bounded owner must clean owned descendants');}
 result.finishedUtc=new Date().toISOString();result.durationSeconds=(performance.now()-started)/1000;
 fs.writeFileSync(`${run}/probe-result.json`,JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({pass:result.pass,durationSeconds:result.durationSeconds,probe:result.probe,errors:result.errors,browserExitCode:result.browserExitCode,run}));
}
process.exit(result.pass?0:1);
