/* Native static link requirements, using genuine GNU function types. */
#ifndef GNU_WASM_STATIC_PTHREAD_REQUIRE_H
#define GNU_WASM_STATIC_PTHREAD_REQUIRE_H
#include_next <pthreadP.h>

#ifndef SHARED
/* GNU unwind.c defines this strong alias with the same genuine function type. */
extern __typeof__ (__pthread_unwind_next) ___pthread_unwind_next;
#undef PTHREAD_STATIC_FN_REQUIRE
/* Keep a real relocation: missing providers must still fail at static link. */
#define PTHREAD_STATIC_FN_REQUIRE(name) \
  static __typeof__ (&name) const __wasm_static_require_##name \
    __attribute__ ((used, retain)) = &name;
#endif
#endif
