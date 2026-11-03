#!/usr/bin/env node
// Authenticated development preview. Browser messages are data, never commands.
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
const exec = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const state = path.resolve(process.env.LINUX_PROGRESS_STATE || 'out/linux-progress');
const port = Number(process.env.LINUX_PROGRESS_PORT || 38080);
const upstreamPort = Number(process.env.LINUX_PROGRESS_UPSTREAM_PORT || 3000);
await fs.mkdir(state, {recursive:true, mode:0o700});
async function privateFile(name, init) {
 const p=path.join(state,name);
 try{return await fs.readFile(p,'utf8');}catch(e){if(e.code!=='ENOENT')throw e;await fs.writeFile(p,init,{mode:0o600,flag:'wx'});return init;}
}
const ownerKey=(await privateFile('owner-key',crypto.randomBytes(32).toString('hex'))).trim();
const cookieKey=(await privateFile('cookie-key',crypto.randomBytes(32).toString('hex'))).trim();
const grants=new Map();
const sessions=new Map();
const peers=new Set();
const rate=new Map();
let lastCpu=null, metrics={updatedAt:null,cpuPercent:null,ram:null,disks:[],error:null}, sampling=false, stopped=false;
const sign=v=>crypto.createHmac('sha256',cookieKey).update(v).digest('hex');
const safeEqual=(a,b)=>typeof a==='string'&&a.length===b.length&&crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b));
const headers={'cache-control':'no-store','cross-origin-opener-policy':'same-origin','cross-origin-embedder-policy':'require-corp','cross-origin-resource-policy':'same-origin','x-content-type-options':'nosniff','referrer-policy':'no-referrer'};
function json(res,status,value,extra={}){const data=JSON.stringify(value);res.writeHead(status,{...headers,'Content-Type':'application/json; charset=utf-8','Content-Length':Buffer.byteLength(data),...extra});res.end(data);}
function session(req){
 const v=/(?:^|;\s*)linux_preview=([^;]+)/.exec(req.headers.cookie||'')?.[1];if(!v)return null;
 const [id,mac]=v.split('.');if(!id||!mac||!safeEqual(mac,sign(id)))return null;
 const s=sessions.get(id);if(!s||s.expires<Date.now()){sessions.delete(id);return null;}return s;
}
function owner(req){return safeEqual(req.headers.authorization||'',`Bearer ${ownerKey}`);}
function sameOrigin(req){const o=req.headers.origin;if(!o)return true;try{return new URL(o).host===req.headers.host;}catch{return false;}}
async function body(req,max=8192){let n=0;const chunks=[];for await(const b of req){n+=b.length;if(n>max)throw Object.assign(Error('request too large'),{status:413});chunks.push(b);}return JSON.parse(Buffer.concat(chunks).toString()||'{}');}
async function messages(){try{return (await fs.readFile(path.join(state,'messages.jsonl'),'utf8')).trim().split('\n').filter(Boolean).slice(-150).map(x=>JSON.parse(x));}catch(e){if(e.code==='ENOENT')return [];throw e;}}
async function addMessage(who,text,replyTo=null){
 if(typeof text!=='string'||!text.trim()||text.length>4000)throw Object.assign(Error('Use 1–4000 characters.'),{status:400});
 const entry={id:crypto.randomUUID(),createdAt:new Date().toISOString(),who,text:text.trim(),replyTo:typeof replyTo==='string'?replyTo:null};
 await fs.appendFile(path.join(state,'messages.jsonl'),JSON.stringify(entry)+'\n',{mode:0o600});
 for(const p of peers) p.send({type:'message',message:entry});return entry;
}
function cpuSample(){const values=os.cpus().reduce((a,c)=>{const v=c.times;return {total:a.total+Object.values(v).reduce((x,y)=>x+y,0),idle:a.idle+v.idle};},{total:0,idle:0});let percent=null;if(lastCpu&&values.total>lastCpu.total)percent=100*(1-(values.idle-lastCpu.idle)/(values.total-lastCpu.total));lastCpu=values;return percent;}
async function sample(){if(sampling||stopped)return;sampling=true;try{
 const mem=Object.fromEntries((await fs.readFile('/proc/meminfo','utf8')).split('\n').map(l=>/^([^:]+):\s+(\d+) kB$/.exec(l)).filter(Boolean).map(m=>[m[1],Number(m[2])*1024]));
 const {stdout}=await exec('df',['-B1','--output=source,size,used,avail,target','-x','tmpfs','-x','devtmpfs','-x','squashfs'],{timeout:1200,maxBuffer:262144});
 const disks=stdout.trim().split('\n').slice(1).map(l=>{const m=/^(.+?)\s+(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/.exec(l);return m?{device:m[1],totalGB:Number(m[2])/1e9,usedGB:Number(m[3])/1e9,availableGB:Number(m[4])/1e9,mount:m[5]}:null;}).filter(Boolean);
 metrics={updatedAt:new Date().toISOString(),cpuPercent:cpuSample(),cpuCount:os.cpus().length,ram:{totalGB:mem.MemTotal/1e9,availableGB:mem.MemAvailable/1e9,usedGB:(mem.MemTotal-mem.MemAvailable)/1e9},disks,error:null};
 }catch(e){metrics={...metrics,error:String(e.message),updatedAt:new Date().toISOString()};}finally{sampling=false;}}
async function progress(){try{return JSON.parse(await fs.readFile(path.join(state,'progress.json'),'utf8'));}catch{return {iteration:0,score:null,status:'Measuring the current build',updatedAt:null};}}
function frame(payload,opcode=1){const b=Buffer.from(payload);if(b.length<126)return Buffer.concat([Buffer.from([0x80|opcode,b.length]),b]);const h=Buffer.alloc(4);h[0]=0x80|opcode;h[1]=126;h.writeUInt16BE(b.length,2);return Buffer.concat([h,b]);}
function monitorSocket(req,socket,head){
 const key=req.headers['sec-websocket-key'];if(!key||req.headers['sec-websocket-version']!=='13')return socket.destroy();
 const accept=crypto.createHash('sha1').update(key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
 socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
 let buffer=Buffer.alloc(0),busy=false,queued=[];
 const peer={send:data=>{if(!socket.destroyed&&socket.writableLength<131072)socket.write(frame(JSON.stringify(data)));}};peers.add(peer);
 peer.send({type:'metrics',metrics});
 const close=()=>{peers.delete(peer);};socket.on('close',close);socket.on('error',close);
 const fail=()=>{socket.end(frame(Buffer.from([0x03,0xea]),8));};
 async function drain(){if(busy)return;busy=true;while(queued.length){const d=queued.shift();if(d.type==='ping')peer.send({type:'pong',id:d.id});}busy=false;}
 const consume=chunk=>{buffer=Buffer.concat([buffer,chunk]);if(buffer.length>32768)return fail();while(buffer.length>=2){const op=buffer[0]&15;const fin=!!(buffer[0]&128);const masked=!!(buffer[1]&128);let n=buffer[1]&127,off=2;if(!fin||!masked||(buffer[0]&112)||n===127)return fail();if(n===126){if(buffer.length<4)return;n=buffer.readUInt16BE(2);off=4;}if(n>8192)return fail();if(buffer.length<off+4+n)return;const mask=buffer.subarray(off,off+4);const data=Buffer.from(buffer.subarray(off+4,off+4+n));buffer=buffer.subarray(off+4+n);for(let i=0;i<n;i++)data[i]^=mask[i%4];if(op===8){socket.end(frame(data,8));return;}if(op===9){if(n>125)return fail();socket.write(frame(data,10));continue;}if(op!==1)return fail();try{queued.push(JSON.parse(data.toString()));if(queued.length>20)return fail();void drain();}catch{return fail();}}};
 socket.on('data',consume);if(head.length)consume(head);
}
const allowedProxy=p=>p==='/dns'||p==='/__reload'||p.startsWith('/linux/')||p.startsWith('/desktop/')||p.startsWith('/upstream/');
const server=http.createServer(async(req,res)=>{try{
 const u=new URL(req.url,'http://localhost');
 if(u.pathname==='/health'){return json(res,200,{ok:true,upstreamPort,publicTelemetry:false});}
 if(u.pathname.startsWith('/__owner/')){
  if(!owner(req))return json(res,403,{error:'Owner authorization required'});
  if(u.pathname==='/__owner/grant'&&req.method==='POST'){const b=await body(req);const token=crypto.randomBytes(24).toString('hex');grants.set(token,{expires:Date.now()+6*3600000,label:String(b.label||'Preview').slice(0,40)});return json(res,201,{path:'/access/'+token});}
  if(u.pathname==='/__owner/messages'&&req.method==='GET')return json(res,200,await messages());
  if(u.pathname==='/__owner/reply'&&req.method==='POST'){const b=await body(req);return json(res,201,await addMessage('Agent',b.text,b.replyTo));}
  if(u.pathname==='/__owner/progress'&&req.method==='POST'){const b=await body(req);const v={iteration:Number.isSafeInteger(b.iteration)&&b.iteration>=0?b.iteration:0,score:typeof b.score==='number'&&b.score>=0&&b.score<=100?b.score:null,status:String(b.status||'In progress').slice(0,300),updatedAt:new Date().toISOString()};await fs.writeFile(path.join(state,'progress.json'),JSON.stringify(v)+'\n',{mode:0o600});return json(res,200,v);}
  return json(res,404,{error:'Unknown owner route'});
 }
 if(u.pathname.startsWith('/access/')&&req.method==='GET'){
  const token=u.pathname.slice('/access/'.length),g=grants.get(token);if(!g||g.expires<Date.now())return json(res,403,{error:'This access link has expired or was already used. Ask for a new preview link.'});
  grants.delete(token);const id=crypto.randomBytes(24).toString('hex');sessions.set(id,{expires:Date.now()+12*3600000,label:g.label});res.writeHead(303,{...headers,'Set-Cookie':`linux_preview=${id}.${sign(id)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200`,Location:'/'});res.end();return;
 }
 if(!session(req)){res.writeHead(401,{...headers,'Content-Type':'text/html; charset=utf-8'});res.end('<!doctype html><meta name="viewport" content="width=device-width"><title>Linux on Web preview</title><main style="font:18px system-ui;max-width:34rem;margin:12vh auto;padding:24px"><h1>Private development preview</h1><p>Open your access link to continue.</p></main>');return;}
 if(!sameOrigin(req))return json(res,403,{error:'Cross-origin request denied'});
 if(u.pathname==='/__progress/messages'&&req.method==='GET')return json(res,200,await messages());
 if(u.pathname==='/__progress/message'&&req.method==='POST'){const s=session(req);const last=rate.get(s)||0;if(Date.now()-last<1500)return json(res,429,{error:'Please wait a moment.'});rate.set(s,Date.now());const b=await body(req);return json(res,201,await addMessage('You',b.text));}
 if(u.pathname==='/__progress/metrics'&&req.method==='GET')return json(res,200,{metrics,progress:await progress()});
 if(u.pathname==='/src.tar.gz'){
  if(!['GET','HEAD'].includes(req.method))return json(res,405,{error:'Read only'});
  const file=path.join(state,'src.tar.gz');try{const st=await fs.stat(file);res.writeHead(200,{...headers,'Content-Type':'application/gzip','Content-Disposition':'attachment; filename="gpt-6-astra-pro_builtin-agents_linuxonweb_src.tar.gz"','Content-Length':st.size});if(req.method==='HEAD')return res.end();createReadStream(file).pipe(res);return;}catch{return json(res,404,{error:'Source checkpoint is being prepared'});}
 }
 if(u.pathname==='/'||u.pathname==='/progress.js'||u.pathname==='/progress.css'){
  if(!['GET','HEAD'].includes(req.method))return json(res,405,{error:'Read only'});
  const file=u.pathname==='/'?'index.html':u.pathname.slice(1);const b=await fs.readFile(path.join(here,file));res.writeHead(200,{...headers,'Content-Type':file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.js')?'text/javascript; charset=utf-8':'text/css; charset=utf-8','Content-Length':b.length});res.end(req.method==='HEAD'?undefined:b);return;
 }
 if(!allowedProxy(u.pathname)||!['GET','HEAD'].includes(req.method))return json(res,404,{error:'Not found'});
 const h={...req.headers,host:`127.0.0.1:${upstreamPort}`};delete h.cookie;delete h.authorization;
 const proxy=http.request({hostname:'127.0.0.1',port:upstreamPort,path:req.url,method:req.method,headers:h},up=>{res.writeHead(up.statusCode,{...up.headers,...headers});up.pipe(res);});proxy.on('error',()=>{if(!res.headersSent)json(res,502,{error:'Desktop preview is restarting'});else res.destroy();});req.on('aborted',()=>proxy.destroy());req.pipe(proxy);
 }catch(e){if(!res.headersSent)json(res,e.status||500,{error:e.status?e.message:'Preview request failed'});else res.destroy();}});
server.on('upgrade',(req,socket,head)=>{
 if(!session(req)||!sameOrigin(req))return socket.destroy();const u=new URL(req.url,'http://localhost');
 if(u.pathname==='/__progress/ws')return monitorSocket(req,socket,head);
 if(u.pathname!=='/tcp')return socket.destroy();
 const remote=net.connect(upstreamPort,'127.0.0.1',()=>{const h={...req.headers,host:`127.0.0.1:${upstreamPort}`};delete h.cookie;delete h.authorization;remote.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`+Object.entries(h).map(([k,v])=>`${k}: ${v}`).join('\r\n')+'\r\n\r\n');if(head.length)remote.write(head);socket.pipe(remote);remote.pipe(socket);});remote.on('error',()=>socket.destroy());socket.on('error',()=>remote.destroy());socket.on('close',()=>remote.destroy());remote.on('close',()=>socket.destroy());
});
await sample();const sampler=setInterval(sample,1000);const publisher=setInterval(async()=>{const p=await progress();for(const c of peers)c.send({type:'metrics',metrics,progress:p});},2000);
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
await fs.writeFile(path.join(state,'server.json'),JSON.stringify({pid:process.pid,port,upstreamPort,startedAt:new Date().toISOString()},null,2)+'\n',{mode:0o600});
console.log(`Linux on Web private progress preview listening on loopback:${port}; access keys remain in private state.`);
for(const s of ['SIGINT','SIGTERM'])process.on(s,()=>{stopped=true;clearInterval(sampler);clearInterval(publisher);server.close();for(const p of peers)p.send({type:'closing'});setTimeout(()=>process.exit(0),300).unref();});
