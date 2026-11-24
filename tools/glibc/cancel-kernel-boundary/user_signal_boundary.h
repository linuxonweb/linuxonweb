/* SPDX-License-Identifier: GPL-2.0 */
#ifndef _WASM_USER_SIGNAL_BOUNDARY_H
#define _WASM_USER_SIGNAL_BOUNDARY_H

#include <linux/types.h>
#include <linux/errno.h>

#define WASM_SIGNAL_BOUNDARY_MAGIC 0x53424732U
#define WASM_SIGNAL_BOUNDARY_VERSION 2U
#define WASM_SIGNAL_BOUNDARY_DELIVER 1U
#define WASM_SIGNAL_BOUNDARY_RESTORED 2U

/* Borrowed synchronously by the host; never a user-space ucontext or PC.
 * All fields are actual wasm32 words. The host must copy, never retain this
 * kernel-stack pointer, and must not write to it. Module/task epochs and GNU
 * cancellation authentication belong to the host/guest sidecar protocol.
 */
struct wasm_signal_boundary_v2 {
	u32 magic;
	u32 version;
	u32 bytes;
	u32 phase;
	u32 task_cookie;
	u32 raw_tp;
	u32 pid;
	u32 tgid;
	u32 generation_lo;
	u32 generation_hi;
	s32 interrupted_raw_result;
	s32 syscall_number;
	s32 restored_result;
	s32 restored_restart_number;
	u32 signal;
	s32 copy_status;
};

/* Zero is invalid. Saturate rather than alias an earlier delivery. Reset only
 * on actual task duplication; exec keeps this kernel counter monotonically
 * advancing while the host invalidates the old module/task epoch.
 */
static inline int wasm_signal_boundary_next(u32 *lo, u32 *hi)
{
	if (*lo == (u32)-1 && *hi == (u32)-1)
		return 0;
	if (++*lo == 0)
		++*hi;
	return 1;
}

/* The raw result is passed separately from the borrowed record and comes
 * from the interrupted pt_regs before syscall_restart, not a nested syscall.
 * This helper supplies only the kernel guard; host authentication is required.
 */
static inline int wasm_signal_boundary_interrupt(int policy, int copy_status,
						 s32 interrupted_raw_result)
{
	return policy == 1 && copy_status == 0
		&& interrupted_raw_result == -ERESTARTSYS;
}

#endif
