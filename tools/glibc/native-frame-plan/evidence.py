#!/usr/bin/env python3
"""Finite source/layout packet; never builds a compiler or executes unwind."""
import hashlib
import json
import os
from pathlib import Path
import resource
import shlex
import shutil
import signal
import subprocess
import time

R = Path(__file__).resolve().parent
REPO = R.parents[2]
T = Path(os.environ.get('GNU_FRAME_PLAN_TASK', '/mnt/p6/build/glibc-native-frame-plan-20261002'))
STORE = Path('/mnt/p6/project/linux/.tmp-firefox-build/nix-local-store/nix/store')
S = STORE/'jkx0x4a4nlmnjm0kz9fiss33b7wh8z9k-source'
L = STORE/'xwpycnlb71djqs4gyxhbkxhzb3pw1ib4-llvm-toolchain-22.1.8'
G = Path('/mnt/p6/build/glibc-wasm-bootstrap-20261002/source/glibc-2.44')
P = Path('/mnt/p6/build/glibc-cancel-compiler-20261002')
H = Path('/mnt/p6/build/glibc-syscalls-next26-20261002/source/glibc-2.44')

def sha(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for b in iter(lambda: f.read(1024*1024), b''): h.update(b)
    return h.hexdigest()

def pin(path, copy=True):
    path = Path(path).resolve()
    h = sha(path)
    row = {'path': str(path), 'sha256': h, 'bytes': path.stat().st_size}
    if copy:
        dest = T/'snapshots'/(h+'-'+path.name)
        if not dest.exists(): shutil.copyfile(path, dest)
        assert sha(dest) == h
        row['snapshot'] = str(dest)
    else: row['hashOnlyReadOnlyBinary'] = True
    return row

def group(pgid):
    members = []
    for p in Path('/proc').glob('[0-9]*/stat'):
        try:
            fields = p.read_text().rsplit(')', 1)[1].split()
            if int(fields[2]) == pgid and fields[0] != 'Z': members.append(int(p.parent.name))
        except (FileNotFoundError, PermissionError, ProcessLookupError): pass
    return members

def budget(launch=False):
    free = shutil.disk_usage(T).free
    used = int(subprocess.check_output(['du', '-sk', str(T)]).split()[0])*1024
    assert subprocess.check_output(['stat', '-f', '-c', '%T', str(T)]).decode().strip() == 'ext2/ext3'
    assert free >= (8 if launch else 5)*1024**3 and used < 2*1024**3
    return {'freeBytes': free, 'taskBytes': used, 'capBytes': 2*1024**3}

def main():
    for d in ['tmp', 'cache', 'logs', 'objects', 'snapshots']: (T/d).mkdir(parents=True, exist_ok=True)
    os.environ.update(TMPDIR=str(T/'tmp'), TMP=str(T/'tmp'), TEMP=str(T/'tmp'),
                      XDG_CACHE_HOME=str(T/'cache'), PYTHONDONTWRITEBYTECODE='1')
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    budget(True)
    attempt = len(list(T.glob('evidence-attempt-*.json')))+1
    while (T/'logs'/f'commands-attempt-{attempt}.json').exists(): attempt += 1
    sources = {
        'gnu-unwind': G/'nptl/unwind.c', 'gnu-unwind-header': G/'sysdeps/generic/unwind.h',
        'gnu-pthread-private': G/'sysdeps/nptl/pthreadP.h',
        'gnu-create': G/'nptl/pthread_create.c', 'gnu-exit': G/'nptl/pthread_exit.c',
        'gnu-cancel': G/'nptl/pthread_cancel.c', 'gnu-cancellation': G/'nptl/cancellation.c',
        'gnu-x86-cfa-reference': G/'sysdeps/x86_64/jmpbuf-unwind.h',
        'gnu-join': G/'nptl/pthread_join_common.c', 'gnu-unwind-reference': S/'libunwind/src/UnwindLevel1.c',
        'llvm-wasm-unwind': S/'libunwind/src/Unwind-wasm.c',
        'llvm-unwind-header': S/'libunwind/include/unwind_itanium.h',
        'cxx-personality': S/'libcxxabi/src/cxa_personality.cpp',
        'cxx-exception': S/'libcxxabi/src/cxa_exception.cpp',
        'wasm-eh-prepare': S/'llvm/lib/CodeGen/WasmEHPrepare.cpp',
        'wasm-exception-table': S/'llvm/lib/CodeGen/AsmPrinter/WasmException.cpp',
        'wasm-target-pipeline': S/'llvm/lib/Target/WebAssembly/WebAssemblyTargetMachine.cpp',
        'wasm-late-eh': S/'llvm/lib/Target/WebAssembly/WebAssemblyLateEHPrepare.cpp',
        'wasm-asm-printer': S/'llvm/lib/Target/WebAssembly/WebAssemblyAsmPrinter.cpp',
        'wasm-sjlj': S/'llvm/lib/Target/WebAssembly/WebAssemblyLowerEmscriptenEHSjLj.cpp',
        'wasm-frame-header': S/'llvm/lib/Target/WebAssembly/WebAssemblyFrameLowering.h',
        'wasm-stack-lowering': S/'llvm/lib/Target/WebAssembly/WebAssemblyISelLowering.cpp',
        'dag-stack-expansion': S/'llvm/lib/CodeGen/SelectionDAG/LegalizeDAG.cpp',
        'wasm-physical-register-replacement': S/'llvm/lib/Target/WebAssembly/WebAssemblyReplacePhysRegs.cpp',
        'compiler-patch': P/'compiler.patch', 'compiler-review': P/'review.json',
        'compiler-source-changes': P/'source-changes.json',
        'accepted-O2-IR': P/'objects/controls/O2-controls.cpp.ll',
        'accepted-O2-result': P/'logs/O2-runtime.json',
        'jump-lowering': REPO/'tools/glibc/jumps/lower.cpp',
        'jump-providers': REPO/'tools/glibc/jumps/helpers.c',
        'jump-cfa': REPO/'tools/glibc/jumps/jmpbuf-unwind.h',
        'native-jmp-header': H/'sysdeps/wasm32/bits/setjmp.h',
        'gnu-wordsize': H/'sysdeps/wordsize-32/bits/wordsize.h',
        'prepared-cxx-recipe': REPO/'tools/glibc/cxx-exception-closure/cxxabi-compile.py',
        'prepared-cxx-layout': REPO/'tools/glibc/cxx-exception-closure/cxxabi-layout.cpp',
        'prepared-cxx-result': Path('/mnt/p6/build/glibc-cxx-exception-closure-20261002/logs/cxxabi-layout-results.json'),
        'prepared-gnu-header': Path('/mnt/p6/build/glibc-cxx-exception-closure-20261002/source/coherent-include/gnu-unwind.h'),
        'prepared-wasm-unwind': REPO/'tools/glibc/cxx-exception-closure/Unwind-wasm-gnu.c',
        'previous-plan': REPO/'docs/glibc-cancel-native-plan-20261002.md',
        'jit-specializer': REPO/'tools/pbl-jit/PblJit.cpp',
        'jit-builder': REPO/'tools/build-firefox-pbl-jit.py',
        'jit-native-install': REPO/'web/linux/dist/guest-jit.js',
        'jit-worker': REPO/'web/linux/dist/worker.js',
        'jit-wasm-runtime': REPO/'web/linux/dist/wasm.js',
        'jit-design': REPO/'docs/guest-jit-design-20260928.md',
        'jit-install-design': REPO/'docs/guest-jit-runtime-primitive-20260928.md',
        'jit-nightly-migration': Path('/mnt/p6/build/firefox-nightly-jit-api-20261002/acceptance-and-migration-plan.md'),
        'jit-nightly-source-pins': Path('/mnt/p6/build/firefox-nightly-jit-api-20261002/source-evidence.json'),
    }
    changes = json.loads((P/'source-changes.json').read_text())
    source_pairs = []
    for rel, entry in changes.items():
        original, owned = S/rel, Path(entry['path'])
        assert sha(original) == entry['original'] and sha(owned) == entry['owned']
        sources['original-'+rel] = original
        sources['basis-'+rel] = owned
        source_pairs.append({'relative': rel, 'original': str(original), 'basis': str(owned),
                             'originalSha256': entry['original'], 'basisSha256': entry['owned']})
    sources.update({p.name: p for p in R.iterdir() if p.is_file()})
    sources['plan-document'] = REPO/'docs/glibc-native-frame-plan-20261002.md'
    packets = sorted(T.glob('records-patch-*/prepared.json'),
                     key=lambda p: int(p.parent.name.rsplit('-', 1)[1]))
    prepared_record = None
    if packets:
        latest = packets[-1]
        prepared_record = json.loads(latest.read_text())
        sources['prepared-record-patch'] = latest
        sources['record-compiler-patch'] = Path(prepared_record['compilerPatch'])
        sources['record-source-pairs'] = latest.parent/'source-pairs.json'
        for rel, row in prepared_record['sourcePairs'].items():
            assert sha(row['path']) == row['ownedSha256']
            sources['record-owned-'+rel] = Path(row['path'])
            if 'basis' in row:
                assert sha(row['basis']) == row['basisSha256']
                sources['record-basis-snapshot-'+rel] = Path(row['basisSnapshot'])
        for path, row in prepared_record['runtimeSources'].items():
            if isinstance(row, str): assert sha(path) == row
            else:
                assert sha(path) == row['sha256'] and sha(row['snapshot']) == row['sha256']
                sources['record-runtime-snapshot-'+Path(path).name] = Path(row['snapshot'])
    pins = {name: pin(path) for name, path in sources.items()}
    pins['accepted-compiler'] = pin(P/'objects/compiler/clang', False)
    for tool in ['llvm-objdump']:
        pins[tool] = pin(L/'bin'/tool, False)
    assert pins['compiler-patch']['sha256'] == '67473abb362e308fef395f80baffdabb8e5baa8572222b457fefb879911cec40'
    assert pins['accepted-compiler']['sha256'] == '1147a637f9144f77c35398fc0cfd77a06fb4fec21f91706361c34395d1b8848b'
    assert pins['prepared-gnu-header']['sha256'] == pins['gnu-unwind-header']['sha256']
    needles = {
        'GNU-call-real-forced': ('gnu-unwind', '_Unwind_ForcedUnwind (&self->exc, unwind_stop, ibuf);'),
        'GNU-end-or-CFA-before-jump': ('gnu-unwind', '_JMPBUF_CFA_UNWINDS_ADJ'),
        'GNU-legacy-chain-CFA': ('gnu-unwind', '_Unwind_GetCFA (context)'),
        'GNU-target-longjmp': ('gnu-unwind', '__libc_unwind_longjmp'),
        'GNU-swallow-fatal': ('gnu-unwind', 'FATAL: exception not rethrown'),
        'GNU-next-buffer': ('gnu-unwind', 'ibuf->priv.data.prev'),
        'GNU-double-word-alignment': ('gnu-unwind-header', '__aligned__ (2 * sizeof (_Unwind_Word))'),
        'LLVM-conflicting-reserved': ('llvm-unwind-header', 'uint32_t reserved[3];'),
        'LLVM-stop-before-personality': ('gnu-unwind-reference', '(*stop)(1, action, exception_object->exception_class'),
        'LLVM-nonzero-stop-fatal': ('gnu-unwind-reference', 'if (stopResult != _URC_NO_REASON)'),
        'LLVM-final-end-stack': ('gnu-unwind-reference', '_UA_FORCE_UNWIND | _UA_CLEANUP_PHASE | _UA_END_OF_STACK'),
        'stock-search-actions': ('llvm-wasm-unwind', '1, _UA_SEARCH_PHASE, exception_object->exception_class'),
        'stock-delete-callback': ('llvm-wasm-unwind', '(*exception_object->exception_cleanup)(_URC_FOREIGN_EXCEPTION_CAUGHT'),
        'CXX-actual-rethrow-entry': ('cxx-exception', '_Unwind_RaiseException(&exception_header->unwindHeader);'),
        'CXX-foreign-catch-delete': ('cxx-exception', '_Unwind_DeleteException(&globals->caughtExceptions->unwindHeader);'),
        'CXX-forced-catch-all': ('cxx-personality', 'foreign exceptions. This is search phase, cleanup'),
        'CXX-forced-phase2-installs-selector': ('cxx-personality', 'assert(actions & _UA_CLEANUP_PHASE);'),
        'EH-skips-cleanup-personality': ('wasm-eh-prepare', "Cleanup pads don't need a personality function call."),
        'EH-no-cleanup-payload': ('wasm-eh-prepare', 'if (!GetExnCI)'),
        'EH-real-pad-index': ('wasm-eh-prepare', 'IRB.CreateCall(LPadIndexF, {FPI, IRB.getInt32(Index)});'),
        'LSDA-index-not-PC': ('wasm-exception-table', 'to not a call site for possibly-throwing functions but a landing pad.'),
        'late-before-stackify': ('wasm-target-pipeline', 'addPass(createWebAssemblyLateEHPrepare());'),
        'late-before-physical-register-replacement': ('wasm-target-pipeline', 'addPass(createWebAssemblyReplacePhysRegs());'),
        'SjLj-real-target-match': ('wasm-sjlj', 'IRB.CreateCall(WasmSetjmpTestF, {EnvP, FunctionInvocationId}'),
        'jump-body-SP-not-CFA': ('jump-lowering', 'Intrinsic::stacksave'),
        'saved-owner': ('jump-providers', 'b->__jmpbuf[0].__owner=THREAD_SELF'),
        'basis-preserved-prologue-SP': ('basis-llvm/lib/Target/WebAssembly/WebAssemblyFrameLowering.cpp', 'Register CallerEntrySP = MRI.createVirtualRegister(PtrRC);'),
        'dynamic-SP-expands-to-physical-register': ('wasm-stack-lowering', 'setOperationAction(ISD::DYNAMIC_STACKALLOC, MVTPtr, Expand);'),
        'stackrestore-physical-SP-definition': ('dag-stack-expansion', 'Results.push_back(DAG.getCopyToReg(Node->getOperand(0), dl, SP,'),
        'dynamic-SP-global-writeback': ('basis-llvm/lib/Target/WebAssembly/WebAssemblyFrameLowering.cpp', 'TII->getCallFrameDestroyOpcode()'),
        'physical-SP-replacement-last-chance': ('wasm-physical-register-replacement', 'MRI.reg_operands(PReg)'),
        'JIT-normal-interrupt-exit': ('jit-specializer', 'a pending interrupt at the backedge'),
        'JIT-actual-native-call': ('jit-specializer', 'reinterpret_cast<JitFn>(uintptr_t(e->fn))'),
        'JIT-original-install-import-rejection': ('jit-native-install', 'function/tag imports are not permitted'),
    }
    findings = {}
    for name, (source, needle) in needles.items():
        text = sources[source].read_text()
        assert needle in text, name
        findings[name] = {'source': source, 'line': text[:text.index(needle)].count('\n')+1, 'needle': needle}
    text = sources['llvm-wasm-unwind'].read_text()
    assert '_Unwind_ForcedUnwind(' not in text and '_Unwind_GetCFA(' not in text
    commands = []
    command_file = T/'logs'/f'commands-attempt-{attempt}.json'
    def run(name, argv):
        budget(True)
        log = T/'logs'/f'{name}-attempt-{attempt}.log'
        start = time.monotonic()
        with log.open('wb') as f:
            proc = subprocess.Popen([str(x) for x in argv], cwd=T, stdout=f, stderr=subprocess.STDOUT, start_new_session=True)
            row = {'name': name, 'argv': [str(x) for x in argv], 'cwd': str(T), 'pid': proc.pid, 'pgid': proc.pid, 'log': str(log)}
            commands.append(row)
            command_file.write_text(json.dumps(commands, indent=2)+'\n')
            try: code = proc.wait(timeout=60)
            except subprocess.TimeoutExpired:
                os.killpg(proc.pid, signal.SIGKILL)
                code = proc.wait()
            row.update(exit=code, seconds=time.monotonic()-start, members=group(proc.pid))
            command_file.write_text(json.dumps(commands, indent=2)+'\n')
        assert code == 0 and not row['members'], row
        return log
    flags = ['--target=wasm32-unknown-linux-gnu', '-ffreestanding', '-nostdinc',
             '-I'+str(G/'sysdeps/generic'), '-I'+str(H/'sysdeps/wasm32'), '-I'+str(H/'sysdeps/wordsize-32'),
             '-fno-builtin', '-fno-stack-protector', '-fexceptions', '-fwasm-exceptions', '-matomics', '-mbulk-memory', '-O2']
    mode = ['-mllvm', '-wasm-gnu-cancel-prerequisite']
    obj = T/'objects'/f'layout-attempt-{attempt}'
    ir, native = Path(str(obj)+'.ll'), Path(str(obj)+'.o')
    run('layout-IR', [P/'objects/compiler/clang', *flags, *mode, '-MD', '-MF', str(obj)+'.d', '-S', '-emit-llvm', R/'layout.c', '-o', ir])
    run('layout-native', [P/'objects/compiler/clang', *flags, *mode, '-c', R/'layout.c', '-o', native])
    disasm = run('layout-disassembly', [L/'bin/llvm-objdump', '--disassemble', native])
    expected = '[i32 24, i32 8, i32 12, i32 16, i32 24, i32 32, i32 64, i32 20, i32 40, i32 16, i32 48, i32 36, i32 60, i32 4, i32 10, i32 26]'
    assert expected in ir.read_text()
    assert 'wasm-gnu-cancel-prerequisite' in ir.read_text()
    for path in shlex.split(Path(str(obj)+'.d').read_text().replace('\\\n', ' ').partition(':')[2]):
        p = Path(path)
        if p.is_file(): pins['include-'+str(p.resolve())] = pin(p)
    outputs = {p.name: pin(p) for p in [ir, native, disasm, command_file]}
    for row in [*pins.values(), *outputs.values()]:
        assert sha(row['path']) == row['sha256']
        if 'snapshot' in row: assert sha(row['snapshot']) == row['sha256']
    proof = {'sourcePlanOnly': True, 'compilerBuild': False, 'runtimeAcceptance': False,
             'attempt': attempt, 'inputs': pins, 'outputs': outputs, 'sourcePairs': source_pairs,
             'findings': findings, 'commands': commands, 'layoutValues': [24,8,12,16,24,32,64,20,40,16,48,36,60,4,10,26],
             'preparedCxxEvidence': json.loads(sources['prepared-cxx-result'].read_text()),
             'preparedRecordPatch': prepared_record,
             'differences': [], 'storage': budget(),
             'retainedDiscoveryFailures': ['read-only initial path lookups: Unwind-wasm.h, WebAssemblyException.cpp, jumps/bits/setjmp.h and guessed jump adapter/provider filenames absent; two later lookups used obsolete FrameLowering snapshot directory and moved EHPersonalities header; corrected to exact source paths before evidence/compile; tool transcript only, no source mutations', 'four apply_patch verification failures before corrected owned edits; atomic failure left files unchanged; tool transcript only', 'JIT discovery initially guessed absent js/ path and broad parent search found no match; exact root-provided paths then pinned'],
             'remaining': ['all general descriptor/runtime implementation', 'activeSP updates on dynamic alloca/stackrestore', 'architecture CFA ancestry/equality adaptation', 'stop-before-language-cleanup guard composition', 'tag1 retained record reconciliation', 'trap boundary reconciliation', 'coherent LTO linker and final loop audit', 'GNU forced unwind and public lifecycle runtime gates']}
    result = T/f'evidence-attempt-{attempt}.json'
    result.write_text(json.dumps(proof, indent=2)+'\n')
    print(json.dumps({'path': str(result), 'sha256': sha(result), 'pins': len(pins), 'findings': len(findings), 'commands': commands, 'storage': budget()}))

if __name__ == '__main__': main()
