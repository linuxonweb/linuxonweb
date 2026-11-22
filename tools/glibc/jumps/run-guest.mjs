// Extend the frozen integration runner with mandatory jump-specific assertions.
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const [,out]=process.argv.slice(2);
const child=spawn(process.execPath,[path.join(here,'../run-guest.mjs'),...process.argv.slice(2)],{stdio:'inherit',env:process.env});
const status=await new Promise(resolve=>child.once('exit',resolve));
const result=JSON.parse(await fs.readFile(path.join(out,'result.json')));
const lines=(await fs.readFile(path.join(out,'guest-console.txt'),'utf8')).split(/\r?\n/);
const negative=['jump-owner','jump-bounds','jump-past'].map(mode=>({mode,pass:lines.filter(x=>x===`GNU_ABORT_EXIT mode=${mode} status=134`).length===1}));
const diagnostics=lines.filter(x=>x.includes('*** invalid native Wasm longjmp stack or owner ***: terminated')).length;
const runs=lines.filter(x=>x==='GNU_NATIVE_JUMPS masks=save0,save1 nested=pass cleanup=actualGNU').length;
const report={pass:status===0&&result.pass&&negative.every(x=>x.pass)&&diagnostics===3&&runs===6,negative,diagnostics,runs,baseResult:'result.json'};
await fs.writeFile(path.join(out,'jumps-result.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));if(!report.pass)process.exitCode=1;
