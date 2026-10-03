#!/usr/bin/env python3
"""Separate uncompiled module4/jump64 source review packet, never edits records7."""
import difflib
import json
from pathlib import Path
from evidence import T, S, R, sha, budget


def replace(text, old, new):
    assert text.count(old) == 1, old
    return text.replace(old, new)


def main():
    out = T / 'module4-proposal-17'
    assert not out.exists()
    budget(True)
    out.mkdir()
    changes, chunks = {}, []
    def edit(rel, basis, transform):
        old = basis.read_text()
        new = transform(old)
        assert new != old
        dest = out / 'source' / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(new)
        snap = out / 'basis' / rel
        snap.parent.mkdir(parents=True, exist_ok=True)
        snap.write_text(old)
        changes[rel] = {'basis': str(basis), 'basisSha256': sha(basis),
                        'basisSnapshot': str(snap), 'path': str(dest), 'ownedSha256': sha(dest)}
        chunks.append(''.join(difflib.unified_diff(old.splitlines(True), new.splitlines(True),
                          fromfile='a/' + rel, tofile='b/' + rel)))
    base = T / 'records-patch-7/source'
    rel = 'llvm/lib/Target/WebAssembly/WebAssemblyGNUFrames.cpp'
    def frames(t):
        t = replace(t, 'namespace {\nclass WebAssemblyGNUFrames', '''static cl::opt<bool> GNUForcedAdmission(
    "wasm-gnu-frame-forced-admission", cl::init(false),
    cl::desc("Separate coherent GNU module4 records/context/jump64 ABI"));
namespace {
class WebAssemblyGNUFrames''')
        t = replace(t, '  if (!GNUFrameRecords)\n    return false;', '''  if (!GNUFrameRecords) {
    if (GNUForcedAdmission) report_fatal_error("GNU module4 requires record materialization");
    return false;
  }
  const unsigned Admission = GNUForcedAdmission ? 4 : 1;
  if (GNUForcedAdmission) {
    if (M.getModuleFlag("wasm.gnu.jump.backend.bytes") ||
        M.getModuleFlag("wasm.gnu.jump.delivery.abi"))
      report_fatal_error("GNU module4 rejects preexisting source jump ABI flags");
    M.addModuleFlag(Module::Error, "wasm.gnu.jump.backend.bytes", 64);
    M.addModuleFlag(Module::Error, "wasm.gnu.jump.delivery.abi", 2);
  }''')
        t = replace(t, '      if (I.isEHPad())', '      if (I.isEHPad() && !GNUForcedAdmission)')
        t = replace(t, '    // These are explicitly RECORDS_ONLY descriptors:',
            '    Capture->setMetadata("wasm.gnu.caller.capture.v1", MDNode::get(C, {}));\n'
            '    // These are explicitly RECORDS_ONLY descriptors:')
        t = replace(t, '    if (F.getName().starts_with("__wasm_gnu_frame_"))',
            '    if (F.getName().starts_with("__wasm_gnu_frame_") ||\n'
            '        F.getName() == "__wasm_gnu_unwind_bind_v1" ||\n'
            '        F.getName() == "__wasm_gnu_unwind_match_v1" ||\n'
            '        F.getName() == "__wasm_gnu_unwind_register_v1")')
        t = replace(t, '      B.CreateCall(Commit, {SP}, Bundles(I));',
            '      B.CreateCall(Commit, {SP}, Bundles(I));\n'
            '      I->setMetadata("wasm.gnu.sp.commit.v1", MDNode::get(C, {}));')
        t = replace(t, '      B.CreateCall(AdmitCall, {CB->getCalledOperand()}, Bundles(CB));',
            '      B.CreateCall(AdmitCall, {CB->getCalledOperand()}, Bundles(CB));\n'
            '      CB->setMetadata("wasm.gnu.call.admitted.v1", MDNode::get(C, {}));')
        # Original source intrinsics remain rejected: SjLj creates its trusted
        # operations later; module4 never admits a source-authored wasm intrinsic.
        t = replace(t, '    Constant *Fields[] = {ConstantInt::get(I32, 1)', '''    Constant *Personality = ConstantPointerNull::get(P);
    if (GNUForcedAdmission && F->hasPersonalityFn()) {
      auto *Original = dyn_cast<Function>(F->getPersonalityFn()->stripPointerCasts());
      if (!Original || Original->getName() != "__gxx_wasm_personality_v0")
        report_fatal_error("GNU module4 does not admit an unknown native personality");
      // The frontend marker is not a callable implementation. Per-pad actual
      // LSDA comes from llvm.wasm.lsda in the coherent WasmEHPrepare context.
      auto *PT = FunctionType::get(I32, {I32, I32, Type::getInt64Ty(C), P, P}, false);
      Personality = cast<Constant>(M.getOrInsertFunction("__gxx_personality_wasm0", PT).getCallee());
    }
    Constant *Fields[] = {ConstantInt::get(I32, 1)''')
        t = replace(t, '      ConstantInt::get(I32, 1), Manifest, F,\n      ConstantPointerNull::get(P), ConstantPointerNull::get(P), ConstantInt::get(I32, 0)};', '''      ConstantInt::get(I32, Admission), Manifest, F,
      Personality, ConstantPointerNull::get(P), ConstantInt::get(I32, 0)};''')
        t = replace(t, '    F->addFnAttr("wasm-gnu-frame-records", "1");',
                       '    F->addFnAttr("wasm-gnu-frame-records", utostr(Admission));')
        t = replace(t, '      ConstantInt::get(I32, 1), ConstantInt::get(I32, 1), ConstantInt::get(I32, 1),\n      Table,',
                       '      ConstantInt::get(I32, 1), ConstantInt::get(I32, Admission), ConstantInt::get(I32, 1),\n      Table,')
        t = replace(t, '    unsigned SP = WebAssembly::SP32;', '''    const bool Forced = MF.getFunction().getFnAttribute("wasm-gnu-frame-records")
                            .getValueAsString() == "4";
    if (Forced && !MF.getFunction().hasFnAttribute("wasm-gnu-native-forced-unwind"))
      report_fatal_error("GNU module4 requires coherent caller-owned context/guard preparation");
    unsigned SP = WebAssembly::SP32;''')
        t = replace(t, '    for (auto &BB : MF) {\n      bool Dirty = false;', '''    SmallVector<MachineInstr *, 8> PadRestores;
    if (Forced) {
      // LateEHPrepare runs after PEI and emits the exact fixed-SP global write
      // immediately after each original catch. Replace that operation only;
      // reconstruct physical SP from the recorded current activeSP before any
      // context/personality/user helper allocation. Never overwrite live VLA.
      for (auto &BB : MF) {
        if (!BB.isEHPad()) continue;
        auto It = BB.begin();
        while (It != BB.end() && It->isEHLabel()) ++It;
        if (It == BB.end() || !WebAssembly::isCatch(It->getOpcode()))
          report_fatal_error("GNU original EH pad lacks a native catch");
        ++It;
        if (It == BB.end() || It->getOpcode() != WebAssembly::GLOBAL_SET_I32 ||
            !It->getOperand(0).isSymbol() ||
            StringRef(It->getOperand(0).getSymbolName()) != "__stack_pointer" ||
            !It->getOperand(1).isReg() || CopyRoot(It->getOperand(1).getReg()) != SP)
          report_fatal_error("GNU original pad lacks the exact LateEHPrepare SP write");
        Register Active = MRI.createVirtualRegister(&WebAssembly::I32RegClass);
        BuildMI(BB, It, It->getDebugLoc(), TII->get(WebAssembly::LOAD_I32_A32), Active)
            .addImm(2).addImm(28).addReg(RecordArg);
        BuildMI(BB, It, It->getDebugLoc(), TII->get(WebAssembly::COPY_I32), SP).addReg(Active);
        It->getOperand(1).setReg(Active);
        PadRestores.push_back(&*It);
      }
    }
    for (auto &BB : MF) {
      bool Dirty = false;''')
        t = replace(t, '        if (!BeforeEnter && MI.definesRegister(SP, TRI))\n          Dirty = true;', '''        if (!BeforeEnter && MI.definesRegister(SP, TRI))
          Dirty = true;
        if (llvm::is_contained(PadRestores, &MI)) Dirty = false;''')
        t = replace(t, '    return !Commits.empty();', '    return !Commits.empty() || !PadRestores.empty();')
        t = replace(t, '#include "WebAssemblySubtarget.h"',
            '#include "WebAssemblySubtarget.h"\n#include "WebAssemblyUtilities.h"\n#include "llvm/ADT/STLExtras.h"')
        return t + '\n' + (R / 'module4-final-ir.cpp').read_text() + '\n' + (R / 'module4-call-audit.cpp').read_text()
    edit(rel, base / rel, frames)
    rel = 'llvm/lib/Target/WebAssembly/WebAssembly.h'
    edit(rel, base / rel, lambda t: replace(t,
        'ModulePass *createWebAssemblyGNUFrames();',
        'ModulePass *createWebAssemblyGNUFrames();\nFunctionPass *createWebAssemblyGNUFinalAdmission();\nFunctionPass *createWebAssemblyGNUCallAudit();'))
    rel = 'llvm/lib/Target/WebAssembly/WebAssemblyTargetMachine.cpp'
    def pipeline(t):
        t = replace(t, '#include "WebAssembly.h"',
            '#include "WebAssembly.h"\n#include "llvm/Analysis/AliasAnalysis.h"')
        t = replace(t, '  TargetPassConfig::addISelPrepare();',
            '  addPass(createWebAssemblyGNUFinalAdmission());\n'
            '  TargetPassConfig::addISelPrepare();\n'
            '  // Rebuild invalidated IR AA inside the function pass manager before ISel.\n'
            '  addPass(new AAResultsWrapperPass());')
        t = replace(t, '  addPass(createWebAssemblyGNUFrameAudit());',
            '  addPass(createWebAssemblyGNUFrameAudit());\n  addPass(createWebAssemblyGNUCallAudit());')
        return replace(t, '  addPass(createWebAssemblyCFGStackify());',
            '  addPass(createWebAssemblyCFGStackify());\n  addPass(createWebAssemblyGNUCallAudit());')
    edit(rel, base / rel, pipeline)
    rel = 'llvm/lib/Target/WebAssembly/WebAssemblyLowerEmscriptenEHSjLj.cpp'
    def sjlj(t):
        t = replace(t, '#include "llvm/IR/IRBuilder.h"',
                       '#include "llvm/IR/IRBuilder.h"\n#include "llvm/IR/InstIterator.h"\n#include "llvm/IR/Intrinsics.h"')
        t = replace(t, 'static void nullifySetjmp(Function *F) {', r'''// Only compiler-generated admission may reference a direct setjmp as data.
// Snapshot real calls before deleting admissions: users() iteration otherwise
// also mistakes the admission operation for a source setjmp invocation.
static bool isGNUSetjmpAdmissionUser(CallBase *CB, Function *SetjmpF) {
  Function *F = CB->getFunction();
  auto *Next = dyn_cast_or_null<CallBase>(CB->getNextNode());
  return F->getFnAttribute("wasm-gnu-frame-records").getValueAsString() == "4" &&
      isa<CallInst>(CB) && CB->getCalledFunction() &&
      CB->getCalledFunction()->getName() == "__wasm_gnu_frame_admit_call_v1" &&
      CB->arg_size() == 1 && CB->getArgOperand(0) == SetjmpF && Next &&
      Next->getCalledOperand() == SetjmpF &&
      Next->getMetadata("wasm.gnu.call.admitted.v1");
}

static void nullifySetjmp(Function *F) {''')
        t = replace(t, '        auto *UserF = CB->getFunction();', r'''        if (CB->getFunction()->getFnAttribute("wasm-gnu-frame-records").getValueAsString() == "4" &&
            CB->getCalledOperand() != SetjmpF) {
          if (isGNUSetjmpAdmissionUser(CB, SetjmpF)) continue;
          report_fatal_error("GNU setjmp admission found an unauthenticated address use");
        }
        auto *UserF = CB->getFunction();''')
        t = replace(t, '        if (containsLongjmpableCalls(UserF))', r'''        if (UserF->getFnAttribute("wasm-gnu-frame-records").getValueAsString() == "4" ||
            containsLongjmpableCalls(UserF))''')
        t = replace(t, '  for (auto *U : make_early_inc_range(SetjmpF->users())) {\n    auto *CB = cast<CallBase>(U);', r'''  SmallVector<CallBase *, 4> ActualSetjmps;
  for (auto *U : SetjmpF->users()) {
    auto *CB = dyn_cast<CallBase>(U);
    if (!CB) report_fatal_error("Indirect use of setjmp is not supported");
    if (F.getFnAttribute("wasm-gnu-frame-records").getValueAsString() != "4" ||
        CB->getCalledOperand() == SetjmpF) ActualSetjmps.push_back(CB);
    else if (!isGNUSetjmpAdmissionUser(CB, SetjmpF))
      report_fatal_error("GNU setjmp lowering found an unauthenticated address use");
  }
  for (auto *CB : ActualSetjmps) {''')
        t = replace(t, '      LongjmpArgsTy = StructType::get(Int8PtrTy, // env\n                                      Int32Ty    // val\n      );', '''      LongjmpArgsTy = M.getModuleFlag("wasm.gnu.jump.backend.bytes")
          ? StructType::get(Int8PtrTy, Int32Ty, Int32Ty)
          : StructType::get(Int8PtrTy, Int32Ty);''')
        t = replace(t, '  LLVMContext &C = M.getContext();\n  IRBuilder<> IRB(C);\n\n  Function *SetjmpF', '''  LLVMContext &C = M.getContext();
  IRBuilder<> IRB(C);
  if (M.getModuleFlag("wasm.gnu.jump.delivery.abi") &&
      !M.getModuleFlag("wasm.gnu.jump.backend.bytes"))
    report_fatal_error("GNU native delivery ABI requires coherent backend64");
  if (M.getModuleFlag("wasm.gnu.jump.backend.bytes")) {
    for (auto Requirement : {std::pair<StringRef, unsigned>("wasm.gnu.jump.backend.bytes", 64),
                            std::pair<StringRef, unsigned>("wasm.gnu.jump.delivery.abi", 2)}) {
      unsigned Found = 0;
      for (auto *Flag : M.getModuleFlagsMetadata()->operands()) {
        auto *Name = dyn_cast<MDString>(Flag->getOperand(1));
        if (!Name || Name->getString() != Requirement.first) continue;
        auto *Behavior = mdconst::dyn_extract<ConstantInt>(Flag->getOperand(0));
        auto *Bytes = mdconst::dyn_extract<ConstantInt>(Flag->getOperand(2));
        if (++Found != 1 || !Behavior || !Bytes || Behavior->getZExtValue() != Module::Error ||
            Bytes->getZExtValue() != Requirement.second)
          report_fatal_error("GNU native tag1 parsing requires exact Error backend64/delivery2 ABI");
      }
      if (Found != 1) report_fatal_error("GNU native tag1 ABI missing");
    }
  }

  Function *SetjmpF''')
        t = replace(t, '    IRB.CreateCall(WasmSetjmpF, Args);', '''    auto *Site = IRB.CreateCall(WasmSetjmpF, Args);
    if (F.getFnAttribute("wasm-gnu-frame-records").getValueAsString() == "4") {
      // Original source setjmp disappears here. Retire only its compiler-owned
      // adjacent admission, then the final pass admits the real generated calls.
      auto *OldAdmit = dyn_cast_or_null<CallInst>(Site->getPrevNode());
      if (!CI->getMetadata("wasm.gnu.call.admitted.v1") || !OldAdmit ||
          !OldAdmit->getCalledFunction() ||
          OldAdmit->getCalledFunction()->getName() != "__wasm_gnu_frame_admit_call_v1" ||
          OldAdmit->arg_size() != 1 || OldAdmit->getArgOperand(0) != CI->getCalledOperand())
        report_fatal_error("GNU setjmp lowering lacks the actual source admission");
      OldAdmit->eraseFromParent();
      Value *Frame = nullptr;
      for (auto &I : instructions(F)) if (auto *AI = dyn_cast<AllocaInst>(&I))
        if (AI->getMetadata("wasm.gnu.frame.record.v1")) {
          if (Frame) report_fatal_error("ambiguous GNU setjmp actual activation");
          Frame = AI;
        }
      if (!Frame) report_fatal_error("GNU setjmp missing actual activation");
      auto *P = IRB.getPtrTy(); auto *I32 = IRB.getInt32Ty();
      auto Register = M.getOrInsertFunction("__wasm_gnu_unwind_register_v1",
          I32, P, P, I32, P, P, I32);
      cast<Function>(Register.getCallee())->addFnAttr(Attribute::NoUnwind);
      Value *Jump = IRB.CreateConstGEP1_32(IRB.getInt8Ty(), Args[0], 28,
                                       "gnu.environment.registration");
      auto *SS = Intrinsic::getOrInsertDeclaration(&M, Intrinsic::stacksave, {P});
      Value *SP = IRB.CreatePtrToInt(IRB.CreateCall(SS), I32);
      auto *Registration = IRB.CreateCall(Register,
          {Frame, Args[0], Args[1], Args[2], Jump, SP}, "gnu.register.version");
      Site->setMetadata("wasm.gnu.setjmp.site.v2", MDNode::get(C, {}));
      Registration->setMetadata("wasm.gnu.setjmp.register.v2", MDNode::get(C, {}));
      // Zero is an explicit provider rejection, never a valid registration.
      auto *Reject = SplitBlockAndInsertIfThen(IRB.CreateICmpEQ(Registration,
          IRB.getInt32(0)), BB->getTerminator(), false);
      IRBuilder<> Fail(Reject);
      Fail.CreateCall(M.getOrInsertFunction("abort", IRB.getVoidTy()));
      Fail.CreateUnreachable();
      Reject->eraseFromParent();
    }''')
        t = replace(t, '  Instruction *LongjmpArgs =\n      IRB.CreateCall(CatchF, {IRB.getInt32(WebAssembly::C_LONGJMP)}, "thrown");', '''  Instruction *RawTag1 =
      IRB.CreateCall(CatchF, {IRB.getInt32(WebAssembly::C_LONGJMP)}, "thrown");
  Instruction *LongjmpArgs = RawTag1;
  Value *DeliveryHandle = nullptr;
  if (F.getFnAttribute("wasm-gnu-frame-records").getValueAsString() == "4") {
    auto Resolve = M.getOrInsertFunction("__wasm_gnu_jump_delivery_resolve_v2",
                                        IRB.getPtrTy(), IRB.getInt32Ty());
    cast<Function>(Resolve.getCallee())->addFnAttr(Attribute::NoUnwind);
    DeliveryHandle = IRB.CreatePtrToInt(RawTag1, IRB.getInt32Ty());
    LongjmpArgs = IRB.CreateCall(Resolve, {DeliveryHandle},
        OperandBundleDef("funclet", CatchPad), "gnu.authenticated.delivery");
    LongjmpArgs->setMetadata("wasm.gnu.tag1.resolve.v2", MDNode::get(C, {}));
    auto *Valid = BasicBlock::Create(C, "gnu.tag1.valid", &F);
    auto *Invalid = BasicBlock::Create(C, "gnu.tag1.invalid", &F);
    IRB.CreateCondBr(IRB.CreateICmpNE(LongjmpArgs,
        ConstantPointerNull::get(IRB.getPtrTy())), Valid, Invalid);
    IRB.SetInsertPoint(Invalid);
    IRB.CreateCall(M.getOrInsertFunction("abort", IRB.getVoidTy()), {},
                  OperandBundleDef("funclet", CatchPad));
    IRB.CreateUnreachable();
    // No env/value/version GEP or load precedes owned handle authentication.
    IRB.SetInsertPoint(Valid);
  }''')
        t = replace(t, '  CallInst *WasmLongjmpCI = IRB.CreateCall(\n      WasmLongjmpF, {Env, Val}, OperandBundleDef("funclet", CatchPad));', '\n'.join([
            '  CallInst *WasmLongjmpCI = nullptr;',
            '  if (F.getFnAttribute("wasm-gnu-frame-records").getValueAsString() == "4") {',
            '    auto *Rethrow = Intrinsic::getOrInsertDeclaration(&M, Intrinsic::wasm_rethrow);',
            '    IRB.CreateCall(Rethrow, {}, OperandBundleDef("funclet", CatchPad));',
            '  } else {',
            '    WasmLongjmpCI = IRB.CreateCall(WasmLongjmpF, {Env, Val},',
            '        OperandBundleDef("funclet", CatchPad));',
            '  }']))
        t = replace(t, '  IRB.SetInsertPoint(EndBB);\n  // Jump to setjmp.dispatch block', '''  IRB.SetInsertPoint(EndBB);
  if (F.getFnAttribute("wasm-gnu-frame-records").getValueAsString() == "4") {
    Value *Frame = nullptr;
    for (auto &I : instructions(F)) if (auto *AI = dyn_cast<AllocaInst>(&I))
      if (AI->getMetadata("wasm.gnu.frame.record.v1")) {
        if (Frame) report_fatal_error("ambiguous GNU matching actual activation");
        Frame = AI;
      }
    if (!Frame) report_fatal_error("GNU match missing actual activation");
    auto *VersionAddress = IRB.CreateConstGEP2_32(LongjmpArgsTy, LongjmpArgs, 0, 2);
    auto *Version = IRB.CreateLoad(IRB.getInt32Ty(), VersionAddress,
                                 "gnu.thrown.registration.version");
    auto *Jump = IRB.CreateConstGEP1_32(IRB.getInt8Ty(), Env, 28);
    auto *P = IRB.getPtrTy(); auto *I32 = IRB.getInt32Ty();
    auto Match = M.getOrInsertFunction("__wasm_gnu_unwind_match_v1",
        IRB.getVoidTy(), P, P, I32, P, P, I32, I32);
    cast<Function>(Match.getCallee())->addFnAttr(Attribute::NoUnwind);
    auto *Marker = IRB.CreateCall(Match, {Frame, Env, Label,
        FunctionInvocationId, Jump, Version, DeliveryHandle}, OperandBundleDef("funclet", CatchPad));
    Marker->setMetadata("wasm.gnu.setjmp.match.v2", MDNode::get(C, {}));
    cast<Instruction>(Label)->setMetadata("wasm.gnu.setjmp.test.v2", MDNode::get(C, {}));
  }
  // Jump to setjmp.dispatch block''')
        t = replace(t, '      if (CI == WasmLongjmpCI)\n        continue;',
            '      if (CI == WasmLongjmpCI)\n        continue;\n'
            '      if (CI->getMetadata("wasm.gnu.setjmp.register.v2") ||\n'
            '          CI->getMetadata("wasm.gnu.setjmp.match.v2") ||\n'
            '          CI->getMetadata("wasm.gnu.tag1.resolve.v2")) continue;')
        return t
    edit(rel, S / rel, sjlj)
    patch = out / 'compiler.patch'
    patch.write_text(''.join(chunks))
    for name in ['module4-call-audit.cpp', 'module4-final-ir.cpp', 'jump-abi-v2.h', 'frame-abi.h', 'module4-runtime.c', 'jump-delivery-v2.c', 'jump-helpers-v2.c']:
        (out / name).write_bytes((R / name).read_bytes())
    proof = {'compiled': False, 'reviewRequiredBeforeBuild': True,
             'patchSha256': sha(patch), 'sourcePairs': changes,
             'backendBytes': 64, 'publicJmpBufExpectedBytes': 196,
             'tagSignature': 'one i32 generation-bearing delivery handle; authenticated immutable env/value/capturedVersion',
             'notBuildReady': ['coherent peer CFG-added call admission and handle consumers',
               'coherent genuine GNU jump64 headers/helpers and all-client rebuild',
               'actual emitted registration failure CFG verification'],
             'storage': budget()}
    (out / 'prepared.json').write_text(json.dumps(proof, indent=2) + '\n')
    print(json.dumps({'prepared': str(out / 'prepared.json'), 'sha256': sha(out / 'prepared.json'),
                      'patchSha256': sha(patch), 'compiled': False}))


if __name__ == '__main__':
    main()
