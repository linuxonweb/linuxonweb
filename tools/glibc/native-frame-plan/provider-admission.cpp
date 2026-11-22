// Source-only mixed-provider extension. An external reviewed manifest seals
// actual IR at the first record pass; source attributes cannot grant admission.
static cl::opt<std::string> GNUProviderManifest("wasm-gnu-provider-manifest",
    cl::init(""), cl::desc("Reviewed exact GNU provider IR admission manifest"));
static cl::opt<std::string> GNUProviderInspect("wasm-gnu-provider-inspect",
    cl::init(""), cl::desc("Write exact IR admission facts and reject code generation"));
static DenseMap<const Function *, unsigned> GNUProviderClasses;
static DenseMap<const Function *, SmallVector<std::string, 4>> GNUProviderIntrinsics;
static Function *GNUProviderRoot = nullptr;
static const Module *GNUProviderAuthenticatedModule = nullptr;

bool llvm::isWebAssemblyGNUPrimitiveAuthenticated(const Function &F) {
  return GNUFrameRecords && GNUForcedAdmission &&
      GNUProviderAuthenticatedModule &&
      F.getParent() == GNUProviderAuthenticatedModule && !F.isDeclaration() &&
      F.getFnAttribute("wasm-gnu-provider-sealed").getValueAsString() == "2" &&
      (&F == GNUProviderRoot || GNUProviderClasses.lookup(&F) == 2);
}

static std::string gnuHash(StringRef S) {
  return toHex(SHA256::hash(ArrayRef<uint8_t>(
      reinterpret_cast<const uint8_t *>(S.data()), S.size())), true);
}
static std::string gnuFunctionText(const Function &F) {
  std::string S; raw_string_ostream OS(S); F.print(OS); return S;
}
static std::string gnuFunctionType(const Function &F) {
  std::string S; raw_string_ostream OS(S); F.getFunctionType()->print(OS); return S;
}
static bool gnuPrimitive(const Function &F) {
  return &F == GNUProviderRoot || GNUProviderClasses.lookup(&F) == 2;
}
static bool gnuProviderIntrinsic(const Function &F, StringRef Name) {
  auto It = GNUProviderIntrinsics.find(&F);
  if (It == GNUProviderIntrinsics.end()) return false;
  return llvm::is_contained(It->second, Name.str());
}
static void prepareGNUProviders(Module &M) {
  GNUProviderAuthenticatedModule = nullptr;
  GNUProviderClasses.clear(); GNUProviderIntrinsics.clear(); GNUProviderRoot = nullptr;
  for (auto &F : M)
    if (F.hasFnAttribute("wasm-gnu-provider-sealed"))
      report_fatal_error("source supplies GNU provider seal");
  if (GNUProviderManifest.empty() && GNUProviderInspect.empty()) return;
  if (!GNUForcedAdmission)
    report_fatal_error("GNU provider admission requires coherent module4");
  std::string ModuleText; raw_string_ostream MS(ModuleText); M.print(MS, nullptr);
  if (!GNUProviderInspect.empty()) {
    json::Object Facts{{"version", 1}, {"moduleSha256", gnuHash(ModuleText)}};
    json::Object Symbols;
    for (auto &F : M)
      Symbols[F.getName()] = json::Object{
          {"sha256", gnuHash(gnuFunctionText(F))}, {"type", gnuFunctionType(F)},
          {"flags", F.isDeclaration() ? 0 : 4}, {"intrinsics", json::Array{}}};
    Facts["symbols"] = std::move(Symbols);
    std::error_code EC;
    raw_fd_ostream OS(GNUProviderInspect, EC);
    if (EC) report_fatal_error("cannot write GNU provider inspection");
    OS << formatv("{0:2}\n", json::Value(std::move(Facts))); OS.flush();
    report_fatal_error("GNU provider inspection is source evidence only; generation rejected");
  }
  auto Buffer = MemoryBuffer::getFile(GNUProviderManifest);
  if (!Buffer) report_fatal_error("cannot read GNU provider manifest");
  auto Parsed = json::parse((*Buffer)->getBuffer());
  if (!Parsed) report_fatal_error("invalid GNU provider manifest JSON");
  auto *Object = Parsed->getAsObject();
  if (!Object || Object->getInteger("version") != 1 ||
      Object->getString("moduleSha256") != gnuHash(ModuleText))
    report_fatal_error("GNU provider manifest does not bind actual input module");
  auto *Symbols = Object->getObject("symbols");
  if (!Symbols || Symbols->size() != M.size())
    report_fatal_error("GNU provider manifest must bind every actual function");
  for (auto &F : M) {
    auto *Entry = Symbols->getObject(F.getName());
    auto Flag = Entry ? Entry->getInteger("flags") : std::nullopt;
    if (!Entry || Entry->getString("sha256") != gnuHash(gnuFunctionText(F)) ||
        Entry->getString("type") != gnuFunctionType(F) || !Flag ||
        (F.isDeclaration() ? *Flag != 0 : (*Flag != 2 && *Flag != 4)))
      report_fatal_error("GNU provider function body/type/class pin mismatch");
    GNUProviderClasses[&F] = *Flag;
    auto *Intrinsics = Entry->getArray("intrinsics");
    if (!Intrinsics) report_fatal_error("GNU provider intrinsic seal missing");
    for (auto &Item : *Intrinsics) {
      auto Name = Item.getAsString();
      auto *Callee = Name ? M.getFunction(*Name) : nullptr;
      if (!Callee || !Callee->isIntrinsic())
        report_fatal_error("GNU provider seal names a non-intrinsic");
      GNUProviderIntrinsics[&F].push_back(Name->str());
    }
  }
  GNUProviderAuthenticatedModule = &M;
}

