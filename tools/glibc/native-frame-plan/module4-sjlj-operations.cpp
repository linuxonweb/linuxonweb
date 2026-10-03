// Consumed only by the separately reviewed module4 producer overlay.
// Metadata is emitted after the source reserved-operation rejection. It binds
// the exact compiler-owned record, not a namespace or a nounwind assertion.
static bool isGNUCompilerOperation(const CallBase *CB) {
  if (!CB) return false;
  auto *Tag = CB->getMetadata("wasm.gnu.compiler.operation.v1");
  if (!Tag) return false;
  auto Reject = []() -> bool {
    report_fatal_error("GNU SjLj found an unauthenticated compiler operation");
  };
  auto *F = CB->getFunction();
  auto *Callee = CB->getCalledFunction();
  if (!isa<CallInst>(CB) || !Callee || Tag->getNumOperands() != 1 ||
      F->getFnAttribute("wasm-gnu-frame-records").getValueAsString() != "4")
    return Reject();
  auto *Name = dyn_cast<MDString>(Tag->getOperand(0));
  const AllocaInst *Record = nullptr;
  for (const auto &BB : *F) for (const auto &I : BB)
    if (const auto *AI = dyn_cast<AllocaInst>(&I))
      if (AI->getMetadata("wasm.gnu.frame.record.v1")) {
        if (Record) return Reject();
        Record = AI;
      }
  if (!Name || Name->getString() != Callee->getName() || !Record ||
      Record->getFunction() != F || !Record->isStaticAlloca() ||
      Record->getAlign() != Align(16) ||
      !Record->getMetadata("wasm.gnu.frame.record.v1") ||
      F->getParent()->getDataLayout().getTypeAllocSize(Record->getAllocatedType()) != 64)
    return Reject();
  StringRef N = Callee->getName();
  if (N == "__wasm_gnu_caller_sp_v1") {
    if (CB->arg_size() || !CB->getType()->isIntegerTy(32) ||
        !CB->getMetadata("wasm.gnu.caller.capture.v1")) return Reject();
    unsigned Entries = 0;
    for (const User *U : CB->users()) {
      auto *Entry = dyn_cast<CallBase>(U);
      if (Entry && Entry->getCalledFunction() &&
          Entry->getCalledFunction()->getName() == "__wasm_gnu_cancel_poll_v1") {
        auto *PollTag = Entry->getMetadata("wasm.gnu.cancel.poll.v1");
        auto *Reason = Entry->arg_size() == 2 ?
            dyn_cast<ConstantInt>(Entry->getArgOperand(1)) : nullptr;
        if (!PollTag || PollTag->getNumOperands() || !Entry->getType()->isVoidTy() ||
            Entry->arg_size() != 2 || Entry->getArgOperand(0) != CB ||
            Entry->getFunction() != F || !Reason ||
            !Reason->getType()->isIntegerTy(32) || Reason->getZExtValue() > 3)
          return Reject();
        continue; // Capture user only: the real poll remains longjmpable.
      }
      if (!Entry || !Entry->getCalledFunction() ||
          Entry->getCalledFunction()->getName() != "__wasm_gnu_frame_enter_v1" ||
          Entry->arg_size() != 4 || Entry->getArgOperand(0) != Record ||
          Entry->getArgOperand(2) != CB) return Reject();
      ++Entries;
    }
    if (Entries != 1) return Reject();
    return true;
  }
  if (!CB->getType()->isVoidTy()) return Reject();
  if (N == "__wasm_gnu_frame_enter_v1") {
    if (CB->arg_size() != 4 || CB->getArgOperand(0) != Record ||
        !CB->getArgOperand(1)->getType()->isPointerTy() ||
        !CB->getArgOperand(2)->getType()->isIntegerTy(32) ||
        !CB->getArgOperand(3)->getType()->isIntegerTy(32)) return Reject();
  } else if (N == "__wasm_gnu_frame_leave_v1") {
    if (CB->arg_size() != 1 || CB->getArgOperand(0) != Record)
      return Reject();
  } else if (N == "__wasm_gnu_frame_commit_sp_v1") {
    if (CB->arg_size() != 1 || !CB->getArgOperand(0)->getType()->isIntegerTy(32))
      return Reject();
  } else if (N == "__wasm_gnu_frame_admit_call_v1") {
    if (CB->arg_size() != 1 || !CB->getArgOperand(0)->getType()->isPointerTy())
      return Reject();
  } else return Reject();
  return true;
}
