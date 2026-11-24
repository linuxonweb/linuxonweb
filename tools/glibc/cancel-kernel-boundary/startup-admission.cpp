// Source-only finite bootstrap class proposal. Included after the unchanged
// class2/class4 provider authentication helpers; no compiler has used this file.
// Class8 never means a primitive2, a published frame, or a cancellation target.
static DenseMap<const Function *, SmallVector<std::string, 8>> GNUStartupCalls;
static DenseMap<const Function *, unsigned> GNUStartupPhases;
static DenseMap<const Function *, std::string> GNUStartupExternalKinds;

bool llvm::isWebAssemblyGNUStartupAuthenticated(const Function &F) {
  return GNUFrameRecords && GNUForcedAdmission &&
      GNUProviderAuthenticatedModule == F.getParent() && !F.isDeclaration() &&
      GNUProviderClasses.lookup(&F) == 8 &&
      F.getFnAttribute("wasm-gnu-startup-sealed").getValueAsString() == "8";
}
static bool gnuStartup(const Function &F) {
  return GNUProviderClasses.lookup(&F) == 8;
}
static std::string gnuInstructionText(const Instruction &I) {
  std::string S; raw_string_ostream OS(S); I.print(OS); return S;
}
static void prepareGNUStartupManifest(Module &M, json::Object &Object) {
  GNUStartupCalls.clear(); GNUStartupPhases.clear(); GNUStartupExternalKinds.clear();
  bool HasStartup = llvm::any_of(M, [](const Function &F) { return gnuStartup(F); });
  if (!HasStartup) {
    if (Object.getObject("startup"))
      report_fatal_error("GNU startup manifest without actual startup bodies");
    return;
  }
  auto *Contract = Object.getObject("startup");
  if (Object.getInteger("version") != 2 || !Contract ||
      Contract->getInteger("version") != 1 ||
      Contract->getString("phaseContract") != "gnu-mask-tls-tp-admit-record-v1" ||
      M.getNamedGlobal("llvm.global_ctors") || M.getNamedGlobal("llvm.global_dtors"))
    report_fatal_error("GNU startup needs distinct exact version2 contract and no constructors");
  auto *Symbols = Contract->getObject("symbols");
  auto *Externals = Contract->getObject("externals");
  if (!Symbols || !Externals)
    report_fatal_error("GNU startup lacks exact call and external seals");
  unsigned Count = 0;
  for (auto &F : M) if (gnuStartup(F)) {
    ++Count;
    auto *Entry = Symbols->getObject(F.getName());
    auto Phase = Entry ? Entry->getInteger("phase") : std::nullopt;
    auto *Calls = Entry ? Entry->getArray("calls") : nullptr;
    if (!Entry || !Phase || *Phase < 1 || *Phase > 3 || !Calls)
      report_fatal_error("GNU startup function phase/call contract missing");
    GNUStartupPhases[&F] = *Phase;
    for (auto &Item : *Calls) {
      auto Hash = Item.getAsString();
      if (!Hash || Hash->size() != 64)
        report_fatal_error("GNU startup callsite SHA seal malformed");
      GNUStartupCalls[&F].push_back(Hash->str());
    }
    // No runtime indirect path may enter a pre-owner function. External _start
    // assembly is separately bound by the final-object/loader contract.
    for (const User *U : F.users()) {
      auto *Call = dyn_cast<CallInst>(U);
      if (!Call || Call->getCalledFunction() != &F || !gnuStartup(*Call->getFunction()))
        report_fatal_error("GNU startup address escapes or is called from recorded code");
    }
  }
  if (Symbols->size() != Count)
    report_fatal_error("GNU startup symbol contract contains extra/missing bodies");
  for (auto &Item : *Externals) {
    Function *F = M.getFunction(Item.first);
    auto *Entry = Item.second.getAsObject();
    auto Kind = Entry ? Entry->getString("kind") : std::nullopt;
    if (!F || !F->isDeclaration() || F->isIntrinsic() || !Entry || !Kind ||
        Entry->getString("type") != gnuFunctionType(*F))
      report_fatal_error("GNU startup external ABI seal mismatch");
    if (*Kind == "import") {
      if (!F->hasFnAttribute("wasm-import-module") || !F->hasFnAttribute("wasm-import-name") ||
          Entry->getString("module") != F->getFnAttribute("wasm-import-module").getValueAsString() ||
          Entry->getString("name") != F->getFnAttribute("wasm-import-name").getValueAsString())
        report_fatal_error("GNU startup import namespace/name mismatch");
    } else if (*Kind == "assembly-object") {
      auto Path = Entry->getString("path"), Hash = Entry->getString("sha256");
      if (!Path || !Hash) report_fatal_error("GNU startup assembly artifact missing");
      auto Buffer = MemoryBuffer::getFile(*Path);
      if (!Buffer || gnuHash((*Buffer)->getBuffer()) != *Hash ||
          !Entry->getString("finalBodyAuditSha256") ||
          Entry->getString("finalBodyAuditSha256")->size() != 64 ||
          F->hasFnAttribute("wasm-import-module") || F->hasFnAttribute("wasm-import-name"))
        report_fatal_error("GNU startup external assembly lacks actual artifact/body audit pins");
    } else
      report_fatal_error("GNU startup external kind unsupported; linker-generated TLS must be separately sealed");
    GNUStartupExternalKinds[F] = Kind->str();
  }
}

