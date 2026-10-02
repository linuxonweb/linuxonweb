// Genuine public stat/time64 gates alongside every frozen GNU regression.
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url)),[,out]=process.argv.slice(2);
const child=spawn(process.execPath,[path.join(here,'../syscalls-next26/run-guest.mjs'),...process.argv.slice(2)],{stdio:'inherit',env:process.env});
const status=await new Promise(resolve=>child.once('exit',resolve));
const base=JSON.parse(await fs.readFile(path.join(out,'next26-result.json')));
const lines=(await fs.readFile(path.join(out,'guest-console.txt'),'utf8')).split(/\r?\n/);
const count=text=>lines.filter(x=>x===text).length;
const runs=count('GNU_STAT public=8 raw=statx time64=beyond2038 result=PASS');
const threadRuns=count('GNU_STAT_THREADS errno=isolated result=PASS');
const warnings=lines.filter(x=>/WARNING:|Not a kmalloc|GNU_STAT FAIL|GNU_STAT_THREADS FAIL/.test(x));
const report={pass:status===0&&base.pass&&runs===6&&threadRuns===1&&warnings.length===0,runs,threadRuns,warnings,publicFunctions:8,scope:'GNU public stat/time64 conversion in actual Linux; no full sysroot/NPTL/Nightly'};
await fs.writeFile(path.join(out,'stat-result.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));if(!report.pass)process.exitCode=1;
