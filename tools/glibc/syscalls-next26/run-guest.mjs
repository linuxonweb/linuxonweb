// Every accepted regression plus genuine public next26 process/runtime gates.
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url)),[,out]=process.argv.slice(2);
const child=spawn(process.execPath,[path.join(here,'../syscalls-fixed/run-guest.mjs'),...process.argv.slice(2)],{stdio:'inherit',env:process.env});
const status=await new Promise(resolve=>child.once('exit',resolve));
const base=JSON.parse(await fs.readFile(path.join(out,'fixed-result.json')));
const lines=(await fs.readFile(path.join(out,'guest-console.txt'),'utf8')).split(/\r?\n/);
const count=text=>lines.filter(x=>x===text).length;
const runs=count('GNU_NEXT26_SYSCALLS public=26 capabilities=4ENOSYS result=PASS');
const threadRuns=count('GNU_NEXT26_THREADS errno=isolated failures=real result=PASS');
const setsid=count('GNU_NEXT26_SETSID isolated=create,query,reject result=PASS')===1&&count('GNU_ABORT_EXIT mode=next26-setsid status=0')===1;
const chroot=count('GNU_NEXT26_CHROOT isolated=sentinel,restricted-root result=PASS')===1&&count('GNU_ABORT_EXIT mode=next26-chroot status=0')===1;
const exec=count('GNU_NEXT26_EXEC active-cleanup public=execve')===1&&count('GNU_NEXT26_EXEC_TARGET argv=sentinel env=sentinel TLS=fresh chain=empty status=43')===1&&count('GNU_ABORT_EXIT mode=next26-exec status=43')===1&&!lines.some(x=>x.includes('GNU_NEXT26_EXEC_OLD_CLEANUP'));
const report={pass:status===0&&base.pass&&runs===6&&threadRuns===1&&setsid&&chroot&&exec,runs,threadRuns,setsidIsolated:setsid,chrootIsolated:chroot,publicExec:exec,publicFunctions:26,unavailable:['swapoff','swapon','acct','fanotify_init'],scope:'typed public syscall runtime; four unavailable facilities remain unsupported; no full libc/NPTL/Nightly'};
await fs.writeFile(path.join(out,'next26-result.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));if(!report.pass)process.exitCode=1;
