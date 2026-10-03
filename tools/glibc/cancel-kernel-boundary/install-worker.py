#!/usr/bin/env python3
"""Render an owned v3 worker candidate; never write production runtime files."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess

HERE = Path(__file__).resolve().parent


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    ap = argparse.ArgumentParser()
    for name in ('task', 'worker', 'wasm'):
        ap.add_argument('--' + name, type=Path, required=True)
    ap.add_argument('--label', required=True)
    args = ap.parse_args()
    task = args.task.resolve()
    assert str(task).startswith('/mnt/p6/build/') and re.fullmatch('worker[0-9A-Za-z_-]+', args.label)
    assert subprocess.check_output(['findmnt', '-T', str(task), '-no', 'FSTYPE'], text=True).strip() == 'ext4'
    assert shutil.disk_usage(task).free > 8 * 1024**3
    output = task / args.label
    output.mkdir()
    pins = []
    for path in (args.worker, args.wasm, HERE / 'worker-boundary.mjs', Path(__file__)):
        path = path.resolve()
        snapshot = output / ('original-' + sha(path) + '-' + path.name)
        snapshot.write_bytes(path.read_bytes())
        pins.append({'path': str(path), 'snapshot': str(snapshot), 'sha256': sha(path), 'bytes': path.stat().st_size})
    worker = args.worker.read_text()

    def replace(old, new):
        nonlocal worker
        assert worker.count(old) == 1, old[:120]
        worker = worker.replace(old, new)

    replace('function user_imports({ kernel_memory, get_kernel_instance, parent_user: parent, }) {',
            'function user_imports({ kernel_memory, get_kernel_instance, parent_user: parent, }) {\n'
            '    let active_signal_boundary = null;\n'
            '    let boundary_module_epoch = 0;')
    worker = 'import { WorkerSignalBoundary } from "./worker-boundary.mjs";\n' + worker
    replace('function create_instance(context) {', '''function create_instance(context) {
    if (boundary_module_epoch === 0xffffffff) throw new Error("boundary epoch exhausted");
    const epoch = ++boundary_module_epoch;
    // Capture this exact module memory/instance. Exec never rebinds old tokens.
    const signal_boundary = new WorkerSignalBoundary({
        kernelMemory: kernel_memory,
        context: () => ({ instance: user_instance, memory: context.memory }),
        callTyped: (fn, args, arity) => call_user_table_function(fn, args, arity, "GNU boundary helper type"),
        controls: new Set([HALT_KERNEL, HALT_KERNEL_ESCAPE, HALT_USER, HALT_USER_ESCAPE]),
        fault: message => console.error("[user-boundary-v3]", message),
        ordinary(trampoline, handler, signal, kind) {
            const table = user_instance.exports.__indirect_function_table;
            assert(table instanceof WebAssembly.Table, "signal boundary table");
            if (kind === 2) {
                call_user_table_function(table.get(handler >>> 0), [signal], 1, "ordinary signal type");
                return 0;
            }
            siginfo_copy_results.push(null);
            try {
                call_user_table_function(table.get(trampoline >>> 0), [handler, signal], 2, "siginfo boundary type");
                return siginfo_copy_results.at(-1) ?? -22;
            } finally {
                // v3 kernel restores previous active_siginfo, including nesting.
                siginfo_copy_results.pop();
            }
        },
    });''')
    replace('const ret = kernel_instance.exports.syscall(nr, arg0, arg1, arg2, arg3, arg4, arg5);', '''const boundary_token = signal_boundary.enter(Number(nr));
        let ret;
        try {
          ret = kernel_instance.exports.syscall(nr, arg0, arg1, arg2, arg3, arg4, arg5);
        } catch (error) {
          signal_boundary.leave(boundary_token, "escape");
          throw error; // Exact actual halt/exec/trap identity, never a new Symbol.
        }
        // leave may rethrow an ordinary signal exception in this importing
        // guest context, after kernel restoration; do not catch it as a kernel
        // failure or return an internal restart result to user code.
        signal_boundary.leave(boundary_token,
            instance === original_instance ? "return" : "replaced");''')
    replace('audio_write: createAudioWrite(context.memory, postMessage),', '''audio_write: createAudioWrite(context.memory, postMessage),
                boundary_admit_v3: () => {
                    assert(instance === user_instance && !signal_boundary.binding,
                        "GNU boundary admission instance");
                    const raw_tp = Number(kernel_instance.exports.get_thread_area(0)) >>> 0;
                    assert(raw_tp !== 0, "GNU boundary actual TP");
                    const admit = user_instance.exports.__wasm_boundary_v3_admit;
                    assert(typeof admit === "function", "GNU boundary admission helper");
                    const value = call_user_table_function(admit, [raw_tp, epoch, epoch], 3, "GNU admission type");
                    const sidecar = typeof value === "bigint" ? Number(BigInt.asUintN(32, value)) : value >>> 0;
                    signal_boundary.admit(raw_tp, epoch, epoch, sidecar);
                    return 0;
                },''')
    replace('        return user_instance;\n    }\n    function instantiate(fresh_memory)',
            '        active_signal_boundary = signal_boundary;\n        return user_instance;\n    }\n    function instantiate(fresh_memory)')
    replace('            // signal handling:\n', '''            // v3 imports are additive; original v1 modules retain old ABI.
            call_signal_handler_v3(trampoline, fn, sig, record) {
                assert(active_signal_boundary, "signal boundary instance");
                return active_signal_boundary.capture(trampoline >>> 0, fn >>> 0, sig, record >>> 0, 3);
            },
            signal_return_policy_v3(record) {
                assert(active_signal_boundary, "signal restoration instance");
                return active_signal_boundary.restored(record >>> 0, 3);
            },
            // v2 compatibility routes SIGINFO but cannot queue native escapes
            // or admit genuine version3 GNU helpers under a version2 kernel.
            call_siginfo_handler_v2(trampoline, fn, sig, record) {
                assert(active_signal_boundary, "signal boundary instance");
                return active_signal_boundary.capture(trampoline >>> 0, fn >>> 0, sig, record >>> 0, 2);
            },
            signal_return_policy_v2(record) {
                assert(active_signal_boundary, "signal restoration instance");
                return active_signal_boundary.restored(record >>> 0, 2);
            },
            // signal handling:
''')
    wasm = args.wasm.read_text()
    needle = '    "linux\\0copy_siginfo\\0function",'
    assert wasm.count(needle) == 1
    wasm = wasm.replace(needle, needle + '\n    "linux\\0boundary_admit_v3\\0function",')
    (output / 'worker.js').write_text(worker)
    (output / 'wasm.js').write_text(wasm)
    shutil.copyfile(HERE / 'worker-boundary.mjs', output / 'worker-boundary.mjs')
    syntax = []
    for name in ('worker.js', 'wasm.js', 'worker-boundary.mjs'):
        command = ['node', '--check', str(output / name)]
        result = subprocess.run(command, capture_output=True, text=True)
        syntax.append({'argv': command, 'exit': result.returncode, 'stdout': result.stdout, 'stderr': result.stderr})
        assert result.returncode == 0
    proof = {'scope': 'owned source integration candidate and syntax only; no kernel/guest acceptance',
             'inputs': pins, 'outputs': [{'path': str(output / name), 'sha256': sha(output / name)}
                                        for name in ('worker.js', 'wasm.js', 'worker-boundary.mjs')],
             'syntax': syntax, 'runtimeAcceptance': False,
             'requiredNativeProviders': 'real canonical frame bridge and import depth; no stub supplied'}
    (output / 'proof.json').write_text(json.dumps(proof, indent=2) + '\n')
    print(json.dumps({'pass': True, 'proof': str(output / 'proof.json')}))


if __name__ == '__main__':
    main()
