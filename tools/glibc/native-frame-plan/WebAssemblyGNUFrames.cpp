//===-- WebAssemblyGNUFrames.cpp - owned record-only GNU prerequisite ------===//
// Exact-source LLVM22 overlay. Not a forced-unwind implementation.
#include "WebAssembly.h"
#include "llvm/ADT/SmallVector.h"
#include "llvm/ADT/SmallString.h"
#include "llvm/ADT/StringExtras.h"
#include "llvm/CodeGen/MachineFunctionPass.h"
#include "llvm/CodeGen/MachineFrameInfo.h"
#include "llvm/CodeGen/MachineInstrBuilder.h"
#include "llvm/CodeGen/MachineRegisterInfo.h"
#include "MCTargetDesc/WebAssemblyMCTargetDesc.h"
#include "WebAssemblySubtarget.h"
#include "llvm/IR/Constants.h"
#include "llvm/IR/EHPersonalities.h"
#include "llvm/IR/IRBuilder.h"
#include "llvm/IR/InstIterator.h"
#include "llvm/IR/Intrinsics.h"
#include "llvm/IR/Module.h"
#include "llvm/IR/Verifier.h"
#include "llvm/Pass.h"
#include "llvm/Support/CommandLine.h"
#include "llvm/Support/ErrorHandling.h"
#include "llvm/Support/MD5.h"
#include "llvm/TargetParser/Triple.h"
#include "llvm/Transforms/Utils/ModuleUtils.h"
using namespace llvm;

static cl::opt<bool> GNUFrameRecords(
    "wasm-gnu-frame-records", cl::init(false),
    cl::desc("Experimental GNU frame records only; no unwind admission"));

namespace {
class WebAssemblyGNUFrames final : public ModulePass {
public:
  static char ID;
  WebAssemblyGNUFrames() : ModulePass(ID) {}
  bool runOnModule(Module &M) override;
};
}
char WebAssemblyGNUFrames::ID = 0;
ModulePass *llvm::createWebAssemblyGNUFrames() {
  return new WebAssemblyGNUFrames();
}

