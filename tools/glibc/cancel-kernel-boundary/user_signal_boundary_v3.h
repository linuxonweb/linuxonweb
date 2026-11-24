/* SPDX-License-Identifier: GPL-2.0 */
#ifndef _WASM_USER_SIGNAL_BOUNDARY_V3_H
#define _WASM_USER_SIGNAL_BOUNDARY_V3_H

#include <linux/types.h>
#include <linux/errno.h>

#define WASM_SIGNAL_BOUNDARY_MAGIC 0x53424733U
#define WASM_SIGNAL_BOUNDARY_VERSION 3U
#define WASM_SIGNAL_BOUNDARY_DELIVER 1U
#define WASM_SIGNAL_BOUNDARY_RESTORED 2U
#define WASM_SIGNAL_BOUNDARY_SIGINFO 1U
#define WASM_SIGNAL_BOUNDARY_SIMPLE 2U

/* Version 3 adds ordinary callback escape acknowledgement. The host copies
 * this kernel-stack record and retains an exception identity separately.
 * This is not a PC, public ucontext, GNU frame, or exception payload. */
struct wasm_signal_boundary_v3 {
	u32 magic, version, bytes, phase;
	u32 task_cookie, raw_tp, pid, tgid;
	u32 generation_lo, generation_hi;
	s32 interrupted_raw_result, syscall_number;
	s32 restored_result, restored_restart_number;
	u32 signal;
	s32 copy_status;
	u32 handler, trampoline, action_flags, delivery_kind;
};

static inline int wasm_signal_boundary_next(u32 *lo, u32 *hi)
{
	if (*lo == (u32)-1 && *hi == (u32)-1)
		return 0;
	if (++*lo == 0)
		++*hi;
	return 1;
}

/* Only cancellation policy 1 changes the result. Policy 2 is valid solely
 * when the host has captured the exact native exception for this delivery
 * and guarantees rethrow before a guest caller can observe any result. */
static inline int wasm_signal_boundary_interrupt(int policy, int copy_status,
						 s32 interrupted_raw_result)
{
	return policy == 1 && copy_status == 0
		&& interrupted_raw_result == -ERESTARTSYS;
}

static inline int wasm_signal_boundary_queued_escape(int policy, int status)
{
	return policy == 2 && status == 0;
}

#endif
