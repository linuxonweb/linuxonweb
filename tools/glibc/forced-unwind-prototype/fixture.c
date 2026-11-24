#define _SETJMP_H 1
#include <bits/setjmp.h>
extern int setjmp(__jmp_buf) __attribute__((returns_twice));
extern void prototype_raise(void);
extern void fixture_cpp_middle(void);
extern void prototype_record(int);
extern void prototype_reset(int,void*);
extern unsigned prototype_status(void);
extern unsigned prototype_stack_pointer(void);
static __jmp_buf target;
static void cleanup(int *p){prototype_record(*p);}
__attribute__((noinline)) void fixture_inner(void){int v __attribute__((cleanup(cleanup)))=2; prototype_raise();}
__attribute__((noinline)) void fixture_middle(void){int v __attribute__((cleanup(cleanup)))=1; fixture_inner();}
unsigned fixture_run(int mode){
 prototype_reset(mode,target);
 int v __attribute__((cleanup(cleanup)))=9;
 int r=setjmp(target);
 if(!r){if(mode==2)fixture_cpp_middle();else fixture_middle();return 999;}
 unsigned status=prototype_status();
 return r==37?status:998;
}
