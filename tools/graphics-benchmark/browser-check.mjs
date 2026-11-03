// Usage: node browser-check.mjs <short disk-backed scratch> <url> [result global]
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {readHostNproc} from '../guest-rootfs/firefox-host-cpus.mjs';
const [scratch,inputUrl,resultGlobal='graphicsResults']=process.argv.slice(2);
let url=inputUrl;
if(!scratch||!url||!/^\w+$/.test(resultGlobal))throw Error('scratch URL and simple result global required');
const run=fs.mkdtempSync(path.join(path.resolve(scratch),'br-'));
if(run.length>65)throw Error('scratch path too long for Chromium Unix sockets');
const inputs={};let server;
if(process.env.GRAPHICS_ISOLATED==='1'){
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../web');
 const cached=new Map();
 const overrides=[['/linux/dist/guest-gl-remote.js',process.env.GRAPHICS_GL_OVERRIDE],['/linux/dist/guest-jit.js',process.env.GRAPHICS_JIT_OVERRIDE],[new URL(inputUrl).pathname,process.env.GRAPHICS_PAGE_OVERRIDE]];
 for(const [route,override] of overrides)if(override){const b=fs.readFileSync(override);cached.set(route,b);inputs[route]={sha256:crypto.createHash('sha256').update(b).digest('hex'),override:path.resolve(override),bytes:b.length};}
 server=http.createServer((req,res)=>{try{const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(!pathname.startsWith('/linux/'))throw Error('route');const f=path.resolve(root,'.'+pathname);if(!f.startsWith(root+'/'))throw Error('path');let b=cached.get(pathname);if(!b){b=fs.readFileSync(f);cached.set(pathname,b);inputs[pathname]={sha256:crypto.createHash('sha256').update(b).digest('hex'),bytes:b.length};}inputs[pathname].requests=(inputs[pathname].requests??0)+1;const type=/\.m?js$/.test(pathname)?'text/javascript':pathname.endsWith('.html')?'text/html':pathname.endsWith('.json')?'application/json':pathname.endsWith('.wasm')?'application/wasm':'application/octet-stream';res.writeHead(200,{'Content-Type':type,'Content-Length':b.length,'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin','Cache-Control':'no-store'});res.end(b);}catch{res.writeHead(404);res.end('Not found');}});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const selected=new URL(url);url='http://127.0.0.1:'+server.address().port+selected.pathname+selected.search;
}
const browser=process.env.CHROMIUM??'/home/a/.local/archpkg/pacman/usr/bin/chromium';
const prime=process.env.PRIME_RUN??'/usr/bin/prime-run';
const angle=process.env.GRAPHICS_ANGLE??'vulkan';
if(!['vulkan','gl'].includes(angle))throw Error('GRAPHICS_ANGLE must be explicit vulkan or gl');
const viewport=process.env.GRAPHICS_VIEWPORT?.split('x').map(Number)??null;
if(viewport&&(viewport.length!==2||viewport.some((n,i)=>!Number.isInteger(n)||n<(i?240:320)||n>4096)))throw Error('invalid GRAPHICS_VIEWPORT');
const args=['--ignore-gpu-blocklist',`--use-angle=${angle}`,'--use-gl=angle',...(angle==='vulkan'?['--enable-features=Vulkan,VulkanFromANGLE,DefaultANGLEVulkan']:[]),'--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-sync','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0',`--user-data-dir=${run}/p`,`--disk-cache-dir=${run}/c`,`--window-size=${(viewport??[800,600]).join(',')}`,'about:blank'];
const observedOwnerCpus=readHostNproc();
// The host controller caps browser owners at 3 CPUs; never bypass that policy.
const cpus=Math.min(observedOwnerCpus,Number(process.env.GRAPHICS_CPUS??3));
if(!Number.isInteger(cpus)||cpus<1)throw Error('invalid requested CPU count');
const allowed=fs.readFileSync('/proc/self/status','utf8').match(/^Cpus_allowed_list:\s*(.+)$/m)[1].split(',').flatMap(x=>{const [a,b]=x.split('-').map(Number);return Array.from({length:(b??a)-a+1},(_,i)=>a+i);});
if(cpus<1||cpus>allowed.length)throw Error('invalid effective CPU allocation');
const affinity=allowed.slice(0,cpus).join(',');
const log=fs.openSync(`${run}/browser.log`,'w');
const child=spawn('/usr/bin/taskset',['-c',affinity,prime,browser,...args],{detached:true,stdio:['ignore',log,log],env:{...process.env,DISPLAY:process.env.DISPLAY??':0',TMPDIR:run,TMP:run,TEMP:run,XDG_CACHE_HOME:`${run}/x`}});fs.closeSync(log);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const result={url,run,started:new Date().toISOString(),errors:[],console:[],flags:args,cpus,affinity,observedOwnerCpus,inputs};
let socket,status=1,send;
function processIdentity(pid){try{const s=fs.readFileSync(`/proc/${pid}/stat`,'utf8');const f=s.slice(s.lastIndexOf(')')+2).split(' ');return {start:f[19],pgrp:Number(f[2])};}catch{return null;}}
const identity=processIdentity(child.pid);
try{
 let port;
 for(let k=0;k<150&&!port;k++){if(child.exitCode!==null)throw Error('browser exited '+child.exitCode);try{port=Number(fs.readFileSync(`${run}/p/DevToolsActivePort`,'utf8').split('\n')[0]);}catch{}if(!port)await sleep(100);}
 if(!port)throw Error('browser did not open DevTools');
 const pages=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();const page=pages.find(t=>t.type==='page');if(!page)throw Error('no owned page');
 socket=new WebSocket(page.webSocketDebuggerUrl);await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j;});
 let next=0;const waiting=new Map();
 socket.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const item=waiting.get(m.id);if(item){clearTimeout(item.timer);waiting.delete(m.id);m.error?item.reject(Error(m.error.message)):item.resolve(m.result);}}else if(m.method==='Runtime.exceptionThrown'){result.errors.push(m.params.exceptionDetails?.exception?.description??m.params.exceptionDetails?.text??'page exception');}else if(m.method==='Runtime.consoleAPICalled'&&result.console.length<100){result.console.push(m.params.args.map(a=>a.value??a.description).join(' ').slice(0,1500));}};
 send=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;const timer=setTimeout(()=>{waiting.delete(id);reject(Error('CDP deadline '+method));},10000);waiting.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
 await send('Runtime.enable');await send('Page.enable');
 if(viewport)await send('Emulation.setDeviceMetricsOverride',{width:viewport[0],height:viewport[1],deviceScaleFactor:1,mobile:false});
 const nav=await send('Page.navigate',{url});if(nav.errorText)throw Error('navigation '+nav.errorText);
 if(process.env.GRAPHICS_TEST_HOOK){const hook=await import(pathToFileURL(path.resolve(process.env.GRAPHICS_TEST_HOOK)).href);await hook.run({send,result,url,cpus});}
 for(let k=0;k<400;k++){
  const r=await send('Runtime.evaluate',{expression:`({result:window.${resultGlobal}??null,text:document.getElementById('out')?.textContent??'',href:location.href,ua:navigator.userAgent,cpus:navigator.hardwareConcurrency,viewport:[innerWidth,innerHeight,devicePixelRatio]})`,returnByValue:true});
  result.page=r.result?.value??null;
  if(result.page?.cpus!==cpus)throw Error('browser/owner CPU count mismatch '+JSON.stringify({owner:cpus,browser:result.page?.cpus}));
  if(result.page?.result?.done||/ALL PASSED|FAILED/.test(result.page?.text??''))break;
  if(result.errors.length)break;
  await sleep(100);
 }
 const shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(`${run}/screen.png`,Buffer.from(shot.data,'base64'));result.screenshot=`${run}/screen.png`;
 const data=result.page?.result;status=data?(data.pass?0:1):(/ALL PASSED/.test(result.page?.text??'')?0:1);
 if(result.errors.length)status=1;
}catch(e){result.errors.push(String(e));}
finally{
 result.ended=new Date().toISOString();result.pass=status===0;
 fs.writeFileSync(`${run}/result.json`,JSON.stringify(result,null,2)+'\n');
 if(send)try{await send('Browser.close');}catch{}
 socket?.close();
 if(server)await new Promise(r=>server.close(r));
 for(let k=0;k<30&&child.exitCode===null;k++)await sleep(100);
 const current=processIdentity(child.pid);
 if(current&&identity&&current.start===identity.start&&current.pgrp===child.pid){try{process.kill(-child.pid,'SIGTERM');}catch{}}
 console.log(JSON.stringify({pass:result.pass,run,errors:result.errors,result:result.page?.result??result.page?.text??null}));
}
process.exit(status);
