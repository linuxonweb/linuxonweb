import os,pathlib
T=pathlib.Path(os.environ['GLIBC_TASK']);p=T/'source/worker.js';s=p.read_text();assert 'GNU_FINAL16_TRACE' not in s
s=s.replace('  const allocatorFutex =', '  const final16Transport = {};\n  const allocatorFutex =')
needle='        const ret = kernel_instance.exports.syscall(nr, arg0, arg1, arg2, arg3, arg4, arg5);';assert s.count(needle)==1
s=s.replace(needle,needle+'\n        if (nativeRawTp && [160,179,21,60,264,228,229,230,231,232,234,440,448,462,289,290].includes(Number(nr))) { const k=String(nr), row=final16Transport[k] ??= {count:0,samples:[]}; row.count++; if (!row.samples.some(x=>x.ret===Number(ret))) row.samples.push({args:[arg0,arg1,arg2,arg3,arg4,arg5].map(Number),ret:Number(ret)}); }')
s=s.replace('        traceAbortWrite(nr, arg0, arg1, arg2);','        traceAbortWrite(nr, arg0, arg1, arg2);\n        if(nativeRawTp && [93,94].includes(Number(nr))) console.warn("[user-module] GNU_FINAL16_TRACE",JSON.stringify(final16Transport));')
p.write_text(s)
