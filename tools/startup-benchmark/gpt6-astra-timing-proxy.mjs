#!/usr/bin/env node
// Local, bounded diagnostic proxy. Only worker/platform source is instrumented.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import { instrumentStartupSource } from './gpt6-codex-timing.mjs';
const [outArg,portArg='38082'] = process.argv.slice(2);
const port=Number(portArg),out=path.resolve(outArg||'');
if(!outArg||!Number.isInteger(port)||port<1024||port>65535||fs.existsSync(out))throw Error('Fresh diagnostic directory and valid port required');
fs.mkdirSync(out,{recursive:true,mode:0o700});
const sources=new Map(),pins={};
for(const[kind,relative]of [['worker','web/linux/dist/worker.js'],['platform','web/linux/dist/platform.js']]){
 const raw=fs.readFileSync(relative,'utf8'),instrumented=instrumentStartupSource(kind,raw),route='/linux/dist/'+path.basename(relative);
 fs.writeFileSync(path.join(out,kind+'-original.js'),raw);fs.writeFileSync(path.join(out,kind+'-instrumented.js'),instrumented);
 sources.set(route,Buffer.from(instrumented));pins[route]={originalSha256:crypto.createHash('sha256').update(raw).digest('hex'),instrumentedSha256:crypto.createHash('sha256').update(instrumented).digest('hex')};
}
{
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
const helper=fs.readFileSync('tools/startup-benchmark/gpt6-codex-timing.mjs');sources.set('/linux/dist/gpt6-codex-timing.mjs',helper);fs.writeFileSync(path.join(out,'gpt6-codex-timing.mjs'),helper);
const connections=new Set();
const server=http.createServer((request,response)=>{
 const route=new URL(request.url,'http://127.0.0.1').pathname;
 if(sources.has(route)){
  const body=sources.get(route);response.writeHead(200,{'content-type':'text/javascript; charset=utf-8','content-length':body.length,'cache-control':'no-store','cross-origin-opener-policy':'same-origin','cross-origin-embedder-policy':'require-corp','cross-origin-resource-policy':'same-origin'});response.end(request.method==='HEAD'?undefined:body);return;
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
server.listen(port,'127.0.0.1',()=>{fs.writeFileSync(path.join(out,'ready.json'),JSON.stringify({port,pid:process.pid,started:new Date().toISOString(),pins,diagnosticOnly:true},null,2));console.log('Constructor timing proxy ready at '+port);});
setTimeout(close,300000).unref();
