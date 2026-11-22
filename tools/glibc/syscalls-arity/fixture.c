/* Public GNU-header client; historical module declarations explicitly owned. */
#include <unistd.h>
#include <sys/prctl.h>
#include <errno.h>
#include <stdint.h>
#include <string.h>
#include <signal.h>
extern int init_module(void *,unsigned long,const char *);
extern int delete_module(const char *,unsigned int);
extern __typeof__(prctl) __prctl_time64;
static void (*volatile p_sync)(void)=sync;
static int (*volatile p_vhangup)(void)=vhangup;
static int (*volatile p_prctl)(int,...)=prctl;
static int (*volatile p_time64)(int,...)=__prctl_time64;
static int (*volatile p_init)(void*,unsigned long,const char*)=init_module;
static int (*volatile p_delete)(const char*,unsigned int)=delete_module;
extern void arity_record(const char*,int);
extern int arity_raw(int,int,int,int,int,int,int);
#define C(n,x) arity_record("arity-" n,!!(x))
struct name_guard {unsigned char before[16],name[16],after[16];};
struct int_guard {unsigned char before[16],value[4],after[16];};
_Static_assert(sizeof(struct name_guard)==48 && __builtin_offsetof(struct name_guard,after)==32,"immediate name guards");
_Static_assert(sizeof(struct int_guard)==36 && __builtin_offsetof(struct int_guard,after)==20,"immediate int guards");
static int bytes(const void*p,unsigned n,unsigned v){const unsigned char*b=p;for(unsigned i=0;i<n;i++)if(b[i]!=v)return 0;return 1;}
static int guard_name(const struct name_guard*g){return bytes(g->before,16,0xa5)&&bytes(g->after,16,0xa5);}
static int guarded_name(char out[16]){struct name_guard g;memset(&g,0xa5,sizeof g);int r=p_prctl(PR_GET_NAME,(char*)g.name);if(r||!guard_name(&g))return 0;memcpy(out,g.name,16);return 1;}
void arity_tests(void){
 int saved=errno;errno=EMLINK;p_sync();C("sync-void-errno",errno==EMLINK);
 unsigned char image[32],image_copy[32];memset(image,0x73,sizeof image);memcpy(image_copy,image,32);
 char module[24]="gnu-arity-module",parameters[24]="arity=unchanged";char name_copy[24],parameters_copy[24];memcpy(name_copy,module,24);memcpy(parameters_copy,parameters,24);
 errno=0;C("init-three-enosys",p_init(image,sizeof image,parameters)==-1&&errno==ENOSYS);C("init-inputs-unchanged",!memcmp(image,image_copy,32)&&!memcmp(parameters,parameters_copy,24));
 errno=0;C("delete-two-enosys",p_delete(module,0)==-1&&errno==ENOSYS);C("delete-input-unchanged",!memcmp(module,name_copy,24));
 errno=0;C("init-altered-enosys",p_init((void*)(uintptr_t)UINT32_MAX,UINT32_MAX,(char*)(uintptr_t)UINT32_MAX)==-1&&errno==ENOSYS);
 errno=0;C("delete-altered-enosys",p_delete((char*)(uintptr_t)UINT32_MAX,UINT32_MAX)==-1&&errno==ENOSYS);
 char old[16],now[16];C("name-guarded-get",guarded_name(old));char name[32]="gnu-arity-name-is-truncated-here";
 errno=EMLINK;C("name-one-pointer-set",p_prctl(PR_SET_NAME,name)==0&&errno==EMLINK);C("name-truncation",guarded_name(now)&&!memcmp(now,name,15)&&now[15]==0);
 C("name-restore-set",p_prctl(PR_SET_NAME,old)==0);C("name-restore-read",guarded_name(now)&&!memcmp(now,old,16));
 errno=0;C("name-get-efault",p_prctl(PR_GET_NAME,(char*)(uintptr_t)UINT32_MAX)==-1&&errno==EFAULT);
 errno=0;C("name-set-efault",p_prctl(PR_SET_NAME,(char*)(uintptr_t)UINT32_MAX)==-1&&errno==EFAULT);C("name-after-fault",guarded_name(now)&&!memcmp(now,old,16));
 errno=EMLINK;int dump=p_prctl(PR_GET_DUMPABLE);C("dump-zero-args",dump>=0&&dump<=2&&errno==EMLINK);
 C("dump-set-zero",p_prctl(PR_SET_DUMPABLE,0UL)==0&&p_prctl(PR_GET_DUMPABLE)==0);
 errno=0;C("dump-invalid",p_prctl(PR_SET_DUMPABLE,9UL)==-1&&errno==EINVAL&&p_prctl(PR_GET_DUMPABLE)==0);
 C("dump-restore",dump<=1&&p_prctl(PR_SET_DUMPABLE,(unsigned long)dump)==0&&p_prctl(PR_GET_DUMPABLE)==dump);
 errno=EMLINK;C("time64-alias-zero",p_time64(PR_GET_DUMPABLE)==dump&&errno==EMLINK);
 errno=EMLINK;C("timing-zero",p_prctl(PR_GET_TIMING)==PR_TIMING_STATISTICAL&&errno==EMLINK);
 errno=0;C("timing-one-invalid",p_prctl(PR_SET_TIMING,9UL)==-1&&errno==EINVAL);
 struct int_guard ig;memset(&ig,0xa5,sizeof ig);C("pdeath-pointer-get",p_prctl(PR_GET_PDEATHSIG,(int*)(void*)ig.value)==0&&bytes(ig.before,16,0xa5)&&bytes(ig.after,16,0xa5));int death;memcpy(&death,ig.value,4);
 C("pdeath-clear",p_prctl(PR_SET_PDEATHSIG,0UL)==0);errno=0;C("pdeath-invalid",p_prctl(PR_SET_PDEATHSIG,128UL)==-1&&errno==EINVAL);C("pdeath-restore",p_prctl(PR_SET_PDEATHSIG,(unsigned long)death)==0);
 int slack=p_prctl(PR_GET_TIMERSLACK);C("timerslack-get-zero",slack>0);C("timerslack-set-one",p_prctl(PR_SET_TIMERSLACK,25000UL)==0&&p_prctl(PR_GET_TIMERSLACK)==25000);C("timerslack-restore",p_prctl(PR_SET_TIMERSLACK,(unsigned long)slack)==0&&p_prctl(PR_GET_TIMERSLACK)==slack);
 int nn=p_prctl(PR_GET_NO_NEW_PRIVS,0UL,0UL,0UL,0UL);C("reserved-four-read",nn==0||nn==1);errno=0;C("reserved-four-invalid",p_prctl(PR_GET_NO_NEW_PRIVS,0UL,1UL,0UL,0UL)==-1&&errno==EINVAL);errno=0;C("set-no-new-privs-invalid",p_prctl(PR_SET_NO_NEW_PRIVS,2UL,0UL,0UL,0UL)==-1&&errno==EINVAL&&p_prctl(PR_GET_NO_NEW_PRIVS,0UL,0UL,0UL,0UL)==nn);
 errno=0;C("seccomp-two-invalid",p_prctl(PR_SET_SECCOMP,0UL,(void*)(uintptr_t)UINT32_MAX)==-1&&errno==EINVAL);
 errno=0;C("futex-hash-three-invalid",p_prctl(PR_FUTEX_HASH,UINT32_MAX,13UL,17UL)==-1&&errno==EINVAL);
 errno=0;C("set-vma-four",p_prctl(PR_SET_VMA,0UL,0UL,0UL,(char*)(uintptr_t)UINT32_MAX)==-1&&errno==EINVAL);
 errno=EMLINK;int secure=p_prctl(PR_GET_SECUREBITS);C("security-zero-securebits",secure>=0&&errno==EMLINK);
 errno=EMLINK;int keep=p_prctl(PR_GET_KEEPCAPS);C("security-zero-keepcaps",(keep==0||keep==1)&&errno==EMLINK);
 errno=0;C("security-set-keepcaps-invalid",p_prctl(PR_SET_KEEPCAPS,2UL)==-1&&errno==EINVAL&&p_prctl(PR_GET_KEEPCAPS)==keep);
 int cap=p_prctl(PR_CAPBSET_READ,0UL);C("security-cap-read-one",cap==0||cap==1);errno=0;C("security-cap-read-invalid",p_prctl(PR_CAPBSET_READ,UINT32_MAX)==-1&&errno==EINVAL);
 errno=0;C("security-cap-drop-invalid",p_prctl(PR_CAPBSET_DROP,UINT32_MAX)==-1&&errno==EINVAL);
 errno=0;C("security-securebits-invalid",p_prctl(PR_SET_SECUREBITS,UINT32_MAX)==-1&&errno==EPERM&&p_prctl(PR_GET_SECUREBITS)==secure);
 int ambient=p_prctl(PR_CAP_AMBIENT,(unsigned long)PR_CAP_AMBIENT_IS_SET,0UL,0UL,0UL);C("security-ambient-four",ambient==0||ambient==1);errno=0;C("security-ambient-invalid",p_prctl(PR_CAP_AMBIENT,(unsigned long)PR_CAP_AMBIENT_IS_SET,0UL,1UL,0UL)==-1&&errno==EINVAL);
 errno=0;C("unknown-no-args",p_prctl(0x6fffffff)==-1&&errno==EINVAL);
 errno=saved;
}
int arity_thread(unsigned i){
 int saved=errno;char old[16],now[16],name[16]="gnu-arity-t0";name[11]='0'+i;int ok=guarded_name(old)&&p_prctl(PR_SET_NAME,name)==0&&guarded_name(now)&&!memcmp(now,name,12);errno=0;ok&=p_prctl(0x6fffffff)==-1&&errno==EINVAL;ok&=p_prctl(PR_SET_NAME,old)==0&&guarded_name(now)&&!memcmp(now,old,16);errno=saved;return ok;
}
int arity_vhangup_process(void){
 int saved=errno;int pid=getpid(),sid=getsid(0),group=getpgid(0);if(pid!=sid||pid!=group)return 0;
 errno=EMLINK;int r=p_vhangup();int ok=r==0&&errno==EMLINK&&getpid()==pid&&getsid(0)==sid&&getpgid(0)==group;errno=saved;return ok;
}
