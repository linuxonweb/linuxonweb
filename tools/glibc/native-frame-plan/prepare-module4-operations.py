#!/usr/bin/env python3
"""Separate source-only fix for proven consumer16 failures; no frozen mutation."""
import difflib
import json
from evidence import T, R, sha, budget


def change(text, old, new, count=1):
    assert text.count(old) == count, (old, text.count(old))
    return text.replace(old, new)


def main():
    budget(True)
    basis = T / 'module4-proposal-16'
    out = T / 'module4-proposal-18'
    assert not out.exists()
    out.mkdir()
    pairs, chunks = {}, []
    for old in sorted((basis / 'source').rglob('*.cpp')) + sorted((basis / 'source').rglob('*.h')):
        rel = old.relative_to(basis / 'source')
        text = old.read_text()
        new = text
        if old.name == 'WebAssemblyGNUFrames.cpp':
            new = change(new, '  SmallVector<Function *, 16> Functions;', '''  for (auto &F : M) for (auto &I : instructions(F))
    if (I.getMetadata("wasm.gnu.compiler.operation.v1"))
      report_fatal_error("GNU source supplies compiler-operation ownership metadata");
  SmallVector<Function *, 16> Functions;''')
            new = change(new, '    Constant *Personality = ConstantPointerNull::get(P);', '''    if (GNUForcedAdmission && !F->hasPersonalityFn()) {
      // Late forced routing adds real scoped catch alternatives even to leaves.
      // Establish genuine scoped personality BEFORE descriptor construction.
      auto *MarkerTy = FunctionType::get(I32, {}, true);
      F->setPersonalityFn(cast<Constant>(
          M.getOrInsertFunction("__gxx_wasm_personality_v0", MarkerTy).getCallee()));
    }
    Constant *Personality = ConstantPointerNull::get(P);''')
            new = change(new, '    F->addFnAttr(Attribute::NoRedZone);', '''    if (GNUForcedAdmission) {
      for (auto &I : instructions(F)) {
        auto *CB = dyn_cast<CallInst>(&I);
        auto *Callee = CB ? CB->getCalledFunction() : nullptr;
        if (!Callee) continue;
        StringRef N = Callee->getName();
        if (N != "__wasm_gnu_frame_commit_sp_v1" &&
            N != "__wasm_gnu_frame_admit_call_v1" &&
            N != "__wasm_gnu_caller_sp_v1" &&
                 N != "__wasm_gnu_frame_enter_v1" &&
                 N != "__wasm_gnu_frame_leave_v1") continue;
        CB->setMetadata("wasm.gnu.compiler.operation.v1",
                        MDNode::get(C, {MDString::get(C, N)}));
      }
    }
    F->addFnAttr(Attribute::NoRedZone);''')
        if old.name == 'WebAssemblyLowerEmscriptenEHSjLj.cpp':
            helper = (R / 'module4-sjlj-operations.cpp').read_text()
            new = change(new, 'static bool canLongjmp(const Value *Callee) {',
                         helper + '\nstatic bool canLongjmp(const Value *Callee, const CallBase *CB = nullptr) {\n'
                         '  if (isGNUCompilerOperation(CB)) return false;')
            new = change(new, 'canLongjmp(CB->getCalledOperand())', 'canLongjmp(CB->getCalledOperand(), CB)')
            new = change(new, 'canLongjmp(Callee)) {', 'canLongjmp(Callee, II)) {')
            new = change(new, 'if (!canLongjmp(Callee))', 'if (!canLongjmp(Callee, CI))', 2)
        dest = out / 'source' / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(new)
        snap = out / 'basis' / rel
        snap.parent.mkdir(parents=True, exist_ok=True)
        snap.write_bytes(old.read_bytes())
        pairs[str(rel)] = {'basis': str(old), 'basisSnapshot': str(snap),
                          'basisSha256': sha(old), 'path': str(dest), 'ownedSha256': sha(dest)}
        if text != new:
            chunks.append(''.join(difflib.unified_diff(text.splitlines(True), new.splitlines(True),
                         fromfile='a/' + str(rel), tofile='b/' + str(rel))))
    patch = out / 'compiler.patch'
    patch.write_text(''.join(chunks))
    # Preserve the reviewed source16 full patch; operation diff is incremental.
    (out / 'basis-compiler.patch').write_bytes((basis / 'compiler.patch').read_bytes())
    for name in ['module4-call-audit.cpp', 'module4-final-ir.cpp', 'jump-abi-v2.h',
                 'frame-abi.h', 'module4-runtime.c', 'jump-delivery-v2.c', 'jump-helpers-v2.c']:
        (out / name).write_bytes((basis / name).read_bytes())
    proof = {'compiled': False, 'reviewRequiredBeforeBuild': True, 'basis': str(basis),
             'patchSha256': sha(patch), 'sourcePairs': pairs,
             'scope': 'compiler operations cannot native-longjmp; scoped personality precedes descriptor',
             'runtimeAcceptance': False, 'storage': budget()}
    (out / 'prepared.json').write_text(json.dumps(proof, indent=2) + '\n')
    print(json.dumps({'prepared': str(out / 'prepared.json'), 'sha256': sha(out / 'prepared.json'),
                      'patchSha256': sha(patch)}))


if __name__ == '__main__':
    main()
