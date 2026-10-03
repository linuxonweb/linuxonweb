#!/usr/bin/env python3
"""Prepare exact record-only owned diff. Never compiles or mutates a base."""
import difflib
import json
import argparse
from evidence import T, S, P, R, sha, budget

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--packet', default='records-patch-1')
    args = parser.parse_args()
    assert args.packet.startswith('records-patch-') and args.packet.removeprefix('records-patch-').isdigit()
    out = T/args.packet
    assert not out.exists(), 'retain original prepared patch; use a new numbered packet for correction'
    out.mkdir()
    budget(True)
    basis = json.loads((P/'source-changes.json').read_text())
    changes = {}
    chunks = []
    def edit(rel, transform):
        original = S/rel
        base = __import__('pathlib').Path(basis[rel]['path']) if rel in basis else original
        if rel in basis:
            assert sha(base) == basis[rel]['owned'] and sha(original) == basis[rel]['original']
        old = base.read_text()
        new = transform(old)
        assert new != old
        dest = out/'source'/rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(new)
        previous = out/'basis'/rel
        previous.parent.mkdir(parents=True, exist_ok=True)
        previous.write_text(old)
        changes[rel] = {'original': str(original), 'originalSha256': sha(original),
                        'basis': str(base), 'basisSha256': sha(base),
                        'basisSnapshot': str(previous), 'path': str(dest), 'ownedSha256': sha(dest)}
        chunks.append(''.join(difflib.unified_diff(old.splitlines(True), new.splitlines(True),
                      fromfile='a/'+rel, tofile='b/'+rel)))
    def replace(text, old, new):
        assert text.count(old) == 1, old
        return text.replace(old, new)
    edit('llvm/lib/Target/WebAssembly/WebAssembly.h', lambda t: replace(t,
        'ModulePass *createWebAssemblyAddMissingPrototypes();',
        'ModulePass *createWebAssemblyAddMissingPrototypes();\n'
        'ModulePass *createWebAssemblyGNUFrames();\n'
        'FunctionPass *createWebAssemblyGNUFrameAudit();'))
    def pipeline(t):
        t = replace(t, '  // If exception handling is not enabled and setjmp/longjmp handling is',
            '  // Explicit opt-in pass; ordinary modules are unchanged.\n'
            '  addPass(createWebAssemblyGNUFrames());\n\n'
            '  // If exception handling is not enabled and setjmp/longjmp handling is')
        return replace(t, '  addPass(createWebAssemblyReplacePhysRegs());',
            '  addPass(createWebAssemblyGNUFrameAudit());\n'
            '  addPass(createWebAssemblyReplacePhysRegs());')
    edit('llvm/lib/Target/WebAssembly/WebAssemblyTargetMachine.cpp', pipeline)
    validation = '''  if (MF.getFunction().hasFnAttribute("wasm-gnu-frame-records")) {
    unsigned Records = 0;
    for (int I = MFI.getObjectIndexBegin(); I != MFI.getObjectIndexEnd(); ++I) {
      if (MFI.isDeadObjectIndex(I)) continue;
      auto *AI = MFI.getObjectAllocation(I);
      if (!AI || !AI->getMetadata("wasm.gnu.frame.record.v1")) continue;
      if (MFI.getObjectSize(I) != 64 || MFI.getObjectAlign(I) < Align(16) ||
          MFI.getStackID(I) == TargetStackID::WasmLocal)
        report_fatal_error("GNU activation is not a real aligned64-byte linear frame");
      ++Records;
    }
    if (Records != 1 || !MF.getFunction().hasFnAttribute(Attribute::NoRedZone))
      report_fatal_error("GNU machine frame lost record or red-zone prohibition");
  }

'''
    epilogue = '''  if (MF.getFunction().hasFnAttribute("wasm-gnu-frame-records")) {
    unsigned CallerSP = 0;
    for (auto &BB : MF) for (auto &MI : BB) {
      if (!MI.isCall()) continue;
      bool Entry = false;
      for (auto &MO : MI.operands()) {
        if (MO.isGlobal() && MO.getGlobal()->getName() == "__wasm_gnu_frame_enter_v1") Entry = true;
        if (MO.isSymbol() && StringRef(MO.getSymbolName()) == "__wasm_gnu_frame_enter_v1") Entry = true;
      }
      if (!Entry) continue;
      // PEI can visit a separate return block before eliminating the entry's
      // frame-index argument. Count that sealed operand without reconstructing
      // it; actual caller-SP operand2 must already be a real register.
      SmallVector<const MachineOperand *, 4> Args;
      for (auto &MO : MI.operands())
        if ((MO.isReg() && MO.isUse() && !MO.isImplicit()) || MO.isFI())
          Args.push_back(&MO);
      if (Args.size() != 4 || !Args[2]->isReg() || CallerSP)
        report_fatal_error("GNU epilogue missing unique sealed entry operands");
      CallerSP = Args[2]->getReg();
    }
    if (!CallerSP) report_fatal_error("GNU epilogue missing captured actual caller-SP");
    writeSPToGlobal(CallerSP, MF, MBB, InsertPt, DL);
    return;
  }

'''
    def frame(t):
        t = replace(t, '  if (!needsSP(MF))\n    return;\n',
                    validation+'  if (!needsSP(MF))\n    return;\n')
        return replace(t, '  // Restore the stack pointer. If we had fixed-size locals, add the offset',
                       epilogue+'  // Restore the stack pointer. If we had fixed-size locals, add the offset')
    edit('llvm/lib/Target/WebAssembly/WebAssemblyFrameLowering.cpp', frame)
    rel = 'llvm/lib/Target/WebAssembly/WebAssemblyGNUFrames.cpp'
    new = R/'WebAssemblyGNUFrames.cpp'
    dest = out/'source'/rel
    dest.write_bytes(new.read_bytes())
    changes[rel] = {'newSource': True, 'path': str(dest), 'ownedSha256': sha(dest), 'template': str(new)}
    chunks.append(''.join(difflib.unified_diff([], new.read_text().splitlines(True),
                  fromfile='/dev/null', tofile='b/'+rel)))
    patch = out/'compiler.patch'
    patch.write_text(''.join(chunks))
    (out/'source-pairs.json').write_text(json.dumps(changes, indent=2)+'\n')
    runtime = {}
    for name in ['records-runtime.c', 'frame-abi.h']:
        source = R/name
        copy = out/'runtime'/name
        copy.parent.mkdir(exist_ok=True)
        copy.write_bytes(source.read_bytes())
        runtime[str(source)] = {'sha256': sha(source), 'snapshot': str(copy)}
    proof = {'compilerPatch': str(patch), 'patchSha256': sha(patch), 'sourcePairs': changes,
             'runtimeSources': runtime, 'compiled': False, 'reviewRequiredBeforeSparseBuild': True,
             'explicitFailures': ['EH pads/escaping-EH', 'SjLj/computed branches', 'variadic/naked/coroutine/inline assembly',
               'unregistered definitions/calls', 'invalid record geometry/owner/epoch', 'forced state in record-only provider',
               'unclassified body-SP updates or dynamic commit count changes'], 'storage': budget()}
    (out/'prepared.json').write_text(json.dumps(proof, indent=2)+'\n')
    print(json.dumps({'prepared': str(out/'prepared.json'), 'sha256': sha(out/'prepared.json'),
                      'patch': str(patch), 'patchSha256': sha(patch), 'surfaces': len(changes), 'compiled': False}))

if __name__ == '__main__': main()
