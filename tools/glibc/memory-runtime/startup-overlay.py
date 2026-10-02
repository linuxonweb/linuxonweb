#!/usr/bin/env python3
import os,pathlib
T=pathlib.Path(os.environ['GLIBC_TASK']);p=T/'source/startup.c';s=p.read_text();assert 'memory_isolated'not in s
s=s.replace('static void allocate_batch(unsigned id,unsigned round){','extern int memory_thread_begin(unsigned),memory_thread_end(unsigned);\nextern int memory_nonoverlap(const void*,size_t);\nextern void memory_round_check(void),memory_trim_test(unsigned),memory_isolated(void);\nvoid memory_record(const char*n,int ok){check(n,ok);}\nstatic void allocate_batch(unsigned id,unsigned round){\n user_check(id,memory_thread_begin(id));')
s=s.replace('static void release_batch(unsigned id){','static void release_batch(unsigned id){\n user_check(id,memory_thread_end(id));')
needle=' if(startup.argc>1&&!strcmp(startup.argv[1],"arity-vhangup"))';assert s.count(needle)==1
s=s.replace(needle,' if(startup.argc>1&&!strcmp(startup.argv[1],"memory-isolated")){\n  check("isolated-final-heap-floor",heap_floor>=(unsigned)&__heap_base);\n  _dl_pagesize=startup.page_size;check("isolated-memory-init",__wasm_memory_init(heap_floor,startup.page_size)==0);\n  int before=failures;memory_isolated();int ok=failures==before;put(ok?"GNU_MEMORY_ISOLATED public=8 union=adjacent,partial-hole brk=owned arithmetic=preserved result=PASS\\n":"GNU_MEMORY_ISOLATED FAIL\\n");_exit(ok?0:99);\n }\n'+needle)
needle=' check("public-action-size",sizeof(a)==140);';assert s.count(needle)==1
s=s.replace(needle,' int memory_before=failures;memory_trim_test((unsigned)perturb);put(failures==memory_before?"GNU_MEMORY_TRIM GNU=mtrim interior=discarded neighbors=preserved metadata=reused result=PASS\\n":"GNU_MEMORY_TRIM FAIL\\n");\n'+needle)
needle='  for(unsigned a=0;a<3*SLOTS;a++){';assert s.count(needle)==1
s=s.replace(needle,'  memory_round_check();\n'+needle)
s=s.replace('   check("all-users-payload-before-free",all_bytes(x->p,x->n,x->pattern));','   check("all-users-payload-before-free",all_bytes(x->p,x->n,x->pattern));\n   check("memory-public-map-vs-GNU-allocation",memory_nonoverlap(x->p,x->n));')
needle=' check("GNU-errno-distinct",';assert s.count(needle)==1
s=s.replace(needle,' check("memory-concurrent-users",!user_errors[0]&&!user_errors[1]&&!user_errors[2]&&!children[0].errors&&!children[1].errors);put(!user_errors[0]&&!user_errors[1]&&!user_errors[2]&&!children[0].errors&&!children[1].errors?"GNU_MEMORY_THREADS users=3 public=mmap,munmap,mremap errno=isolated payload=integrity result=PASS\\n":"GNU_MEMORY_THREADS FAIL\\n");\n'+needle)
p.write_text(s)
