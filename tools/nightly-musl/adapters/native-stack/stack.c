/* Native Linux/Wasm stack query adapter; pinned musl internal layout. */
#define _GNU_SOURCE
#include <unistd.h>
#include "pthread_impl.h"
#include <stdint.h>
#if !defined(__linux__) || !defined(__wasm__) || defined(__wasi__)
#error Native Linux/Wasm only
#endif
extern unsigned char __stack_low[], __stack_high[];
int __real_pthread_getattr_np(pthread_t, pthread_attr_t *);
int __wrap_pthread_getattr_np(pthread_t t, pthread_attr_t *a)
{
    /* Created pthreads keep libc's actual metadata and complete behavior. */
    if (t->stack) return __real_pthread_getattr_np(t, a);
    if (t->tid != getpid()) return ENOTSUP;
    uintptr_t low = (uintptr_t)__stack_low;
    uintptr_t high = (uintptr_t)__stack_high;
    uint64_t memory_end = (uint64_t)__builtin_wasm_memory_size(0) * 65536u;
    if (high <= low || high > memory_end)
        return EINVAL;
    if (pthread_equal(t, pthread_self())) {
        uintptr_t frame = (uintptr_t)__builtin_frame_address(0);
        if (frame < low || frame >= high) return EINVAL;
    }
    /* Same detach/guard fields as the selected libc query, real linker range. */
    *a = (pthread_attr_t){0};
    a->_a_detach = t->detach_state >= DT_DETACHED;
    a->_a_guardsize = t->guard_size;
    a->_a_stackaddr = high;
    a->_a_stacksize = high - low;
    return 0;
}
