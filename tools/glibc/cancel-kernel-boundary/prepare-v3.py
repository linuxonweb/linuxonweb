#!/usr/bin/env python3
"""Produce a separate v3 proposal from the reviewed v2 sparse replay."""
import argparse
import difflib
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess

HERE = Path(__file__).resolve().parent
V2_SHA = 'a27a219d28b4a78ad7e29d6446b1c52dffa114c58c6bd508a8ade643b02fef13'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def once(text, old, new):
    assert text.count(old) == 1, old
    return text.replace(old, new, 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--task', type=Path, required=True)
    ap.add_argument('--label', default='prepared-v3')
    args = ap.parse_args()
    assert args.label.startswith('prepared-v3') and all(c.isalnum() or c in '-_' for c in args.label)
    task = args.task.resolve()
    assert str(task).startswith('/mnt/p6/build/')
    assert subprocess.check_output(['findmnt', '-T', str(task), '-no', 'FSTYPE'], text=True).strip() == 'ext4'
    assert shutil.disk_usage(task).free >= 8 * 1024**3
    for name in ('TMPDIR', 'TMP', 'TEMP'):
        assert Path(os.environ[name]).resolve().is_relative_to(task)
    v2 = task / 'prepared'
    assert sha(v2 / 'kernel-boundary.patch') == V2_SHA
    proof = json.loads((v2 / 'proof.json').read_text())
    for row in proof['outputs']:
        assert sha(v2 / 'kernel' / row['relative']) == row['sha256']
    output = task / args.label
    output.mkdir()
    shutil.copytree(v2 / 'kernel', output / 'original')
    shutil.copytree(v2 / 'kernel', output / 'kernel')
    root = output / 'kernel'
    header = root / 'arch/wasm/include/asm/user_signal_boundary.h'
    header.write_bytes((HERE / 'user_signal_boundary_v3.h').read_bytes())
    path = root / 'arch/wasm/include/asm/wasm_imports.h'
    text = path.read_text().replace('wasm_signal_boundary_v2', 'wasm_signal_boundary_v3')
    text = text.replace('call_siginfo_handler_v2', 'call_signal_handler_v3')
    text = text.replace('signal_return_policy_v2', 'signal_return_policy_v3')
    text = text.replace('/* v2 copy status', '/* v3 callback/copy status')
    path.write_text(text)
    path = root / 'arch/wasm/kernel/signal.c'
    text = path.read_text().replace('wasm_signal_boundary_v2', 'wasm_signal_boundary_v3')
    text = text.replace('wasm_user_signal_return_policy_v2', 'wasm_user_signal_return_policy_v3')
    text = once(text, '\t\t.signal = ksig->sig,\n',
                '\t\t.signal = ksig->sig,\n'
                '\t\t.handler = (u32)(uintptr_t)sa->sa_handler,\n'
                '\t\t.trampoline = (sa->sa_flags & SA_SIGINFO)\n'
                '\t\t\t? (u32)(uintptr_t)sa->sa_restorer : 0,\n'
                '\t\t.action_flags = sa->sa_flags,\n'
                '\t\t.delivery_kind = (sa->sa_flags & SA_SIGINFO)\n'
                '\t\t\t? WASM_SIGNAL_BOUNDARY_SIGINFO : WASM_SIGNAL_BOUNDARY_SIMPLE,\n')
    start = text.index('\tif (sa->sa_flags & SA_SIGINFO) {\n')
    end = text.index('\n\tenter_from_user_mode(regs);', start)
    text = text[:start] + (
        '\t{\n'
        '\t\tconst struct kernel_siginfo *previous_siginfo = ti->active_siginfo;\n\n'
        '\t\tif (sa->sa_flags & SA_SIGINFO)\n'
        '\t\t\tti->active_siginfo = &ksig->info;\n'
        '\t\tif (wasm_signal_boundary_next(&ti->signal_generation_lo,\n'
        '\t\t\t\t\t      &ti->signal_generation_hi)) {\n'
        '\t\t\tboundary.generation_lo = ti->signal_generation_lo;\n'
        '\t\t\tboundary.generation_hi = ti->signal_generation_hi;\n'
        '\t\t\tfailed = wasm_user_call_signal_handler_v3(\n'
        '\t\t\t\tboundary.trampoline, boundary.handler, ksig->sig, &boundary);\n'
        '\t\t} else {\n\t\t\tfailed = -EOVERFLOW;\n\t\t}\n'
        '\t\tti->active_siginfo = previous_siginfo;\n\t}\n\n\tlocal_irq_disable();\n') + text[end:]
    text = once(text, '\tif (sa->sa_flags & SA_SIGINFO) {\n', '\t{\n')
    text = once(text, '\t\t} else if (policy != 0) {\n',
                '\t\t} else if (wasm_signal_boundary_queued_escape(policy, failed)) {\n'
                '\t\t\t/* Exact exception is queued; do not expose/change the result. */\n'
                '\t\t\tregs->restart_syscall_nr = -1;\n'
                '\t\t} else if (policy != 0) {\n')
    path.write_text(text)
    patch = ''
    for row in proof['outputs']:
        relative = row['relative']
        before = output / 'original' / relative
        after = root / relative
        patch += ''.join(difflib.unified_diff(before.read_text().splitlines(keepends=True),
                                            after.read_text().splitlines(keepends=True),
                                            fromfile='a/' + relative, tofile='b/' + relative))
    (output / 'v2-to-v3.patch').write_text(patch)
    replay = output / 'replay'
    shutil.copytree(output / 'original', replay)
    completed = subprocess.run(['patch', '-p1', '--batch', '-i', str(output / 'v2-to-v3.patch')],
                               cwd=replay, capture_output=True, text=True)
    (output / 'patch-apply.log').write_text(completed.stdout + completed.stderr)
    assert completed.returncode == 0
    for path in root.rglob('*'):
        if path.is_file():
            assert path.read_bytes() == (replay / path.relative_to(root)).read_bytes()
    result = {'pass': True, 'scope': 'versioned patch proposal and exact replay, no v3 unit/runtime acceptance',
              'v2PatchSha256': V2_SHA, 'patchSha256': sha(output / 'v2-to-v3.patch'),
              'sources': [{'path': str(p), 'sha256': sha(p)} for p in [Path(__file__).resolve(), HERE / 'user_signal_boundary_v3.h']],
              'outputs': [{'relative': str(p.relative_to(root)), 'sha256': sha(p), 'bytes': p.stat().st_size}
                          for p in sorted(root.rglob('*')) if p.is_file()]}
    (output / 'proof.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result))


if __name__ == '__main__':
    main()
