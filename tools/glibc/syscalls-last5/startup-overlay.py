import os,pathlib
T=pathlib.Path(os.environ['GLIBC_TASK']);p=T/'source/startup.c';s=p.read_text();assert 'last5_tests' not in s
s=s.replace('extern int final16_thread(unsigned);','extern int final16_thread(unsigned);\nextern int last5_thread_test(unsigned);')
s=s.replace(' c->errors+=!final16_thread(i);',' c->errors+=!last5_thread_test(i);\n c->errors+=!final16_thread(i);')
s=s.replace('extern void final16_tests(void);','extern void final16_tests(void);\nextern void last5_tests(void);\nextern int last5_pivot_process(void);\nvoid last5_record(const char*n,int ok){check(n,ok);}\nint last5_raw(int n,int a,int b,int c,int d,int e,int f){return sc(n,a,b,c,d,e,f);}')
s=s.replace(' jump_tests();',' if(startup.argc>1&&!strcmp(startup.argv[1],"last5-pivot")){int ok=last5_pivot_process();put(ok?"GNU_LAST5_PIVOT isolated=owned-chroot create,reverse,root-restored result=PASS\\n":"GNU_LAST5_PIVOT FAIL\\n");_exit(ok?0:99); }\n jump_tests();')
s=s.replace(' int final16_before=failures;final16_tests();',' int last5_before=failures;last5_tests();\n put(failures==last5_before?"GNU_LAST5 capability=no-op pidfd=marshaled mount=readonly,restore result=PASS\\n":"GNU_LAST5 FAIL\\n");\n int final16_before=failures;final16_tests();')
s=s.replace(' int final16_threads_ok=',' int last5_threads_ok=last5_thread_test(0)&&!children[0].errors&&!children[1].errors;check("last5-thread-errors",last5_threads_ok);\n put(last5_threads_ok?"GNU_LAST5_THREADS errno=isolated result=PASS\\n":"GNU_LAST5_THREADS FAIL\\n");\n int final16_threads_ok=')
p.write_text(s)
