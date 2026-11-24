#!/usr/bin/env python3
"""Owned source-only mixed-provider overlay, pending exact root review/build."""
import difflib
import json
from evidence import T, R, sha, budget


def replace(s, old, new):
    assert s.count(old) == 1, (old, s.count(old))
    return s.replace(old, new)


def main():
    budget(True)
    base = T / 'module4-proposal-18'
    out = T / 'provider-proposal-3'
    assert not out.exists()
    out.mkdir()
    rel = 'llvm/lib/Target/WebAssembly/WebAssemblyGNUFrames.cpp'
    basis = base / 'source' / rel
    old = basis.read_text()
    new = replace(old, 'namespace {\nclass WebAssemblyGNUFrames',
                  (R / 'provider-admission.cpp').read_text() + '\nnamespace {\nclass WebAssemblyGNUFrames')
    new = replace(new, '#include "llvm/Support/MD5.h"', '''#include "llvm/Support/MD5.h"
#include "llvm/ADT/DenseMap.h"
#include "llvm/Support/JSON.h"
#include "llvm/Support/MemoryBuffer.h"
#include "llvm/Support/FormatVariadic.h"
#include "llvm/Support/SHA256.h"
#include <optional>''')
    new = replace(new, '  // Reserved operations must not come from the source or a provider archive.',
                  '  prepareGNUProviders(M);\n  // Reserved operations must not come from the source or a provider archive.')
    new = replace(new, '        F.getName() == "__wasm_gnu_unwind_register_v1")', '''        F.getName() == "__wasm_gnu_unwind_register_v1") &&
        (GNUProviderManifest.empty() ||
         (!F.isDeclaration() && !gnuPrimitive(F))))''')
    # Group the existing reserved-name condition before applying the seal.
    new = replace(new, '    if (F.getName().starts_with("__wasm_gnu_frame_") ||',
                  '    if ((F.getName().starts_with("__wasm_gnu_frame_") ||')
    new = replace(new, 'else if (F.getName() == "__wasm_gnu_cancel_poll_v1" && !F.isDeclaration())',
                  'else if (F.getName() == "__wasm_gnu_cancel_poll_v1" && !F.isDeclaration() && !gnuPrimitive(F))')
    new = replace(new, '  Manifest->setAlignment(Align(4));', '''  Manifest->setAlignment(Align(4));
  if (!GNUProviderManifest.empty()) {
    auto *RootTy = FunctionType::get(P, {}, false);
    auto *Root = M.getFunction("__wasm_boundary_native_root_v3");
    if (Root && (!Root->isDeclaration() || Root->getFunctionType() != RootTy))
      report_fatal_error("GNU source supplies an actual-root getter body or wrong ABI");
    if (!Root) Root = Function::Create(RootTy, GlobalValue::ExternalLinkage,
                                      "__wasm_boundary_native_root_v3", M);
    GNUProviderRoot = Root;
    auto *Entry = BasicBlock::Create(C, "entry", Root);
    IRBuilder<> B(Entry); B.CreateRet(Manifest);
    Root->addFnAttr(Attribute::NoUnwind);
    Functions.push_back(Root);
  }''')
    new = replace(new, '  for (Function *F : Functions) {', '''  for (Function *F : Functions) {
    if (gnuPrimitive(*F)) {
      prepareGNUPrimitive(*F);
      Constant *Fields[] = {ConstantInt::get(I32, 1), ConstantInt::get(I32, 32),
        ConstantInt::get(I32, 2), Manifest, F, ConstantPointerNull::get(P),
        ConstantPointerNull::get(P), ConstantInt::get(I32, 0)};
      auto *D = new GlobalVariable(M, DescTy, true, GlobalValue::PrivateLinkage,
          ConstantStruct::get(DescTy, Fields), "wasm.gnu.primitive.descriptor");
      D->setAlignment(Align(4));
      D->setSection(".rodata.wasm.gnu.frame.records.v1");
      Descriptors.push_back(D);
      continue;
    }''')
    new = replace(new, '                Callee->getName().starts_with("llvm.wasm."))',
                  '                (Callee->getName().starts_with("llvm.wasm.") &&\n'
                  '                 !gnuProviderIntrinsic(*F, Callee->getName())))')
    new = replace(new, '    if (!MF.getFunction().hasFnAttribute("wasm-gnu-frame-records")) {',
                  '    if (auditGNUPrimitive(MF)) return false;\n'
                  '    if (!MF.getFunction().hasFnAttribute("wasm-gnu-frame-records")) {')
    new = replace(new, '    if (!GNUForcedAdmission || F.isDeclaration()) return false;',
                  '    if (!GNUForcedAdmission || F.isDeclaration() ||\n'
                  '        F.getFnAttribute("wasm-gnu-provider-sealed").getValueAsString() == "2") return false;')
    new = replace(new, '    if (!GNUForcedAdmission) return false;',
                  '    if (!GNUForcedAdmission) return false;\n'
                  '    if (auditGNUPrimitive(MF)) return false;')
    dest = out / 'source' / rel
    dest.parent.mkdir(parents=True)
    dest.write_text(new)
    snap = out / 'basis' / rel
    snap.parent.mkdir(parents=True)
    snap.write_bytes(basis.read_bytes())
    header_rel = 'llvm/lib/Target/WebAssembly/WebAssembly.h'
    header_basis = base / 'source' / header_rel
    header_old = header_basis.read_text()
    header_new = replace(header_old, 'class FunctionPass;',
        'class FunctionPass;\nclass Function;\nbool isWebAssemblyGNUPrimitiveAuthenticated(const Function &F);')
    header_dest = out / 'source' / header_rel
    header_dest.write_text(header_new)
    header_snap = out / 'basis' / header_rel
    header_snap.write_bytes(header_basis.read_bytes())
    patch = out / 'compiler.patch' 
    patch.write_text(''.join(difflib.unified_diff(old.splitlines(True), new.splitlines(True),
                     fromfile='a/' + rel, tofile='b/' + rel)) +
        ''.join(difflib.unified_diff(header_old.splitlines(True), header_new.splitlines(True),
                     fromfile='a/'+header_rel, tofile='b/'+header_rel)))
    proof = {'compiled': False, 'runtimeAcceptance': False, 'basis': str(base),
             'patchSha256': sha(patch), 'sourcePairs': {rel: {
                 'basis': str(basis), 'basisSnapshot': str(snap), 'basisSha256': sha(basis),
                 'path': str(dest), 'ownedSha256': sha(dest)}, header_rel: {
                 'basis': str(header_basis), 'basisSnapshot': str(header_snap),
                 'basisSha256': sha(header_basis), 'path': str(header_dest),
                 'ownedSha256': sha(header_dest)}},
             'schema': 'external module/body SHA256/type pins; 0 declaration, 2 primitive, 4 recorded',
             'rootGetter': '__wasm_boundary_native_root_v3 returns actual immutable compiler manifest',
             'requiredBeforeRuntime': [
                 'review exact source patch and compiler pipeline snapshot/manifest tool',
                 'peer WasmEHPrepare/CFGStackify recognize only compiler-authenticated primitive2',
                 'sealed-call transitive machine closure and source/include/body audit pins',
                 'Enter/Leave/Admit failure policy must not recurse or omit allocating abort frames',
                 'real genuine TP/epoch admission before any descriptor4 frame'],
             'storage': budget()}
    (out / 'prepared.json').write_text(json.dumps(proof, indent=2) + '\n')
    print(json.dumps({'prepared': str(out / 'prepared.json'),
                      'sha256': sha(out / 'prepared.json'), 'patchSha256': sha(patch)}))


if __name__ == '__main__':
    main()