static bool gnuStartupTLSOperand(const Value *V, unsigned Depth = 0) {
  if (Depth > 32) report_fatal_error("GNU startup constant operand nesting unsupported");
  if (auto *G = dyn_cast<GlobalVariable>(V)) return G->isThreadLocal();
  if (auto *C = dyn_cast<Constant>(V))
    for (const Use &U : C->operands()) if (gnuStartupTLSOperand(U.get(), Depth + 1)) return true;
  return false;
}
static void prepareGNUStartup(Function &F) {
  SmallVector<CallInst *, 8> Polls;
  CallInst *Capture = nullptr;
  unsigned Calls = 0;
  for (auto &I : instructions(F)) {
    if (I.isEHPad() || isa<AllocaInst>(I) || isa<IndirectBrInst>(I) || isa<CallBrInst>(I))
      report_fatal_error("GNU startup has unguarded linear-stack/EH/control operations");
    if (GNUStartupPhases.lookup(&F) < 3)
      for (const Use &U : I.operands())
        if (gnuStartupTLSOperand(U.get()))
          report_fatal_error("GNU pre-TLS startup references C TLS");
    auto *CB = dyn_cast<CallBase>(&I);
    if (!CB) continue;
    Function *Callee = CB->getCalledFunction();
    if (!isa<CallInst>(CB) || !Callee || CB->isInlineAsm())
      report_fatal_error("GNU startup has an indirect/invoking/assembly call");
    auto N = Callee->getName();
    if (N == "__wasm_gnu_caller_sp_v1") {
      if (Capture || CB->arg_size() || !CB->getType()->isIntegerTy(32) ||
          I.getParent() != &F.getEntryBlock() ||
          F.getFnAttribute("wasm-gnu-cancel-prerequisite").getValueAsString() != "1")
        report_fatal_error("GNU startup cannot retire an unowned caller capture");
      Capture = cast<CallInst>(CB); continue;
    }
    if (N == "__wasm_gnu_cancel_poll_v1") {
      auto *Tag = CB->getMetadata("wasm.gnu.cancel.poll.v1");
      auto *Reason = CB->arg_size() == 2 ? dyn_cast<ConstantInt>(CB->getArgOperand(1)) : nullptr;
      if (CB->arg_size() != 2 || !CB->getType()->isVoidTy() || !Tag ||
          Tag->getNumOperands() || !Reason || !Reason->getType()->isIntegerTy(32) ||
          Reason->getZExtValue() > 3)
        report_fatal_error("GNU startup cannot retire malformed early poll");
      Polls.push_back(cast<CallInst>(CB)); continue;
    }
    auto &Expected = GNUStartupCalls[&F];
    if (Calls >= Expected.size() || Expected[Calls++] != gnuHash(gnuInstructionText(I)))
      report_fatal_error("GNU startup actual call/operand ordering differs from sealed IR");
    if (Callee->isIntrinsic()) {
      if (!gnuProviderIntrinsic(F, N) || N.starts_with("llvm.wasm.throw") ||
          N.starts_with("llvm.wasm.rethrow") || N.starts_with("llvm.wasm.catch") ||
          N.starts_with("llvm.eh.") || N.starts_with("llvm.coro.") || N.starts_with("llvm.stack"))
        report_fatal_error("GNU startup intrinsic is not audited stack-free code");
    } else if (Callee->isDeclaration()) {
      if (!GNUStartupExternalKinds.count(Callee))
        report_fatal_error("GNU startup external call lacks the exact import/artifact seal");
    } else if (!gnuStartup(*Callee) && !gnuPrimitive(*Callee))
      report_fatal_error("GNU startup call enters recorded code before owner admission");
  }
  if (Calls != GNUStartupCalls[&F].size() || F.hasPersonalityFn() || F.isVarArg() ||
      F.hasFnAttribute(Attribute::Naked) || F.hasFnAttribute("wasm-import-module") ||
      F.hasFnAttribute("wasm-import-name"))
    report_fatal_error("GNU startup call/function mode mismatch");
  unsigned EntryPolls = 0;
  for (auto *Poll : Polls) {
    if (!Capture || Poll->getArgOperand(0) != Capture)
      report_fatal_error("GNU startup poll lacks actual caller capture");
    if (cast<ConstantInt>(Poll->getArgOperand(1))->isZero()) {
      if (Poll->getParent() != &F.getEntryBlock())
        report_fatal_error("GNU startup entry poll is outside entry");
      ++EntryPolls;
    }
  }
  if (Capture) {
    if (EntryPolls != 1) report_fatal_error("GNU startup needs unique authenticated early poll");
    for (const User *U : Capture->users())
      if (!llvm::is_contained(Polls, dyn_cast<CallInst>(U)))
        report_fatal_error("GNU startup capture escapes authenticated early polls");
  } else if (!Polls.empty()) report_fatal_error("GNU startup poll lacks capture");
  for (auto *Poll : Polls) Poll->eraseFromParent();
  if (Capture) Capture->eraseFromParent();
  F.removeFnAttr("wasm-gnu-cancel-prerequisite");
  F.addFnAttr("wasm-gnu-startup-sealed", "8");
  F.addFnAttr(Attribute::NoInline);
  F.addFnAttr("disable-tail-calls", "true");
}

