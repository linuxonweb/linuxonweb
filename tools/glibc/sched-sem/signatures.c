#include <bits/types/struct_sched_param.h>
#include <sched.h>
#include <semaphore.h>
#include <stddef.h>
#include <internaltypes.h>
#include <nptl/descr.h>
#define VERIFY(name,result,...) \
 _Static_assert(__builtin_types_compatible_p(__typeof__(&name),result (*)(__VA_ARGS__)),#name " genuine GNU prototype"); \
 __typeof__(&name) volatile public_reference_##name=&name
VERIFY(sched_getparam,int,pid_t,struct sched_param *);
VERIFY(sched_setparam,int,pid_t,const struct sched_param *);
VERIFY(sched_setscheduler,int,pid_t,int,const struct sched_param *);
VERIFY(sem_init,int,sem_t *,int,unsigned int);
VERIFY(sem_post,int,sem_t *);
VERIFY(sem_trywait,int,sem_t *);
VERIFY(sem_getvalue,int,sem_t *,int *);
VERIFY(sem_destroy,int,sem_t *);
_Static_assert(sizeof(struct sched_param)==4 && _Alignof(struct sched_param)==4 && offsetof(struct sched_param,sched_priority)==0,"GNU sched_param ABI");
_Static_assert(sizeof(struct pthread)==1184 && _Alignof(struct pthread)==32,"genuine GNU descriptor unchanged");
const unsigned sched_sem_layout[]={sizeof(struct sched_param),_Alignof(struct sched_param),offsetof(struct sched_param,sched_priority),sizeof(sem_t),_Alignof(sem_t),sizeof(struct new_sem),_Alignof(struct new_sem),USE_64B_ATOMICS_ON_SEM_T,sizeof(struct pthread_attr),sizeof(struct pthread),_Alignof(struct pthread)};