bool WebAssemblyGNUFrames::runOnModule(Module &M) {
  if (!GNUFrameRecords)
    return false;
  Triple T(M.getTargetTriple());
  if (T.getArch() != Triple::wasm32 || !T.isOSLinux() || !T.isGNUEnvironment())
    report_fatal_error("GNU records require wasm32 Linux GNU");
  if (M.getModuleFlag("wasm.gnu.frame.records.v1"))
    report_fatal_error("GNU record materialization cannot run twice");
  if (!M.getModuleInlineAsm().empty())
    report_fatal_error("GNU records do not admit unaudited module assembly");
  // Reserved operations must not come from the source or a provider archive.
  for (auto &F : M)
    if (F.getName().starts_with("__wasm_gnu_frame_"))
      report_fatal_error("source defines or declares reserved GNU frame operation");
    else if (F.getName() == "__wasm_gnu_cancel_poll_v1" && !F.isDeclaration())
      report_fatal_error("GNU poll must be a separately admitted sealed native bridge");
  SmallVector<Function *, 16> Functions;
  for (auto &F : M)
    if (!F.isDeclaration())
      Functions.push_back(&F);
  if (Functions.empty())
    report_fatal_error("GNU records require a participating definition");
  LLVMContext &C = M.getContext();
  auto *P = PointerType::getUnqual(C);
  auto *I32 = Type::getInt32Ty(C);
  auto *V = Type::getVoidTy(C);
  auto *RecordTy = ArrayType::get(I32, 16);
  auto *DescTy = StructType::get(C, {I32, I32, I32, P, P, P, P, I32});
  auto *ModuleTy = StructType::get(C, {I32, I32, I32, P, I32, P});
  MD5 Digest;
  MD5::MD5Result DigestResult;
  Digest.update(M.getModuleIdentifier());
  Digest.final(DigestResult);
  SmallString<32> ModuleName;
  MD5::stringifyResult(DigestResult, ModuleName);
  // Name uniqueness only: admission binds final bytes, never trusts this MD5.
  auto *Manifest = new GlobalVariable(M, ModuleTy, true, GlobalValue::ExternalLinkage,
      nullptr, Twine("__wasm_gnu_frame_records_module_v1.") + ModuleName.str());
  Manifest->setVisibility(GlobalValue::HiddenVisibility);
  Manifest->setAlignment(Align(4));
  auto Enter = M.getOrInsertFunction("__wasm_gnu_frame_enter_v1", V, P, P, I32, I32);
  auto Leave = M.getOrInsertFunction("__wasm_gnu_frame_leave_v1", V, P);
  auto Commit = M.getOrInsertFunction("__wasm_gnu_frame_commit_sp_v1", V, I32);
  auto AdmitCall = M.getOrInsertFunction("__wasm_gnu_frame_admit_call_v1", V, P);
  for (auto FC : {Enter, Leave, Commit, AdmitCall}) {
    auto *F = cast<Function>(FC.getCallee());
    F->addFnAttr(Attribute::NoUnwind);
    F->addFnAttr(Attribute::NoInline);
    // No willreturn/readnone: publication, validation and release are observable.
  }
  SmallVector<Constant *, 16> Descriptors;
  auto *StackSave = Intrinsic::getOrInsertDeclaration(&M, Intrinsic::stacksave, {P});
  for (Function *F : Functions) {
    if (!F->hasFnAttribute("wasm-gnu-cancel-prerequisite") ||
        !F->hasFnAttribute(Attribute::NoInline) ||
        !F->hasFnAttribute("disable-tail-calls") ||
        !F->hasFnAttribute("target-features") ||
        !F->getFnAttribute("target-features").getValueAsString().contains("+exception-handling"))
      report_fatal_error("GNU records found an uninstrumented/non-native-EH definition");
    if (F->hasFnAttribute(Attribute::Naked) || F->isVarArg())
      report_fatal_error("GNU records do not admit naked or variadic functions yet");
    CallInst *Capture = nullptr;
    SmallVector<Instruction *, 16> DynamicSP, Returns;
    SmallVector<CallBase *, 16> UserCalls;
    for (auto &I : instructions(F)) {
      if (I.isEHPad())
        report_fatal_error("record-only GNU mode requires composed escaping-EH routing before admitting EH pads");
      if (auto *CB = dyn_cast<CallBase>(&I)) {
        if (CB->isInlineAsm())
          report_fatal_error("GNU record module contains unaudited inline assembly");
        if (auto *Call = dyn_cast<CallInst>(CB)) {
          if (Call->isMustTailCall())
            report_fatal_error("GNU record handoff for musttail is absent");
          Call->setTailCallKind(CallInst::TCK_None);
        }
        if (Function *Callee = CB->getCalledFunction()) {
          if (Callee->getName() == "__wasm_gnu_caller_sp_v1") {
            if (Capture || !isa<CallInst>(I) || I.getParent() != &F->getEntryBlock())
              report_fatal_error("GNU records require one entry caller-SP operation");
            Capture = cast<CallInst>(&I);
          }
          if (!Callee->isIntrinsic() &&
              Callee->getName() != "__wasm_gnu_caller_sp_v1")
            UserCalls.push_back(CB);
          if (Callee->isIntrinsic()) {
            auto ID = Callee->getIntrinsicID();
            if (ID == Intrinsic::stackrestore)
              DynamicSP.push_back(&I);
            if (Callee->getName().starts_with("llvm.coro.") ||
                Callee->getName().starts_with("llvm.eh.sjlj.") ||
                Callee->getName().starts_with("llvm.wasm."))
              report_fatal_error("GNU records found an unaudited low-level intrinsic");
          }
        } else
          UserCalls.push_back(CB);
      }
      if (auto *AI = dyn_cast<AllocaInst>(&I)) {
        if (!AI->isStaticAlloca())
          DynamicSP.push_back(AI);
      }
      if (isa<ReturnInst>(I))
        Returns.push_back(&I);
      if (isa<IndirectBrInst>(I) || isa<CallBrInst>(I))
        report_fatal_error("GNU records do not admit computed branches");
    }
    if (!Capture || !Capture->getNextNode())
      report_fatal_error("GNU records missing entry capture");
    // These are explicitly RECORDS_ONLY descriptors: no LSDA/personality
    // admission and no forced dispatch until the reviewed routing merge.
    Constant *Fields[] = {ConstantInt::get(I32, 1), ConstantInt::get(I32, 32),
      ConstantInt::get(I32, 1), Manifest, F,
      ConstantPointerNull::get(P), ConstantPointerNull::get(P), ConstantInt::get(I32, 0)};
    auto *D = new GlobalVariable(M, DescTy, true, GlobalValue::PrivateLinkage,
        ConstantStruct::get(DescTy, Fields), "wasm.gnu.frame.descriptor");
    D->setAlignment(Align(4));
    D->setSection(".rodata.wasm.gnu.frame.records.v1");
    Descriptors.push_back(D);
    IRBuilder<> AB(&*F->getEntryBlock().getFirstInsertionPt());
    auto *Record = AB.CreateAlloca(RecordTy, nullptr, "wasm.gnu.frame.record.v1");
    Record->setAlignment(Align(16));
    Record->setMetadata("wasm.gnu.frame.record.v1", MDNode::get(C, {}));
    auto Colors = colorEHFunclets(*F);
    auto Bundles = [&](Instruction *At) {
      SmallVector<OperandBundleDef, 1> Result;
      auto It = Colors.find(At->getParent());
      if (It != Colors.end()) {
        if (It->second.size() != 1)
          report_fatal_error("GNU records require uniquely colored funclets");
        auto *Pad = &*It->second.front()->getFirstNonPHIIt();
        if (isa<FuncletPadInst>(Pad))
          Result.emplace_back("funclet", Pad);
      }
      return Result;
    };
    IRBuilder<> EB(Capture->getNextNode());
    Value *FixedSP = EB.CreatePtrToInt(EB.CreateCall(StackSave), I32);
    EB.CreateCall(Enter, {Record, D, Capture, FixedSP}, Bundles(Capture->getNextNode()));
    for (Instruction *I : DynamicSP) {
      if (!I->getNextNode())
        report_fatal_error("GNU records cannot commit dynamic SP at terminator");
      IRBuilder<> B(I->getNextNode());
      Value *SP = B.CreatePtrToInt(B.CreateCall(StackSave, {}, Bundles(I)), I32);
      // Store before any helper/throw; base is the stable fixed frame object.
      auto *Active = B.CreateConstGEP2_32(RecordTy, Record, 0, 7);
      B.CreateStore(SP, Active);
      B.CreateCall(Commit, {SP}, Bundles(I));
    }
    for (Instruction *I : Returns) {
      IRBuilder<> B(I);
      B.CreateCall(Leave, {Record}, Bundles(I));
    }
    for (CallBase *CB : UserCalls) {
      CB->setMemoryEffects(MemoryEffects::unknown());
      CB->removeFnAttr(Attribute::NoSync);
      CB->removeFnAttr(Attribute::NoFree);
      CB->removeFnAttr(Attribute::WillReturn);
      IRBuilder<> B(CB);
      B.CreateCall(AdmitCall, {CB->getCalledOperand()}, Bundles(CB));
    }
    F->addFnAttr(Attribute::NoRedZone);
    F->setMemoryEffects(MemoryEffects::unknown());
    F->removeFnAttr(Attribute::NoSync);
    F->removeFnAttr(Attribute::NoFree);
    F->removeFnAttr(Attribute::WillReturn);
    F->removeFnAttr(Attribute::Speculatable);
    F->addFnAttr("wasm-gnu-frame-records", "1");
    F->addFnAttr("wasm-gnu-frame-dynamic-commits", utostr(DynamicSP.size()));
  }
  auto *TableTy = ArrayType::get(P, Descriptors.size());
  auto *Table = new GlobalVariable(M, TableTy, true, GlobalValue::PrivateLinkage,
      ConstantArray::get(TableTy, Descriptors), "wasm.gnu.frame.records.table.v1");
  Table->setSection(".rodata.wasm.gnu.frame.records.table.v1");
  Manifest->setInitializer(ConstantStruct::get(ModuleTy, {
      ConstantInt::get(I32, 1), ConstantInt::get(I32, 1), ConstantInt::get(I32, 1),
      Table, ConstantInt::get(I32, Descriptors.size()), ConstantPointerNull::get(P)}));
  Descriptors.push_back(Table);
  Descriptors.push_back(Manifest);
  SmallVector<GlobalValue *, 16> Used;
  for (Constant *D : Descriptors) Used.push_back(cast<GlobalValue>(D));
  appendToCompilerUsed(M, Used);
  M.addModuleFlag(Module::Error, "wasm.gnu.frame.records.v1", 1);
  if (verifyModule(M, &errs()))
    report_fatal_error("GNU record materialization produced invalid IR");
  return true;
}

