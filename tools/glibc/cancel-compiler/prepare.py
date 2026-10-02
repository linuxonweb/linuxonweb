#!/usr/bin/env python3
"""Create a sparse, reviewable prerequisite compiler overlay; no frozen edits."""
import pathlib,difflib,json,hashlib,os
T=pathlib.Path(os.environ.get('GLIBC_TASK','/mnt/p6/build/glibc-cancel-compiler-20261002'))
S=pathlib.Path('/mnt/p6/project/linux/.tmp-firefox-build/nix-local-store/nix/store/jkx0x4a4nlmnjm0kz9fiss33b7wh8z9k-source')
D=T/'source-snapshots/compiler';D.mkdir(parents=True,exist_ok=True)
changes={}
def edit(rel,transform):
 p=S/rel;old=p.read_text();new=transform(old);assert old!=new
 out=D/rel;out.parent.mkdir(parents=True,exist_ok=True);assert not out.exists();out.write_text(new)
 original=D/(rel+'.original');original.write_text(old)
 changes[rel]={'original':hashlib.sha256(old.encode()).hexdigest(),'owned':hashlib.sha256(new.encode()).hexdigest(),'path':str(out)}
 return ''.join(difflib.unified_diff(old.splitlines(True),new.splitlines(True),fromfile='a/'+rel,tofile='b/'+rel))
def replace(s,a,b):assert s.count(a)==1,(a,s.count(a));return s.replace(a,b)
helper='''
// Explicit prerequisite mode only: source cleanups must remain live at polls.
static llvm::cl::opt<bool> WasmGNUCancelPrerequisite(
    "wasm-gnu-cancel-prerequisite", llvm::cl::init(false),
    llvm::cl::desc("Experimental native Linux GNU cancellation prerequisites"));

void CodeGenFunction::EmitWasmGNUCancelSafepoint(unsigned Reason) {
  if (!WasmGNUCancelPrerequisite || !HaveInsertPoint())
    return;
  const auto &T = getTarget().getTriple();
  if (T.getArch() != llvm::Triple::wasm32 || !T.isOSLinux() ||
      !T.isGNUEnvironment() || !getLangOpts().Exceptions ||
      !CGM.getCodeGenOpts().hasWasmExceptions())
    llvm::report_fatal_error("GNU cancellation prerequisite requires wasm32 Linux GNU and native Wasm EH");
  if (CurFn->getName() == "__wasm_gnu_caller_sp_v1")
    llvm::report_fatal_error("compiler-owned GNU caller SP marker cannot be defined by source");
  CurFn->addFnAttr("wasm-gnu-cancel-prerequisite", "1");
  // Inlining/tail frame handoff is deliberately pending in this subset.
  CurFn->removeFnAttr(llvm::Attribute::AlwaysInline);
  CurFn->addFnAttr(llvm::Attribute::NoInline);
  CurFn->addFnAttr("disable-tail-calls", "true");
  llvm::Value *CallerSP = nullptr;
  for (auto &I : CurFn->getEntryBlock())
    if (auto *CB = llvm::dyn_cast<llvm::CallBase>(&I))
      if (CB->getCalledFunction() &&
          CB->getCalledFunction()->getName() == "__wasm_gnu_caller_sp_v1") {
        CallerSP = &I;
        break;
      }
  if (!CallerSP) {
    auto Capture = CGM.getModule().getOrInsertFunction(
        "__wasm_gnu_caller_sp_v1", llvm::FunctionType::get(Int32Ty, false));
    auto *CaptureFn = llvm::dyn_cast<llvm::Function>(Capture.getCallee());
    if (!CaptureFn || !CaptureFn->isDeclaration())
      llvm::report_fatal_error("invalid compiler-owned GNU caller SP declaration");
    auto *Call = Builder.CreateCall(Capture, {}, "wasm.gnu.caller.sp");
    Call->setDoesNotThrow();
    CallerSP = Call;
  }
  auto Poll = CGM.getModule().getOrInsertFunction(
      "__wasm_gnu_cancel_poll_v1",
      llvm::FunctionType::get(VoidTy, {Int32Ty, Int32Ty}, false));
  // Do not mark nounwind: EmitCallOrInvoke consumes the actual EH scope stack.
  auto *Call = EmitCallOrInvoke(Poll, {CallerSP, Builder.getInt32(Reason)});
  Call->setMetadata("wasm.gnu.cancel.poll.v1", llvm::MDNode::get(getLLVMContext(), {}));
}

'''
def stmt(s):
 s=replace(s,'#include <optional>','#include "llvm/Support/CommandLine.h"\n#include "llvm/Support/ErrorHandling.h"\n#include <optional>')
 s=replace(s,'void CodeGenFunction::EmitStopPoint(const Stmt *S) {',helper+'void CodeGenFunction::EmitStopPoint(const Stmt *S) {')
 s=replace(s,'  EmitBlock(LoopHeader.getBlock());\n','  EmitBlock(LoopHeader.getBlock());\n  EmitWasmGNUCancelSafepoint(1);\n')
 s=replace(s,'  if (CGM.shouldEmitConvergenceTokens())\n    ConvergenceTokenStack.push_back(emitConvergenceLoopToken(LoopBody));','  EmitWasmGNUCancelSafepoint(2);\n  if (CGM.shouldEmitConvergenceTokens())\n    ConvergenceTokenStack.push_back(emitConvergenceLoopToken(LoopBody));')
 # for and range headers share this exact block
 a='  EmitBlock(CondBlock);\n';assert s.count(a)==2;s=s.replace(a,a+'  EmitWasmGNUCancelSafepoint(3);\n')
 return s
