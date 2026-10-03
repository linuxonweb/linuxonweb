/* Synthetic controls of the proposed kernel ABI; not a kernel or GNU runtime. */
#include "user_signal_boundary.h"
#define O(field) __builtin_offsetof(struct wasm_signal_boundary_v2, field)
_Static_assert(sizeof(struct wasm_signal_boundary_v2) == 64, "record size");
_Static_assert(_Alignof(struct wasm_signal_boundary_v2) == 4, "record alignment");
#define ASSERT_FIELD(field, index) _Static_assert(O(field) == 4 * (index), #field)
ASSERT_FIELD(magic, 0); ASSERT_FIELD(version, 1); ASSERT_FIELD(bytes, 2);
ASSERT_FIELD(phase, 3); ASSERT_FIELD(task_cookie, 4); ASSERT_FIELD(raw_tp, 5);
ASSERT_FIELD(pid, 6); ASSERT_FIELD(tgid, 7); ASSERT_FIELD(generation_lo, 8);
ASSERT_FIELD(generation_hi, 9); ASSERT_FIELD(interrupted_raw_result, 10);
ASSERT_FIELD(syscall_number, 11); ASSERT_FIELD(restored_result, 12);
ASSERT_FIELD(restored_restart_number, 13); ASSERT_FIELD(signal, 14);
ASSERT_FIELD(copy_status, 15);

unsigned kernel_protocol_controls(void)
{
	unsigned count = 0;
	u32 lo = 0, hi = 0;
	int results[] = { 0, 1, 2147483647, -EINTR, -EBADF, -ERESTARTNOHAND,
		-ERESTARTNOINTR, -ERESTART_RESTARTBLOCK, -ERESTARTSYS };
	if (!wasm_signal_boundary_next(&lo, &hi) || lo != 1 || hi != 0)
		return 0;
	count++;
	lo = (u32)-1; hi = 0;
	if (!wasm_signal_boundary_next(&lo, &hi) || lo != 0 || hi != 1)
		return 0;
	count++;
	lo = hi = (u32)-1;
	if (wasm_signal_boundary_next(&lo, &hi) || lo != (u32)-1 || hi != (u32)-1)
		return 0;
	count++;
	for (unsigned i = 0; i < sizeof(results) / sizeof(results[0]); i++) {
		for (int policy = -1; policy < 4; policy++) {
			for (int copy = -1; copy <= 0; copy++) {
				int expected = policy == 1 && copy == 0 && results[i] == -ERESTARTSYS;
				if (wasm_signal_boundary_interrupt(policy, copy, results[i]) != expected)
					return 0;
				count++;
			}
		}
	}
	return count;
}