static void prepareGNUPrimitive(Function &F) {
  SmallVector<CallInst *, 8> Polls;
  CallInst *Capture = nullptr;
  for (auto &I : instructions(F)) {
    if (I.isEHPad() || isa<AllocaInst>(I) || isa<IndirectBrInst>(I) || isa<CallBrInst>(I))
      report_fatal_error("GNU primitive has unaudited stack/control operations");
    auto *CB = dyn_cast<CallBase>(&I);
    if (!CB) continue;
    auto *Callee = CB->getCalledFunction();
    if (!isa<CallInst>(CB) || !Callee || CB->isInlineAsm())
      report_fatal_error("GNU primitive has an indirect/invoking/assembly call");
    auto N = Callee->getName();
    if (N == "__wasm_gnu_caller_sp_v1") {
      if (Capture || CB->arg_size() || !CB->getType()->isIntegerTy(32) ||
          I.getParent() != &F.getEntryBlock() ||
          F.getFnAttribute("wasm-gnu-cancel-prerequisite").getValueAsString() != "1")
        report_fatal_error("GNU primitive cannot remove an unowned entry capture");
      Capture = cast<CallInst>(CB); continue;
    }
    if (N == "__wasm_gnu_cancel_poll_v1") {
      auto *Tag = CB->getMetadata("wasm.gnu.cancel.poll.v1");
      auto *Reason = CB->arg_size() == 2 ? dyn_cast<ConstantInt>(CB->getArgOperand(1)) : nullptr;
      if (CB->arg_size() != 2 || !CB->getType()->isVoidTy() ||
          !Tag || Tag->getNumOperands() || !Reason ||
          !Reason->getType()->isIntegerTy(32) || Reason->getZExtValue() > 3)
        report_fatal_error("GNU primitive cannot remove malformed early poll");
      Polls.push_back(cast<CallInst>(CB)); continue;
    }
    if (Callee->isIntrinsic()) {
      if (!gnuProviderIntrinsic(F, N) || N.starts_with("llvm.wasm.throw") ||
          N.starts_with("llvm.wasm.rethrow") || N.starts_with("llvm.wasm.catch") ||
          N.starts_with("llvm.eh.") || N.starts_with("llvm.coro.") ||
          N.starts_with("llvm.stack"))
        report_fatal_error("GNU primitive intrinsic is not sealed stack-free code");
    } else if (Callee->isDeclaration() || !gnuPrimitive(*Callee))
      report_fatal_error("GNU primitive call closure lacks the actual sealed body");
  }
  if (F.hasPersonalityFn() || F.isVarArg() || F.hasFnAttribute(Attribute::Naked) ||
      F.hasFnAttribute("wasm-import-module") || F.hasFnAttribute("wasm-import-name"))
    report_fatal_error("GNU primitive has an unaudited EH/import/function mode");
  unsigned EntryPolls = 0;
  for (auto *Poll : Polls) {
    if (!Capture || Poll->getArgOperand(0) != Capture)
      report_fatal_error("GNU primitive poll does not use actual entry capture");
    if (cast<ConstantInt>(Poll->getArgOperand(1))->isZero()) {
      if (Poll->getParent() != &F.getEntryBlock())
        report_fatal_error("GNU primitive entry poll is outside entry");
      ++EntryPolls;
    }
  }
  if (Capture) {
    if (EntryPolls != 1)
      report_fatal_error("GNU primitive requires the unique actual early entry poll");
    for (const User *U : Capture->users())
      if (!llvm::is_contained(Polls, dyn_cast<CallInst>(U)))
        report_fatal_error("GNU primitive caller-SP is used outside authenticated polls");
  } else if (!Polls.empty())
    report_fatal_error("GNU primitive poll lacks actual entry capture");
  for (auto *Poll : Polls) Poll->eraseFromParent();
  if (Capture) {
    if (!Capture->use_empty())
      report_fatal_error("GNU primitive still uses entry capture after poll retirement");
    Capture->eraseFromParent();
  }
  F.removeFnAttr("wasm-gnu-cancel-prerequisite");
  F.addFnAttr("wasm-gnu-provider-sealed", "2");
  F.addFnAttr(Attribute::NoInline);
  F.addFnAttr("disable-tail-calls", "true");
}

