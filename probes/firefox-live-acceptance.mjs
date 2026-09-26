// Task-only phased QA. Never attaches to guest workers or opens another home DB.
// boot ORIGIN OUTPUT [admin/marker.txt] | navigate OUTPUT | actions OUTPUT JSON
// collect OUTPUT | external OUTPUT allowlisted HTTP[S] URL | update OUTPUT
// FIREFOX_READY_QA=1 enables the isolated startup gate, including warm OUTPUT.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
const [phase,a,b,c]=process.argv.slice(2),boot=phase==='boot';
const readyQA=process.env.FIREFOX_READY_QA==='1';
if(!['boot','navigate','actions','collect','external','update',...(readyQA?['warm']:[])].includes(phase))throw new Error('Unknown phase');
if(phase==='external'&&!['http://example.com','https://example.com','http://www.google.com','https://www.google.com'].includes(b))throw new Error('External QA URL is not allowlisted');
const output=boot?b:a;if(!output)throw new Error('Output directory required');
await mkdir(output,{recursive:true});
const endpoint=process.env.CDP_URL||'http://127.0.0.1:9394';
const statePath=join(output,'firefox-acceptance.json');
const state=boot?{schema:1,origin:new URL(a).origin,startedAt:new Date().toISOString(),startedMs:Date.now(),markerPath:c||null,performanceComparison:'Functional acceptance and observed launch timing only; no matched public Firefox pre-change baseline exists, so no speedup ratio is claimed.',phases:[],errors:[]}:JSON.parse(await readFile(statePath));
if(readyQA){state.readinessQA=true;state.performanceComparison='Matched local startup observations only; one pair is not a timing distribution. Launch log, screenshot observation and verified interaction are distinct; no exact first-paint measurement.';state.observer='Page CDP and one-second guest log polling; no worker attachment, hooks, pause, tracing or profiler';}
if(readyQA&&boot)state.outerBrowser=(await(await fetch(endpoint+'/json/version')).json()).Browser;
const networkObservation=phase==='external'?{url:b,startedAt:new Date().toISOString(),dnsChecks:[],dnsRequests:[],webSockets:[],privacy:'Only DNS answers and WebSocket handshake/frame count/byte length metadata; no TCP payloads, cookies or headers are retained'}:null;
if(networkObservation)(state.networkObservations??=[]).push(networkObservation);
const dnsRows=new Map(),socketRows=new Map();
function observeNetwork(method,p){
  if(!networkObservation)return;
  if(method==='Network.requestWillBeSent'){
    const url=new URL(p.request.url);
    if(url.origin===state.origin&&url.pathname==='/dns'&&['example.com','www.google.com','www.bing.com'].includes(url.searchParams.get('name'))&&networkObservation.dnsRequests.length<100){const row={name:url.searchParams.get('name'),start:p.timestamp};dnsRows.set(p.requestId,row);networkObservation.dnsRequests.push(row);}
  }else if(method==='Network.responseReceived'){
    const row=dnsRows.get(p.requestId);if(row){row.status=p.response.status;row.responseMs=(p.timestamp-row.start)*1000;}
  }else if(method==='Network.loadingFailed'){
    const row=dnsRows.get(p.requestId);if(row)row.error=p.errorText;
  }else if(method==='Network.webSocketCreated'){
    const url=new URL(p.url);
    if(url.host===new URL(state.origin).host&&url.pathname==='/tcp'&&networkObservation.webSockets.length<100){const row={host:url.searchParams.get('host'),port:url.searchParams.get('port'),sentFrames:0,sentBytes:0,receivedFrames:0,receivedBytes:0};socketRows.set(p.requestId,row);networkObservation.webSockets.push(row);}
  }else{
    const row=socketRows.get(p.requestId);if(!row)return;
    if(method==='Network.webSocketHandshakeResponseReceived')row.handshakeStatus=p.response.status;
    else if(method==='Network.webSocketFrameSent'||method==='Network.webSocketFrameReceived'){
      const direction=method.endsWith('Sent')?'sent':'received',frame=p.response;
      row[direction+'Frames']++;row[direction+'Bytes']+=frame.opcode===2?Buffer.from(frame.payloadData,'base64').length:Buffer.byteLength(frame.payloadData);
    }else if(method==='Network.webSocketFrameError')row.error=String(p.errorMessage).slice(0,300);
    else if(method==='Network.webSocketClosed')row.closed=true;
  }
}
const save=()=>writeFile(statePath,JSON.stringify(state,null,2)+'\n');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const target=boot?await(await fetch(endpoint+'/json/new?about:blank',{method:'PUT'})).json():(await(await fetch(endpoint+'/json/list')).json()).find(tab=>tab.id===state.tabId);
if(!target)throw new Error('QA target is closed; do not substitute another tab');
state.tabId=target.id;await save();
const socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
let id=0,loads=0;const pending=new Map(),imageRequests=[];
function call(method,params={},timeout=20000){return new Promise((resolve,reject)=>{const n=++id,timer=setTimeout(()=>{pending.delete(n);reject(new Error(method+' timeout'));},timeout);pending.set(n,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(new Error(JSON.stringify(error)));}});socket.send(JSON.stringify({id:n,method,params}));});}
socket.onmessage=event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(p)m.error?p.reject(m.error):p.resolve(m.result);}else{observeNetwork(m.method,m.params||{});if(readyQA&&m.method==='Network.requestWillBeSent'&&/\/(?:initramfs[^/]*|vmlinux\.wasm)(?:\?|$)/.test(m.params.request.url))imageRequests.push({url:m.params.request.url,observedAt:Date.now()});if(m.method==='Runtime.exceptionThrown')state.errors.push(m.params.exceptionDetails);else if(m.method==='Page.loadEventFired')loads++;}};
async function ev(expression){await save();const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function shot(name){const result=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(join(output,name+'.png'),Buffer.from(result.data,'base64'));}
async function setupHome(){await ev(`(async()=>{const m=await import('./main.js');window.__ffQaHome=m.guestHome();if(!__ffQaHome)throw Error('Guest home is not mounted');window.__ffQaLookup=async path=>{let n=__ffQaHome.root;for(const p of path.split('/').filter(Boolean)){n=await __ffQaHome.lookup(n,p);if(!n)throw Error('Missing QA path '+path);}return n;};return true;})()`);}
async function homeRead(path){const value=await ev(`(async()=>{const node=await __ffQaLookup(${JSON.stringify(path)}),attr=await __ffQaHome.getattr(node);if(Number(attr.size)>1048576)throw Error('QA file unexpectedly large');return [...await __ffQaHome.read(node,{},0n,Number(attr.size))];})()`);return Buffer.from(value);}
async function homeCreate(path,bytes){const parts=path.split('/'),name=parts.pop();await ev(`(async()=>{const parent=await __ffQaLookup(${JSON.stringify(parts.join('/'))}),attr=await __ffQaHome.getattr(parent);const file=await __ffQaHome.create(parent,${JSON.stringify(name)},1,{uid:attr.uid,gid:attr.gid,mode:0o644});try{await __ffQaHome.write(file.node,file.handle,0n,new Uint8Array(${JSON.stringify([...bytes])}));await __ffQaHome.fsync(file.node,file.handle);}finally{await __ffQaHome.release(file.node,file.handle);}return true;})()`);}
async function readyObservation(label){
  const current=await bootState(),configuration=current.configuration.join('\n');
  const host=await ev(`({visibility:document.visibilityState,focus:document.hasFocus(),isolated:crossOriginIsolated,canvas:{width:document.querySelector('#fb').width,height:document.querySelector('#fb').height},backend:document.querySelector('#graphics-backend').value,actualBackend:document.querySelector('#graphics-status').textContent,activeVersion:JSON.parse(localStorage.getItem('linuxonweb.system.active.v1')||'null')?.version})`);
  const observation={label,bootStartedMs:state.bootStartedMs,timings:structuredClone(state.timings),host,configuration:current.configuration,readinessLines:current.logs.filter(line=>/\[wm-ready\]|waiting for Aurora readiness/.test(line)),imageRequests:[...imageRequests],resources:current.resources,observedMs:Date.now()-state.bootStartedMs};
  (state.bootObservations??=[]).push(observation);await save();
  if(!/boot mode=firefox, display=1280x720, cpus=2, ram=4 GB/.test(configuration)||!/Memory: \d+K\/4194240K available/.test(configuration)||!/smp: Brought up 1 node, 2 CPUs/.test(configuration))throw Error('Actual host/kernel configuration mismatch');
  if(host.visibility!=='visible'||!host.focus||!host.isolated||host.canvas.width!==1280||host.canvas.height!==720||host.backend!=='canvas2d'||host.actualBackend!=='canvas2d')throw Error('Foreground/renderer/isolation configuration mismatch');
  return observation;
}
async function seedReadyMarkers(){
  if(!state.markerPath){state.markerPath='admin/startup-ready-'+state.startedMs+'.txt';await homeCreate(state.markerPath,Buffer.from('firefox-ready-home-'+state.startedMs+'\n'));}
  state.markerSHA256=hash(await homeRead(state.markerPath));
  // Accepted packed init explicitly launches this profile. Hash its existing
  // user.js and add a QA marker there; this is profile-file persistence, not history.
  const profileFile='admin/.mozilla/firefox/http1-profile/user.js',bytes=await homeRead(profileFile);
  const markerPath='admin/.mozilla/firefox/http1-profile/startup-ready-'+state.startedMs+'.txt',marker=Buffer.from('firefox-ready-profile-'+state.startedMs+'\n');
  await homeCreate(markerPath,marker);
  state.profileFiles=[{path:profileFile,sha256:hash(bytes)},{path:markerPath,sha256:hash(marker)}];
}
async function verifyReadyFiles(){for(const file of state.profileFiles||[])if(hash(await homeRead(file.path))!==file.sha256)throw Error('Profile file lost/changed: '+file.path);}
async function bootState(){return ev(`(async()=>{const m=await import('./main.js');const logs=m.guestLogs.history.page(undefined,10000).map(row=>row.text);return {at:Date.now(),status:document.querySelector('#status').textContent,visibility:document.visibilityState,isolated:crossOriginIsolated,configuration:logs.filter(s=>/boot mode=|Memory:|smp: Brought up/.test(s)),logs,resources:performance.getEntriesByType('resource').filter(r=>/initramfs|vmlinux/.test(r.name)).map(r=>({name:r.name,duration:r.duration,transferSize:r.transferSize}))};})()`);}
async function waitLaunch(deadline){let launchedAt;
  for(;;){const current=await bootState();state.last=current;
    if(state.errors.length||current.status==='boot failed'||current.status.startsWith('stopped:')||current.logs.some(line=>line.includes('home: FAILED')))throw new Error('Guest boot failed');
    for(const [key,text]of Object.entries({kernel:'Linux version',mount:'home: persistent storage mounted',x:'display: starting Xfbdev',auroraReady:'[wm-ready] Aurora handshake ready',firefoxLaunch:'starting /bin/firefox as admin'}))if(!state.timings?.[key]&&current.logs.some(line=>line.includes(text))){state.timings??={};state.timings[key]={observedAt:Date.now(),elapsedMs:Date.now()-state.bootStartedMs};}
    if(current.logs.some(line=>line.includes('starting /bin/firefox as admin')))launchedAt??=Date.now();
    await save();if(launchedAt&&Date.now()-launchedAt>=(readyQA?1500:20000))return;
    if(Date.now()>deadline-20000)throw new Error('120-second Firefox launch observation deadline');await wait(1000);
  }
}
async function key(key,code,v,modifiers=0,type){const args={key,code,windowsVirtualKeyCode:v,nativeVirtualKeyCode:v,modifiers};if(type!=='up')await call('Input.dispatchKeyEvent',{type:'keyDown',...args});if(type!=='down')await call('Input.dispatchKeyEvent',{type:'keyUp',...args});}
async function clickGuest(x,y){const r=await ev("(()=>{const c=document.querySelector('canvas'),r=c.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,width:c.width,height:c.height}})()");const p={x:r.x+x*r.w/r.width,y:r.y+y*r.h/r.height};await call('Input.dispatchMouseEvent',{type:'mouseMoved',...p,buttons:0});await call('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',buttons:1,clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',buttons:0,clickCount:1});}
async function typeText(text){for(const ch of text){const code=/[a-z]/i.test(ch)?'Key'+ch.toUpperCase():/[0-9]/.test(ch)?'Digit'+ch:({'.':'Period','/':'Slash','-':'Minus',':':'Semicolon','_':'Minus'})[ch];if(!code)throw new Error('Unsupported QA URL character');const v=({'.':190,'/':191,'-':189,':':186,'_':189})[ch]||ch.toUpperCase().charCodeAt(0),shifted=ch===':'||ch==='_'||/[A-Z]/.test(ch);if(shifted)await key('Shift','ShiftLeft',16,1,'down');await call('Input.dispatchKeyEvent',{type:'keyDown',key:ch,code,windowsVirtualKeyCode:v,nativeVirtualKeyCode:v,text:ch,modifiers:shifted?1:0});await key(ch,code,v,shifted?1:0,'up');if(shifted)await key('Shift','ShiftLeft',16,0,'up');await wait(180);}}
try{
  await call('Page.enable');await call('Runtime.enable');await call('Page.bringToFront');
  if(networkObservation||readyQA)await call('Network.enable');
  await call('Emulation.setDeviceMetricsOverride',{width:1700,height:1100,deviceScaleFactor:1,mobile:false});
  if(boot){
    await call('Page.navigate',{url:new URL('/linux/index.html',state.origin).href});
    const deadline=Date.now()+120000;
    for(;;){if(await ev("Boolean(document.querySelector('#start-firefox')&&typeof Terminal==='function')"))break;if(Date.now()>deadline-20000)throw new Error('Page readiness deadline');await wait(250);}
    await ev("(async()=>{await import('./main.js');return true;})()");
    await ev(`document.querySelector('#ram').value='4096';document.querySelector('#cpu-cores').value='2';document.querySelector('#resolution').value='1280x720';document.querySelector('#graphics-backend').value='canvas2d';document.querySelector('#ram').dispatchEvent(new Event('change'));if(!document.querySelector('#settings-apply').disabled){document.querySelector('#settings-apply').click();document.querySelector('#restart-continue').click();}true`);
    state.bootStartedMs=Date.now();await ev("document.querySelector('#start-firefox').click();true");
    await waitLaunch(state.bootStartedMs+120000);
    if(readyQA){await readyObservation('initial');state.earlyScreenshotObservedMs=Date.now()-state.bootStartedMs;await shot('firefox-early-observation');}
    await setupHome();
    if(!state.last.configuration.some(line=>/boot mode=firefox.*cpus=2, ram=4 GB/.test(line)))throw new Error('Firefox actual configuration mismatch');
    const fixture=await readFile(new URL('../web/linux/tests/guest-js-benchmark.html',import.meta.url));state.fixtureName='runtime-qa-'+state.startedMs+'.html';state.fixturePath='admin/Downloads/'+state.fixtureName;state.fixtureSHA256=hash(fixture);
    await ev(`(async()=>{const parent=await __ffQaLookup('admin/Downloads'),attr=await __ffQaHome.getattr(parent);const file=await __ffQaHome.create(parent,${JSON.stringify(state.fixtureName)},1,{uid:attr.uid,gid:attr.gid,mode:0o644});try{await __ffQaHome.write(file.node,file.handle,0n,new Uint8Array(${JSON.stringify([...fixture])}));await __ffQaHome.fsync(file.node,file.handle);}finally{await __ffQaHome.release(file.node,file.handle);}return true;})()`);
    if(hash(await homeRead(state.fixturePath))!==state.fixtureSHA256)throw new Error('QA fixture readback mismatch');
    if(readyQA)await seedReadyMarkers();
    else if(state.markerPath)state.markerSHA256=hash(await homeRead(state.markerPath));
    state.visualAcceptance='pending screenshot review';state.launchScreenshotObservedMs=Date.now()-state.bootStartedMs;await shot('firefox-launch');
  }else{
    if(new URL(target.url).origin!==state.origin)throw new Error('QA tab origin changed');
    if(phase==='navigate'||phase==='external'){
      if(networkObservation){
        networkObservation.dnsChecks=await ev(`Promise.all(['example.com','www.google.com','www.bing.com'].map(async name=>{const response=await fetch('/dns?name='+encodeURIComponent(name),{cache:'no-store',signal:AbortSignal.timeout(5000)});let json;try{json=await response.json();}catch{}return {name,status:response.status,addresses:Array.isArray(json?.addresses)?json.addresses:null};}))`);
        await save();
      }
      // Ctrl+L also activated the outer browser's reserved accelerator in QA.
      // Use the visually observed guest address bar, then select its text.
      await clickGuest(600,130);await wait(100);
      await key('Control','ControlLeft',17,2,'down');await wait(80);await key('a','KeyA',65,2,'down');await wait(80);await key('a','KeyA',65,2,'up');await wait(80);await key('Control','ControlLeft',17,0,'up');await wait(80);
      state.navigationFocus=await ev("({hasFocus:document.hasFocus(),activeTag:document.activeElement?.tagName,activeId:document.activeElement?.id})");
      if(!state.navigationFocus.hasFocus||state.navigationFocus.activeId!=='fb')throw new Error('Host canvas lost focus; no URL was typed');
      const destination=phase==='external'?b:'file:///home/'+state.fixturePath;
      await typeText(destination);await key('Enter','Enter',13);
      if(phase==='external'){
        const observation={url:destination,requestedAt:new Date().toISOString(),pass:null,visualAcceptance:'pending root screenshot review; command completion does not establish page success'};
        (state.externalObservations??=[]).push(observation);await save();await wait(15000);
        observation.screenshot='firefox-external-'+new URL(destination).hostname.replaceAll('.','-')+'-'+(destination.startsWith('https:')?'https':'http');await shot(observation.screenshot);observation.observedAt=new Date().toISOString();
      }else{await wait(3000);if(readyQA)state.fixtureScreenshotObservedMs=Date.now()-state.bootStartedMs;await shot('firefox-fixture');}
    }else if(phase==='actions'){
      const actions=JSON.parse(b);let budget=0;if(!Array.isArray(actions)||actions.length>20)throw new Error('Bounded action list required');
      for(const action of actions){if(action.wait){budget+=action.wait;if(action.wait<0||budget>120000)throw new Error('Action wait budget exceeded');await wait(action.wait);}if(action.guest)await clickGuest(...action.guest);if(action.shot){if(!/^[a-z0-9_-]+$/i.test(action.shot))throw new Error('Invalid screenshot name');await shot(action.shot);}}
    }else if(phase==='collect'){
      await setupHome();const names=await ev("(async()=>{const n=await __ffQaLookup('admin/Downloads');return (await __ffQaHome.readdir(n,{})).map(e=>e.name);})()");
      const namesQA=names.filter(name=>/^guest-js-unspecified-\d+(?:\(\d+\))?\.json$/.test(name)&&Number(name.match(/-(\d+)/)[1])>=state.startedMs).sort();if(!namesQA.length)throw new Error('No current guest benchmark JSON download');
      const path='admin/Downloads/'+namesQA.at(-1),bytes=await homeRead(path),result=JSON.parse(bytes);
      const expected=[7998000,67982,748500,19900,1700];
      if(!result.done||!result.pass||result.error||!/Firefox\//.test(result.userAgent)||result.repetitions!==100||result.results?.length!==5||result.results.some((row,i)=>!row.correct||row.actual!==expected[i]))throw new Error('Guest benchmark acceptance failed');
      state.benchmark={path,sha256:hash(bytes),result};if(readyQA)state.interactionVerifiedObservedMs=Date.now()-state.bootStartedMs;await writeFile(join(output,'guest-js-result.json'),bytes);await shot('firefox-benchmark-complete');
    }else if(phase==='update'||phase==='warm'){
      if(!state.benchmark)throw new Error('Collect benchmark before update gate');
      state.updateStartedMs=Date.now();state.bootStartedMs=Date.now();state.timings={};
      const previousLoads=loads;
      const previousVersion=readyQA?await ev("JSON.parse(localStorage.getItem('linuxonweb.system.active.v1')||'null')?.version"):null;
      if(phase==='warm'){await ev("sessionStorage.setItem('linuxonweb.restart-mode.v1','firefox');true");await call('Page.reload');}
      else await ev("document.querySelector('[data-storage=\"update\"]').click();true");
      while(loads===previousLoads){if(Date.now()>state.updateStartedMs+100000)throw new Error('Update & restart did not reload');await wait(250);}
      if(readyQA){
        await call('Page.bringToFront');
        // Reviewed blank outer-page margin at this probe's 1700px layout.
        // Real input restores document focus after reload without guest input.
        await call('Input.dispatchMouseEvent',{type:'mousePressed',x:10,y:10,button:'left',buttons:1,clickCount:1});
        await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:10,y:10,button:'left',buttons:0,clickCount:1});
      }
      await waitLaunch(state.updateStartedMs+120000);await setupHome();
      if(hash(await homeRead(state.fixturePath))!==state.fixtureSHA256)throw new Error('Fixture lost after update');
      if(hash(await homeRead(state.benchmark.path))!==state.benchmark.sha256)throw new Error('Actual guest download lost after update');
      if(state.markerPath&&hash(await homeRead(state.markerPath))!==state.markerSHA256)throw new Error('Existing home marker lost after update');
      if(readyQA){await verifyReadyFiles();const observation=await readyObservation(phase);if(phase==='warm'&&(observation.imageRequests.length||observation.resources.length))throw Error('Warm boot requested system images');if(phase==='update'&&observation.host.activeVersion===previousVersion)throw Error('Update did not switch to a distinct image version');state[phase+'Preserved']=true;}
      else state.updatePreserved=true;
      await shot('firefox-after-'+phase);
    }
  }
  state.phases.push({phase,pass:phase==='external'?null:true,observationCompleted:true,completedAt:new Date().toISOString()});await save();console.log(JSON.stringify({phase,pass:phase==='external'?null:true,observationCompleted:true,tabId:state.tabId,timings:state.timings,fixturePath:state.fixturePath,benchmark:state.benchmark?.result.pass,updatePreserved:state.updatePreserved,visualAcceptance:phase==='external'?'pending root screenshot review':state.visualAcceptance}));
}catch(error){state.phases.push({phase,pass:false,error:String(error),at:new Date().toISOString()});await save();process.exitCode=1;console.error(String(error));}
finally{socket.close();}
