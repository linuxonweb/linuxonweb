/* Measured GNU/kernel fields only; other non-NULL siginfo classes are unsupported.
   This is architecture marshaling around the genuine GNU generated wrapper. */
#include <stdint.h>
#include <errno.h>
static __inline long
last5_pidfd_signal (int fd, int sig, siginfo_t *info, unsigned int flags)
{
  if (info == 0)
    return INTERNAL_SYSCALL_NCS (__NR_pidfd_send_signal, 4, fd, sig, info, flags);
  uint64_t address = (uintptr_t) info;
  uint64_t end = (uint64_t) __builtin_wasm_memory_size (0) * 65536;
  /* Keep kernel descriptor/flag/error validation for addresses that cannot be
     read safely by this userspace conversion. Kernel copy_from_user is bounded. */
  if (address + sizeof (*info) > end)
    return INTERNAL_SYSCALL_NCS (__NR_pidfd_send_signal, 4, fd, sig, info, flags);
  if (info->si_code != SI_USER && info->si_code != SI_QUEUE
      && info->si_code != SI_TKILL)
    return -EOPNOTSUPP;
  _Static_assert (sizeof (siginfo_t) == 128
                  && __builtin_offsetof (siginfo_t, si_pid) == 12
                  && __builtin_offsetof (siginfo_t, si_uid) == 16
                  && __builtin_offsetof (siginfo_t, si_value) == 20,
                  "measured GNU fields required");
  int32_t kernel[32] = { 0 };
  kernel[0] = info->si_signo;
  kernel[1] = info->si_errno;
  kernel[2] = info->si_code;
  kernel[3] = info->si_pid;
  kernel[4] = info->si_uid;
  if (info->si_code == SI_QUEUE)
    kernel[5] = info->si_value.sival_int;
  return INTERNAL_SYSCALL_NCS (__NR_pidfd_send_signal, 4, fd, sig, kernel, flags);
}
