/* Native tag/C cleanup fixture, not a C++ exception or cancellation runtime. */
#include <pthreadP.h>
#include <errno.h>
extern void cleanup_throw(int);
extern int cleanup_catch(void (*)(void));
extern unsigned cleanup_stack_pointer(void);
extern void cleanup_exec_raw(char **);
extern void c_cleanup_record(const char *,int);
static int sequence[32],used,throw_cleanup,init_calls,once_result=-1;
static __thread int marker;
static pthread_once_t once=PTHREAD_ONCE_INIT;
static void cleanup(int *p){if(*p==4)c_cleanup_record("exec-old-cleanup-ran",0);sequence[used++]=*p;if(throw_cleanup)cleanup_throw(999);}
__attribute__((noinline)) static void inner(void){int v __attribute__((cleanup(cleanup)))=2;cleanup_throw(731);}
__attribute__((noinline)) static void outer(void){int v __attribute__((cleanup(cleanup)))=1;inner();}
static void normal(void){int v __attribute__((cleanup(cleanup)))=3;}
static void loop(void){for(int i=0;i<3;i++){int v __attribute__((cleanup(cleanup)))=10+i;if(i==0)continue;if(i==1)break;}}
static void indirect(void){void (*volatile fn)(void)=outer;fn();}
static void initializer(void){init_calls++;if(init_calls==1)cleanup_throw(853);marker=94;}
static void fixture_once_call(void){once_result=pthread_once(&once,initializer);}
void cleanup_abort(void){throw_cleanup=1;outer();__builtin_unreachable();}
void cleanup_exec(char **envp){marker=157;used=7;int v __attribute__((cleanup(cleanup)))=4;cleanup_exec_raw(envp);}
int cleanup_exec_target_fresh(void){return marker==0&&once==PTHREAD_ONCE_INIT&&init_calls==0&&used==0;}
void c_cleanup_tests(void){
 struct _pthread_cleanup_buffer *original=THREAD_SELF->cleanup;
 errno=72;marker=91;used=0;unsigned saved_sp=cleanup_stack_pointer();
 c_cleanup_record("native-cleanup-nested-payload",cleanup_catch(outer)==731&&cleanup_stack_pointer()==saved_sp&&used==2&&sequence[0]==2&&sequence[1]==1);
 c_cleanup_record("native-cleanup-errno-TLS",errno==72&&marker==91&&THREAD_SELF->cleanup==original);
 used=0;c_cleanup_record("native-cleanup-ordinary-return",cleanup_catch(normal)==0&&cleanup_stack_pointer()==saved_sp&&used==1&&sequence[0]==3);
 used=0;c_cleanup_record("native-cleanup-loop-continue-break",cleanup_catch(loop)==0&&cleanup_stack_pointer()==saved_sp&&used==2&&sequence[0]==10&&sequence[1]==11);
 used=0;c_cleanup_record("native-cleanup-indirect-rethrow",cleanup_catch(indirect)==731&&cleanup_stack_pointer()==saved_sp&&used==2&&sequence[0]==2&&sequence[1]==1);
 c_cleanup_record("GNU-once-throw-reset-chain",cleanup_catch(fixture_once_call)==853&&cleanup_stack_pointer()==saved_sp&&once==0&&init_calls==1&&once_result==-1&&THREAD_SELF->cleanup==original);
 c_cleanup_record("GNU-once-retry-success-chain",cleanup_catch(fixture_once_call)==0&&cleanup_stack_pointer()==saved_sp&&once==2&&init_calls==2&&once_result==0&&marker==94&&THREAD_SELF->cleanup==original);
 c_cleanup_record("GNU-once-done-exactly-once",cleanup_catch(fixture_once_call)==0&&cleanup_stack_pointer()==saved_sp&&once==2&&init_calls==2&&once_result==0&&THREAD_SELF->cleanup==original);
 errno=0;
}
