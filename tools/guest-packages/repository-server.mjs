#!/usr/bin/env node
import http from 'node:http';import fs from 'node:fs/promises';import {constants,createReadStream} from 'node:fs';import path from 'node:path';
const root=await fs.realpath(process.env.LINUXONWEB_REPOSITORY_ROOT||'out/public-repository'),port=Number(process.env.LINUXONWEB_REPOSITORY_PORT||38100);
const allowed=/^\/(?:linuxonweb-dev\.rsa\.pub|wasm32\/(?:APKINDEX\.tar\.gz|index-receipt\.json|[A-Za-z0-9_.+-]+\.(?:apk|json)))$/;
const server=http.createServer(async(req,res)=>{let file;try{
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{'Allow':'GET, HEAD'});res.end();return;}
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/health'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(req.method==='HEAD'?undefined:'{"ok":true,"service":"signed-apk-repository","readOnly":true}\n');return;}
 if(url.search||!allowed.test(url.pathname)){res.writeHead(404);res.end();return;}
 const name=path.join(root,url.pathname.slice(1));file=await fs.open(name,constants.O_RDONLY|constants.O_NOFOLLOW);const stat=await file.stat();if(!stat.isFile())throw Error('not regular');
 const headers={'Content-Type':url.pathname.endsWith('.json')?'application/json':'application/octet-stream','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'cross-origin','Access-Control-Allow-Origin':'*','Accept-Ranges':'bytes','Cache-Control':url.pathname.endsWith('.apk')?'public, max-age=31536000, immutable':'no-cache'};
 let start=0,end=stat.size-1,status=200;const range=req.headers.range;
 if(range){const m=/^bytes=(\d+)-(\d*)$/.exec(range);if(!m){res.writeHead(416,{'Content-Range':`bytes */${stat.size}`});res.end();return;}start=Number(m[1]);end=m[2]?Number(m[2]):end;if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||end>=stat.size){res.writeHead(416,{'Content-Range':`bytes */${stat.size}`});res.end();return;}status=206;headers['Content-Range']=`bytes ${start}-${end}/${stat.size}`;}
 headers['Content-Length']=end-start+1;res.writeHead(status,headers);
 if(req.method==='HEAD'){res.end();return;}
 const stream=file.createReadStream({start,end,autoClose:true});file=null;stream.on('error',()=>res.destroy());res.once('close',()=>stream.destroy());stream.pipe(res);
}catch{if(!res.headersSent)res.writeHead(404);res.end();}finally{if(file)await file.close();}});
server.requestTimeout=30000;server.headersTimeout=10000;server.listen(port,'127.0.0.1',()=>console.log(JSON.stringify({service:'signed-apk-repository',port,readOnly:true})));process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
