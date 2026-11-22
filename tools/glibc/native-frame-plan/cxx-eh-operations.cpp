// Actual WebAssembly C++ frontend scoped operations, never a name wildcard.
static bool gnuSourceCatchOperation(const CallBase &CB) {
  auto ID = CB.getIntrinsicID();
  if (ID != Intrinsic::wasm_get_exception &&
      ID != Intrinsic::wasm_get_ehselector && ID != Intrinsic::wasm_rethrow)
    return false;
  const Function &F = *CB.getFunction();
  if (!GNUForcedAdmission || !F.hasPersonalityFn() ||
      classifyEHPersonality(F.getPersonalityFn()) != EHPersonality::Wasm_CXX)
    report_fatal_error("GNU source catch operation lacks its actual Wasm personality");
  if (ID != Intrinsic::wasm_rethrow) {
    auto *Pad = CB.arg_size() == 1 ? dyn_cast<CatchPadInst>(CB.getArgOperand(0)) : nullptr;
    if (!isa<CallInst>(CB) || !Pad || Pad->getFunction() != &F ||
        Pad->getParent() != CB.getParent() ||
        (ID == Intrinsic::wasm_get_exception ? !CB.getType()->isPointerTy()
                                            : !CB.getType()->isIntegerTy(32)))
      report_fatal_error("GNU source exception/selector does not use its actual same-block catchpad");
    return true;
  }
  auto Bundle = CB.getOperandBundle(LLVMContext::OB_funclet);
  auto *Pad = Bundle && Bundle->Inputs.size() == 1
      ? dyn_cast<CatchPadInst>(Bundle->Inputs[0]) : nullptr;
  if (!isa<CallInst>(CB) || CB.arg_size() || !CB.getType()->isVoidTy() ||
      !CB.doesNotReturn() || !Pad || Pad->getFunction() != &F ||
      !isa<UnreachableInst>(CB.getParent()->getTerminator()) ||
      CB.getNextNode() != CB.getParent()->getTerminator())
    report_fatal_error("GNU source rethrow lacks its actual noreturn catch funclet");
  auto Colors = colorEHFunclets(const_cast<Function &>(F));
  auto It = Colors.find(const_cast<BasicBlock *>(CB.getParent()));
  if (It == Colors.end() || It->second.size() != 1 ||
      &*It->second.front()->getFirstNonPHIIt() != Pad)
    report_fatal_error("GNU source rethrow belongs to a different actual funclet");
  return true;
}
