#!/usr/bin/env python3
import sys
sys.dont_write_bytecode=True
from common import *
import difflib
PATCH_NAME='compiler-attempt5.patch'
assert not (T/'logs'/PATCH_NAME).exists(), 'preserve prior attempt; use fresh task/version'
uw=(T/'source/basis-WasmEHPrepare.cpp').read_text()
uw=uw.replace('#include "llvm/Transforms/Utils/BasicBlockUtils.h"','#include "llvm/Transforms/Utils/BasicBlockUtils.h"\n#include "llvm/Support/CommandLine.h"')
uw=uw.replace('namespace {\nclass WasmEHPrepareImpl {','''static cl::opt<bool> GNUForcedUnwind("wasm-gnu-forced-unwind", cl::init(false),
    cl::desc("Owned coherent GNU native forced-unwind context/guard ABI"));
namespace {
class WasmEHPrepareImpl {''')
uw=uw.replace('  bool prepareThrows(Function &F);','''  Value *GNURecord = nullptr;
  bool GNUForced = false;
  bool prepareGNUContext(Function &F);
  bool prepareThrows(Function &F);''')
uw=uw.replace('  bool Changed = false;\n  Changed |= prepareThrows(F);','''  bool Changed = false;
  GNUForced = GNUForcedUnwind;
  if (GNUForced) Changed |= prepareGNUContext(F);
  Changed |= prepareThrows(F);''',1)
method='''bool WasmEHPrepareImpl::prepareGNUContext(Function &F) {
  if (F.isDeclaration()) return false;
  if (!F.hasFnAttribute("wasm-gnu-frame-records"))
    report_fatal_error("GNU forced unwind requires actual admitted frame records");
  GNURecord = nullptr;
  CallInst *Enter = nullptr;
  for (auto &BB : F) for (auto &I : BB) {
    if (auto *AI = dyn_cast<AllocaInst>(&I))
      if (AI->getMetadata("wasm.gnu.frame.record.v1")) {
        if (GNURecord) report_fatal_error("ambiguous GNU actual frame record");
        GNURecord = AI;
      }
    if (auto *CI = dyn_cast<CallInst>(&I))
      if (CI->getCalledFunction() &&
          CI->getCalledFunction()->getName() == "__wasm_gnu_frame_enter_v1") {
        if (Enter) report_fatal_error("ambiguous GNU actual entry publication");
        Enter = CI;
      }
  }
  if (!GNURecord || !Enter || Enter->getArgOperand(0) != GNURecord)
    report_fatal_error("GNU forced unwind lacks the compiler-owned actual record");
  auto &C = F.getContext();
  auto *I32 = Type::getInt32Ty(C); auto *P = PointerType::getUnqual(C);
  LPadContextTy = StructType::get(C, {I32,P,I32,P,P,I32,P,I32,I32,I32});
  IRBuilder<> AB(&*F.getEntryBlock().getFirstInsertionPt());
  auto *GuardContext = AB.CreateAlloca(LPadContextTy, nullptr,
                                       "wasm.gnu.unwind.guard.context.v1");
  GuardContext->setAlignment(Align(4));
  GuardContext->setMetadata("wasm.gnu.unwind.context.v1", MDNode::get(C, {}));
  auto &M = *F.getParent();
  auto Bind = M.getOrInsertFunction("__wasm_gnu_unwind_bind_v1", AB.getVoidTy(),P,P);
  cast<Function>(Bind.getCallee())->addFnAttr(Attribute::NoUnwind);
  IRBuilder<> EB(Enter->getNextNode());
  EB.CreateCall(Bind, {GNURecord, GuardContext});
  M.getOrInsertFunction("__wasm_gnu_unwind_guard_v1", AB.getVoidTy(),P,P,P);
  M.getOrInsertFunction("__wasm_gnu_unwind_terminal_v1", AB.getVoidTy(),P,P,P);
  M.getOrInsertFunction("__wasm_gnu_unwind_escape_v1", I32,P,I32,P);
  M.getOrInsertFunction("abort", AB.getVoidTy());
  F.addFnAttr("wasm-gnu-native-forced-unwind", "1");
  unsigned ContextFlags = 0;
  if (auto *Flags = M.getModuleFlagsMetadata()) for (auto *Flag : Flags->operands()) {
    if (Flag->getNumOperands()!=3) continue;
    auto *Name = dyn_cast<MDString>(Flag->getOperand(1));
    if (!Name || Name->getString()!="wasm.gnu.unwind.context.v1") continue;
    auto *Behavior = mdconst::dyn_extract<ConstantInt>(Flag->getOperand(0));
    auto *Version = mdconst::dyn_extract<ConstantInt>(Flag->getOperand(2));
    if (++ContextFlags!=1 || !Behavior || !Version ||
        Behavior->getZExtValue()!=Module::Error || Version->getZExtValue()!=1)
      report_fatal_error("conflicting GNU unwind context module ABI");
  }
  if (!ContextFlags) M.addModuleFlag(Module::Error,"wasm.gnu.unwind.context.v1",1);
  return true;
}

'''
uw=uw.replace('bool WasmEHPrepareImpl::prepareThrows(Function &F) {',method+'bool WasmEHPrepareImpl::prepareThrows(Function &F) {')
start=uw.index('  LPadContextGV = M.getOrInsertGlobal(');end=uw.index('  // wasm.landingpad.index()',start)
original=uw[start:end];uw=uw[:start]+'  if (!GNUForced) {\n'+original+'  }\n'+uw[end:]
uw=uw.replace('  CallPersonalityF = M.getOrInsertFunction(UnwindCallPersonalityName,\n                                           IRB.getInt32Ty(), IRB.getPtrTy());','''  CallPersonalityF = GNUForced
      ? M.getOrInsertFunction(UnwindCallPersonalityName, IRB.getInt32Ty(),
                              IRB.getPtrTy(), IRB.getPtrTy())
      : M.getOrInsertFunction(UnwindCallPersonalityName, IRB.getInt32Ty(), IRB.getPtrTy());''')
