/* Genuine selected GNU architecture headers; native compiler controls only. */
#include <bits/wordsize.h>
#define _SETJMP_H 1
#include <bits/setjmp.h>
_Static_assert(__WORDSIZE == 32, "selected GNU wasm32 wordsize");
_Static_assert(sizeof(__jmp_buf) == 24, "selected native jump backend ABI");
extern void record_cleanup(unsigned);
extern void observe_buffer(volatile void *,unsigned);
void c_cleanup(unsigned *v) { record_cleanup(*v); }
__attribute__((noinline)) unsigned zero_frame(unsigned x) { return x+7; }
unsigned static_frame(unsigned x) {
 volatile unsigned char data[256];data[0]=(unsigned char)x;
 observe_buffer(data,256);return zero_frame(data[0]);
}
unsigned dynamic_frame(unsigned n) {
 volatile unsigned char *p=__builtin_alloca(n);p[0]=31;
 observe_buffer(p,n);
 for (unsigned i=0;i<3;i++) p[i+1]=(unsigned char)i;
 return p[0];
}
unsigned nested_indirect(unsigned x) {
 volatile unsigned char data[128];data[0]=23;
 unsigned (*volatile f)(unsigned)=static_frame;
 observe_buffer(data,128);return f(x)+data[0];
}
unsigned recursive(unsigned depth) {
 volatile unsigned char data[64];data[0]=(unsigned char)depth;
 observe_buffer(data,64);return depth?recursive(depth-1)+data[0]:data[0];
}
void c_while(void) {
 unsigned v __attribute__((cleanup(c_cleanup)))=11;
 while (__atomic_load_n(&v,__ATOMIC_RELAXED)) {}
}
void c_do(void) {
 unsigned v __attribute__((cleanup(c_cleanup)))=12;
 do {} while (__atomic_load_n(&v,__ATOMIC_RELAXED));
}
void c_for(void) {
 unsigned v __attribute__((cleanup(c_cleanup)))=13;
 for (;;) {__atomic_load_n(&v,__ATOMIC_RELAXED);}
}
