#!/usr/bin/env python3
"""Record the selected GNU/kernel cancellation boundary without changing it."""
import hashlib
import json
from pathlib import Path

TASK = Path('/mnt/p6/build/glibc-cancel-boundary-plan-20261002')
REPO = Path('/mnt/p6/project/linux/linuxonweb')
GNU = Path('/mnt/p6/build/glibc-wasm-bootstrap-20261002/source/glibc-2.44')
KERNEL = Path('/mnt/p6/project/linux/.tmp-firefox-build/nix-local-store/nix/store/s6qc0any0wby0f4nnivpaanvqb9hl130-source')


def digest(data):
    return {'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)}


def main():
    snapshots = TASK / 'source-snapshots'
    snapshots.mkdir(parents=True, exist_ok=True)
    paths = {
        'gnu-cancel': GNU / 'nptl/cancellation.c',
        'gnu-pthread-cancel': GNU / 'nptl/pthread_cancel.c',
        'gnu-pc-check': GNU / 'sysdeps/nptl/cancellation-pc-check.h',
        'gnu-arch-reference': GNU / 'sysdeps/unix/sysv/linux/syscall_cancel.c',
        'gnu-unwind': GNU / 'nptl/unwind.c',
        'kernel-signal': KERNEL / 'arch/wasm/kernel/signal.c',
        'kernel-syscall': KERNEL / 'arch/wasm/kernel/syscall.c',
        'kernel-registers': KERNEL / 'arch/wasm/include/uapi/asm/sigcontext.h',
        'worker': REPO / 'web/linux/dist/worker.js',
        'gnu-signal-adapter': REPO / 'tools/glibc/port/libc_sigaction.c',
        'selected-kernel': REPO / 'web/linux/vmlinux.wasm',
    }
    pins = {}
    texts = {}
    for name, path in paths.items():
        data = path.read_bytes()
        row = digest(data)
        snapshot = snapshots / (row['sha256'] + '-' + path.name)
        if snapshot.exists():
            assert snapshot.read_bytes() == data
        else:
            snapshot.write_bytes(data)
        assert digest(snapshot.read_bytes()) == row
        pins[name] = {'path': str(path), 'snapshot': str(snapshot), **row}
        if name != 'selected-kernel':
            texts[name] = data.decode()
    assert pins['selected-kernel']['sha256'] == '21c15250e6f27c95fef333a16ffbc411159838f194f0ea19f8adcda3f21b0e75'
    conditions = {
        'gnu-post-call-cancel-only-on-EINTR': ('gnu-cancel', 'result == -EINTR && cancel_enabled_and_canceled (ch)'),
        'gnu-SIGCANCEL-SA_RESTART': ('gnu-pthread-cancel', 'sa.sa_flags = SA_SIGINFO | SA_RESTART;'),
        'gnu-handler-unwinds-on-async-or-PC': ('gnu-pthread-cancel', '|| cancellation_pc_check (ctx)'),
        'gnu-PC-requires-register-context': ('gnu-pc-check', 'uintptr_t pc = sigcontext_get_pc (ctx);'),
        'adapter-has-no-register-context': ('gnu-signal-adapter', 'handler(sig,&info,NULL);'),
        'kernel-SA_RESTART-restarts-ERESTARTSYS': ('kernel-signal', 'if (handler && !(ka->sa.sa_flags & SA_RESTART))'),
        'kernel-restores-interrupted-registers-after-callback': ('kernel-signal', '*regs = saved_regs;'),
        'kernel-restores-signal-mask-after-callback': ('kernel-signal', 'set_current_blocked(&saved_mask);'),
        'kernel-syscall-exit-loop-can-reenter-syscall': ('kernel-syscall', 'nr = regs->restart_syscall_nr;'),
        'worker-calls-kernel-before-returning-to-user': ('worker', 'const ret = kernel_instance.exports.syscall(nr, arg0, arg1, arg2, arg3, arg4, arg5);'),
    }
    findings = {}
    for name, (source, needle) in conditions.items():
        assert needle in texts[source], name
        findings[name] = {'source': source, 'line': texts[source].split(needle, 1)[0].count('\n') + 1, 'text': needle}
    register_body = texts['kernel-registers'].split('struct pt_regs {', 1)[1].split('};', 1)[0]
    assert 'restart_syscall_nr' in register_body and not any(word in register_body for word in ['instruction_pointer', 'program_counter'])
    proof = {
        'pass': True,
        'scope': 'current source and selected binary identity; no new cancellation runtime acceptance',
        'inputs': pins,
        'findings': findings,
        'registerBody': register_body,
        'conclusion': 'Deferring a SIGCANCEL callback in the host until syscall return alone is insufficient: SA_RESTART can restart the interrupted blocking call inside the kernel before that return. A real restart-decision boundary is required in addition to native GNU forced unwind outside the live kernel callback.',
        'unproven': ['ordinary C++ exception execution', 'GNU forced unwind and real CFA', 'interruptible blocked cancellation', 'partial-side-effect preservation', 'default NPTL lifecycle', 'busy-loop asynchronous cancellation'],
    }
    for row in pins.values():
        assert digest(Path(row['path']).read_bytes()) == digest(Path(row['snapshot']).read_bytes()) == {k: row[k] for k in ['sha256', 'bytes']}
    (TASK / 'evidence.json').write_text(json.dumps(proof, indent=2) + '\n')
    print(json.dumps({'pass': True, 'pins': len(pins), 'sourceFindings': len(findings), 'evidence': str(TASK / 'evidence.json'), 'runtimeAcceptance': False}))


if __name__ == '__main__':
    main()
