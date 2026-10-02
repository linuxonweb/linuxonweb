import os,pathlib
T=pathlib.Path(os.environ['GLIBC_TASK']);p=T/'source/startup.c';s=p.read_text();assert 'final16_tests' not in s
s=s.replace('extern int sched_sem_thread(unsigned);','extern int sched_sem_thread(unsigned);\nextern int final16_thread(unsigned);')
s=s.replace(' c->errors+=!sched_sem_thread(i);',' c->errors+=!final16_thread(i);\n c->errors+=!sched_sem_thread(i);')
s=s.replace('extern void sched_sem_tests(void);','extern void sched_sem_tests(void);\nextern void final16_tests(void);\nvoid final16_record(const char*n,int ok){check(n,ok);}\nint final16_raw(int n,int a,int b,int c,int d,int e,int f){return sc(n,a,b,c,d,e,f);}')
s=s.replace(' check("genuine-GNU-init-finished",_dl_pagesize==65536&&__libc_enable_secure==0);',' check("genuine-GNU-init-finished",_dl_pagesize==65536&&__libc_enable_secure==0);\n int final16_before=failures;final16_tests();\n put(failures==final16_before?"GNU_FINAL16 enabled=uname,sysinfo,epoll_ctl unsupported=13 result=PASS\\n":"GNU_FINAL16 FAIL\\n");')
s=s.replace(' int sched_sem_ok=sched_sem_finish();',' int final16_threads_ok=final16_thread(0)&&!children[0].errors&&!children[1].errors;check("final16-thread-errors",final16_threads_ok);\n put(final16_threads_ok?"GNU_FINAL16_THREADS errno=isolated result=PASS\\n":"GNU_FINAL16_THREADS FAIL\\n");\n int sched_sem_ok=sched_sem_finish();')
p.write_text(s)
