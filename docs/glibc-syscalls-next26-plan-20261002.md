# Further GNU syscall wrappers — 2026-10-02

This is a source and actual-kernel-binary plan, not compile or runtime
acceptance. It follows the current 36-wrapper packet. A fresh planning-agent
request hit the agent thread limit, so the root agent performed the review.

The source is the signed pristine GNU glibc 2.44 release under
`/mnt/p6/build/glibc-wasm-bootstrap-20261002/source/glibc-2.44`.
`/mnt/p6/build/glibc-next26-plan-20261002/plan.json` records 26 exact public
prototypes, public-header hashes, historical generated-stream hashes and
the actual shipped kernel's bound function bodies. The original failure
inventory and accepted 36-wrapper sources remain separate and unchanged.

## Typed group

| Genuine public header | Public functions |
| --- | --- |
| sys/swap.h | swapoff, swapon |
| sys/fsuid.h | setfsuid, setfsgid |
| unistd.h | chroot, acct, setsid, sethostname, setdomainname, execve |
| sys/mount.h | mount, fsopen, fsmount, fsconfig, fspick, open_tree, move_mount |
| sched.h | unshare, setns, sched_getscheduler |
| sys/pidfd.h | pidfd_open, pidfd_getfd |
| sys/klog.h | klogctl |
| sys/resource.h | setpriority |
| sys/fanotify.h | fanotify_init |
| signal.h | tgkill |

Important C distinctions: setfsuid/setfsgid return **int**, with uid_t/gid_t
arguments. setsid returns pid_t. GNU C setpriority uses the genuine
`__priority_which_t` enum and id_t; do not replace the enum with int merely
because both lower to i32. mount flags are unsigned long, other mount APIs
use unsigned int, and hostname lengths are size_t. execve's last two arguments
are `char *const *`, including the nested const qualification. tgkill is
declared through signal.h's Linux bits/signal_ext.h; unshare/setns through
sched.h's Linux bits/sched.h. Preserve all genuine generated aliases.

Historical object names differ: setdomain means public/kernel setdomainname,
sched_gets means public/kernel sched_getscheduler, and klogctl invokes the
kernel syslog entry. All 26 original streams have NOERRNO=0 and ERRVAL=0.
Use the current owned template's explicit type checks and independent actual
public address references; do not broaden the old unaudited generic i32 path.

The 27th member of the inventory's further-fixed category, pivot_root, has a
GNU syscalls.list export but no installed GNU public prototype. Keep it out
of a claim about 26 genuine public headers. A later separate historical-export
adapter must cite the GNU stream and kernel signature without inventing a GNU
public declaration.

## Actual kernel limits and runtime plan

The shipped kernel SHA-256 is
`21c15250e6f27c95fef333a16ffbc411159838f194f0ea19f8adcda3f21b0e75`.
The selected swapoff, swapon, acct and fanotify_init bodies are exactly
`00 41 5a 0b`: no locals, i32.const -38, end. The plan records their actual
function-table bindings and code-body offsets. They are unavailable facilities,
not successful calls to skip. Other selected functions have nontrivial bound
bodies; that fact alone does not prove their runtime semantics.

The retained generated config disables BSD_PROCESS_ACCT, FANOTIFY and
NAMESPACES. Full source/config-to-shipped-binary provenance remains unresolved,
as explained in the first packet's kernel review. Avoid inferring availability
from a weak symbol or a retained default configuration.

Guest gates should preserve every earlier native and FPCAST regression and
cover actual public calls, success errno preservation, failures and concurrent
GNU errno isolation. Use separate named ordinary processes for setsid and
chroot; a raw CLONE_THREAD child shares process identity and is unsuitable.
Changes to scheduling, filesystem contexts, hostname/domainname and mounts
must stay inside the owned fresh guest and restore state where applicable.

Use unchanged fsuid/fsgid identities and their genuine previous-ID returns;
query scheduler policy and preserve priority rather than claiming realtime
scheduling support. Use tgkill signal zero and an owned callback for actual
delivery. Read-only klogctl queries must not clear or change the log. Mount
tests need a bounded owned directory, actual file bytes, descriptor closure
and explicit unmount cleanup; source review must determine namespace and
permission errors before setting expectations. pidfd tests need actual process
identity, descriptor duplication or a documented genuine kernel restriction.

Public execve needs an independent mode that proves argument/environment
transfer, fresh GNU TLS/startup and the existing runtime's exec control escape.
The previously accepted raw syscall 221 fixture is prerequisite evidence,
not acceptance of the new genuine public execve wrapper. Do not claim full
NPTL cancellation or a complete GNU sysroot from this packet.
