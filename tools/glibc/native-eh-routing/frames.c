/* Native compiler controls; GNU public jump/cancellation APIs remain separate. */
#define _SETJMP_H 1
#include <bits/setjmp.h>
extern int setjmp(__jmp_buf) __attribute__((returns_twice));
extern void route_jump(__jmp_buf,int) __attribute__((noreturn));
extern void raw_raise(unsigned,unsigned) __attribute__((noreturn));
extern unsigned observe_stack(void);
static __jmp_buf env,inner_env;
static __jmp_buf *active_env=&env;
static unsigned kind,tag,trace[32],used,frame_entries,lowest;
static volatile unsigned sink;
__attribute__((noinline)) static void cleanup(unsigned *v){
 if(used<32)trace[used++]=*v;
}
__attribute__((noinline)) static void mark(void){
 unsigned sp=observe_stack();if(sp<lowest)lowest=sp;frame_entries++;
}
__attribute__((noinline,noreturn)) static void raise(void){
 if(tag==2)route_jump(*active_env,37);
 raw_raise(tag,731);
}
__attribute__((noinline)) static void zero_frame(unsigned n){mark();sink+=n;raise();}
__attribute__((noinline)) static void static_frame(unsigned n){
 volatile char a[97];a[0]=(char)n;a[96]=3;mark();sink+=a[0]+a[96];raise();
}
__attribute__((noinline)) static void dynamic_frame(unsigned n){
 volatile char *a=__builtin_alloca(33+n%171);a[0]=7;a[32+n%171]=9;mark();sink+=a[0];raise();
}
__attribute__((noinline)) static void aligned_frame(unsigned n){
 _Alignas(64) volatile char a[192];a[0]=n;a[191]=11;mark();sink+=(unsigned long)a&63;raise();
}
static void (*volatile targets[])(unsigned)={zero_frame,static_frame,dynamic_frame,aligned_frame};
__attribute__((noinline)) static void indirect_frame(unsigned n){mark();targets[n%4](n);}
__attribute__((noinline)) static void nested_frame(unsigned n){
 unsigned outer __attribute__((cleanup(cleanup)))=2;mark();
 {unsigned inner __attribute__((cleanup(cleanup)))=1;dynamic_frame(n);}
}
__attribute__((noinline)) static void recursive_frame(unsigned n){
 volatile char a[23];a[0]=n;mark();sink+=a[0];
 if(n)recursive_frame(n-1);else nested_frame(77);
 sink+=a[0];
}
extern void cpp_frame(unsigned);
static void (*volatile frames[])(unsigned)={zero_frame,static_frame,dynamic_frame,aligned_frame,indirect_frame,nested_frame,recursive_frame,cpp_frame};
__attribute__((noinline)) unsigned frame_entry(unsigned k,unsigned t,unsigned n){
 kind=k;tag=t;used=0;frame_entries=0;lowest=observe_stack();
 frames[k%8](n);return 999;
}
__attribute__((noinline)) unsigned retained_entry(unsigned k,unsigned n){
 kind=k;active_env=&env;tag=2;used=0;frame_entries=0;lowest=observe_stack();
 unsigned retained __attribute__((cleanup(cleanup)))=9;
 int v=setjmp(env);if(!v)frames[k%8](n);
 return (unsigned)v;
}
__attribute__((noinline)) unsigned frame_query(unsigned n){
 if(n==0)return used;if(n==1)return frame_entries;if(n==2)return lowest;
 return n>=3&&n-3<used?trace[n-3]:~0u;
}
__attribute__((noinline)) unsigned normal_entry(unsigned n){
 volatile char *a=__builtin_alloca(n%257+33);a[0]=5;
 unsigned v __attribute__((cleanup(cleanup)))=8;used=0;sink+=a[0];return 42;
}

void cpp_cleanup(unsigned v){if(used<32)trace[used++]=v;}
void cpp_raise(void){raise();}
void cpp_mark(void){mark();}

__attribute__((noinline)) unsigned inner_entry(unsigned k,unsigned n,unsigned outer_jump){
 used=0;frame_entries=0;lowest=observe_stack();tag=2;
 unsigned outer __attribute__((cleanup(cleanup)))=11;
 int ov=setjmp(env);
 if(ov)return (unsigned)ov;
 {
  unsigned inner __attribute__((cleanup(cleanup)))=9;
  active_env=outer_jump?&env:&inner_env;
  int iv=setjmp(inner_env);
  if(!iv)frames[k%8](n);
  return (unsigned)iv;
 }
}