// Run before physical-SP replacement and after actual CFGStackify as well.
static bool auditGNUPrimitive(MachineFunction &MF) {
  if (MF.getFunction().getFnAttribute("wasm-gnu-provider-sealed").getValueAsString() != "2")
    return false;
  if (!llvm::isWebAssemblyGNUPrimitiveAuthenticated(MF.getFunction()))
    report_fatal_error("GNU primitive machine audit lacks actual producer authentication");
  if (MF.getFrameInfo().getNumObjects() || MF.getFrameInfo().getStackSize())
    report_fatal_error("GNU sealed primitive acquired a linear frame");
  const auto *TRI = MF.getSubtarget<WebAssemblySubtarget>().getRegisterInfo();
  for (auto &BB : MF) for (auto &MI : BB) {
    if (BB.isEHPad() || MI.definesRegister(WebAssembly::SP32, TRI) ||
        WebAssembly::isCatch(MI.getOpcode()) || MI.getOpcode() == WebAssembly::THROW ||
        MI.getOpcode() == WebAssembly::RETHROW)
      report_fatal_error("GNU sealed primitive acquired SP/EH operations");
    if (MI.getOpcode() == WebAssembly::GLOBAL_SET_I32) {
      const auto &G = MI.getOperand(0);
      if ((G.isSymbol() && StringRef(G.getSymbolName()) == "__stack_pointer") ||
          (G.isGlobal() && G.getGlobal()->getName() == "__stack_pointer"))
        report_fatal_error("GNU sealed primitive writes actual linear SP");
    }
    if (!MI.isCall()) continue;
    const auto &Target = WebAssembly::getCalleeOp(MI);
    const Function *Callee = nullptr;
    if (Target.isGlobal()) Callee = dyn_cast<Function>(Target.getGlobal());
    if (Target.isSymbol()) Callee = MF.getFunction().getParent()->getFunction(Target.getSymbolName());
    if (!Callee || !llvm::isWebAssemblyGNUPrimitiveAuthenticated(*Callee))
      report_fatal_error("GNU primitive machine-call closure is not sealed");
  }
  return true;
}
