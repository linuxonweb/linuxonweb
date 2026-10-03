#include "base/platform_thread.h"
#include "mozilla/ServoBindings.h"
#include <type_traits>
static_assert(std::is_same<PlatformThreadHandle, pthread_t>::value);
static_assert(std::is_same<mozilla::StylePlatformThreadHandle, pthread_t>::value);
static_assert(std::is_same<decltype(&mozilla::Servo_ThreadPool_GetThreadHandles), void (*)(nsTArray<PlatformThreadHandle>*)>::value);
static_assert(std::is_same<pthread_t,unsigned long>::value);
static_assert(sizeof(pthread_t)==4 && alignof(pthread_t)==4);
