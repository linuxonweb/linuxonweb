/* Owned static native Wasm startup prerequisite; actual GNU 2.44 headers. */
#include <tls.h>
#include <dl-osinfo.h>
#include <errno.h>
#include <string.h>
#include <time.h>
#include <sys/types.h>
#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>
#include <malloc.h>
#include <ldsodefs.h>
#include <dl-tunables.h>
#include <hugepages.h>
#include <sys/single_threaded.h>
#include <sys/mman.h>
struct sigaction;extern pid_t __getpid(void);extern int __libc_sigaction(int,const struct sigaction*,struct sigaction*);
extern unsigned int __nptl_nthreads;
extern void __ptmalloc_init(void);
extern void __malloc_fork_lock_parent(void),__malloc_fork_unlock_parent(void);
extern int __wasm_memory_init(uintptr_t,size_t);
extern uintptr_t __wasm_memory_cursor(void);
extern void *__sbrk(intptr_t);
extern void *__mmap(void*,size_t,int,int,int,off_t);
extern int __munmap(void*,size_t);
size_t _dl_pagesize,_dl_elf_thp_pagesize;
enum thp_mode_t _dl_thp_mode;
int __libc_enable_secure;
int _dl_debug_fd=2;
uintptr_t __pointer_chk_guard_local;
_Static_assert(sizeof(struct pthread)==1184,"GNU descriptor size");
_Static_assert(_Alignof(struct pthread)==32,"GNU descriptor alignment");
_Static_assert(sizeof(time_t)==8&&sizeof(off_t)==8,"GNU time64/off64");
_Static_assert(sizeof(dtv_t)==8,"GNU DTV width");
__attribute__((import_module("linux"),import_name("syscall"))) extern int sc(int,int,int,int,int,int,int);
extern unsigned tls_size(void),tls_align(void),tls_base(void);
extern void __wasm_init_tls(void *),__wasm_call_ctors(void),clone_entry(void *);
extern unsigned char __heap_base;