needle='  // Pseudocode: __wasm_lpad_context.lpad_index = index;'
extra='''  Value *NativeContext = nullptr;
  if (GNUForced) {
    IRBuilder<> AB(&*BB->getParent()->getEntryBlock().getFirstInsertionPt());
    auto *AI = AB.CreateAlloca(LPadContextTy, nullptr, "wasm.gnu.unwind.pad.context.v1");
    AI->setAlignment(Align(4));
    AI->setMetadata("wasm.gnu.unwind.context.v1", MDNode::get(BB->getContext(), {}));
    NativeContext = AI;
    LPadIndexField = AI;
    LSDAField = IRB.CreateConstInBoundsGEP2_32(LPadContextTy,AI,0,1);
    SelectorField = IRB.CreateConstInBoundsGEP2_32(LPadContextTy,AI,0,2);
    IRB.CreateStore(GNURecord, IRB.CreateConstInBoundsGEP2_32(LPadContextTy,AI,0,3));
  }

'''
uw=uw.replace(needle,extra+needle)
uw=uw.replace('  CallInst *PersCI = IRB.CreateCall(CallPersonalityF, CatchCI,\n                                    OperandBundleDef("funclet", CPI));','''  SmallVector<Value *, 2> PersonalityArgs{CatchCI};
  if (GNUForced) PersonalityArgs.push_back(NativeContext);
  CallInst *PersCI = IRB.CreateCall(CallPersonalityF, PersonalityArgs,
                                    OperandBundleDef("funclet", CPI));''')
