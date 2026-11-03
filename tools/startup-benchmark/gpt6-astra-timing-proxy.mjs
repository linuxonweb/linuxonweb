#!/usr/bin/env node
// Local, bounded diagnostic proxy. Only worker/platform source is instrumented.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import { instrumentStartupSource } from './gpt6-codex-timing.mjs';
const [outArg,portArg='38082',diagnosticMode='full',overlayArg] = process.argv.slice(2);
if(!['full','home','seed','input'].includes(diagnosticMode))throw Error('diagnostic mode must be full, home or seed');
const port=Number(portArg),out=path.resolve(outArg||'');
if(!outArg||!Number.isInteger(port)||port<1024||port>65535||fs.existsSync(out))throw Error('Fresh diagnostic directory and valid port required');
fs.mkdirSync(out,{recursive:true,mode:0o700});
const sources=new Map(),pins={};
for(const[kind,relative]of (diagnosticMode==='full' ? [['worker','web/linux/dist/worker.js'],['platform','web/linux/dist/platform.js']] : [])){
 const raw=fs.readFileSync(relative,'utf8'),instrumented=instrumentStartupSource(kind,raw),route='/linux/dist/'+path.basename(relative);
 fs.writeFileSync(path.join(out,kind+'-original.js'),raw);fs.writeFileSync(path.join(out,kind+'-instrumented.js'),instrumented);
 sources.set(route,Buffer.from(instrumented));pins[route]={originalSha256:crypto.createHash('sha256').update(raw).digest('hex'),instrumentedSha256:crypto.createHash('sha256').update(instrumented).digest('hex')};
}
if(diagnosticMode==='full'||diagnosticMode==='input'){
 const raw=fs.readFileSync('web/linux/dist/virtio/input.js','utf8');
 let code=raw.replace('    const pending = [];',`    const diagnostic = globalThis.__gpt6InputQueue = {enqueued:0,delivered:0,dropped:0,highWater:0,events:[]};
    const pending = [];`);
 code=code.replace('            const evt = pending.shift();',`            const evt = pending.shift();
            diagnostic.delivered++;
            if(diagnostic.events.length<8192)diagnostic.events.push({phase:'delivered',...evt,ms:performance.timeOrigin+performance.now(),pending:pending.length});`);
 code=code.replace('            pending.splice(0, pending.length >> 1);',`            diagnostic.dropped += pending.length >> 1;
            pending.splice(0, pending.length >> 1);`);
 code=code.replace('        pending.push({ type, code, value });',`        diagnostic.enqueued++;
        if(diagnostic.events.length<8192)diagnostic.events.push({phase:'enqueued',type,code,value,ms:performance.timeOrigin+performance.now(),pending:pending.length});
        pending.push({ type, code, value });
        diagnostic.highWater=Math.max(diagnostic.highWater,pending.length);`);
 if(code===raw)throw Error('Input diagnostic anchors missing');
 sources.set('/linux/dist/virtio/input.js',Buffer.from(code));fs.writeFileSync(path.join(out,'input-original.js'),raw);fs.writeFileSync(path.join(out,'input-instrumented.js'),code);
 pins['/linux/dist/virtio/input.js']={originalSha256:crypto.createHash('sha256').update(raw).digest('hex'),instrumentedSha256:crypto.createHash('sha256').update(code).digest('hex')};
}
// Preserve filesystem semantics; gather counts and async wall durations only.
// In-flight union time prevents summing concurrent operations as serial delay.
{
 const raw=fs.readFileSync(process.env.LINUXONWEB_LOOKUP_FIXTURE ? path.join(path.resolve(process.env.LINUXONWEB_LOOKUP_FIXTURE),'persistent-home.mjs') : 'web/linux/persistent-home.mjs','utf8');
 const marker='  return api;';
 if(raw.split(marker).length!==2)throw Error('Home API return anchor changed');
 const instrumentation=`
  const timing = globalThis.__gpt6HomeTimings = {startMs:performance.now(),timeOrigin:performance.timeOrigin,active:0,maxActive:0,busyMs:0,calls:0,methods:{},bins:{},nodes:{1:{parent:0,name:''}},inodes:{}};
  for(const [name,original] of Object.entries(api)) if(typeof original==='function') {
    api[name]=function(...args) {
      const started=performance.now();
      if(timing.active++===0)timing.busyStartMs=started;
      timing.maxActive=Math.max(timing.maxActive,timing.active);
      const bin=String(Math.floor(started/5000));
      const row=timing.methods[name]??=( {calls:0,errors:0,totalMs:0,maxMs:0,bytes:0} );
      const bucket=(timing.bins[bin]??={})[name]??=({calls:0,errors:0,totalMs:0,maxMs:0,bytes:0});
      timing.calls++;row.calls++;bucket.calls++;
      const complete=(error,value)=>{
        const duration=performance.now()-started;
        const bytes=name==='write'?(args[3]?.byteLength??0):name==='read'?(value?.byteLength??0):0;
        if(!error&&['lookup','lookupWithAttributes','mkdir','create','symlink'].includes(name)){const id=value?.node?.id??value?.id;if(id)timing.nodes[id]={parent:args[0]?.id,name:String(args[1])};}
        if(!error&&name==='rename'){const node=Object.values(timing.nodes).find(n=>n.parent===args[0]?.id&&n.name===args[1]);if(node){node.parent=args[2]?.id;node.name=String(args[3]);}}
        if(name==='write'||name==='read'){const id=args[0]?.id;if(id){const io=timing.inodes[id]??={reads:0,writes:0,readBytes:0,writeBytes:0,readMs:0,writeMs:0,bins:{}};const ib=io.bins[bin]??={reads:0,writes:0,readBytes:0,writeBytes:0,readMs:0,writeMs:0};for(const item of [io,ib]){if(name==='write'){item.writes++;item.writeBytes+=bytes;item.writeMs+=duration;}else{item.reads++;item.readBytes+=bytes;item.readMs+=duration;}}}}
        for(const item of [row,bucket]){item.totalMs+=duration;item.maxMs=Math.max(item.maxMs,duration);item.bytes+=bytes;if(error)item.errors++;}
        if(--timing.active===0)timing.busyMs+=performance.now()-timing.busyStartMs;
      };
      try {
        const result=original.apply(this,args);
        if(result&&typeof result.then==='function')return result.then(value=>{complete(false,value);return value;},error=>{complete(true);throw error;});
        complete(false,result);return result;
      }catch(error){complete(true);throw error;}
    };
  }
  return api;`;
 const code=raw.replace(marker,instrumentation);
 const route='/linux/persistent-home.mjs';
 sources.set(route,Buffer.from(code));fs.writeFileSync(path.join(out,'home-original.mjs'),raw);fs.writeFileSync(path.join(out,'home-instrumented.mjs'),code);
 pins[route]={originalSha256:crypto.createHash('sha256').update(raw).digest('hex'),instrumentedSha256:crypto.createHash('sha256').update(code).digest('hex')};
}
const helper=fs.readFileSync('tools/startup-benchmark/gpt6-codex-timing.mjs');sources.set('/linux/dist/gpt6-codex-timing.mjs',helper);fs.writeFileSync(path.join(out,'gpt6-codex-timing.mjs'),helper);
{
 const raw=fs.readFileSync('web/linux/log-viewer.mjs','utf8');
 const old="state.row = { id: this.nextId++, text: '' };";
 if(raw.split(old).length!==2)throw Error('Log timestamp anchor changed');
 const code=raw.replace(old,"state.row = { id: this.nextId++, text: '', firstAtMs: performance.now(), firstAtEpochMs: performance.timeOrigin + performance.now() };");
 sources.set('/linux/log-viewer.mjs',Buffer.from(code));
 fs.writeFileSync(path.join(out,'log-viewer-original.mjs'),raw);fs.writeFileSync(path.join(out,'log-viewer-instrumented.mjs'),code);
 pins['/linux/log-viewer.mjs']={originalSha256:crypto.createHash('sha256').update(raw).digest('hex'),instrumentedSha256:crypto.createHash('sha256').update(code).digest('hex')};
}
if(diagnosticMode==='seed'){
 const raw=fs.readFileSync('web/linux/main.js','utf8');
 const old='    initramfs.catch(() => {});';
 if(raw.split(old).length!==2)throw Error('Seed boot integration anchor changed');
 const code=raw.replace(old,old+`
    if(mode==='firefox'&&['1','2'].includes(new URLSearchParams(location.search).get('startup-cache-seed'))){
      try{
        const {activeManifest}=await import('./boot-assets.mjs');
        const {seedFirefoxCodeCache}=await import('./startup-cache-seed.mjs');
        const {FIREFOX_CODE_CACHE_SEED:seed}=await import(new URLSearchParams(location.search).get('startup-cache-seed')==='2'?'./startup-cache-catalog-v2.mjs':'./startup-cache-catalog.mjs');
        globalThis.__gpt6SeedReceipt=await seedFirefoxCodeCache({home:persistentHome,archiveSha256:(await activeManifest()).assets.firefox.sha256,seed,signal:archiveController.signal});
        hostLog('code-cache seed: '+JSON.stringify(globalThis.__gpt6SeedReceipt));
      }catch(error){globalThis.__gpt6SeedReceipt={status:'failed',error:String(error)};hostLog('Code-cache seed skipped after error: '+error.message);}
    }
`);
 sources.set('/linux/main.js',Buffer.from(code));
 fs.writeFileSync(path.join(out,'main-original.js'),raw);fs.writeFileSync(path.join(out,'main-seed-candidate.js'),code);
 pins['/linux/main.js']={originalSha256:crypto.createHash('sha256').update(raw).digest('hex'),instrumentedSha256:crypto.createHash('sha256').update(code).digest('hex')};
}
// Test-only negotiation; no production FUSE capability is changed.
if(process.env.LINUXONWEB_WRITEBACK_FIXTURE==='1'){
 const raw=fs.readFileSync('web/linux/dist/virtio/fs.js','utf8'),old='const supported_flags = FuseInitFlags.ASYNC_READ |';
 if(raw.split(old).length!==2)throw Error('FUSE writeback test anchor changed');
 const code=raw.replace(old,"const supported_flags = (tag==='writeback' ? (1 << 16) : 0) | FuseInitFlags.ASYNC_READ |");
 sources.set('/linux/dist/virtio/fs.js',Buffer.from(code));fs.writeFileSync(path.join(out,'fs-writeback-candidate.js'),code);pins['/linux/dist/virtio/fs.js']={originalSha256:crypto.createHash('sha256').update(raw).digest('hex'),instrumentedSha256:crypto.createHash('sha256').update(code).digest('hex'),testOnlyWritebackTag:'writeback'};
}
const mimeTypes=new Map();
if(process.env.LINUXONWEB_LOOKUP_FIXTURE){
 if(process.env.LINUXONWEB_WRITEBACK_FIXTURE)throw Error('Lookup and writeback experiments must stay separate');
 const directory=path.resolve(process.env.LINUXONWEB_LOOKUP_FIXTURE),route='/linux/dist/virtio/fs.js',body=fs.readFileSync(path.join(directory,'fs.js'));
 sources.set(route,body);pins[route]={testOnly:true,overrideFile:path.join(directory,'fs.js'),sha256:crypto.createHash('sha256').update(body).digest('hex')};
 for(const name of ['home-lookup.html','home-lookup-native.html']){const file=path.join(directory,name);if(fs.existsSync(file)){const route='/linux/tests/'+name,body=fs.readFileSync(file);sources.set(route,body);mimeTypes.set(route,'text/html; charset=utf-8');pins[route]={testOnly:true,sha256:crypto.createHash('sha256').update(body).digest('hex')};}}
}