patch=edit('clang/lib/CodeGen/CGStmt.cpp',stmt)
patch+=edit('clang/lib/CodeGen/CodeGenFunction.cpp',lambda s:replace(s,'  EmitFunctionProlog(*CurFnInfo, CurFn, Args);','  EmitFunctionProlog(*CurFnInfo, CurFn, Args);\n  EmitWasmGNUCancelSafepoint(0);'))
patch+=edit('clang/lib/CodeGen/CodeGenFunction.h',lambda s:replace(s,'  void EmitFunctionBody(const Stmt *Body);','  void EmitWasmGNUCancelSafepoint(unsigned Reason);\n  void EmitFunctionBody(const Stmt *Body);'))
backend='''
  SmallVector<MachineInstr *, 1> GNUCaptureMarkers;
  if (MF.getFunction().hasFnAttribute("wasm-gnu-cancel-prerequisite")) {
    if (MF.getTarget().getTargetTriple().getArch() != Triple::wasm32 ||
        !MF.getTarget().getTargetTriple().isOSLinux())
      report_fatal_error("GNU caller SP marker requires native wasm32 Linux");
    // SPReg holds global caller-entry SP here, before this frame's subtraction.
    // Every participating function remains noinline until frame handoff exists.
    Register CallerEntrySP = MRI.createVirtualRegister(PtrRC);
    BuildMI(MBB, InsertPt, DL, TII->get(WebAssembly::COPY), CallerEntrySP)
        .addReg(SPReg);
    unsigned Captures = 0;
    for (auto &BB : MF) {
      for (auto I = BB.begin(); I != BB.end();) {
        auto &MI = *I++;
        if (!MI.isCall())
          continue;
        bool Marker = false;
        for (const auto &MO : MI.operands()) {
          if (MO.isGlobal() && MO.getGlobal()->getName() == "__wasm_gnu_caller_sp_v1")
            Marker = true;
          if (MO.isSymbol() && StringRef(MO.getSymbolName()) == "__wasm_gnu_caller_sp_v1")
            Marker = true;
        }
        if (!Marker)
          continue;
        if (MI.getNumExplicitDefs() != 1 || !MI.getOperand(0).isReg())
          report_fatal_error("invalid GNU caller SP capture marker");
        BuildMI(BB, MI, MI.getDebugLoc(), TII->get(WebAssembly::COPY),
                MI.getOperand(0).getReg()).addReg(CallerEntrySP);
        GNUCaptureMarkers.push_back(&MI);
        ++Captures;
      }
    }
    if (Captures != 1)
      report_fatal_error("GNU caller SP prerequisite requires exactly one capture per frame");
  }
'''
def frame(s):
 s=replace(s,'#include "llvm/MC/MCAsmInfo.h"','#include "llvm/MC/MCAsmInfo.h"\n#include "llvm/Support/ErrorHandling.h"')
 s=replace(s,'  return MFI.getStackSize() || MFI.adjustsStack() || hasFP(MF) ||','  return MF.getFunction().hasFnAttribute("wasm-gnu-cancel-prerequisite") ||\n         MFI.getStackSize() || MFI.adjustsStack() || hasFP(MF) ||')
 s=replace(s,'  bool HasBP = hasBP(MF);',backend+'\n  bool HasBP = hasBP(MF);')
 s=replace(s,'    writeSPToGlobal(getSPReg(MF), MF, MBB, InsertPt, DL);\n  }\n}', '    writeSPToGlobal(getSPReg(MF), MF, MBB, InsertPt, DL);\n  }\n  // InsertPt may be the capture marker: erase only after prologue insertion.\n  for (auto *MI : GNUCaptureMarkers)\n    MI->eraseFromParent();\n}')
 return s
patch+=edit('llvm/lib/Target/WebAssembly/WebAssemblyFrameLowering.cpp',frame)
(T/'compiler.patch').write_text(patch)
(T/'source-changes.json').write_text(json.dumps(changes,indent=2)+'\n')
print(json.dumps({'patch':str(T/'compiler.patch'),'sha256':hashlib.sha256(patch.encode()).hexdigest(),'sources':changes},indent=2))
