// Appended only to the separately reviewed module4 overlay.
// Runs after coherent WasmEHPrepare and all IR call-creating lowerings.
namespace {
class WebAssemblyGNUFinalAdmission final : public FunctionPass {
public:
  static char ID;
  WebAssemblyGNUFinalAdmission() : FunctionPass(ID) {}
  bool runOnFunction(Function &F) override {
    if (!GNUForcedAdmission || F.isDeclaration()) return false;
    Module &M = *F.getParent();
    auto &C = M.getContext(); auto *P = PointerType::getUnqual(C);
    auto *I32 = Type::getInt32Ty(C);
    auto *RecordTy = ArrayType::get(I32, 16);
    auto Admit = M.getOrInsertFunction("__wasm_gnu_frame_admit_call_v1",
                                      Type::getVoidTy(C), P);
    auto Commit = M.getOrInsertFunction("__wasm_gnu_frame_commit_sp_v1",
                                       Type::getVoidTy(C), I32);
    auto *StackSave = Intrinsic::getOrInsertDeclaration(&M, Intrinsic::stacksave, {P});
    {
      if (F.getFnAttribute("wasm-gnu-frame-records").getValueAsString() != "4" ||
          !F.hasFnAttribute("wasm-gnu-native-forced-unwind"))
        report_fatal_error("GNU final admission found a noncoherent definition");
      AllocaInst *Record = nullptr;
      unsigned Bindings = 0, NewCommits = 0;
      SmallVector<CallBase *, 16> Calls;
      SmallVector<Instruction *, 4> Restores;
      for (auto &I : instructions(F)) {
        if (auto *AI = dyn_cast<AllocaInst>(&I))
          if (AI->getMetadata("wasm.gnu.frame.record.v1")) {
            if (Record) report_fatal_error("GNU final admission found duplicate records");
            Record = AI;
          }
        if (auto *CB = dyn_cast<CallBase>(&I)) {
          Function *Callee = CB->getCalledFunction();
          if (Callee && Callee->getName() == "__wasm_gnu_caller_sp_v1") {
            bool ActualEntryOperand = false;
            for (auto *U : CB->users())
              if (auto *Entry = dyn_cast<CallBase>(U))
                if (Entry->getCalledFunction() &&
                    Entry->getCalledFunction()->getName() == "__wasm_gnu_frame_enter_v1" &&
                    Entry->arg_size() == 4 && Entry->getArgOperand(2) == CB)
                  ActualEntryOperand = true;
            if (!isa<CallInst>(CB) || CB->arg_size() != 0 ||
                !CB->getType()->isIntegerTy(32) ||
                !CB->getMetadata("wasm.gnu.caller.capture.v1") || !ActualEntryOperand)
              report_fatal_error("GNU final admission found an unowned caller-SP marker");
            continue; // Exact compiler operation, consumed by FrameLowering.
          }
          if (Callee && Callee->getName() == "__wasm_gnu_unwind_bind_v1") {
            ++Bindings;
            continue;
          }
          if (Callee && Callee->getName() == "__wasm_gnu_unwind_match_v1")
            report_fatal_error("GNU matching marker survived coherent EH preparation");
          if (Callee && Callee->isIntrinsic()) {
            if (Callee->getIntrinsicID() == Intrinsic::stackrestore &&
                !I.getMetadata("wasm.gnu.sp.commit.v1")) {
              if (!I.getMetadata("wasm.gnu.setjmp.restore.v2"))
                report_fatal_error("GNU final admission found an unowned late stackrestore");
              Restores.push_back(&I);
            }
            continue;
          }
          if (Callee && Callee->getName().starts_with("__wasm_gnu_frame_")) continue;
          // Also check helpers inserted after the first record pass. These are
          // actual recorded calls or loader-admitted audited primitive bridges.
          if (!I.getMetadata("wasm.gnu.call.admitted.v1")) Calls.push_back(CB);
        }
      }
      if (!Record || Bindings != 1)
        report_fatal_error("GNU final admission requires the unique actual binding");
      for (auto &I : instructions(F)) {
        auto *CB = dyn_cast<CallBase>(&I);
        if (!CB || !CB->getCalledFunction() ||
            CB->getCalledFunction()->getName() != "__wasm_gnu_unwind_bind_v1") continue;
        auto *Context = CB->arg_size() == 2 ? dyn_cast<AllocaInst>(CB->getArgOperand(1)) : nullptr;
        if (!Context || CB->getArgOperand(0) != Record || !Context->isStaticAlloca() ||
            Context->getAlign() < Align(4) ||
            !Context->getMetadata("wasm.gnu.unwind.context.v1") ||
            M.getDataLayout().getTypeAllocSize(Context->getAllocatedType()) != 40)
          report_fatal_error("GNU binding is not the actual frame and caller-owned context40");
      }
      auto Colors = colorEHFunclets(F);
      auto Bundles = [&](Instruction *At) {
        SmallVector<OperandBundleDef, 1> Result;
        auto It = Colors.find(At->getParent());
        if (It != Colors.end()) {
          if (It->second.size() != 1) report_fatal_error("GNU final admission ambiguous funclet");
          auto *Pad = &*It->second.front()->getFirstNonPHIIt();
          if (isa<FuncletPadInst>(Pad)) Result.emplace_back("funclet", Pad);
        }
        return Result;
      };
      for (auto *CB : Calls) {
        IRBuilder<> B(CB);
        B.CreateCall(Admit, {CB->getCalledOperand()}, Bundles(CB));
        CB->setMetadata("wasm.gnu.call.admitted.v1", MDNode::get(C, {}));
        CB->setMemoryEffects(MemoryEffects::unknown());
        CB->removeFnAttr(Attribute::NoSync); CB->removeFnAttr(Attribute::NoFree);
        CB->removeFnAttr(Attribute::WillReturn);
      }
      for (auto *I : Restores) {
        if (!I->getNextNode()) report_fatal_error("GNU late restore at terminator");
        IRBuilder<> B(I->getNextNode());
        auto *SP = B.CreatePtrToInt(B.CreateCall(StackSave, {}, Bundles(I)), I32);
        B.CreateStore(SP, B.CreateConstGEP2_32(RecordTy, Record, 0, 7));
        B.CreateCall(Commit, {SP}, Bundles(I));
        I->setMetadata("wasm.gnu.sp.commit.v1", MDNode::get(C, {}));
        ++NewCommits;
      }
      unsigned Previous = 0;
      if (F.getFnAttribute("wasm-gnu-frame-dynamic-commits").getValueAsString()
             .getAsInteger(10, Previous)) report_fatal_error("GNU missing original commit count");
      F.addFnAttr("wasm-gnu-frame-dynamic-commits", utostr(Previous + NewCommits));
    }
    if (verifyFunction(F, &errs())) report_fatal_error("GNU final admission invalid IR");
    return true;
  }
};
}
char WebAssemblyGNUFinalAdmission::ID = 0;
FunctionPass *llvm::createWebAssemblyGNUFinalAdmission() {
  return new WebAssemblyGNUFinalAdmission();
}