if(overlayArg){
 const overlay=path.resolve(overlayArg);
 for(const name of ['desktop-extras.cpio.json','desktop-extras.cpio','desktop-extras.cpio.gz']){
  const route='/linux/'+name,body=fs.readFileSync(path.join(overlay,name));
  sources.set(route,body);mimeTypes.set(route,name.endsWith('.json')?'application/json':name.endsWith('.gz')?'application/gzip':'application/octet-stream');
  pins[route]={overrideFile:path.join(overlay,name),sha256:crypto.createHash('sha256').update(body).digest('hex'),bytes:body.length};
 }
}
if(process.env.LINUXONWEB_MOUNT_FIXTURE){
 const fixture=path.resolve(process.env.LINUXONWEB_MOUNT_FIXTURE);
 for(const suffix of ['cpio','json']){const route='/linux/tests/home-mount.'+suffix,file=fixture.replace(/\.cpio$/,'')+'.'+suffix,body=fs.readFileSync(file);sources.set(route,body);mimeTypes.set(route,suffix==='json'?'application/json':'application/octet-stream');pins[route]={overrideFile:file,bytes:body.length,sha256:crypto.createHash('sha256').update(body).digest('hex')};}
}
if(process.env.LINUXONWEB_BARRIER_FIXTURE==='1'){
 const route='/linux/tests/home-barrier.html',body=fs.readFileSync('tools/startup-benchmark/guest-home-mount/barrier.html');sources.set(route,body);mimeTypes.set(route,'text/html; charset=utf-8');pins[route]={sha256:crypto.createHash('sha256').update(body).digest('hex'),bytes:body.length};
}
const overrideFiles=new Map();
if(process.env.LINUXONWEB_BOOT_PACKAGE){
 const directory=path.resolve(process.env.LINUXONWEB_BOOT_PACKAGE),manifestBytes=fs.readFileSync(path.join(directory,'boot-manifest.json')),manifest=JSON.parse(manifestBytes),asset=manifest.assets?.firefox;
 if(!asset||!Number.isSafeInteger(asset.bytes)||asset.bytes<1||!(/^[0-9a-f]{64}$/).test(asset.sha256)||path.basename(asset.url)!=='initramfs-firefox.cpio.gz')throw Error('Invalid candidate Firefox manifest');
 const file=path.join(directory,'initramfs-firefox.cpio.gz'),stat=fs.statSync(file),digest=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file))digest.update(chunk);if(stat.size!==asset.bytes||digest.digest('hex')!==asset.sha256)throw Error('Candidate Firefox archive identity differs');
 const route='/linux/initramfs-firefox.cpio.gz';overrideFiles.set(route,{file,bytes:asset.bytes,sha256:asset.sha256});pins[route]={overrideFile:file,bytes:asset.bytes,sha256:asset.sha256};sources.set('/linux/boot-manifest.json',manifestBytes);mimeTypes.set('/linux/boot-manifest.json','application/json');pins['/linux/boot-manifest.json']={overrideFile:path.join(directory,'boot-manifest.json'),version:manifest.version,sha256:crypto.createHash('sha256').update(manifestBytes).digest('hex')};
}
// Isolated same-image diagnostic, never a public cache invalidation policy.
if(process.env.LINUXONWEB_REMOVE_PURGE_MARKER==='1'){
 const expected='4675a8ceb318c539cd64eb1b69338a19185d0cadb7a5f51b2352048a0c09a771';
 const archive=overrideFiles.get('/linux/initramfs-firefox.cpio.gz');
 const profile=path.resolve(process.env.LINUXONWEB_REUSE_TEST_PROFILE||'');
 const profileRun=path.dirname(profile),receipt=JSON.parse(fs.readFileSync(path.join(profileRun,'report.json'),'utf8'));
 if(archive?.sha256!==expected||path.basename(profile)!=='profile'||receipt.run!==profileRun||!receipt.end||receipt.remainingOwned?.length!==0||!receipt.finishedNormally||!String(receipt.finalState?.text).includes('d258203daee8'))throw Error('Marker diagnostic requires exact accepted APK4 and its closed retained profile');
 const raw=fs.readFileSync('web/linux/desktop-extras.mjs','utf8');
 const marker='exec /init.desktop-original "$@"\\n';
 if(raw.split(marker).length!==2)throw Error('Original desktop init wrapper anchor differs');
 const code=raw.replace(marker,'/bin/busybox rm -f /opt/firefox/browser/.purgecaches\\n/bin/busybox echo cache-marker-test-removed >&2\\n'+marker);
 const route='/linux/desktop-extras.mjs';sources.set(route,Buffer.from(code));fs.writeFileSync(path.join(out,'desktop-extras-original.mjs'),raw);fs.writeFileSync(path.join(out,'desktop-extras-marker-test.mjs'),code);
 pins[route]={testOnly:true,productionAccepted:false,sourceProfile:profile,archiveSha256:expected,originalSha256:crypto.createHash('sha256').update(raw).digest('hex'),instrumentedSha256:crypto.createHash('sha256').update(code).digest('hex')};
}
const connections=new Set();
const server=http.createServer((request,response)=>{
 const route=new URL(request.url,'http://127.0.0.1').pathname;
 if(overrideFiles.has(route)){
  const item=overrideFiles.get(route),headers={'content-type':'application/octet-stream','cache-control':'no-store','accept-ranges':'bytes','cross-origin-opener-policy':'same-origin','cross-origin-embedder-policy':'require-corp','cross-origin-resource-policy':'same-origin'};let start=0,end=item.bytes-1,status=200;
  if(request.headers.range){const match=/^bytes=(\d+)-(\d*)$/.exec(request.headers.range);if(!match){response.writeHead(416,{...headers,'content-range':'bytes */'+item.bytes});response.end();return;}start=Number(match[1]);end=match[2]?Number(match[2]):end;if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>end||end>=item.bytes){response.writeHead(416,{...headers,'content-range':'bytes */'+item.bytes});response.end();return;}status=206;headers['content-range']=`bytes ${start}-${end}/${item.bytes}`;}
  response.writeHead(status,{...headers,'content-length':end-start+1});if(request.method==='HEAD'){response.end();return;}const stream=fs.createReadStream(item.file,{start,end});stream.on('error',()=>response.destroy());request.on('aborted',()=>stream.destroy());stream.pipe(response);return;
 }

 if(sources.has(route)){
  const body=sources.get(route);response.writeHead(200,{'content-type':mimeTypes.get(route)||'text/javascript; charset=utf-8','content-length':body.length,'cache-control':'no-store','cross-origin-opener-policy':'same-origin','cross-origin-embedder-policy':'require-corp','cross-origin-resource-policy':'same-origin'});response.end(request.method==='HEAD'?undefined:body);return;
 }
 const upstream=http.request({hostname:'127.0.0.1',port:3000,method:request.method,path:request.url,headers:{...request.headers,host:'127.0.0.1:3000'}},upstreamResponse=>{response.writeHead(upstreamResponse.statusCode,upstreamResponse.headers);upstreamResponse.pipe(response);});
 upstream.on('error',()=>{if(!response.headersSent)response.writeHead(502);response.end('upstream unavailable');});request.pipe(upstream);request.on('aborted',()=>upstream.destroy());
});
server.on('connection',socket=>{connections.add(socket);socket.on('close',()=>connections.delete(socket));});
server.on('upgrade',(request,socket,head)=>{
 const upstream=net.connect(3000,'127.0.0.1',()=>{let text=`${request.method} ${request.url} HTTP/${request.httpVersion}\r\n`;for(const[k,v]of Object.entries(request.headers))text+=`${k}: ${k==='host'?'127.0.0.1:3000':v}\r\n`;upstream.write(text+'\r\n');if(head.length)upstream.write(head);upstream.pipe(socket);socket.pipe(upstream);});
 upstream.on('error',()=>socket.destroy());socket.on('error',()=>upstream.destroy());socket.on('close',()=>upstream.destroy());
});
function close(){for(const socket of connections)socket.destroy();server.close(()=>process.exit(0));setTimeout(()=>process.exit(1),2000).unref();}
process.on('SIGTERM',close);process.on('SIGINT',close);
server.listen(port,'127.0.0.1',()=>{fs.writeFileSync(path.join(out,'ready.json'),JSON.stringify({port,pid:process.pid,started:new Date().toISOString(),pins,diagnosticOnly:true,diagnosticMode},null,2));console.log('Constructor timing proxy ready at '+port);});
setTimeout(close,600000).unref();
