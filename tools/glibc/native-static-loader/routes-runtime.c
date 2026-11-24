#define _SETJMP_H 1
#include <bits/setjmp.h>
void __wasm_setjmp(__jmp_buf b,int label,void *invocation){b[0].__invocation=invocation;b[0].__label=label;}
int __wasm_setjmp_test(__jmp_buf b,void *invocation){return b[0].__invocation==invocation?b[0].__label:0;}
__attribute__((noreturn)) void route_jump(__jmp_buf b,int v){b[0].__env=b;b[0].__value=v;__builtin_wasm_throw(1,&b[0].__env);}
__attribute__((noreturn)) void __wasm_longjmp(__jmp_buf b,int v){route_jump(b,v);}
