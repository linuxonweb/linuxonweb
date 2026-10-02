#include <setjmp/setjmp.h>
#include <tls.h>
#include <stddef.h>
unsigned abi(unsigned i){static const unsigned v[]={sizeof(__jmp_buf),_Alignof(__jmp_buf),sizeof(jmp_buf),_Alignof(jmp_buf),offsetof(struct __jmp_buf_tag,__mask_was_saved),offsetof(struct __jmp_buf_tag,__saved_mask),__builtin_offsetof(__typeof__(((__jmp_buf*)0)[0][0]),__sp),__builtin_offsetof(__typeof__(((__jmp_buf*)0)[0][0]),__owner),sizeof(struct pthread),_Alignof(struct pthread)};return i<10?v[i]:0;}
