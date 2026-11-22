// Add fixed-rounding assertions to the accepted GNU cleanup regression gate.
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url)),[,out]=process.argv.slice(2);
const child=spawn(process.execPath,[path.join(here,'../c-cleanup/run-guest.mjs'),...process.argv.slice(2)],{stdio:'inherit',env:process.env});
const status=await new Promise(resolve=>child.once('exit',resolve));
const base=JSON.parse(await fs.readFile(path.join(out,'c-cleanup-result.json')));
const lines=(await fs.readFile(path.join(out,'guest-console.txt'),'utf8')).split(/\r?\n/);
const runs=lines.filter(x=>x==='GNU_FENV public=nearest,reject errno=preserved ties=f32,f64 result=PASS').length;
const threadRuns=lines.filter(x=>x==='GNU_FENV_THREADS errno=isolated mode=nearest result=PASS').length;
const report={pass:status===0&&base.pass&&runs===6&&threadRuns===1,runs,threadRuns,scope:'public GNU fixed-nearest rounding; no selectable modes, flags, full libm or conversion runtime acceptance'};
await fs.writeFile(path.join(out,'fenv-result.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));if(!report.pass)process.exitCode=1;
