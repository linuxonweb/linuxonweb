/* Owned Linux/Wasm brk adapter; GNU sbrk.c remains unchanged. */
#include <unistd.h>
#include <stdint.h>
extern int __wasm_memory_brk(uintptr_t,uintptr_t *);
void *__curbrk;
int __brk(void *address) {
 uintptr_t actual=0;
 int result=__wasm_memory_brk((uintptr_t)address,&actual);
 if(actual)__curbrk=(void *)actual;
 return result;
}
libc_hidden_def(__brk)
weak_alias(__brk,brk)
