#!/usr/bin/env python3
"""Bounded source/compile-only measurements; never implements cancellation."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import time

TASK = Path('/mnt/p6/build/glibc-cancel-native-plan-20261002')
REPO = Path('/mnt/p6/project/linux/linuxonweb')
PACKET = REPO / 'tools/glibc/cancel-native-plan'
GNU = Path('/mnt/p6/build/glibc-wasm-bootstrap-20261002/source/glibc-2.44')
STORE = Path('/mnt/p6/project/linux/.tmp-firefox-build/nix-local-store/nix/store')
LLVM = STORE / 'jkx0x4a4nlmnjm0kz9fiss33b7wh8z9k-source'
KERNEL = STORE / 's6qc0any0wby0f4nnivpaanvqb9hl130-source'
CLANG = Path('/mnt/p6/build/glibc-c-cleanup-20261002/objects/compiler/clang')


def pin(path):
    data = path.read_bytes()
    sha = hashlib.sha256(data).hexdigest()
    dst = TASK / 'source-snapshots' / (sha + '-' + path.name)
    if dst.exists():
        assert dst.read_bytes() == data
    else:
        dst.write_bytes(data)
    assert hashlib.sha256(dst.read_bytes()).hexdigest() == sha
    return {'path': str(path), 'snapshot': str(dst), 'sha256': sha, 'bytes': len(data)}


def main():
    for name in ['tmp', 'cache', 'logs', 'objects', 'source-snapshots']:
        (TASK / name).mkdir(parents=True, exist_ok=True)
    assert shutil.disk_usage(TASK).free >= 8 * 1024**3
    paths = {
        'gnu-cancellation': GNU / 'nptl/cancellation.c',
        'gnu-pthread-cancel': GNU / 'nptl/pthread_cancel.c',
        'gnu-unwind': GNU / 'nptl/unwind.c',
        'gnu-unwind-header': GNU / 'sysdeps/generic/unwind.h',
        'gnu-bridge-reference': GNU / 'sysdeps/unix/sysv/linux/syscall_cancel.c',
        'gnu-pc-check': GNU / 'sysdeps/nptl/cancellation-pc-check.h',
        'gnu-setcancelstate': GNU / 'nptl/pthread_setcancelstate.c',
        'gnu-setcanceltype': GNU / 'nptl/pthread_setcanceltype.c',
        'gnu-testcancel': GNU / 'nptl/pthread_testcancel.c',
        'gnu-pthread-private': GNU / 'sysdeps/nptl/pthreadP.h',
        'gnu-pthread-create': GNU / 'nptl/pthread_create.c',
        'gnu-join-common': GNU / 'nptl/pthread_join_common.c',
        'kernel-signal': KERNEL / 'arch/wasm/kernel/signal.c',
        'kernel-syscall': KERNEL / 'arch/wasm/kernel/syscall.c',
        'kernel-registers': KERNEL / 'arch/wasm/include/uapi/asm/sigcontext.h',
        'kernel-imports': KERNEL / 'arch/wasm/include/asm/wasm_imports.h',
        'kernel-thread-info': KERNEL / 'arch/wasm/include/asm/thread_info.h',
        'kernel-irq': KERNEL / 'arch/wasm/kernel/irq.c',
        'llvm-wasm-unwind': LLVM / 'libunwind/src/Unwind-wasm.c',
        'llvm-forced-reference': LLVM / 'libunwind/src/UnwindLevel1.c',
        'llvm-cxx-personality': LLVM / 'libcxxabi/src/cxa_personality.cpp',
        'llvm-frame-lowering': LLVM / 'llvm/lib/Target/WebAssembly/WebAssemblyFrameLowering.cpp',
        'llvm-late-eh': LLVM / 'llvm/lib/Target/WebAssembly/WebAssemblyLateEHPrepare.cpp',
        'clang-c-exceptions': LLVM / 'clang/lib/CodeGen/CGException.cpp',
        'clang-statement-codegen': LLVM / 'clang/lib/CodeGen/CGStmt.cpp',
        'worker': REPO / 'web/linux/dist/worker.js',
        'signal-adapter': REPO / 'tools/glibc/port/libc_sigaction.c',
        'jmp-cfa': REPO / 'tools/glibc/jumps/jmpbuf-unwind.h',
        'prototype-adapter': REPO / 'tools/glibc/forced-unwind-routing/force-ir.cpp',
        'prototype-runtime': REPO / 'tools/glibc/forced-unwind-routing/runtime.c',
        'routing-acceptance': Path('/mnt/p6/build/glibc-forced-unwind-routing-20261002/acceptance.json'),
        'boundary-evidence': Path('/mnt/p6/build/glibc-cancel-boundary-plan-20261002/evidence.json'),
        'loader-default-failure': Path('/mnt/p6/build/glibc-native-static-loader-20261002/logs/gnu-public-cxx-default-link-attempt3.log'),
        'loader-release-failure': Path('/mnt/p6/build/glibc-native-static-loader-20261002/logs/gnu-public-cxx-release-link-attempt3.log'),
        'selected-kernel': REPO / 'web/linux/vmlinux.wasm',
        'accepted-compiler': CLANG,
        'accepted-codegen-archive': Path('/mnt/p6/build/glibc-c-cleanup-20261002/objects/compiler/libclangCodeGen.a'),
        'llvm-wasm-codegen-archive': STORE / 'xwpycnlb71djqs4gyxhbkxhzb3pw1ib4-llvm-toolchain-22.1.8/lib/libLLVMWebAssemblyCodeGen.a',
        'compiler-build-recipe': REPO / 'tools/glibc/c-cleanup/build-compiler.py',
        'layout-proposal': PACKET / 'layout.c',
        'safepoint-control': PACKET / 'safepoint-shape.cpp',
        'script': Path(__file__).resolve(),
    }
    pins = {name: pin(path) for name, path in paths.items()}
    assert pins['selected-kernel']['sha256'] == '21c15250e6f27c95fef333a16ffbc411159838f194f0ea19f8adcda3f21b0e75'
    texts = {name: path.read_text() for name, path in paths.items()
             if name not in ['accepted-compiler', 'selected-kernel', 'accepted-codegen-archive', 'llvm-wasm-codegen-archive']}
    needles = {
        'post-call-EINTR-only': ('gnu-cancellation', 'result == -EINTR && cancel_enabled_and_canceled (ch)'),
        'disabled-direct-route': ('gnu-cancellation', 'SINGLE_THREAD_P || !cancel_enabled (ch) || cancel_exiting (ch)'),
        'SIGCANCEL-authentication': ('gnu-pthread-cancel', 'si->si_code != SI_TKILL'),
        'SIGCANCEL-restart': ('gnu-pthread-cancel', 'sa.sa_flags = SA_SIGINFO | SA_RESTART;'),
        'async-or-PC': ('gnu-pthread-cancel', '|| cancellation_pc_check (ctx)'),
        'disabled-request-retention': ('gnu-pthread-cancel', 'newval = oldval | CANCELED_BITMASK;'),
        'reenabled-async-cancels': ('gnu-setcancelstate', 'cancel_enabled_and_canceled_and_async (newval)'),
        'retyped-async-cancels': ('gnu-setcanceltype', 'cancel_enabled_and_canceled_and_async (newval)'),
        'stop-CFA-contract': ('gnu-unwind', '_Unwind_GetCFA (context)'),
        'stop-longjmp-target': ('gnu-unwind', '__libc_unwind_longjmp'),
        'forced-unwind-required': ('gnu-unwind', '_Unwind_ForcedUnwind (&self->exc, unwind_stop, ibuf);'),
        'foreign-swallow-fatal': ('gnu-unwind', 'FATAL: exception not rethrown'),
        'callback-after-restart': ('kernel-signal', 'syscall_restart(regs, true, &ksig.ka);'),
        'restore-regs': ('kernel-signal', '*regs = saved_regs;'),
        'restore-mask': ('kernel-signal', 'set_current_blocked(&saved_mask);'),
        'thread-owned-active-info': ('kernel-thread-info', 'const struct kernel_siginfo *active_siginfo;'),
        'restart-loop': ('kernel-syscall', 'nr = regs->restart_syscall_nr;'),
        'no-asynchronous-user-trap': ('kernel-syscall', 'WebAssembly has no asynchronous trap from user mode.'),
        'no-ERESTARTNOINTR-veto': ('kernel-signal', 'case -ERESTARTNOINTR:'),
        'wasm-personality-search-only': ('llvm-wasm-unwind', '1, _UA_SEARCH_PHASE, exception_object->exception_class'),
        'native-throw-record': ('llvm-wasm-unwind', '__builtin_wasm_throw(0, exception_object);'),
        'cxx-catchall-forced': ('llvm-cxx-personality', 'foreign exceptions. This is search phase, cleanup'),
        'SP-writeback-redzone-decision': ('llvm-frame-lowering', 'return needsSPForLocalFrame(MF) && !CanUseRedZone;'),
        'NULL-ucontext': ('signal-adapter', 'handler(sig,&info,NULL);'),
    }
    findings = {}
    for name, (source, needle) in needles.items():
        assert needle in texts[source], name
        findings[name] = {'source': source, 'line': texts[source].split(needle, 1)[0].count('\n') + 1, 'text': needle}
    assert '_Unwind_ForcedUnwind(' not in texts['llvm-wasm-unwind']
    assert '_Unwind_GetCFA(' not in texts['llvm-wasm-unwind']
    attempts = sorted((TASK / 'logs').glob('compile-attempt-*.json'))
    attempt = len(attempts) + 1
    env = os.environ.copy()
    env.update(TMPDIR=str(TASK/'tmp'), TMP=str(TASK/'tmp'), TEMP=str(TASK/'tmp'),
               XDG_CACHE_HOME=str(TASK/'cache'), PYTHONDONTWRITEBYTECODE='1')
    commands = []
    common = [str(CLANG), '--target=wasm32-unknown-unknown', '-ffreestanding',
              '-nostdinc', '-fno-builtin', '-S', '-emit-llvm']
    outputs = {}
    for name, extra, source in [
        ('layout', ['-I', str(GNU/'sysdeps/generic'), '-O2'], 'layout.c'),
        ('safepoint', ['-fwasm-exceptions', '-fexceptions', '-nostdinc++',
                       '-Xclang', '-disable-llvm-passes', '-O1'], 'safepoint-shape.cpp')]:
        assert shutil.disk_usage(TASK).free >= 5 * 1024**3
        assert sum(p.stat().st_size for p in TASK.rglob('*') if p.is_file()) < 2 * 1024**3
        output = TASK/'objects'/f'{name}-attempt-{attempt}.ll'
        argv = [*common, *extra, str(PACKET/source), '-o', str(output)]
        started = time.monotonic()
        logfile = TASK/'logs'/f'{name}-attempt-{attempt}.log'
        with logfile.open('wb') as log:
            proc = subprocess.Popen(argv, cwd=REPO, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
            try:
                status = proc.wait(timeout=60)
            except subprocess.TimeoutExpired:
                os.killpg(proc.pid, signal.SIGKILL)
                status = proc.wait()
        try:
            os.killpg(proc.pid, 0)
            empty = False
        except ProcessLookupError:
            empty = True
        commands.append({'argv': argv, 'cwd': str(REPO), 'pid': proc.pid,
                         'pgid': proc.pid, 'exit': status, 'seconds': time.monotonic()-started,
                         'groupEmpty': empty, 'log': str(logfile), 'source': pins['layout-proposal' if name=='layout' else 'safepoint-control']})
        (TASK/'logs'/f'compile-attempt-{attempt}.json').write_text(json.dumps(commands, indent=2)+'\n')
        assert status == 0 and empty, name
        outputs[name] = pin(output)
    layout = Path(outputs['layout']['path']).read_text()
    assert '[i32 24, i32 8, i32 4, i32 4, i32 4, i32 32, i32 4, i32 12, i32 24, i32 4, i32 16, i32 32, i32 4, i32 28]' in layout
    shape = Path(outputs['safepoint']['path']).read_text()
    no = shape.split('define hidden void @busy_without_boundary', 1)[1].split('\n}', 1)[0]
    yes = shape.split('define hidden void @busy_with_source_boundary', 1)[1].split('\n}', 1)[0]
    assert 'invoke ' not in no and 'cleanuppad' not in no
    assert 'invoke ' in yes and 'cleanuppad' in yes
    reread = []
    for name, row in {**pins, **outputs}.items():
        if Path(row['path']).read_bytes() != Path(row['snapshot']).read_bytes():
            reread.append(name)
    assert not reread
    proof = {'scope':'source and compile-only plan; no cancellation implementation or runtime acceptance',
             'runtimeAcceptance':False, 'frozen':False, 'inputs':pins, 'findings':findings,
             'compileOutputs':outputs, 'commands':commands, 'rereadDifferences':reread,
             'layout':{'GNUException':[24,8], 'proposedFrame':[32,4], 'proposedContext':[24,4], 'proposedBoundary':[32,4]},
             'cleanupScopeControl':'source-level throwing call retains C++ cleanup; atomic-only busy loop has no cleanup pad',
             'unproven':['forced-unwind general frame coverage','kernel restart veto','deferred and async cancellation','GNU lifecycle/join','Nightly/JIT/GPU']}
    path = TASK/f'evidence-attempt-{attempt}.json'
    path.write_text(json.dumps(proof, indent=2)+'\n')
    print(json.dumps({'evidence':str(path), 'pins':len(pins), 'findings':len(findings), 'compileOnly':True, 'runtimeAcceptance':False}))


if __name__ == '__main__':
    main()