// Record-only gate before physical SP replacement. Every body SP definition
// must reach its compiler-owned commit before a call/return or a CFG exit.
// EH is rejected above until the independent route is composed.
namespace {
class WebAssemblyGNUFrameAudit final : public MachineFunctionPass {
public:
  static char ID;
  WebAssemblyGNUFrameAudit() : MachineFunctionPass(ID) {}
  bool runOnMachineFunction(MachineFunction &MF) override {
    if (!MF.getFunction().hasFnAttribute("wasm-gnu-frame-records")) {
      if (MF.getFunction().getParent()->getModuleFlag("wasm.gnu.frame.records.v1"))
        report_fatal_error("GNU record module acquired an uninstrumented generated definition");
      return false;
    }
    unsigned SP = WebAssembly::SP32;
    auto &MRI = MF.getRegInfo();
    const auto *TII = MF.getSubtarget<WebAssemblySubtarget>().getInstrInfo();
    const auto *TRI = MF.getSubtarget<WebAssemblySubtarget>().getRegisterInfo();
    SmallVector<MachineInstr *, 16> Commits;
    unsigned Enters = 0;
    unsigned RecordArg = 0, CallerArg = 0;
    for (auto &BB : MF)
      for (auto &MI : BB) {
        bool Enter = false;
        for (auto &MO : MI.operands())
          if ((MO.isGlobal() && MO.getGlobal()->getName() == "__wasm_gnu_frame_enter_v1") ||
              (MO.isSymbol() && StringRef(MO.getSymbolName()) == "__wasm_gnu_frame_enter_v1")) Enter = true;
        if (!Enter) continue;
        SmallVector<unsigned, 4> Args;
        for (auto &MO : MI.operands())
          if (MO.isReg() && MO.isUse() && !MO.isImplicit()) Args.push_back(MO.getReg());
        if (Args.size() != 4 || RecordArg)
          report_fatal_error("invalid GNU entry operation argument shape");
        RecordArg = Args[0]; CallerArg = Args[2];
      }
    if (!RecordArg || !CallerArg)
      report_fatal_error("GNU audit cannot identify sealed record/caller-SP operands");
    auto CopyRoot = [&](unsigned R) {
      for (unsigned N = 0; Register::isVirtualRegister(R) && N != 32; ++N) {
        auto *Def = MRI.getUniqueVRegDef(R);
        if (!Def || !(Def->isCopy() || Def->getOpcode() == WebAssembly::COPY_I32) ||
            !Def->getOperand(1).isReg()) break;
        R = Def->getOperand(1).getReg();
      }
      return R;
    };
    // PEI rematerializes one frame-index address at each use. Accept only the
    // same fixed SP/FP plus exact constant offset, never arbitrary arithmetic.
    // A dynamic frame's record must use the stable physical frame register.
    auto RecordAddress = [&](unsigned R) {
      unsigned Offset = 0;
      for (unsigned N = 0; N != 32; ++N) {
        R = CopyRoot(R);
        if (!Register::isVirtualRegister(R)) break;
        auto *Def = MRI.getUniqueVRegDef(R);
        if (!Def || Def->getOpcode() != WebAssembly::ADD_I32 ||
            !Def->getOperand(1).isReg() || !Def->getOperand(2).isReg()) break;
        unsigned Base = Def->getOperand(1).getReg();
        unsigned ConstantReg = CopyRoot(Def->getOperand(2).getReg());
        if (!Register::isVirtualRegister(ConstantReg)) break;
        auto *Constant = MRI.getUniqueVRegDef(ConstantReg);
        if (!Constant || Constant->getOpcode() != WebAssembly::CONST_I32 ||
            !Constant->getOperand(1).isImm()) break;
        Offset += static_cast<unsigned>(Constant->getOperand(1).getImm());
        R = Base;
      }
      bool Stable = R == WebAssembly::FP32 ||
          (R == SP && !MF.getFrameInfo().hasVarSizedObjects());
      return std::make_pair(Stable ? R : 0u, Offset);
    };
    auto SealedRecordAddress = RecordAddress(RecordArg);
    if (!SealedRecordAddress.first)
      report_fatal_error("GNU record does not have a stable fixed-frame MIR address");
    unsigned RecordObjects = 0;
    for (int FI = MF.getFrameInfo().getObjectIndexBegin();
         FI != MF.getFrameInfo().getObjectIndexEnd(); ++FI) {
      auto *AI = MF.getFrameInfo().getObjectAllocation(FI);
      if (!AI || !AI->getMetadata("wasm.gnu.frame.record.v1")) continue;
      ++RecordObjects;
      // Exactly the same formula used by WebAssemblyRegisterInfo PEI.
      unsigned Offset = static_cast<unsigned>(MF.getFrameInfo().getStackSize() +
                                               MF.getFrameInfo().getObjectOffset(FI));
      if (SealedRecordAddress.first != TRI->getFrameRegister(MF) ||
          SealedRecordAddress.second != Offset)
        report_fatal_error("GNU entry operand is not the actual compiler record object");
    }
    if (RecordObjects != 1)
      report_fatal_error("GNU audit requires one actual compiler record object");
    auto IsRecordAddress = [&](unsigned R) {
      return RecordAddress(R) == SealedRecordAddress;
    };
    for (auto &BB : MF) {
      bool Dirty = false;
      bool Left = false, Released = false;
      // A dirty SP cannot cross a block edge. This deliberately rejects
      // unclassified transformation-created sequences instead of guessing.
      bool BeforeEnter = &BB == &MF.front();
      for (auto &MI : BB) {
        StringRef Callee;
        if (MI.isCall())
          for (auto &MO : MI.operands()) {
            if (MO.isGlobal()) Callee = MO.getGlobal()->getName();
            if (MO.isSymbol()) Callee = MO.getSymbolName();
          }
        if (Left) {
          if (MI.isCall() || MI.definesRegister(SP, TRI))
            report_fatal_error("GNU normal leave followed by call/body-SP definition");
          for (auto &MO : MI.operands())
            if (MO.isReg() && MO.isUse() && !MO.isImplicit() &&
                IsRecordAddress(MO.getReg()))
              report_fatal_error("GNU normal leave followed by record access");
          if (Released && MI.mayLoadOrStore())
            report_fatal_error("GNU caller-SP release followed by linear-memory access");
          if (MI.getOpcode() == WebAssembly::GLOBAL_SET_I32 &&
              MI.getOperand(0).isSymbol() &&
              StringRef(MI.getOperand(0).getSymbolName()) == "__stack_pointer") {
            if (Released || !MI.getOperand(1).isReg() ||
                CopyRoot(MI.getOperand(1).getReg()) != CopyRoot(CallerArg))
              report_fatal_error("GNU normal epilogue does not restore captured actual caller-SP");
            Released = true;
          }
          if (MI.isReturn() && !Released)
            report_fatal_error("GNU normal return lacks actual caller-SP release");
        }
        if (Callee == "__wasm_gnu_frame_enter_v1") {
          ++Enters;
          BeforeEnter = false;
          Dirty = false;
        } else if (Callee == "__wasm_gnu_frame_commit_sp_v1") {
          if (BeforeEnter || MI.getNumExplicitDefs() != 0)
            report_fatal_error("invalid GNU body-SP commit operation");
          unsigned Arg = 0;
          for (auto &MO : MI.operands())
            if (MO.isReg() && MO.isUse() && !MO.isImplicit()) {
              if (Arg) report_fatal_error("ambiguous GNU SP commit argument");
              Arg = MO.getReg();
            }
          if (!Arg) report_fatal_error("missing GNU SP commit argument");
          unsigned R = Arg;
          for (unsigned N = 0; R != SP && N != 32; ++N) {
            if (!Register::isVirtualRegister(R)) break;
            auto *Def = MRI.getUniqueVRegDef(R);
            if (!Def || !(Def->isCopy() || Def->getOpcode() == WebAssembly::COPY_I32) ||
                !Def->getOperand(1).isReg()) break;
            R = Def->getOperand(1).getReg();
          }
          if (R != SP)
            report_fatal_error("GNU SP commit is not actual current physical SP");
          BuildMI(BB, MI, MI.getDebugLoc(), TII->get(WebAssembly::GLOBAL_SET_I32))
              .addExternalSymbol(MF.createExternalSymbolName("__stack_pointer"))
              .addReg(Arg);
          Commits.push_back(&MI);
          Dirty = false;
        } else if (Callee == "__wasm_gnu_frame_leave_v1") {
          if (Dirty || Left)
            report_fatal_error("invalid GNU normal-leave ordering");
          unsigned Arg = 0;
          for (auto &MO : MI.operands())
            if (MO.isReg() && MO.isUse() && !MO.isImplicit()) {
              if (Arg) report_fatal_error("ambiguous GNU leave argument");
              Arg = MO.getReg();
            }
          if (!Arg || !IsRecordAddress(Arg))
            report_fatal_error("GNU leave does not unpublish this actual frame");
          Left = true;
        } else if ((MI.isCall() || MI.isReturn()) && Dirty)
          report_fatal_error("GNU body SP changed without active-SP commit before call/return");
        if (MI.isReturn() && !Left)
          report_fatal_error("GNU normal return missing sealed leave");
        if (!BeforeEnter && MI.definesRegister(SP, TRI))
          Dirty = true;
        if (!BeforeEnter && SealedRecordAddress.first == WebAssembly::FP32 &&
            MI.definesRegister(WebAssembly::FP32, TRI))
          report_fatal_error("GNU fixed record base changed after publication");
      }
      if (Dirty)
        report_fatal_error("GNU body SP changed without active-SP commit before CFG edge");
      if (Left && !Released)
        report_fatal_error("GNU unpublication escapes block before caller-SP release");
    }
    if (Enters != 1)
      report_fatal_error("GNU machine frame requires exactly one entry publication");
    unsigned Expected = 0;
    if (MF.getFunction().getFnAttribute("wasm-gnu-frame-dynamic-commits")
        .getValueAsString().getAsInteger(10, Expected) || Expected != Commits.size())
      report_fatal_error("GNU dynamic-SP commit count changed during code generation");
    for (auto *MI : Commits) MI->eraseFromParent();
    return !Commits.empty();
  }
};
}
char WebAssemblyGNUFrameAudit::ID = 0;
FunctionPass *llvm::createWebAssemblyGNUFrameAudit() {
  return new WebAssemblyGNUFrameAudit();
}
