// Private authentication for an already-owned blank browser target.
// This connection never records console, network or navigation events. The normal
// owner must attach its logging connection only after this helper returns blank.
import fs from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';

const APPROVED_ORIGIN = 'https://9209ec251514cc05.5x7aqstuceku.opentunnel.xyz';
class SafeAuthError extends Error {
  constructor(code, transient=false) { super('Owned HTTPS authentication failed: '+code); this.code=code; this.transient=transient; }
}
const fail = code => { throw new SafeAuthError(code); };

export function readHttpsAuthInputs({productionBase, grantFile, targetWebSocketUrl, manifestPath='/linux/boot-manifest.json', expectedManifestSha256, expectedVersion}) {
  let base, target, record, st, grant, descriptor;
  try { base=new URL(productionBase); target=new URL(targetWebSocketUrl); } catch { fail('invalid public or owned target URL'); }
  if(base.origin!==APPROVED_ORIGIN||base.protocol!=='https:'||base.username||base.password||base.pathname!=='/'||base.search||base.hash)fail('unapproved production origin');
  if(target.protocol!=='ws:'||!['127.0.0.1','localhost'].includes(target.hostname)||!target.port||target.username||target.password||target.search||target.hash||!target.pathname.startsWith('/devtools/page/'))fail('target is not a local owned page');
  if(typeof manifestPath!=='string'||!/^\/(?:linux|desktop\/latest-build)\/[A-Za-z0-9._-]+\.json$/.test(manifestPath))fail('invalid public manifest path');
  if(!/^[0-9a-f]{64}$/.test(expectedManifestSha256||'')||typeof expectedVersion!=='string'||!expectedVersion)fail('missing approved manifest identity');
  try {
    descriptor=fs.openSync(grantFile,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
    st=fs.fstatSync(descriptor);
    if(!st.isFile()||st.isSymbolicLink()||(st.mode&0o077)!==0||st.size>16384||(typeof process.getuid==='function'&&st.uid!==process.getuid()))fail('grant file ownership or permissions');
    record=JSON.parse(fs.readFileSync(descriptor,'utf8'));
  } catch(error) { if(error instanceof SafeAuthError)throw error; fail('grant file unavailable or malformed'); }
  finally { if(descriptor!==undefined)fs.closeSync(descriptor); }
  if(!record||typeof record.path!=='string'||record.path.length>4096||!record.path.startsWith('/access/')||/[\r\n]/.test(record.path))fail('invalid private grant path');
  try { grant=new URL(record.path,base); } catch { fail('invalid private grant path'); }
  if(grant.origin!==base.origin||!grant.pathname.startsWith('/access/')||grant.pathname==='/access/'||grant.username||grant.password||grant.hash)fail('grant escapes approved origin');
  return {base, target, grantUrl:grant.href, manifestPath, expectedManifestSha256, expectedVersion};
}

export async function authenticateOwnedHttps(options) {
  const started=performance.now();
  const timeoutMs=options.timeoutMs??20000;
  if(!Number.isFinite(timeoutMs)||timeoutMs<1000||timeoutMs>30000)fail('invalid finite authentication bound');
  const deadline=started+timeoutMs, input=readHttpsAuthInputs(options);
  const shouldAbort=options.shouldAbort??(()=>false), WebSocketClass=options.WebSocketClass??WebSocket;
  let socket, sequence=0, pending=new Map(), opened=false;
  function remaining() {
    if(shouldAbort())fail('owner cancelled authentication');
    const value=deadline-performance.now();
    if(value<=0)fail('authentication deadline');
    return value;
  }
  const rejectPending=code=>{for(const item of pending.values()){clearTimeout(item.timer);item.reject(new SafeAuthError(code));}pending.clear();};
  function send(method, params={}) {
    return new Promise((resolve,reject)=>{
      let budget;
      try { budget=remaining(); if(!opened||socket.readyState!==1)fail('owned connection closed'); }
      catch(error){reject(error);return;}
      const id=++sequence, timer=setTimeout(()=>{pending.delete(id);reject(new SafeAuthError('authentication command deadline'));},budget);
      pending.set(id,{resolve,reject,timer});
      try { socket.send(JSON.stringify({id,method,params})); }
      catch { clearTimeout(timer);pending.delete(id);reject(new SafeAuthError('owned command transport')); }
    });
  }
  async function evaluate(expression) {
    const value=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    if(value.exceptionDetails)fail('browser authentication inspection');
    return value.result?.value;
  }
  async function waitFor(expression, predicate) {
    while(true) {
      remaining();
      try { if(predicate(await evaluate(expression)))return; }
      catch(error) { if(!(error instanceof SafeAuthError)||!error.transient)throw error; }
      await delay(Math.min(100,remaining()));
    }
  }
  try {
    socket=new WebSocketClass(input.target.href);
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new SafeAuthError('owned connection deadline')),remaining());
      socket.addEventListener('open',()=>{clearTimeout(timer);opened=true;resolve();},{once:true});
      socket.addEventListener('error',()=>{clearTimeout(timer);reject(new SafeAuthError('owned connection failed'));},{once:true});
    });
    socket.addEventListener('message',event=>{
      let message;
      try { message=JSON.parse(event.data); } catch { rejectPending('invalid owned response');return; }
      // Discard all unsolicited events, including any grant URL in Page/Network.
      if(!message.id||!pending.has(message.id))return;
      const item=pending.get(message.id);pending.delete(message.id);clearTimeout(item.timer);
      if(message.error) {
        const transient=message.error.code===-32000&&/context.*destroyed|Cannot find context|Inspected target navigated/i.test(String(message.error.message||''));
        item.reject(new SafeAuthError('owned browser command',transient));
      } else item.resolve(message.result??{});
    });
    socket.addEventListener('close',()=>{opened=false;rejectPending('owned connection closed');});
    await send('Page.enable');
    await send('Runtime.enable');
    if(await evaluate('location.href')!=='about:blank')fail('authentication target was not blank');
    const navigation=await send('Page.navigate',{url:input.grantUrl});
    input.grantUrl='';
    if(navigation.errorText)fail('normal grant navigation');
    await waitFor('({origin:location.origin,isAccess:location.pathname.startsWith("/access/"),ready:document.readyState})',
      value=>value?.origin===input.base.origin&&value.isAccess===false&&value.ready==='complete');
    const expression='(async()=>{const response=await fetch('+JSON.stringify(input.manifestPath)+',{cache:"no-store",credentials:"same-origin",signal:AbortSignal.timeout(5000)});if(!response.ok)return {ok:false};const bytes=await response.arrayBuffer();if(bytes.byteLength>262144)return {ok:false};const sha=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),n=>n.toString(16).padStart(2,"0")).join("");let value;try{value=JSON.parse(new TextDecoder().decode(bytes));}catch{return {ok:false};}return {ok:true,sha,version:value.version,schema:value.schema};})()';
    const manifest=await evaluate(expression);
    if(!manifest?.ok||manifest.schema!==1||manifest.sha!==input.expectedManifestSha256||manifest.version!==input.expectedVersion)fail('authenticated production manifest identity');
    const blank=await send('Page.navigate',{url:'about:blank'});
    if(blank.errorText)fail('blank return navigation');
    await waitFor('location.href',value=>value==='about:blank');
    while(true) {
      remaining();
      const targets=(await send('Target.getTargets')).targetInfos??[];
      const pages=targets.filter(row=>row.type==='page');
      if(pages.length===1&&pages[0].url==='about:blank'&&!targets.some(row=>['worker','shared_worker','service_worker'].includes(row.type)))break;
      await delay(Math.min(100,remaining()));
    }
    await send('Runtime.discardConsoleEntries');
    return {authenticated:true,productionOrigin:input.base.origin,manifestPath:input.manifestPath,
      manifestSha256:manifest.sha,manifestVersion:manifest.version,returnedToBlank:true,
      elapsedMs:Math.round((performance.now()-started)*1000)/1000,
      authentication:'Normal HTTPS grant navigation establishes the browser cookie; no cookie values are read or serialized',
      privateNavigationEventsRecorded:false,privateConsoleCacheDiscarded:true,authenticationWorkerTargetsRemaining:0};
  } catch(error) {
    if(error instanceof SafeAuthError)throw error;
    fail('unexpected private authentication failure');
  } finally {
    input.grantUrl='';
    rejectPending('authentication connection closed');
    try { socket?.close(); } catch {}
  }
}
