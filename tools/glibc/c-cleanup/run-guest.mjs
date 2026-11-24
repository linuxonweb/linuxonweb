// Mandatory new cleanup assertions in addition to the frozen GNU regression gate.
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url)),[,out]=process.argv.slice(2);
const child=spawn(process.execPath,[path.join(here,'../fullmake/run-guest.mjs'),...process.argv.slice(2)],{stdio:'inherit',env:process.env});
const status=await new Promise(resolve=>child.once('exit',resolve));
const base=JSON.parse(await fs.readFile(path.join(out,'warnings-result.json')));
const lines=(await fs.readFile(path.join(out,'guest-console.txt'),'utf8')).split(/\r?\n/);
const runs=lines.filter(x=>x==='GNU_C_CLEANUP native-tag=payload,rethrow once=reset,retry,done chain=restored result=PASS').length;
const negative=lines.filter(x=>x==='GNU_ABORT_EXIT mode=cleanup-abort status=134').length===1;
const entered=lines.filter(x=>x==='GNU_C_CLEANUP_ABORT throwing-inside-cleanup').length===1;
const execStatus=lines.filter(x=>x==='GNU_ABORT_EXIT mode=cleanup-exec status=42').length===1;
const execTarget=lines.filter(x=>x==='GNU_C_CLEANUP_EXEC_TARGET argv=sentinel TLS=fresh chain=empty status=42').length===1;
const execNoCleanup=!lines.some(x=>x.includes('exec-old-cleanup-ran'));
const report={pass:status===0&&base.pass&&runs===6&&negative&&entered&&execStatus&&execTarget&&execNoCleanup,execReplacement:{pass:execStatus&&execTarget&&execNoCleanup,rawKernelAPI:true},runs,cleanupThrowGNUAbort:negative&&entered,fullCancellation:false,CXXRuntime:false};
await fs.writeFile(path.join(out,'c-cleanup-result.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));if(!report.pass)process.exitCode=1;
