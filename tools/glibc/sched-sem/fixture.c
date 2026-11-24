/* Actual GNU public scheduler/semaphore APIs; no replacement algorithms. */
#include <bits/types/struct_sched_param.h>
#include <sched.h>
#include <semaphore.h>
#include <unistd.h>
#include <errno.h>
#include <limits.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
extern void sched_sem_record(const char *,int);
extern int sched_sem_raw(int,int,int,int,int,int,int);
#define C(n,x) sched_sem_record(n,!!(x))
#define REF(n) static __typeof__(&n) volatile p_##n=&n
REF(sched_getparam);REF(sched_setparam);REF(sched_setscheduler);REF(sched_getscheduler);REF(sched_yield);
REF(sem_init);REF(sem_post);REF(sem_trywait);REF(sem_getvalue);REF(sem_destroy);
static sem_t spaces,items;static unsigned sequence,active,consumed;static unsigned char payload[256];
static uintptr_t buffers[2];static unsigned thread_errors[2],yield_count[2];
struct guarded {unsigned char before[16];struct sched_param param;unsigned char after[16];};
_Static_assert(__builtin_offsetof(struct guarded,param)==16 && __builtin_offsetof(struct guarded,after)==20,"immediate contiguous canaries");
static int guards(struct guarded *g){for(unsigned i=0;i<16;i++)if(g->before[i]!=0xa5||g->after[i]!=0xa5)return 0;return 1;}
void sched_sem_tests(void){
 int saved=errno;pid_t pid=getpid();struct guarded g;memset(&g,0xa5,sizeof(g));errno=181;
 C("sched-getparam-pid0-guards",p_sched_getparam(0,&g.param)==0&&g.param.sched_priority==0&&guards(&g)&&errno==181);
 struct sched_param raw={-1};C("sched-getparam-raw-readback",sched_sem_raw(121,pid,(int)&raw,0,0,0,0)==0&&raw.sched_priority==g.param.sched_priority);
 errno=182;C("sched-getparam-current-guards",p_sched_getparam(pid,&g.param)==0&&guards(&g)&&errno==182);
 int prio=g.param.sched_priority,policy=p_sched_getscheduler(0);errno=183;
 C("sched-setparam-preserved",p_sched_setparam(0,&g.param)==0&&errno==183&&p_sched_getscheduler(0)==policy);
 errno=0;C("sched-getparam-negative-preserves",p_sched_getparam(-1,&g.param)==-1&&errno==EINVAL&&guards(&g)&&g.param.sched_priority==prio);
 errno=0;C("sched-getparam-null",p_sched_getparam(0,0)==-1&&errno==EINVAL);
 errno=0;C("sched-getparam-missing-preserves",p_sched_getparam(INT_MAX,&g.param)==-1&&errno==ESRCH&&guards(&g)&&g.param.sched_priority==prio);
 errno=0;C("sched-setparam-negative",p_sched_setparam(-1,&g.param)==-1&&errno==EINVAL);
 errno=0;C("sched-setparam-null",p_sched_setparam(0,0)==-1&&errno==EINVAL);
 errno=0;C("sched-setparam-missing",p_sched_setparam(INT_MAX,&g.param)==-1&&errno==ESRCH);
 errno=0;C("sched-setscheduler-negative-policy",p_sched_setscheduler(0,-1,&g.param)==-1&&errno==EINVAL&&p_sched_getscheduler(0)==policy);
 struct sched_param bad={1};errno=0;C("sched-invalid-priority-preserves",p_sched_setscheduler(0,SCHED_OTHER,&bad)==-1&&errno==EINVAL&&p_sched_getscheduler(0)==policy);
 sem_t s,overflow;int v=-1;errno=191;
 C("sem-init-empty",p_sem_init(&s,0,0)==0&&errno==191);
 C("sem-empty-value",p_sem_getvalue(&s,&v)==0&&v==0&&errno==191);
 errno=0;C("sem-empty-trywait",p_sem_trywait(&s)==-1&&errno==EAGAIN);
 errno=192;C("sem-post-one",p_sem_post(&s)==0&&p_sem_getvalue(&s,&v)==0&&v==1&&errno==192);
 C("sem-consume-one",p_sem_trywait(&s)==0&&p_sem_getvalue(&s,&v)==0&&v==0&&errno==192);
 C("sem-count-three",p_sem_post(&s)==0&&p_sem_post(&s)==0&&p_sem_post(&s)==0&&p_sem_getvalue(&s,&v)==0&&v==3);
 C("sem-drain-three",p_sem_trywait(&s)==0&&p_sem_trywait(&s)==0&&p_sem_trywait(&s)==0&&p_sem_getvalue(&s,&v)==0&&v==0);
 C("sem-overflow-init",p_sem_init(&overflow,0,SEM_VALUE_MAX)==0);errno=0;
 C("sem-overflow-preserves",p_sem_post(&overflow)==-1&&errno==EOVERFLOW&&p_sem_getvalue(&overflow,&v)==0&&v==SEM_VALUE_MAX);
 errno=0;C("sem-invalid-init",p_sem_init(&s,0,(unsigned)SEM_VALUE_MAX+1U)==-1&&errno==EINVAL);
 C("sem-destroy",p_sem_destroy(&s)==0&&p_sem_destroy(&overflow)==0);
 C("sem-concurrency-init",p_sem_init(&spaces,0,1)==0&&p_sem_init(&items,0,0)==0);
 errno=saved;
}
int sched_sem_policy_process(void){
 int saved_errno=errno;pid_t pid=getpid(),ppid=getppid(),sid=getsid(0),pgid=getpgid(0);uid_t uid=getuid();gid_t gid=getgid();
 struct sched_param original,check;int policy=p_sched_getscheduler(0),ok=policy>=0&&p_sched_getparam(0,&original)==0;
 struct sched_param zero={0};
 ok&=p_sched_setscheduler(0,SCHED_OTHER,&zero)==0;ok&=p_sched_getscheduler(0)==SCHED_OTHER&&p_sched_getparam(0,&check)==0&&check.sched_priority==0;
 ok&=p_sched_setscheduler(0,SCHED_BATCH,&zero)==0;ok&=p_sched_getscheduler(0)==SCHED_BATCH&&p_sched_getparam(0,&check)==0&&check.sched_priority==0;
 ok&=p_sched_setparam(0,&zero)==0&&p_sched_getscheduler(0)==SCHED_BATCH;
 ok&=p_sched_setscheduler(0,SCHED_OTHER,&zero)==0&&p_sched_getscheduler(0)==SCHED_OTHER;
 int restored=p_sched_setscheduler(0,policy,&original)==0&&p_sched_setparam(0,&original)==0;
 ok&=restored&&p_sched_getscheduler(0)==policy&&p_sched_getparam(0,&check)==0&&check.sched_priority==original.sched_priority;
 ok&=pid==getpid()&&ppid==getppid()&&sid==getsid(0)&&pgid==getpgid(0)&&uid==getuid()&&gid==getgid();errno=saved_errno;return ok;
}
static int token(sem_t *s,unsigned id){for(unsigned n=0;n<1000000;n++){if(p_sem_trywait(s)==0)return 1;if(errno!=EAGAIN)return 0;yield_count[id]++;if(p_sched_yield()!=0)return 0;}return 0;}
int sched_sem_thread(unsigned id){
 int saved=errno;unsigned x=id-1,ok=1;unsigned char *b=malloc(512);if(!b){errno=saved;return 0;}buffers[x]=(uintptr_t)b;
 for(unsigned seq=1;seq<=512;seq++){
  if(!token(id==1?&spaces:&items,x)){ok=0;break;}
  if(__atomic_exchange_n(&active,1,__ATOMIC_SEQ_CST))ok=0;
  if(id==1){sequence=seq;for(unsigned j=0;j<256;j++)payload[j]=(unsigned char)(seq+j);memset(b,(unsigned char)seq,512);}
  else{if(sequence!=seq)ok=0;for(unsigned j=0;j<256;j++)if(payload[j]!=(unsigned char)(seq+j))ok=0;consumed=seq;memset(b,(unsigned char)seq,512);}
  __atomic_store_n(&active,0,__ATOMIC_SEQ_CST);
  if(p_sem_post(id==1?&items:&spaces)!=0){ok=0;break;}
 }
 thread_errors[x]=!ok;free(b);errno=saved;return ok;
}
int sched_sem_finish(void){
 int saved=errno,a=-1,b=-1;int ok=p_sem_getvalue(&spaces,&a)==0&&p_sem_getvalue(&items,&b)==0&&a==1&&b==0&&consumed==512&&!active&&!thread_errors[0]&&!thread_errors[1];
 ok&=buffers[0]&&buffers[1]&&(buffers[0]+512<=buffers[1]||buffers[1]+512<=buffers[0]);
 ok&=p_sem_destroy(&spaces)==0&&p_sem_destroy(&items)==0;errno=saved;return ok;
}
