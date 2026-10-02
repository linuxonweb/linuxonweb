/* Dispatch between exact independently accepted GNU architecture templates.
   GNU-generated streams and aliases remain unchanged. Unknown entries reach
   the frozen final16 template's explicit signature rejection. */
#define COHERENT_LAST5_capget 1
#define COHERENT_LAST5_capset 1
#define COHERENT_LAST5_mount_setattr 1
#define COHERENT_LAST5_pidfd_send_signal 1
#define COHERENT_LAST5_pivot_root 1
#define COHERENT_SELECT_I(name) COHERENT_LAST5_##name
#define COHERENT_SELECT(name) COHERENT_SELECT_I(name)
#if COHERENT_SELECT(SYSCALL_NAME)
# include "last5-template.S"
#else
# include "final16-template.S"
#endif
