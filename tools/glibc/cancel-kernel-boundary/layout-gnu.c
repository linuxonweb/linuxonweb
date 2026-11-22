/* Compile-only measurement with genuine selected GNU descriptor/headers. */
#include <signal.h>
#include <nptl/descr.h>
#include <internal-signals.h>
#define O(type, field) __builtin_offsetof(type, field)
const unsigned boundary_gnu_layout[] = {
  sizeof(struct pthread), _Alignof(struct pthread), O(struct pthread, cancelhandling),
  sizeof(siginfo_t), _Alignof(siginfo_t), O(siginfo_t, si_signo),
  O(siginfo_t, si_errno), O(siginfo_t, si_code), O(siginfo_t, si_pid), O(siginfo_t, si_uid),
  SIGCANCEL, (unsigned) SI_TKILL,
  CANCELSTATE_BITMASK, CANCELTYPE_BITMASK, CANCELING_BITMASK, CANCELED_BITMASK,
  EXITING_BITMASK, TERMINATED_BITMASK
};
_Static_assert(SIGCANCEL == 32, "selected GNU internal signal");
_Static_assert(SI_TKILL == -6, "selected GNU authenticated code");
/* The kernel patch neither knows nor consumes the descriptor offset. */
