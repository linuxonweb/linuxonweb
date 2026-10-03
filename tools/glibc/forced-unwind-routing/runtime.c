#include <unwind.h>
#define _SETJMP_H 1
#include <bits/setjmp.h>
struct Frame {struct Frame *parent;void *cfa;unsigned epoch,id,visited;};
static struct Frame *current,*saved;
static void *pending,*root_sp;
static __jmp_buf *target;
static unsigned generation,mode,used,sequence[16],stops,failures;
static struct _Unwind_Exception exception;
static unsigned deleted;
static void verify(int yes){if(!yes)failures++;}
static void exception_cleanup(_Unwind_Reason_Code reason,struct _Unwind_Exception *obj){verify(reason==_URC_FOREIGN_EXCEPTION_CAUGHT&&obj==&exception);deleted++;}
void prototype_root(void *sp){root_sp=sp;pending=sp;}
void prototype_enter(struct Frame *f,void *local,unsigned id){f->parent=current;f->cfa=pending;f->id=id;f->epoch=++generation;f->visited=0;verify(pending!=0&&(unsigned)pending>=(unsigned)local&&(unsigned)pending<=(unsigned)root_sp);pending=0;current=f;}
void prototype_leave(struct Frame *f){verify(current==f);current=f->parent;f->epoch=0;}
void prototype_publish(void *sp){pending=sp;}
void prototype_record(int n){if(used<16)sequence[used++]=n;else failures++;}
void prototype_reset(int m,void *env){mode=m;target=env;used=stops=failures=deleted=0;saved=current;exception.exception_class=0;exception.exception_cleanup=exception_cleanup;}
void __wasm_setjmp(__jmp_buf b,int label,void *invocation){b[0].__invocation=invocation;b[0].__label=label;}
int __wasm_setjmp_test(__jmp_buf b,void *invocation){return b[0].__invocation==invocation?b[0].__label:0;}
__attribute__((noreturn)) void __wasm_longjmp(__jmp_buf b,int v){b[0].__env=b;b[0].__value=v;__builtin_wasm_throw(1,&b[0].__env);}
void prototype_stop(void *obj,struct Frame *f){verify(obj==&exception&&current==f&&f->epoch&&f->cfa);if(!f->visited){f->visited=1;stops++;}else failures++;
 if(f==saved&&mode){verify(used==2&&sequence[0]==(mode==2?4:2)&&sequence[1]==(mode==2?3:1));current=saved;pending=0;__wasm_longjmp(*target,37);}
}
__attribute__((noreturn)) void prototype_raise(void){_Unwind_RaiseException(&exception);__builtin_trap();}
unsigned prototype_status(void){verify(used==2&&stops==3&&current==saved);return failures?failures:37;}
unsigned prototype_used(void){return used;}
unsigned prototype_sequence(unsigned i){return i<used?sequence[i]:0;}
unsigned prototype_stops(void){return stops;}
unsigned prototype_failures(void){return failures;}
unsigned prototype_live(void){return current!=0;}
void *prototype_exception_pointer(void){return &exception;}
unsigned prototype_delete_exception(void){_Unwind_DeleteException(&exception);return deleted;}
void abort(void){__builtin_trap();}

__attribute__((noreturn)) void prototype_forward_tag0(void *obj){__builtin_wasm_throw(0,obj);}
