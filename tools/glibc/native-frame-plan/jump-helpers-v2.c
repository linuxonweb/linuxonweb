/* Coherent owned architecture helper proposal; requires backend64 GNU headers.
   Every body needs actual module4 admission except separately sealed primitives.
   Genuine GNU longjmp/siglongjmp/_Unwind target calls all resolve __longjmp here. */
#include <setjmp/setjmp.h>
#include <tls.h>
#include "jump-abi-v2.h"
#include "frame-abi.h"
#include <stdint.h>
extern void abort(void) __attribute__((noreturn));
_Static_assert(sizeof(__jmp_buf) == 64, "do not mix old GNU clients");
_Static_assert(sizeof(struct __jmp_buf_tag) == 196, "genuine GNU public storage");
void __wasm_jmp_prepare(struct __jmp_buf_tag *b, void *sp) {
  b->__jmpbuf[0].__sp = sp; b->__jmpbuf[0].__owner = THREAD_SELF;
}
void __wasm_setjmp(struct __jmp_buf_tag *b, int label, void *invocation) {
  b->__jmpbuf[0].__invocation = invocation; b->__jmpbuf[0].__label = label;
}
int __wasm_setjmp_test(struct __jmp_buf_tag *b, void *invocation) {
  return b->__jmpbuf[0].__invocation == invocation ? b->__jmpbuf[0].__label : 0;
}
__attribute__((noreturn)) void __wasm_longjmp(struct __jmp_buf_tag *b, int value) {
  unsigned handle = __wasm_gnu_jump_delivery_allocate_v2(b, value);
  if (!handle) abort();
  /* The native tag remains exactly one i32. Its coherent v2 meaning is an
     authenticated generation-bearing handle, never a mutable env payload. */
  __builtin_wasm_throw(1, (void *)handle);
}
__attribute__((noreturn)) void __longjmp(__jmp_buf b, int value) {
  __wasm_longjmp((void *)b, value);
}
/* Retain genuine GNU fortify diagnostics and owner/linear-stack checks. The
   delivery allocator additionally authenticates the actual target registration
   and ancestry; an equal-CFA target is never rejected by an invented CFA bias. */
extern void __fortify_fail(const char *) __attribute__((noreturn));
__attribute__((noreturn)) void ____longjmp_chk(__jmp_buf b, int value) {
  struct pthread *pd = THREAD_SELF;
  unsigned long long limit = (unsigned long long)__builtin_wasm_memory_size(0) * 65536u;
  uintptr_t p = (uintptr_t)pd, e = (uintptr_t)b;
  if (!p || (p & 31u) || (unsigned long long)p + sizeof(*pd) > limit ||
      !e || (e & 3u) || (unsigned long long)e + sizeof(*b) > limit)
    __fortify_fail("invalid native Wasm longjmp stack or owner");
  uintptr_t low = (uintptr_t)pd->stackblock, high = low + pd->stackblock_size;
  uintptr_t saved = (uintptr_t)b[0].__sp;
  uintptr_t current = (uintptr_t)__builtin_frame_address(0);
  if (b[0].__owner != pd || high < low || high > limit ||
      current < low || current >= high || saved < current || saved < low ||
      saved > high || (saved & 15u) || !b[0].__invocation || b[0].__label <= 0)
    __fortify_fail("invalid native Wasm longjmp stack or owner");
  unsigned handle = __wasm_gnu_jump_delivery_allocate_v2(b, value);
  if (!handle) __fortify_fail("invalid native Wasm longjmp registration or delivery");
  __builtin_wasm_throw(1, (void *)handle);
}
