#include "UniquePtrExtensions.h"
#include <fcntl.h>
#include <type_traits>
using NativeDuplicate = mozilla::UniqueFileHandle (*)(mozilla::detail::FileHandleType);
static_assert(std::is_same_v<mozilla::detail::FileHandleType,int>);
static_assert(std::is_same_v<decltype(static_cast<NativeDuplicate>(&mozilla::DuplicateFileHandle)),NativeDuplicate>);
static_assert(sizeof(int)==4 && F_DUPFD_CLOEXEC==1030 && F_GETFD==1 && FD_CLOEXEC==1);
extern "C" int DuplicateFdProbe(int fd) {
  return mozilla::DuplicateFileHandle(fd).release();
}
