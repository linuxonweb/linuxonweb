import os,pathlib
T=pathlib.Path(os.environ['GLIBC_TASK']);p=T/'source/startup.c';s=p.read_text();assert 'arity_tests'not in s
s=s.replace('extern void final16_tests(void);','extern void final16_tests(void);\nextern void arity_tests(void);\nextern int arity_thread(unsigned),arity_vhangup_process(void);\nvoid arity_record(const char*n,int ok){check(n,ok);}\nint arity_raw(int n,int a,int b,int c,int d,int e,int f){return sc(n,a,b,c,d,e,f);}')
s=s.replace('extern int final16_thread(unsigned);','extern int final16_thread(unsigned);\nextern int arity_thread(unsigned);')
s=s.replace(' c->errors+=!final16_thread(i);',' c->errors+=!arity_thread(i);\n c->errors+=!final16_thread(i);')
needle=' if(startup.argc>1&&!strcmp(startup.argv[1],"sched-sem-policy"))'
s=s.replace(needle,' if(startup.argc>1&&!strcmp(startup.argv[1],"arity-vhangup")){int ok=arity_vhangup_process();put(ok?"GNU_ARITY_VHANGUP isolated=session-no-tty restored=identity result=PASS\\n":"GNU_ARITY_VHANGUP FAIL\\n");_exit(ok?0:99); }\n'+needle)
s=s.replace(' int final16_before=failures;final16_tests();',' int arity_before=failures;arity_tests();\n put(failures==arity_before?"GNU_ARITY public=sync,vhangup,prctl historical=init_module,delete_module result=PASS\\n":"GNU_ARITY FAIL\\n");\n int final16_before=failures;final16_tests();')
s=s.replace(' int final16_threads_ok=', ' int arity_threads_ok=arity_thread(0)&&!children[0].errors&&!children[1].errors;check("arity-thread-errors",arity_threads_ok);put(arity_threads_ok?"GNU_ARITY_THREADS name=isolated errno=isolated result=PASS\\n":"GNU_ARITY_THREADS FAIL\\n");\n int final16_threads_ok=')
p.write_text(s)
p=T/'source/worker.js';s=p.read_text();assert 'GNU_ARITY_TRACE'not in s
s=s.replace('  const final16Transport =','  const arityTransport = {};\n  const final16Transport =')
needle='        const ret = kernel_instance.exports.syscall(nr, arg0, arg1, arg2, arg3, arg4, arg5);';assert s.count(needle)==1
s=s.replace(needle,needle+'\n        if(nativeRawTp && [58,81,105,106,167].includes(Number(nr))){const k=String(nr),row=arityTransport[k]??={count:0,samples:[]};row.count++;const args=[arg0,arg1,arg2,arg3,arg4,arg5].map(Number);if(row.samples.length<96&&!row.samples.some(x=>x.ret===Number(ret)&&x.args.every((a,i)=>a===args[i])))row.samples.push({args,ret:Number(ret)});}')
s=s.replace('        traceAbortWrite(nr, arg0, arg1, arg2);','        traceAbortWrite(nr, arg0, arg1, arg2);\n        if(nativeRawTp&&[93,94].includes(Number(nr)))console.warn("[user-module] GNU_ARITY_TRACE",JSON.stringify(arityTransport));')
p.write_text(s)