# Context accessor initialization beyond original LSDA prefix is performed by
# the coherent provider before invoking the actual descriptor personality.
cfg=(T/'source/basis-WebAssemblyCFGStackify.cpp').read_text()
cfg=cfg.replace('  MachineDominatorTree *MDT;', '  MachineDominatorTree *MDT;\n  Register GNUFrame, GNUContext;')
cfg=cfg.replace('  void rewriteDepthImmediates(MachineFunction &MF);','  void addGNUForcedGuards(MachineFunction &MF);\n  void rewriteDepthImmediates(MachineFunction &MF);')
method='''void WebAssemblyCFGStackify::addGNUForcedGuards(MachineFunction &MF) {
  GNUFrame=Register();GNUContext=Register();
  if (!MF.getFunction().hasFnAttribute("wasm-gnu-native-forced-unwind")) return;
  if (!NativeEHRouting || !WebAssembly::WasmUseLegacyEH)
    report_fatal_error("GNU forced guards require reviewed native legacy routing");
  auto &MRI = MF.getRegInfo(); auto *MFI=MF.getInfo<WebAssemblyFunctionInfo>();
  const auto &TII=*MF.getSubtarget<WebAssemblySubtarget>().getInstrInfo();
  MachineInstr *Bind=nullptr; Register Frame, Context;
  for (auto &BB:MF) for(auto &MI:BB) if(MI.isCall()) {
    bool IsBind=false;
    for(auto &MO:MI.operands())
      if ((MO.isGlobal() && MO.getGlobal()->getName()=="__wasm_gnu_unwind_bind_v1") ||
          (MO.isSymbol() && StringRef(MO.getSymbolName())=="__wasm_gnu_unwind_bind_v1")) IsBind=true;
    if(!IsBind) continue;
    if(Bind || MI.getNumExplicitDefs()) report_fatal_error("ambiguous GNU guard binding");
    SmallVector<Register,2> Args;
    for(auto &MO:MI.operands()) if(MO.isReg()&&MO.isUse()&&!MO.isImplicit()) Args.push_back(MO.getReg());
    if(Args.size()!=2) report_fatal_error("invalid GNU actual frame/context binding");
    Bind=&MI;Frame=Args[0];Context=Args[1];
  }
  if(!Bind) report_fatal_error("GNU forced guard missing compiler context capture");
  MFI->unstackifyVReg(Frame);MFI->unstackifyVReg(Context);
  GNUFrame=Frame;GNUContext=Context;
  Bind->eraseFromParent();
  auto *Guard=MF.getFunction().getParent()->getFunction("__wasm_gnu_unwind_guard_v1");
  if(!Guard) report_fatal_error("missing typed GNU guard declaration");
  SmallVector<std::pair<MachineInstr *,MachineBasicBlock *>,8> Original;
  for(auto &Pair:TryToEHPad) if(Pair.second) Original.push_back({const_cast<MachineInstr *>(Pair.first),Pair.second});
  for(auto [Try,Pad]:Original) {
    auto *Catch=WebAssembly::findCatch(Pad);
    if(!Catch) report_fatal_error("GNU guard has no original native handler");
    auto *G=MF.CreateMachineBasicBlock();auto *End=MF.CreateMachineBasicBlock();
    G->setIsEHPad();MF.insert(Pad->getIterator(),G);MF.insert(Pad->getIterator(),End);
    G->splice(G->end(),Pad,Pad->begin(),Catch->getIterator());
    auto *Begin=BuildMI(*Try->getParent(),std::next(Try->getIterator()),Try->getDebugLoc(),
                       TII.get(WebAssembly::TRY)).addImm(Try->getOperand(0).getImm()).getInstr();
    Register E=MRI.createVirtualRegister(&WebAssembly::I32RegClass);
    Register Active=MRI.createVirtualRegister(&WebAssembly::I32RegClass);
    BuildMI(*G,G->end(),Catch->getDebugLoc(),TII.get(WebAssembly::CATCH_LEGACY),E)
        .addExternalSymbol(MF.createExternalSymbolName("__cpp_exception"));
    BuildMI(*G,G->end(),Catch->getDebugLoc(),TII.get(WebAssembly::LOAD_I32),Active)
        .addImm(2).addImm(28).addReg(Frame);
    BuildMI(*G,G->end(),Catch->getDebugLoc(),TII.get(WebAssembly::GLOBAL_SET_I32))
        .addExternalSymbol(MF.createExternalSymbolName("__stack_pointer")).addReg(Active);
    BuildMI(*G,G->end(),Catch->getDebugLoc(),TII.get(WebAssembly::CALL))
        .addGlobalAddress(Guard).addReg(Frame).addReg(E).addReg(Context);
    BuildMI(*G,G->end(),Catch->getDebugLoc(),TII.get(WebAssembly::RETHROW)).addMBB(G);
    auto *Finish=BuildMI(*End,End->end(),Catch->getDebugLoc(),TII.get(WebAssembly::END_TRY)).getInstr();
    registerTryScope(Begin,Finish,G);
    SmallVector<MachineBasicBlock *,8> Preds(Pad->pred_begin(),Pad->pred_end());
    for(auto *P:Preds) P->addSuccessor(G);
    G->addSuccessor(Pad);
    for(auto *S:Pad->successors()) if(S->isEHPad()) G->addSuccessor(S);
  }
  recalculateScopeTops(MF);
}

'''
cfg=cfg.replace('void WebAssemblyCFGStackify::rewriteDepthImmediates(MachineFunction &MF) {',method+'void WebAssemblyCFGStackify::rewriteDepthImmediates(MachineFunction &MF) {')
cfg=cfg.replace('  // Convert MBB operands in terminators to relative depth immediates.','  addGNUForcedGuards(MF);\n\n  // Convert MBB operands in terminators to relative depth immediates.')
# Concrete escaping scopes use a guard inside a distinct restoration scope:
# a tag1 thrown by stop in the guard handler must still pop/restore the caller.
cfg=cfg.replace('static void addNativeEHRouting(MachineFunction &MF) {',
                'static void addNativeEHRouting(MachineFunction &MF, Register GNUFrame, Register GNUContext) {')
