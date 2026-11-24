import os,pathlib
T=pathlib.Path(os.environ['GLIBC_TASK']);p=T/'source/worker.js';s=p.read_text();assert 'GNU_SCHED_TRACE' not in s
needle='        const ret = kernel_instance.exports.syscall(nr, arg0, arg1, arg2, arg3, arg4, arg5);'
assert s.count(needle)==1
s=s.replace(needle,needle+'\n        if (nativeRawTp && [118,119,121].includes(Number(nr))) console.warn("[user-module] GNU_SCHED_TRACE", JSON.stringify({nr:Number(nr),args:[arg0,arg1,arg2,arg3,arg4,arg5].map(Number),ret:Number(ret)}));')
p.write_text(s)
