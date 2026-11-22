#!/usr/bin/env python3
"""Pin loader and genuine pthread startup ordering; no runtime admission claim."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess

HERE = Path(__file__).resolve().parent


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    ap = argparse.ArgumentParser()
    for name in ('task', 'repository', 'pristine', 'caller-proof', 'compile-proof', 'kernel-source'):
        ap.add_argument('--' + name, type=Path, required=True)
    args = ap.parse_args()
    task = args.task.resolve()
    assert task.parent == Path('/mnt/p6/build') and not task.exists()
    assert digest(args.compile_proof) == 'f149f926e598648e4e7493b34b4e90d5861e984f5ad7b2bc95d385152fb06101'
    assert digest(args.caller_proof) == 'fb1579eca3048afdfd160badc01ce7e3494a4a0f83fa448570c602dafb05c34e'
    task.mkdir()
    assert subprocess.check_output(['findmnt', '-T', str(task), '-no', 'FSTYPE'], text=True).strip() == 'ext4'
    assert shutil.disk_usage(task).free >= 8 * 1024**3
    for name in ('snapshots', 'tmp', 'cache'):
        (task / name).mkdir()
    os.environ.update(TMPDIR=str(task / 'tmp'), TMP=str(task / 'tmp'), TEMP=str(task / 'tmp'),
                      XDG_CACHE_HOME=str(task / 'cache'), PYTHONDONTWRITEBYTECODE='1')
    pins = []

    def pin(path):
        path = path.resolve()
        row = {'path': str(path), 'sha256': digest(path), 'bytes': path.stat().st_size}
        dest = task / 'snapshots' / (row['sha256'] + '-' + path.name)
        if dest.exists():
            assert dest.read_bytes() == path.read_bytes()
        else:
            shutil.copyfile(path, dest)
        row['snapshot'] = str(dest)
        pins.append(row)
        return row

    pin(Path(__file__))
    pin(args.compile_proof)
    pin(args.caller_proof)
    worker = args.repository / 'web/linux/dist/worker.js'
    adapter = args.repository / 'web/linux/dist/firefox-callback-adapter.mjs'
    installer = HERE / 'install-worker.py'
    for path in (worker, adapter, installer, HERE / 'worker-boundary.mjs'):
        pin(path)
    text = worker.read_text()
    assert '__wasm_call_ctors' not in text
    create = text[text.index('function create_instance(context) {'):text.index('function instantiate(fresh_memory) {')]
    assert 'new WebAssembly.Instance(context.module,' in create
    assert not re.search(r'user_instance\.exports\.\w+\(', create)
    assert 'installFirefoxCallbackAdapter(context.module, user_instance)' in create
    assert 'new WebAssembly.Module(bytes)' in text
    assert '_start();' in text and 'call_entry = () => {' in text
    assert 'new WebAssembly.Instance' in adapter.read_text()
    assert 'table.set(' in adapter.read_text()
    # This instantiates a separate no-import adapter module, not guest exports;
    # the actual candidate module must still exclude a native start section.
    assert 'exports.__wasm_call_ctors' not in adapter.read_text()
    boundary = (HERE / 'worker-boundary.mjs').read_text()
    assert 'const bridge = this.binding ? this.helper(' in boundary
    assert 'boundary_admit_v3:' in installer.read_text()
    original = args.pristine / 'nptl/pthread_create.c'
    pin(original)
    gnu = original.read_text()
    parent = gnu[gnu.index('internal_signal_block_all (&original_sigmask);'):]
    assert parent.index('pd->sigmask = original_sigmask;') < parent.index('create_thread (pd,')
    assert parent.index('internal_sigdelset (&pd->sigmask, SIGCANCEL);') < parent.index('create_thread (pd,')
    child = gnu[gnu.index('start_thread (void *arg)'):gnu.index('/* No previous handlers.')]
    assert child.index('lll_lock (pd->lock, LLL_PRIVATE);') < child.index('not_first_call = setjmp')
    assert child.index('INTERNAL_SYSCALL_CALL (set_robust_list,') < child.index('not_first_call = setjmp')
    full_child = gnu[gnu.index('start_thread (void *arg)'):gnu.index('internal_signal_restore_set (&pd->sigmask);')]
    assert 'THREAD_SETMEM (pd, cleanup_jmp_buf, &unwind_buf);' in full_child
    raw = args.caller_proof.parent / 'objects/lowered.ll'
    pin(raw)
    ir = raw.read_text()
    start = ir[ir.index('define internal i32 @start_thread('):]
    start = start[:start.index('\n}') + 2]
    assert start.index('@__lll_lock_wait_private(') < start.index('@setjmp(')
    assert '@__sigjmp_save(' in start and '@__wasm_jmp_prepare(' in start
    calls = re.findall(r'\b(?:call|invoke)\b[^\n]*?@([A-Za-z_][A-Za-z0-9_.]*)\(', start)
    before = calls[:calls.index('setjmp')]
    # Active retained architecture restores actual kernel mask through raw134;
    # this remains separate from the exec finite owner bootstrap contract.
    proc = args.kernel_source / 'arch/wasm/kernel/process.c'
    pin(proc)
    assert 'task_thread_info(p)->tp_value = args->tls;' in proc.read_text()
    for rel in ('kernel/fork.c', 'arch/wasm/kernel/fork.c'):
        pin(args.kernel_source / rel)
    fork = (args.kernel_source / 'kernel/fork.c').read_text()
    assert '*dst = *src;' in fork and 'p = dup_task_struct(current, node);' in fork
    custom = (args.kernel_source / 'arch/wasm/kernel/fork.c').read_text()
    assert 'kargs.fn = wasm_call_clone_fn;' in custom and '.user_worker' not in custom
    report = {'pass': True, 'runtimeAcceptance': False, 'nativeRecordsAdmitted': False,
              'loader': {'explicitGuestCtorCall': False, 'candidateInstanceMayExecuteStartSection': True,
                         'requiredFinalModuleCheck': 'reject section8 before instantiation; verify no ctor before first rawmask',
                         'adapterIsSeparateModule': True,
                         'beforeOwnerAdmission': 'worker enter binding=null invokes no guest helper; admission helper called only by explicit bootstrap import'},
              'pthread': {'parentBlocksAllBeforeClone': True, 'childInheritsKernelBlockedMask': True,
                          'savedMaskExcludesSIGCANCEL': True, 'childRestoreAfterRealJumpAnchor': True,
                          'possibleCallsBeforeJumpAnchor': before,
                          'requiredContract': 'distinct genuine child TLS/owner admission before helper frames/imports; no blanket exec-startup seal'},
              'remaining': ['actual final Wasm start-section audit', 'authenticated compiler startup class',
                            'recorded4 restore helper and owner gate', 'real mask failure/exit and inherited pending signal gates'],
              'inputPins': pins}
    for row in pins:
        assert digest(Path(row['path'])) == row['sha256']
    assert shutil.disk_usage(task).free >= 5 * 1024**3
    (task / 'proof.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'pass': True, 'proof': str(task / 'proof.json'), 'sha256': digest(task / 'proof.json')}))


if __name__ == '__main__':
    main()