cfg=cfg.replace('  addNativeEHRouting(MF);','  addNativeEHRouting(MF, GNUFrame, GNUContext);')
start=cfg.index('  auto *Handler = MF.CreateMachineBasicBlock();')
end=cfg.index('  // Preserve the original typed fallthrough',start)
original=cfg[start:end]
forced=r'''  if (GNUFrame) {
    auto &M=*MF.getFunction().getParent();
    auto *Guard=M.getFunction("__wasm_gnu_unwind_guard_v1");
    auto *Escape=M.getFunction("__wasm_gnu_unwind_escape_v1");
    auto *Terminal=M.getFunction("__wasm_gnu_unwind_terminal_v1");
    auto *Abort=M.getFunction("abort");
    if(!GNUContext || !Guard || !Escape || !Terminal || !Abort)
      report_fatal_error("missing coherent GNU escaping-frame providers");
    // Existing outer TRY is restoration. Insert an inner typed guard scope.
    BuildMI(Entry,Start,DebugLoc(),TII.get(WebAssembly::TRY)).addImm(int64_t(RetType));
    auto *GuardPad=MF.CreateMachineBasicBlock();GuardPad->setIsEHPad();
    auto *GuardEnd=MF.CreateMachineBasicBlock();
    for(auto &BB:MF) if(llvm::any_of(BB,[](const MachineInstr &MI) {
        return MI.isCall() || MI.getOpcode()==WebAssembly::RETHROW ||
               MI.getOpcode()==WebAssembly::THROW;
      })) BB.addSuccessor(GuardPad);
    MF.push_back(GuardPad);MF.push_back(GuardEnd);
    Register E=MRI.createVirtualRegister(&WebAssembly::I32RegClass);
    Register Active=MRI.createVirtualRegister(&WebAssembly::I32RegClass);
    BuildMI(*GuardPad,GuardPad->end(),DebugLoc(),TII.get(WebAssembly::CATCH_LEGACY),E)
        .addExternalSymbol(MF.createExternalSymbolName("__cpp_exception"));
    BuildMI(*GuardPad,GuardPad->end(),DebugLoc(),TII.get(WebAssembly::LOAD_I32),Active)
        .addImm(2).addImm(28).addReg(GNUFrame);
    BuildMI(*GuardPad,GuardPad->end(),DebugLoc(),TII.get(WebAssembly::GLOBAL_SET_I32))
        .addExternalSymbol(MF.createExternalSymbolName("__stack_pointer")).addReg(Active);
    BuildMI(*GuardPad,GuardPad->end(),DebugLoc(),TII.get(WebAssembly::CALL))
        .addGlobalAddress(Guard).addReg(GNUFrame).addReg(E).addReg(GNUContext);
    BuildMI(*GuardPad,GuardPad->end(),DebugLoc(),TII.get(WebAssembly::CALL))
        .addGlobalAddress(Terminal).addReg(GNUFrame).addReg(E).addReg(GNUContext);
    BuildMI(*GuardPad,GuardPad->end(),DebugLoc(),TII.get(WebAssembly::RETHROW)).addImm(0);
    BuildMI(*GuardEnd,GuardEnd->end(),DebugLoc(),TII.get(WebAssembly::END_TRY));
    SmallVector<MachineBasicBlock *,8> EscapeSources;
    for(auto &BB:MF) if(llvm::any_of(BB,[](const MachineInstr &MI) {
        return MI.isCall() || MI.getOpcode()==WebAssembly::RETHROW ||
               MI.getOpcode()==WebAssembly::THROW;
      })) EscapeSources.push_back(&BB);
    for(unsigned Reason : {2u,1u,0u}) {
      auto *H=MF.CreateMachineBasicBlock();H->setIsEHPad();
      auto *Fatal=MF.CreateMachineBasicBlock();auto *Done=MF.CreateMachineBasicBlock();
      MF.push_back(H);MF.push_back(Fatal);MF.push_back(Done);
      for(auto *P:EscapeSources) P->addSuccessor(H);
      Register Payload=MRI.createVirtualRegister(&WebAssembly::I32RegClass);
      if(Reason) BuildMI(*H,H->end(),DebugLoc(),TII.get(WebAssembly::CATCH_LEGACY),Payload)
          .addExternalSymbol(MF.createExternalSymbolName(Reason==2?"__cpp_exception":"__c_longjmp"));
      else BuildMI(*H,H->end(),DebugLoc(),TII.get(WebAssembly::CATCH_ALL_LEGACY));
      Register Zero=MRI.createVirtualRegister(&WebAssembly::I32RegClass);
      Register Why=MRI.createVirtualRegister(&WebAssembly::I32RegClass);
      Register Valid=MRI.createVirtualRegister(&WebAssembly::I32RegClass);
      BuildMI(*H,H->end(),DebugLoc(),TII.get(WebAssembly::CONST_I32),Zero).addImm(0);
      BuildMI(*H,H->end(),DebugLoc(),TII.get(WebAssembly::CONST_I32),Why).addImm(Reason);
      if(Reason==1) BuildMI(*H,H->end(),DebugLoc(),TII.get(WebAssembly::DROP_I32)).addReg(Payload);
      Register HandlerSP=MRI.createVirtualRegister(&WebAssembly::I32RegClass);
      BuildMI(*H,H->end(),DebugLoc(),TII.get(WebAssembly::LOAD_I32),HandlerSP)
          .addImm(2).addImm(28).addReg(GNUFrame);
      BuildMI(*H,H->end(),DebugLoc(),TII.get(WebAssembly::GLOBAL_SET_I32))
          .addExternalSymbol(MF.createExternalSymbolName("__stack_pointer")).addReg(HandlerSP);
      BuildMI(*H,H->end(),DebugLoc(),TII.get(WebAssembly::BLOCK)).addImm(int64_t(WebAssembly::BlockType::Void));
      BuildMI(*H,H->end(),DebugLoc(),TII.get(WebAssembly::CALL),Valid)
          .addGlobalAddress(Escape).addReg(GNUFrame).addReg(Why).addReg(Reason==2?Payload:Zero);
      // This newly added block is innermost: explicit relative depth0 is exact.
      BuildMI(*H,H->end(),DebugLoc(),TII.get(WebAssembly::BR_IF)).addImm(0).addReg(Valid);
      H->addSuccessor(Fatal);H->addSuccessor(Done);
      BuildMI(*Fatal,Fatal->end(),DebugLoc(),TII.get(WebAssembly::CALL)).addGlobalAddress(Abort);
      BuildMI(*Fatal,Fatal->end(),DebugLoc(),TII.get(WebAssembly::UNREACHABLE));
      BuildMI(*Done,Done->end(),DebugLoc(),TII.get(WebAssembly::END_BLOCK));
      BuildMI(*Done,Done->end(),DebugLoc(),TII.get(WebAssembly::GLOBAL_SET_I32))
          .addExternalSymbol(MF.createExternalSymbolName("__stack_pointer")).addReg(EntrySP);
      BuildMI(*Done,Done->end(),DebugLoc(),TII.get(WebAssembly::RETHROW)).addImm(0);
    }
    auto *End=MF.CreateMachineBasicBlock();MF.push_back(End);
    BuildMI(*End,End->end(),DebugLoc(),TII.get(WebAssembly::END_TRY));
  } else {
'''+original+'  }\n'
cfg=cfg[:start]+forced+cfg[end:]
paths={'llvm/lib/CodeGen/WasmEHPrepare.cpp':uw,'llvm/lib/Target/WebAssembly/WebAssemblyCFGStackify.cpp':cfg};patch=''
for path,after in paths.items():
 before=(T/'source'/('basis-'+pathlib.Path(path).name)).read_text();out=T/'source'/path;out.parent.mkdir(parents=True,exist_ok=True);out.write_text(after)
 patch+=''.join(difflib.unified_diff(before.splitlines(True),after.splitlines(True),fromfile='a/'+path,tofile='b/'+path))
(T/'logs'/PATCH_NAME).write_text(patch)
print(pin(T/'logs'/PATCH_NAME))
