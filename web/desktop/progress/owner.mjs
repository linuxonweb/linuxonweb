#!/usr/bin/env node
// Local CLI; owner key is read from a private file and never printed.
import fs from 'node:fs/promises';import path from 'node:path';
const [stateArg,command,arg]=process.argv.slice(2);if(!stateArg||!command)throw Error('usage: owner.mjs STATE grant|messages|reply|progress [JSON]');
const state=path.resolve(stateArg);const key=(await fs.readFile(path.join(state,'owner-key'),'utf8')).trim();const s=JSON.parse(await fs.readFile(path.join(state,'server.json'),'utf8'));
const data=arg?JSON.parse(arg):{};let route=command,method=command==='messages'?'GET':'POST';
const res=await fetch(`http://127.0.0.1:${s.port}/__owner/${route}`,{method,headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},...(method==='GET'?{}:{body:JSON.stringify(data)})});const result=await res.json();if(!res.ok)throw Error(JSON.stringify(result));
if(command==='grant'){const label=String(data.label||'preview').replace(/[^a-z0-9_-]/gi,'_');await fs.writeFile(path.join(state,label+'-grant.json'),JSON.stringify(result)+'\n',{mode:0o600});console.log('Access grant saved to private state for '+label);}
else console.log(JSON.stringify(result));
