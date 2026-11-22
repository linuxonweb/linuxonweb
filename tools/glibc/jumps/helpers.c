#include <setjmp/setjmp.h>
#include <tls.h>
void __wasm_jmp_prepare(struct __jmp_buf_tag *b,void *sp){b->__jmpbuf[0].__sp=sp;b->__jmpbuf[0].__owner=THREAD_SELF;}
void __wasm_setjmp(struct __jmp_buf_tag *b,int label,void *invocation){b->__jmpbuf[0].__invocation=invocation;b->__jmpbuf[0].__label=label;}
int __wasm_setjmp_test(struct __jmp_buf_tag*b,void*invocation){return b->__jmpbuf[0].__invocation==invocation?b->__jmpbuf[0].__label:0;}
__attribute__((noreturn)) void __wasm_longjmp(struct __jmp_buf_tag*b,int value){b->__jmpbuf[0].__env=b;b->__jmpbuf[0].__value=value?value:1;__builtin_wasm_throw(1,&b->__jmpbuf[0].__env);}
__attribute__((noreturn)) void __longjmp(__jmp_buf b,int value){__wasm_longjmp((void*)b,value);}
/* Checked backend is restricted to known GNU descriptor/linear-stack bounds. */
#include <stdint.h>
extern void __fortify_fail(const char *) __attribute__((noreturn));
__attribute__((noreturn)) void ____longjmp_chk(__jmp_buf b,int value){
 struct pthread *pd=THREAD_SELF;
 uintptr_t low=(uintptr_t)pd->stackblock,high=low+pd->stackblock_size;
 uintptr_t saved=(uintptr_t)b[0].__sp,current=(uintptr_t)__builtin_frame_address(0);
 if(b[0].__owner!=pd||high<low||current<low||current>=high||saved<current||saved<low||saved>high||(saved&15)||!b[0].__invocation||b[0].__label<=0)
  __fortify_fail("invalid native Wasm longjmp stack or owner");
 __longjmp(b,value);
}