static bool auditGNUStartup(MachineFunction &MF) {
  if (MF.getFunction().getFnAttribute("wasm-gnu-startup-sealed").getValueAsString() != "8") return false;
  if (!llvm::isWebAssemblyGNUStartupAuthenticated(MF.getFunction()) ||
      MF.getFrameInfo().getNumObjects() || MF.getFrameInfo().getStackSize())
    report_fatal_error("GNU startup lacks producer seal or acquired a linear frame");
  const auto *TRI = MF.getSubtarget<WebAssemblySubtarget>().getRegisterInfo();
  for (auto &BB : MF) for (auto &MI : BB) {
    if (BB.isEHPad() || MI.definesRegister(WebAssembly::SP32, TRI) ||
        WebAssembly::isCatch(MI.getOpcode()) || MI.getOpcode() == WebAssembly::THROW ||
        MI.getOpcode() == WebAssembly::RETHROW)
      report_fatal_error("GNU startup acquired unguarded SP/EH operations");
    if (MI.getOpcode() == WebAssembly::GLOBAL_SET_I32) {
      const auto &G = MI.getOperand(0);
      if ((G.isSymbol() && StringRef(G.getSymbolName()) == "__stack_pointer") ||
          (G.isGlobal() && G.getGlobal()->getName() == "__stack_pointer"))
        report_fatal_error("GNU startup writes linear SP");
    }
    if (!MI.isCall()) continue;
    const auto &Target = WebAssembly::getCalleeOp(MI);
    const Function *Callee = nullptr;
    if (Target.isGlobal()) Callee = dyn_cast<Function>(Target.getGlobal());
    if (Target.isSymbol()) Callee = MF.getFunction().getParent()->getFunction(Target.getSymbolName());
    if (!Callee || (!llvm::isWebAssemblyGNUStartupAuthenticated(*Callee) &&
        !llvm::isWebAssemblyGNUPrimitiveAuthenticated(*Callee) &&
        !GNUStartupExternalKinds.count(Callee)))
      report_fatal_error("GNU startup machine call lacks actual sealed closure");
  }
  return true;
}
