#!/usr/bin/env python3
"""Prepare sparse kernel copies and a patch; never build or edit the input."""
import argparse
import difflib
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess

HERE = Path(__file__).resolve().parent


def digest(data):
    return hashlib.sha256(data).hexdigest()


def replace_once(text, old, new):
    assert text.count(old) == 1, old
    return text.replace(old, new, 1)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--kernel', type=Path, required=True)
    parser.add_argument('--task', type=Path, required=True)
    args = parser.parse_args()
    task = args.task.resolve()
    assert str(task).startswith('/mnt/p6/build/')
    assert subprocess.check_output(['findmnt', '-T', str(task), '-no', 'FSTYPE'], text=True).strip() == 'ext4'
    assert shutil.disk_usage(task).free >= 8 * 1024**3
    for name in ('TMPDIR', 'TMP', 'TEMP'):
        assert Path(os.environ[name]).resolve().is_relative_to(task)
    output = task / 'prepared'
    output.mkdir()  # unique destination; preserve every failed attempt
    before, after = output / 'original', output / 'kernel'
    pins = json.loads((HERE / 'kernel-inputs.json').read_text())
    rows = []
    for relative, expected in pins.items():
        data = (args.kernel / relative).read_bytes()
        assert digest(data) == expected, relative
        for root in (before, after):
            dest = root / relative
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(data)
        rows.append({'relative': relative, 'original': str((args.kernel / relative).resolve()),
                     'sha256': expected, 'bytes': len(data)})

    path = after / 'arch/wasm/include/asm/thread_info.h'
    text = path.read_text()
    text = replace_once(text, '\tconst struct kernel_siginfo *active_siginfo;\n',
                        '\tconst struct kernel_siginfo *active_siginfo;\n'
                        '\t/* Per-task signal delivery identity; zero is invalid. */\n'
                        '\tu32 signal_generation_lo;\n\tu32 signal_generation_hi;\n')
    text = replace_once(text, '\t\t.active_siginfo = NULL,              \\\n',
                        '\t\t.active_siginfo = NULL,              \\\n'
                        '\t\t.signal_generation_lo = 0,          \\\n'
                        '\t\t.signal_generation_hi = 0,          \\\n')
    path.write_text(text)
    path = after / 'arch/wasm/kernel/process.c'
    text = replace_once(path.read_text(), '\ttask_thread_info(dst)->active_siginfo = NULL;\n',
                        '\ttask_thread_info(dst)->active_siginfo = NULL;\n'
                        '\ttask_thread_info(dst)->signal_generation_lo = 0;\n'
                        '\ttask_thread_info(dst)->signal_generation_hi = 0;\n')
    path.write_text(text)
    path = after / 'arch/wasm/include/asm/wasm_imports.h'
    text = replace_once(path.read_text(),
                        'int wasm_import(user, call_siginfo_handler)(u32 trampoline, u32 fn, u32 sig);\n',
                        'int wasm_import(user, call_siginfo_handler)(u32 trampoline, u32 fn, u32 sig);\n'
                        'struct wasm_signal_boundary_v2;\n'
                        '/* v2 copy status and restoration policy are separate. Policy must not\n'
                        ' * call user handlers, enter the kernel, or throw through kernel frames. */\n'
                        'int wasm_import(user, call_siginfo_handler_v2)(u32 trampoline, u32 fn,\n'
                        '\t\t\tu32 sig, const struct wasm_signal_boundary_v2 *boundary);\n'
                        'int wasm_import(user, signal_return_policy_v2)(\n'
                        '\t\t\tconst struct wasm_signal_boundary_v2 *boundary);\n')
    path.write_text(text)
    path = after / 'arch/wasm/kernel/signal.c'
    text = replace_once(path.read_text(), '#include <asm/wasm_imports.h>\n',
                        '#include <asm/wasm_imports.h>\n#include <asm/user_signal_boundary.h>\n')
    text = replace_once(text,
                        'static void call_signal_handler(struct ksignal *ksig, struct pt_regs *regs)\n',
                        'static void call_signal_handler(struct ksignal *ksig, struct pt_regs *regs,\n'
                        '\t\t\t\tlong interrupted_raw_result)\n')
    text = replace_once(text, '\tint failed = 0;\n',
                        '\tint failed = 0;\n\tint policy = 0;\n'
                        '\tstruct wasm_signal_boundary_v2 boundary = {\n'
                        '\t\t.magic = WASM_SIGNAL_BOUNDARY_MAGIC,\n'
                        '\t\t.version = WASM_SIGNAL_BOUNDARY_VERSION,\n'
                        '\t\t.bytes = sizeof(boundary),\n'
                        '\t\t.phase = WASM_SIGNAL_BOUNDARY_DELIVER,\n'
                        '\t\t.task_cookie = (u32)(uintptr_t)current,\n'
                        '\t\t.raw_tp = ti->tp_value,\n'
                        '\t\t.pid = current->pid,\n\t\t.tgid = current->tgid,\n'
                        '\t\t.interrupted_raw_result = interrupted_raw_result,\n'
                        '\t\t.syscall_number = saved_regs.syscall_nr,\n'
                        '\t\t.signal = ksig->sig,\n\t};\n')
    old = ('\t\tfailed = wasm_user_call_siginfo_handler(\n'
           '\t\t\t(uintptr_t)sa->sa_restorer, (uintptr_t)sa->sa_handler,\n'
           '\t\t\tksig->sig);\n')
    new = ('\t\tif (wasm_signal_boundary_next(&ti->signal_generation_lo,\n'
           '\t\t\t\t\t      &ti->signal_generation_hi)) {\n'
           '\t\t\tboundary.generation_lo = ti->signal_generation_lo;\n'
           '\t\t\tboundary.generation_hi = ti->signal_generation_hi;\n'
           '\t\t\tfailed = wasm_user_call_siginfo_handler_v2(\n'
           '\t\t\t\t(uintptr_t)sa->sa_restorer,\n'
           '\t\t\t\t(uintptr_t)sa->sa_handler, ksig->sig, &boundary);\n'
           '\t\t} else {\n'
           '\t\t\t/* No token reuse and no untracked cancellation callback. */\n'
           '\t\t\tfailed = -EOVERFLOW;\n\t\t}\n')
    text = replace_once(text, old, new)
    text = replace_once(text, '\tif (failed)\n\t\tforce_sigsegv(ksig->sig);\n',
                        '\tif (failed) {\n\t\tforce_sigsegv(ksig->sig);\n\t\treturn;\n\t}\n'
                        '\tif (sa->sa_flags & SA_SIGINFO) {\n'
                        '\t\t/* No guest handler/unwind is permitted in this import. */\n'
                        '\t\tboundary.phase = WASM_SIGNAL_BOUNDARY_RESTORED;\n'
                        '\t\tboundary.restored_result = regs->syscall_return;\n'
                        '\t\tboundary.restored_restart_number = regs->restart_syscall_nr;\n'
                        '\t\tboundary.copy_status = failed;\n'
                        '\t\tpolicy = wasm_user_signal_return_policy_v2(&boundary);\n'
                        '\t\tif (wasm_signal_boundary_interrupt(policy, failed,\n'
                        '\t\t\t\t\t\t   interrupted_raw_result)) {\n'
                        '\t\t\tregs->syscall_return = -EINTR;\n'
                        '\t\t\tregs->restart_syscall_nr = -1;\n'
                        '\t\t} else if (policy != 0) {\n'
                        '\t\t\t/* Invalid policy never rewrites partial results/restarts. */\n'
                        '\t\t\tforce_sigsegv(ksig->sig);\n\t\t}\n\t}\n')
    text = replace_once(text, '\t\tsyscall_restart(regs, true, &ksig.ka);\n\t\tcall_signal_handler(&ksig, regs);\n',
                        '\t\tlong interrupted_raw_result = regs->syscall_return;\n\n'
                        '\t\tsyscall_restart(regs, true, &ksig.ka);\n'
                        '\t\tcall_signal_handler(&ksig, regs, interrupted_raw_result);\n')
    path.write_text(text)
    relative = 'arch/wasm/include/asm/user_signal_boundary.h'
    (after / relative).write_bytes((HERE / 'user_signal_boundary.h').read_bytes())
    patch = ''
    for relative in sorted([*pins, relative]):
        original = before / relative
        changed = after / relative
        old = original.read_text().splitlines(keepends=True) if original.exists() else []
        patch += ''.join(difflib.unified_diff(old, changed.read_text().splitlines(keepends=True),
                                            fromfile='a/' + relative if old else '/dev/null',
                                            tofile='b/' + relative))
    (output / 'kernel-boundary.patch').write_text(patch)
    # Apply the actual patch to independent sparse copies, proving exact replay.
    replay = output / 'replay'
    shutil.copytree(before, replay)
    result = subprocess.run(['patch', '-p1', '--batch', '-i', str(output / 'kernel-boundary.patch')],
                            cwd=replay, capture_output=True, text=True)
    (output / 'patch-apply.log').write_text(result.stdout + result.stderr)
    assert result.returncode == 0
    for path in after.rglob('*'):
        if path.is_file():
            assert path.read_bytes() == (replay / path.relative_to(after)).read_bytes()
    proof = {'pass': True, 'scope': 'patch preparation and exact sparse replay only',
             'inputs': rows, 'patchSha256': digest(patch.encode()),
             'outputs': [{'relative': str(p.relative_to(after)), 'sha256': digest(p.read_bytes()),
                          'bytes': p.stat().st_size} for p in sorted(after.rglob('*')) if p.is_file()]}
    (output / 'proof.json').write_text(json.dumps(proof, indent=2) + '\n')
    assert sum(p.stat().st_size for p in task.rglob('*') if p.is_file()) < 2 * 1024**3
    assert shutil.disk_usage(task).free > 5 * 1024**3
    print(json.dumps({'pass': True, 'patch': str(output / 'kernel-boundary.patch'),
                      'sha256': proof['patchSha256'], 'files': len(proof['outputs'])}))


if __name__ == '__main__':
    main()
