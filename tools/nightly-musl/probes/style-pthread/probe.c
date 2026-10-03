#include <pthread.h>
#include <stdint.h>
_Static_assert(__builtin_types_compatible_p(pthread_t,struct __pthread*), "musl C opaque pthread pointer");
_Static_assert(sizeof(pthread_t)==4,"pthread width");
_Static_assert(_Alignof(pthread_t)==4,"pthread alignment");
_Static_assert(sizeof(uintptr_t)==4,"pointer integer width");