__attribute__((export_name("__gnu_wasm_raw_tp"))) void raw_marker(void){}
static _Thread_local unsigned tls_initialized=0x12345678,tls_zero;
static unsigned global_canary=0xabcdef01;
static unsigned ctor_count,ctor_saw_ready;
static struct pthread descriptors[3] __attribute__((aligned(32)));
static dtv_t dtvs[3][3];
static unsigned char tls_pool[65536] __attribute__((aligned(65536)));
static unsigned char stacks[2][65536] __attribute__((aligned(16)));
static unsigned char arg_blob[262144] __attribute__((aligned(16)));
static void *images[3];
static unsigned layout_size,layout_align,heap_floor;
struct process_args {int len,envc,argc;char **argv,**envp;};
struct startup_context {int argc,envc;char **argv,**envp;unsigned page_size,secure,uid,euid,gid,egid;void *random;unsigned heap_floor;};
static struct startup_context startup;
struct child_context {unsigned stack_top,image,pd,id,ready,go,done,errors,frame,errno_address,tls_address,checks,start_ready,start_go;};
static struct child_context children[2];
/* Observation only: separates own barriers/clearTID from GNU lock futexes. */
__attribute__((export_name("allocator_futex_class"))) int allocator_futex_class(unsigned address){
 if(address>=(unsigned)children&&address<(unsigned)(children+2))return 0;
 for(unsigned i=0;i<3;i++)if(address==(unsigned)&descriptors[i].joinstate)return 0;
 return 1;
}
static int passes,failures,ready_wakes,clear_wakes;
static void put(const char *s){unsigned n=0;while(s[n])n++;sc(64,1,(int)s,n,0,0,0);}
static void number(unsigned n){char b[12];unsigned i=11;b[i]=0;do{b[--i]='0'+n%10;n/=10;}while(n);put(b+i);}
static void check(const char *label,int good){if(good)passes++;else{failures++;put("GUEST_JIT FAIL ");put(label);put("\n");}}
static int load(unsigned *p){return __atomic_load_n(p,__ATOMIC_SEQ_CST);}
static void store(unsigned *p,unsigned n){__atomic_store_n(p,n,__ATOMIC_SEQ_CST);}
static int futex(unsigned *p,int op,int value){return sc(98,(int)p,op,value,0,0,0);}
static int range(const void *p,unsigned n,unsigned total){return (uintptr_t)p>=(uintptr_t)arg_blob&&(uintptr_t)p-(uintptr_t)arg_blob<=total&&n<=total-((uintptr_t)p-(uintptr_t)arg_blob);}
static int string_in_blob(char *p,unsigned total){if(!range(p,1,total))return 0;while(range(p,1,total)){if(!*p)return 1;p++;}return 0;}
/* This bootstrap C function makes no GNU library/TLS accesses and allocates nothing. */
void *startup_prepare(void){
 layout_size=tls_size();layout_align=tls_align();
 if(!layout_size||!layout_align||(layout_align&(layout_align-1))||layout_align>65536||layout_size>65536/3) {sc(94,90,0,0,0,0,0);__builtin_unreachable();}
 unsigned stride=(layout_size+layout_align-1)&~(layout_align-1);
 if(stride>65536/3){sc(94,91,0,0,0,0,0);__builtin_unreachable();}
 for(unsigned i=0;i<3;i++)images[i]=tls_pool+i*stride;
 heap_floor=(unsigned)&__heap_base;
 return images[0];
}
bool __wasm_gnu_init_tp(void *pd){return sc(244,(int)pd,0,0,0,0,0)==0;}
static void init_descriptor(unsigned i,void *stack,unsigned stack_size){
 struct pthread *pd=&descriptors[i];memset(pd,0,sizeof(*pd));
 pd->header.tcb=pd;pd->header.self=pd;
 dtvs[i][0].counter=1;dtvs[i][1].counter=0;
 dtvs[i][2].pointer.val=images[i];dtvs[i][2].pointer.to_free=0;
 INSTALL_DTV(pd,dtvs[i]);
 pd->specific[0]=&pd->specific_1stblock[0];pd->joinstate=THREAD_STATE_JOINABLE;
 pd->stack_mode=ALLOCATE_GUARD_USER;pd->stackblock=stack;pd->stackblock_size=stack_size;
 pd->header.stack_guard=_dl_setup_stack_chk_guard(startup.random);
 pd->header.pointer_guard=_dl_setup_pointer_guard(startup.random,pd->header.stack_guard);
}
static int descriptor_valid(unsigned i){struct pthread *pd=&descriptors[i];dtv_t *d=GET_DTV(pd);return THREAD_SELF==pd&&pd->header.self==pd&&pd->header.tcb==pd&&d==dtvs[i]+1&&d[-1].counter==1&&d[0].counter==0&&d[1].pointer.val==(void*)tls_base()&&d[1].pointer.to_free==0&&pd->specific[0]==pd->specific_1stblock&&pd->header.stack_guard==_dl_setup_stack_chk_guard(startup.random)&&pd->header.pointer_guard==_dl_setup_pointer_guard(startup.random,pd->header.stack_guard);}
__attribute__((constructor)) static void ctor(void){ctor_count++;ctor_saw_ready=descriptor_valid(0)&&errno==0;}
static int parse_args(void){
 check("args-invalid-range-EFAULT",sc(245,(int)0xfffffff0,262144,0,0,0,0)==-14);
 check("args-small-buffer-E2BIG",sc(245,(int)arg_blob,4,0,0,0,0)==-7);
 if(sc(245,(int)arg_blob,sizeof(arg_blob),0,0,0,0)!=0)return 0;
 struct process_args *a=(void*)arg_blob;
 if(a->len<0||(unsigned)a->len>sizeof(arg_blob)-sizeof(*a)||a->argc<1||a->envc<0)return 0;
 unsigned total=sizeof(*a)+a->len;
 if((unsigned)a->argc>total/4||(unsigned)a->envc>total/4)return 0;
 if(a->argv!=(char**)(arg_blob+sizeof(*a))||a->envp!=a->argv+a->argc+1)return 0;
 if(!range(a->argv,(a->argc+1)*4,total)||!range(a->envp,(a->envc+1)*4,total)||a->argv[a->argc]||a->envp[a->envc])return 0;
 for(int i=0;i<a->argc;i++)if(!string_in_blob(a->argv[i],total))return 0;
 for(int i=0;i<a->envc;i++)if(!string_in_blob(a->envp[i],total))return 0;
 unsigned *aux=(void*)(a->envp+a->envc+1);unsigned found=0;
 while(range(aux,8,total)&&aux[0]){
  unsigned type=aux[0],value=aux[1];
  if(type==3||type==4||type==5||type==7)return 0; /* No ELF PHDR/PHENT/PHNUM/BASE. */
  if(type==6){startup.page_size=value;found|=1;}
  if(type==11){startup.uid=value;found|=2;}
  if(type==12){startup.euid=value;found|=4;}
  if(type==13){startup.gid=value;found|=8;}
  if(type==14){startup.egid=value;found|=16;}
  if(type==23){startup.secure=value;found|=32;}
  if(type==25){startup.random=(void*)value;found|=64;}
  aux+=2;
 }
 if(!range(aux,8,total)||aux[0]||found!=127||!range(startup.random,16,total)||!startup.page_size||(startup.page_size&(startup.page_size-1)))return 0;
 startup.argc=a->argc;startup.envc=a->envc;startup.argv=a->argv;startup.envp=a->envp;startup.heap_floor=heap_floor;
 check("args-one-shot-EINVAL",sc(245,(int)arg_blob,sizeof(arg_blob),0,0,0,0)==-22);return 1;
}
#include <signal.h>
#include <futex-internal.h>
extern void __libc_fatal(const char *);
static volatile unsigned simple_count,info_count,mask_ok,info_ok,return_count;
static void simple(int sig){sigset_t mask;memset(&mask,0,sizeof(mask));simple_count++;sigprocmask(SIG_SETMASK,0,&mask);mask_ok=(mask.__val[0]&(1U<<(SIGUSR1-1)))&&(mask.__val[0]&(1U<<(SIGUSR2-1)));errno=123;}
static void info(int sig,siginfo_t *si,void *context){info_count++;info_ok=si&&si->si_signo==sig&&si->si_code==SI_TKILL&&si->si_pid==__getpid()&&context==0;}
static void returning(int sig){return_count++;put("GNU_ABORT_HANDLER_RETURN count=");number(return_count);put("\n");}
static void set_one(sigset_t *s,int n){memset(s,0,sizeof(*s));s->__val[(n-1)/32]|=1U<<((n-1)%32);}

