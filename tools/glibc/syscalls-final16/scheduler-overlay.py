import os,pathlib
T=pathlib.Path(os.environ['GLIBC_TASK']);p=T/'source/startup.c';s=p.read_text();assert 'sched_sem_tests' not in s
s=s.replace('extern int next26_thread_test(unsigned);','extern int next26_thread_test(unsigned);\nextern int sched_sem_thread(unsigned);')
old=' c->errors+=errno!=100+(int)i||tls_initialized!=0x12345678+i||tls_zero!=i;';assert s.count(old)==1
s=s.replace(old,' c->errors+=!sched_sem_thread(i);\n'+old)
s=s.replace('extern void next26_tests(void);','extern void next26_tests(void);\nextern void sched_sem_tests(void);\nextern int sched_sem_policy_process(void),sched_sem_finish(void);\nvoid sched_sem_record(const char *name,int success){check(name,success);}\nint sched_sem_raw(int n,int a,int b,int c,int d,int e,int f){return sc(n,a,b,c,d,e,f);}')
s=s.replace(' if(startup.argc>1&&!strcmp(startup.argv[1],"next26-setsid"))',' if(startup.argc>1&&!strcmp(startup.argv[1],"sched-sem-policy")){int ok=sched_sem_policy_process();put(ok?"GNU_SCHED_POLICY isolated=OTHER,BATCH,OTHER restored=identity,policy,priority result=PASS\\n":"GNU_SCHED_POLICY FAIL\\n");_exit(ok?0:99); }\n if(startup.argc>1&&!strcmp(startup.argv[1],"next26-setsid"))')
s=s.replace(' int next26_before=failures;next26_tests();',' int sched_sem_before=failures;sched_sem_tests();\n put(failures==sched_sem_before?"GNU_SCHED_SEM public=scheduler3,semaphore5 result=PASS\\n":"GNU_SCHED_SEM FAIL\\n");\n int next26_before=failures;next26_tests();')
s=s.replace(' check("measured-ready-wake",ready_wakes>0);',' int sched_sem_ok=sched_sem_finish();check("GNU-semaphore-concurrent-payload-nonoverlap",sched_sem_ok);\n put(sched_sem_ok?"GNU_SEM_THREADS transfers=512 payload=integrity ownership=exclusive nonoverlap=PASS result=PASS\\n":"GNU_SEM_THREADS FAIL\\n");\n check("measured-ready-wake",ready_wakes>0);')
p.write_text(s)
