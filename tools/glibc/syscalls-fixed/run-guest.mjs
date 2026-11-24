// Genuine public syscall coverage plus every accepted GNU rounding regression.
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url)),[,out]=process.argv.slice(2);
const child=spawn(process.execPath,[path.join(here,'../fenv/run-guest.mjs'),...process.argv.slice(2)],{stdio:'inherit',env:process.env});
const status=await new Promise(resolve=>child.once('exit',resolve));
const base=JSON.parse(await fs.readFile(path.join(out,'fenv-result.json')));
const lines=(await fs.readFile(path.join(out,'guest-console.txt'),'utf8')).split(/\r?\n/);
const runs=lines.filter(x=>x==='GNU_FIXED_SYSCALLS public=36 capabilities=5ENOSYS,xattr-ramfs result=PASS').length;
const threadRuns=lines.filter(x=>x==='GNU_FIXED_THREADS errno=isolated failures=real result=PASS').length;
const setpgid=lines.filter(x=>x==='GNU_FIXED_SETPGID isolated=create,restore result=PASS').length===1&&lines.filter(x=>x==='GNU_ABORT_EXIT mode=fixed-setpgid status=0').length===1;
const report={pass:status===0&&base.pass&&runs===6&&threadRuns===1&&setpgid,runs,threadRuns,setpgidIsolated:setpgid,publicFunctions:36,unavailable:['inotify_init1','inotify_add_watch','inotify_rm_watch','timerfd_create','memfd_create','ramfs-user-xattr-storage'],scope:'typed public syscall runtime; unavailable facilities remain unsupported; no full libc/NPTL/Nightly'};
await fs.writeFile(path.join(out,'fixed-result.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));if(!report.pass)process.exitCode=1;