#define ROUNDS 24
#define SLOTS 8
struct allocation {unsigned char *p;unsigned n;unsigned pattern;};
static struct allocation allocations[3][SLOTS];
static unsigned user_checks[3],user_errors[3],alloc_count[3];
static const unsigned sizes[SLOTS]={1,31,255,4096,12000,180000,360000,768000};
static void user_check(unsigned id,int yes){user_checks[id]++;if(!yes)user_errors[id]++;}
static int all_bytes(unsigned char *p,unsigned n,unsigned expected){for(unsigned j=0;j<n;j++)if(p[j]!=expected)return 0;return 1;}
static void allocate_batch(unsigned id,unsigned round){
 for(unsigned j=0;j<256;j++){
  unsigned n=2048+(j%5)*4096;unsigned char *p=malloc(n);alloc_count[id]++;user_check(id,p&&((uintptr_t)p%16)==0);
  if(p){memset(p,id+round+37,n);user_check(id,all_bytes(p,n,id+round+37));free(p);}
 }
 for(unsigned j=0;j<SLOTS;j++){
  unsigned n=sizes[j]+id*16+round;unsigned char *p=(j&1)?calloc(n,1):malloc(n);alloc_count[id]++;
  user_check(id,p&&((uintptr_t)p%16)==0);if(!p){sc(94,96,0,0,0,0,0);__builtin_unreachable();}
  if(j&1)user_check(id,all_bytes(p,n,0));
  unsigned pattern=41+id*23+round;memset(p,pattern,n);
  unsigned bigger=n+(j>=5?70000:257);unsigned char *q=realloc(p,bigger);user_check(id,q&&((uintptr_t)q%16)==0);
  if(!q){sc(94,97,0,0,0,0,0);__builtin_unreachable();}
  user_check(id,all_bytes(q,n,pattern));memset(q,pattern,bigger);
  allocations[id][j]=(struct allocation){q,bigger,pattern};
 }
}
static void release_batch(unsigned id){
 for(unsigned j=0;j<SLOTS;j++){
  struct allocation *a=&allocations[id][j];user_check(id,all_bytes(a->p,a->n,a->pattern));
  unsigned shrink=a->n/2+1;unsigned char *q=realloc(a->p,shrink);user_check(id,q!=0);if(q){user_check(id,all_bytes(q,shrink,a->pattern));free(q);}else free(a->p);
 }
 unsigned char *dirty=malloc(1024);user_check(id,dirty!=0);if(dirty){memset(dirty,0xa5,1024);free(dirty);}
 unsigned char *zero=calloc(1,1024);user_check(id,zero&&all_bytes(zero,1024,0));free(zero);
 errno=0;user_check(id,calloc(0x40000000U,16)==0&&errno==12);
 errno=100+id;
}
void child_body(struct child_context *c){
 volatile unsigned frame=123;unsigned i=c->id;struct pthread *pd=&descriptors[i];c->frame=(unsigned)&frame;
 c->errno_address=(unsigned)__errno_location();c->tls_address=(unsigned)&tls_initialized;
 c->errors+=!descriptor_valid(i)||pd->tid!=sc(178,0,0,0,0,0,0)||pd->joinstate!=THREAD_STATE_JOINABLE;
 c->errors+=tls_initialized!=0x12345678||tls_zero||errno||ctor_count!=1||!ctor_saw_ready||global_canary!=0xabcdef01;
 c->errors+=pd->header.multiple_threads!=1||__libc_single_threaded!=0||__nptl_nthreads!=3;
 errno=100+i;tls_initialized+=i;tls_zero=i;
 for(unsigned round=0;round<ROUNDS;round++){
  store(&c->start_ready,round+1);futex(&c->start_ready,1,1);
  while(load(&c->start_go)!=round+1)futex(&c->start_go,0,round);
  allocate_batch(i,round);store(&c->ready,round+1);futex(&c->ready,1,1);
  while(load(&c->go)!=round+1)futex(&c->go,0,round);
  release_batch(i);store(&c->done,round+1);futex(&c->done,1,1);
 }
 c->errors+=errno!=100+(int)i||tls_initialized!=0x12345678+i||tls_zero!=i;
 struct {int s,n;} delay={0,100000000};c->errors+=sc(101,(int)&delay,0,0,0,0,0)!=0;
 __atomic_fetch_sub(&__nptl_nthreads,1,__ATOMIC_SEQ_CST);
 sc(93,0,0,0,0,0,0);__builtin_unreachable();
}
__attribute__((noreturn)) void startup_main(void){
 check("args-validated",parse_args());if(!startup.random){sc(94,92,0,0,0,0,0);__builtin_unreachable();}
 check("aux-identities-real-kernel",startup.uid==(unsigned)sc(174,0,0,0,0,0,0)&&startup.euid==(unsigned)sc(175,0,0,0,0,0,0)&&startup.gid==(unsigned)sc(176,0,0,0,0,0,0)&&startup.egid==(unsigned)sc(177,0,0,0,0,0,0));
 init_descriptor(0,0,65536);check("GNU-init-rawTP",TLS_INIT_TP(&descriptors[0]));
 descriptors[0].tid=sc(96,(int)&descriptors[0].joinstate,0,0,0,0,0);
 check("main-tid-address",descriptors[0].tid==sc(178,0,0,0,0,0,0));
 check("GNU-main-descriptor-DTV",descriptor_valid(0));
 check("GNU-guard-low-byte",(descriptors[0].header.stack_guard&255)==0);
 check("GNU-main-TLS",tls_initialized==0x12345678&&!tls_zero&&!errno);
 __wasm_call_ctors();check("ctors-after-TLS-TP",ctor_count==1&&ctor_saw_ready);
 check("safe-final-heap-floor",heap_floor>=(unsigned)(arg_blob+sizeof(arg_blob))&&heap_floor>=(unsigned)(stacks+2)&&heap_floor>=(unsigned)(tls_pool+sizeof(tls_pool))&&heap_floor>=(unsigned)(descriptors+3)&&heap_floor>=(unsigned)(dtvs+3));
 check("heap-uninitialized-until-startup",(unsigned)__sbrk(1)==0xffffffff);
 _dl_pagesize=startup.page_size;__libc_enable_secure=startup.secure;
 __pointer_chk_guard_local=descriptors[0].header.pointer_guard;
 check("heap-init-after-reservations",__wasm_memory_init(heap_floor,startup.page_size)==0);
 check("heap-first-address",(unsigned)__sbrk(0)==((heap_floor+31)&~31U));
 __tunables_init(startup.envp,startup.argv);__ptmalloc_init();
 int count=-1,perturb=-1;size_t arena_max=0;__tunable_get_val(glibc_malloc_arena_max,&arena_max,0);check("real-args-tunables-single-arena",arena_max==1);__tunable_get_val(glibc_malloc_tcache_count,&count,0);__tunable_get_val(glibc_malloc_perturb,&perturb,0);check("real-args-tunables-tcache0-perturb93",count==0&&perturb==93);
 check("genuine-GNU-init-finished",_dl_pagesize==65536&&__libc_enable_secure==0);
 {
 const char *mode=startup.argc>1?startup.argv[1]:"normal";
 struct sigaction a={0},old={0};sigset_t set={0},previous={0};
 if(strcmp(mode,"normal")){
  put("GNU_ABORT_BEGIN mode=");put(mode);put("\n");
  if(!strcmp(mode,"ignored")){a.sa_handler=SIG_IGN;sigaction(SIGABRT,&a,0);}
  if(!strcmp(mode,"returning")){a.sa_handler=returning;sigaction(SIGABRT,&a,0);}
  if(!strcmp(mode,"blocked")){set_one(&set,SIGABRT);sigprocmask(SIG_BLOCK,&set,0);}
  if(!strcmp(mode,"fatal"))__libc_fatal("GNU_FATAL_TEST deterministic message\n");
  abort();
 }
 check("public-action-size",sizeof(a)==140);check("public-info-size",sizeof(siginfo_t)==128);
 struct timespec clock={0};unsigned word=0;
 check("kernel-clock403-time64",sc(403,CLOCK_MONOTONIC,(int)&clock,0,0,0,0)==0&&clock.tv_sec>0&&clock.tv_nsec>=0&&clock.tv_nsec<1000000000);
 struct timespec past={.tv_sec=1,.tv_nsec=0},invalid={.tv_sec=1,.tv_nsec=1000000000};
 check("kernel-futex422-past",sc(422,(int)&word,9,0,(int)&past,0,-1)==-ETIMEDOUT);
 check("GNU-futex-time64-invalid-nsec",__futex_abstimed_wait64(&word,0,CLOCK_MONOTONIC,&invalid,0)==EINVAL);
 check("GNU-futex-time64-past",__futex_abstimed_wait64(&word,0,CLOCK_MONOTONIC,&past,0)==ETIMEDOUT);
 struct timespec genuine={0};check("GNU-clock-time64",clock_gettime(CLOCK_MONOTONIC,&genuine)==0&&genuine.tv_sec>=clock.tv_sec&&genuine.tv_nsec>=0&&genuine.tv_nsec<1000000000);
 a.sa_flags=SA_ONSTACK;errno=0;check("altstack-explicit-unsupported",sigaction(SIGUSR1,&a,0)==-1&&errno==EOPNOTSUPP);a.sa_flags=0;
 a.sa_flags=0x04000000;a.sa_restorer=(void(*)(void))simple;errno=0;check("custom-restorer-explicit-unsupported",sigaction(SIGUSR1,&a,0)==-1&&errno==EOPNOTSUPP);a.sa_restorer=0;a.sa_flags=0;
 errno=0;check("invalid-signal-errno",sigaction(0,&a,0)==-1&&errno==EINVAL);
 errno=0;check("raw-sigaction-error",__libc_sigaction(SIGKILL,&a,0)==-1&&errno==EINVAL);
 a.sa_handler=simple;a.sa_restorer=(void(*)(void))simple;set_one(&a.sa_mask,SIGUSR2);a.sa_flags=SA_RESTART;
 check("install-simple",sigaction(SIGUSR1,&a,&old)==0&&old.sa_handler==SIG_DFL);
 memset(&old,0xa5,sizeof(old));check("query-layout",sigaction(SIGUSR1,0,&old)==0&&old.sa_handler==simple&&old.sa_flags==SA_RESTART&&old.sa_mask.__val[0]==(1U<<(SIGUSR2-1))&&old.sa_restorer==0);
 check("simple-raise",raise(SIGUSR1)==0&&simple_count==1&&mask_ok&&errno==123);
 memset(&set,0,sizeof(set));check("mask-restored",sigprocmask(SIG_SETMASK,0,&set)==0&&!set.__val[0]&&!set.__val[1]);
 set_one(&set,SIGUSR1);check("block-mask",sigprocmask(SIG_BLOCK,&set,&previous)==0);
 check("blocked-raise-pending",raise(SIGUSR1)==0&&simple_count==1);
 check("unblock-delivers",sigprocmask(SIG_SETMASK,&previous,0)==0&&simple_count==2);
 memset(&a,0,sizeof(a));a.sa_sigaction=info;a.sa_flags=SA_SIGINFO;
 check("install-info",sigaction(SIGUSR1,&a,0)==0);check("info-raise",raise(SIGUSR1)==0&&info_count==1&&info_ok);
 memset(&old,0,sizeof(old));check("info-query",sigaction(SIGUSR1,0,&old)==0&&old.sa_sigaction==info&&old.sa_flags==SA_SIGINFO&&old.sa_restorer==0);
 memset(&a,0,sizeof(a));a.sa_handler=SIG_IGN;check("ignore-install",sigaction(SIGUSR1,&a,0)==0);check("ignore-raise",raise(SIGUSR1)==0&&info_count==1&&simple_count==2);
 void *p=malloc(1024);check("GNU-allocator-after-signals",p!=0);free(p);

 memset(&a,0,sizeof(a));a.sa_handler=SIG_DFL;check("signals-reset-before-concurrency",sigaction(SIGUSR1,&a,0)==0);errno=0;
 }
 check("GNU-initial-thread-bookkeeping",__libc_single_threaded==1&&__nptl_nthreads==1);
 errno=0;unsigned tid_sentinel=0xabcddcba,join_sentinel=0x12345678;
 check("invalid-clone-rejected",sc(220,(int)clone_entry,(int)&children[0],0x10000,(int)&tid_sentinel,(int)&join_sentinel,(int)&descriptors[1])==-22);
 check("invalid-clone-no-TID-write",tid_sentinel==0xabcddcba&&join_sentinel==0x12345678);
 check("invalid-clone-preserves-parent-GNU-TLS",descriptor_valid(0)&&tls_initialized==0x12345678&&!tls_zero&&!errno);
 __libc_single_threaded=0;__atomic_store_n(&__nptl_nthreads,3,__ATOMIC_SEQ_CST);
 errno=52;tls_zero=63;descriptors[0].header.multiple_threads=1;
 for(unsigned i=1;i<3;i++){
  init_descriptor(i,stacks[i-1],65536);descriptors[i].header.multiple_threads=1;
  struct child_context *c=&children[i-1];c->stack_top=(unsigned)(stacks[i-1]+65536);c->image=(unsigned)images[i];c->pd=(unsigned)&descriptors[i];c->id=i;
  int flags=0x100|0x200|0x400|0x800|0x10000|0x40000|0x80000|0x100000|0x200000;
  int r=sc(220,(int)clone_entry,(int)c,flags,(int)&descriptors[i].tid,(int)&descriptors[i].joinstate,(int)&descriptors[i]);
  check("clone-GNU-tid",r>0&&descriptors[i].tid==r);if(r<=0){sc(94,93,0,0,0,0,0);__builtin_unreachable();}
 }
 for(unsigned round=0;round<ROUNDS;round++){
  for(unsigned i=0;i<2;i++)while(load(&children[i].start_ready)!=round+1){int r=futex(&children[i].start_ready,0,round);check("round-start-ready-futex",r==0||r==-11);}
  if(round==0)__malloc_fork_lock_parent();
  for(unsigned i=0;i<2;i++){store(&children[i].start_go,round+1);futex(&children[i].start_go,1,1);}
  if(round==0){
   struct {int s,n;} held={0,100000000};check("GNU-allocator-lock-hold-nanosleep",sc(101,(int)&held,0,0,0,0,0)==0);
   check("GNU-allocator-held-mutex-blocks-children",!load(&children[0].ready)&&!load(&children[1].ready));
   __malloc_fork_unlock_parent();
  }
  allocate_batch(0,round);
  for(unsigned i=0;i<2;i++){while(load(&children[i].ready)!=round+1){int r=futex(&children[i].ready,0,round);if(!r)ready_wakes++;check("ready-futex",r==0||r==-11);}check("child-ready-errors",!children[i].errors);}
  for(unsigned a=0;a<3*SLOTS;a++){
   struct allocation *x=&allocations[a/SLOTS][a%SLOTS];
   check("all-users-payload-before-free",all_bytes(x->p,x->n,x->pattern));
   for(unsigned b=a+1;b<3*SLOTS;b++){
    struct allocation *y=&allocations[b/SLOTS][b%SLOTS];
    check("pairwise-nonoverlap",(uintptr_t)x->p+x->n<=(uintptr_t)y->p||(uintptr_t)y->p+y->n<=(uintptr_t)x->p);
   }
  }
  for(unsigned i=0;i<2;i++){store(&children[i].go,round+1);futex(&children[i].go,1,1);}
  release_batch(0);
  for(unsigned i=0;i<2;i++)while(load(&children[i].done)!=round+1){int r=futex(&children[i].done,0,round);check("round-done-futex",r==0||r==-11);}
 }
 check("GNU-errno-distinct",children[0].errno_address!=children[1].errno_address&&children[0].errno_address!=(unsigned)__errno_location()&&children[1].errno_address!=(unsigned)__errno_location());
 check("GNU-TLS-distinct",children[0].tls_address!=children[1].tls_address&&children[0].tls_address!=(unsigned)&tls_initialized);
 for(unsigned i=0;i<2;i++){
  unsigned *join=&descriptors[i+1].joinstate;
  while(load(join)){int r=futex(join,0,THREAD_STATE_JOINABLE);if(!r)clear_wakes++;check("GNU-joinstate-cleartid-futex",r==0||r==-11);}
  check("GNU-joinstate-cleared",!load(join)&&load(&children[i].done)==ROUNDS);check("child-isolated-state",!children[i].errors);
  check("private-child-stack",children[i].frame>=(unsigned)stacks[i]&&children[i].frame<(unsigned)(stacks[i]+65536));
 }
 check("measured-ready-wake",ready_wakes>0);check("measured-GNU-joinstate-wake",clear_wakes>0);
 check("parent-errno-TLS-retained",errno==100&&tls_zero==63&&tls_initialized==0x12345678&&descriptor_valid(0));
 check("global-BSS-ctors-preserved",global_canary==0xabcdef01&&ctor_count==1&&ctor_saw_ready);
 for(unsigned id=0;id<3;id++){passes+=user_checks[id]-user_errors[id];failures+=user_errors[id];}
 check("GNU-thread-count-exit",__nptl_nthreads==1&&__libc_single_threaded==0);
 unsigned stable_pages=0,reuse_cursor=0;
 for(unsigned i=0;i<24;i++){
  unsigned char *p=malloc(1500000);check("large-reuse-malloc",p!=0);if(!p)break;memset(p,0xa5,1500000);free(p);
  unsigned char *q=calloc(1,1500000);check("large-reuse-calloc-zero",q&&all_bytes(q,1500000,0));free(q);
  if(i==4){stable_pages=__builtin_wasm_memory_size(0);reuse_cursor=__wasm_memory_cursor();}
  if(i>4)check("large-free-reuse-no-growth",stable_pages==__builtin_wasm_memory_size(0)&&reuse_cursor==__wasm_memory_cursor());
 }
 unsigned char *p=malloc(256);check("OOM-source",p!=0);if(p){memset(p,0x45,256);unsigned before=__wasm_memory_cursor(),pages=__builtin_wasm_memory_size(0);errno=0;
  check("realloc-OOM",realloc(p,0x7fffffffU)==0&&errno==12);check("realloc-OOM-old-payload",all_bytes(p,256,0x45));
  check("OOM-preserves-cursor-pages",before==__wasm_memory_cursor()&&pages==__builtin_wasm_memory_size(0));free(p);}
 unsigned before=__wasm_memory_cursor(),pages=__builtin_wasm_memory_size(0);errno=0;
 check("provider-invalid-flags",(uintptr_t)__mmap(0,65536,3,0x32,-1,0)==0xffffffff&&errno==95);
 check("provider-failure-preserves-cursor-pages",before==__wasm_memory_cursor()&&pages==__builtin_wasm_memory_size(0));
 put("GUEST_JIT allocator rounds=");number(ROUNDS);put(" users=3 allocations=");number(alloc_count[0]+alloc_count[1]+alloc_count[2]);put(" pairwise=");number(ROUNDS*(3*SLOTS)*(3*SLOTS-1)/2);put(" pages=");number(__builtin_wasm_memory_size(0));put(" cursor=");number(__wasm_memory_cursor());put(" nthreads=");number(__nptl_nthreads);put(" single=");number(__libc_single_threaded);put("\n");
 put("GUEST_JIT startup pthread_size=");number(sizeof(struct pthread));put(" pthread_align=");number(_Alignof(struct pthread));put(" dtv_size=");number(sizeof(dtv_t));put(" tls_size=");number(layout_size);put(" tls_align=");number(layout_align);put(" heap_floor=");number(heap_floor);put(" pagesize=");number(startup.page_size);put(" argc=");number(startup.argc);put(" envc=");number(startup.envc);put(" secure=");number(startup.secure);put("\n");
 put("GUEST_JIT child errno_addresses=");number(children[0].errno_address);put(",");number(children[1].errno_address);put(" parent_errno=");number((unsigned)__errno_location());put(" ready_wakes=");number(ready_wakes);put(" joinstate_wakes=");number(clear_wakes);put("\n");
 put("GUEST_JIT_RESULT pass=");number(passes);put(" fail=");number(failures);put("\n");sc(94,failures?1:0,0,0,0,0,0);__builtin_unreachable();
}
