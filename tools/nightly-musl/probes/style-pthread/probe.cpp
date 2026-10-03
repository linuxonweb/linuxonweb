#include "base/platform_thread.h"
#include <type_traits>
#include <stdint.h>
static_assert(std::is_same<PlatformThreadHandle, pthread_t>::value);
static_assert(std::is_same<pthread_t, unsigned long>::value);
static_assert(sizeof(PlatformThreadHandle)==4);
static_assert(alignof(PlatformThreadHandle)==4);
static_assert(sizeof(uintptr_t)==4);
extern "C" unsigned c_pthread_size() { return sizeof(PlatformThreadHandle); }
extern "C" unsigned c_pthread_align() { return alignof(PlatformThreadHandle); }
