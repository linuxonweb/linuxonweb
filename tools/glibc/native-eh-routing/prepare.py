#!/usr/bin/env python3
import sys
sys.dont_write_bytecode=True
from common import *
import difflib
target=S/'llvm/lib/Target/WebAssembly'
original=(target/'WebAssemblyCFGStackify.cpp').read_text()
text=original.replace('#include "llvm/MC/MCAsmInfo.h"','#include "llvm/MC/MCAsmInfo.h"\n#include "llvm/Support/CommandLine.h"\n#include "llvm/Support/ErrorHandling.h"')
needle='STATISTIC(NumCatchUnwindMismatches, "Number of catch unwind mismatches found");'
assert text.count(needle)==1
text=text.replace(needle,needle+'''

static cl::opt<bool> NativeEHRouting(
    "wasm-native-eh-routing", cl::Hidden, cl::init(false),
    cl::desc("Restore native escaping frames and bypass SjLj in catch-all"));

// Runs after all original scope/depth decisions, before explicit locals.
// The added outer scope is outside every existing branch target; no existing
// branch/rethrow depth changes. Entry SP is read before the actual prologue.
static void addNativeEHRouting(MachineFunction &MF) {
  if (!NativeEHRouting)
    return;
  const auto &Triple = MF.getTarget().getTargetTriple();
  if (Triple.getArch() != Triple::wasm32 || !Triple.isOSLinux() ||
      !Triple.isGNUEnvironment())
    report_fatal_error("native EH routing requires wasm32 Linux GNU");
  if (!WebAssembly::WasmUseLegacyEH ||
      MF.getTarget().getMCAsmInfo()->getExceptionHandlingType() !=
          ExceptionHandling::Wasm)
    report_fatal_error("native EH routing currently requires legacy Wasm EH");
  const auto &ST = MF.getSubtarget<WebAssemblySubtarget>();
  if (ST.hasAddr64())
    report_fatal_error("native EH routing currently requires wasm32");
  const auto &TII = *ST.getInstrInfo();
  auto &MRI = MF.getRegInfo();
  // Tag1 is a nonlocal jump. An original catch_all must never treat it as a
  // language/foreign exception; the real enclosing SjLj tag1 handler remains.
  SmallVector<MachineInstr *, 8> CatchAlls;
  for (auto &MBB : MF)
    for (auto &MI : MBB)
      if (MI.getOpcode() == WebAssembly::CATCH_ALL_LEGACY)
        CatchAlls.push_back(&MI);
  for (auto *CatchAll : CatchAlls) {
    auto *OriginalCatch = CatchAll->getParent();
    auto *Bypass = MF.CreateMachineBasicBlock();
    Bypass->setIsEHPad();
    MF.insert(OriginalCatch->getIterator(), Bypass);
    // Preserve bytecode order if the original EH block begins with structural
    // END_* markers or labels: these still precede both catch alternatives.
    Bypass->splice(Bypass->end(), OriginalCatch, OriginalCatch->begin(),
                   CatchAll->getIterator());
    // Preserve the original EH pad, body, successors, and incoming unwind
    // edges. The added alternative has the same incoming unwind sources.
    SmallVector<MachineBasicBlock *, 8> Preds(OriginalCatch->pred_begin(),
                                             OriginalCatch->pred_end());
    for (auto *Pred : Preds)
      Pred->addSuccessor(Bypass);
    for (auto *Succ : OriginalCatch->successors())
      if (Succ->isEHPad())
        Bypass->addSuccessor(Succ);
    Register Payload = MRI.createVirtualRegister(&WebAssembly::I32RegClass);
    BuildMI(*Bypass, Bypass->end(), CatchAll->getDebugLoc(),
            TII.get(WebAssembly::CATCH_LEGACY))
        .addReg(Payload, RegState::Define)
        .addExternalSymbol(MF.createExternalSymbolName("__c_longjmp"));
    BuildMI(*Bypass, Bypass->end(), CatchAll->getDebugLoc(),
            TII.get(WebAssembly::DROP_I32)).addReg(Payload);
    BuildMI(*Bypass, Bypass->end(), CatchAll->getDebugLoc(),
            TII.get(WebAssembly::RETHROW)).addImm(0);
  }
  Register EntrySP = MRI.createVirtualRegister(&WebAssembly::I32RegClass);
  auto &Entry = MF.front();
  auto Start = Entry.begin();
  while (Start != Entry.end() && WebAssembly::isArgument(Start->getOpcode()))
    ++Start;
  BuildMI(Entry, Start, DebugLoc(), TII.get(WebAssembly::GLOBAL_GET_I32), EntrySP)
      .addExternalSymbol(MF.createExternalSymbolName("__stack_pointer"));
  const auto &Results = MF.getInfo<WebAssemblyFunctionInfo>()->getResults();
  WebAssembly::BlockType RetType =
      Results.empty() ? WebAssembly::BlockType::Void
      : Results.size() > 1 ? WebAssembly::BlockType::Multivalue
      : WebAssembly::BlockType(WebAssembly::toValType(Results.front()));
  BuildMI(Entry, Start, DebugLoc(), TII.get(WebAssembly::TRY))
      .addImm(int64_t(RetType));
  // Keep native terminators last in each machine block. The new catch and
  // merge use separate blocks, preserving post-stackify machine verification.
  auto *Handler = MF.CreateMachineBasicBlock();
  auto *Merge = MF.CreateMachineBasicBlock();
  Handler->setIsEHPad();
  // Existing scoped instructions determine exact native dispatch. Record the
  // possible escape edge from each block containing a call/throw/rethrow, so
  // the real entry SP definition dominates the added native handler.
  for (auto &MBB : MF)
    if (llvm::any_of(MBB, [](const MachineInstr &MI) {
          return MI.isCall() || MI.getOpcode() == WebAssembly::RETHROW ||
                 MI.getOpcode() == WebAssembly::THROW;
        }))
      MBB.addSuccessor(Handler);
  MF.push_back(Handler);
  MF.push_back(Merge);
  auto &Last = *Handler;
  BuildMI(Last, Last.end(), DebugLoc(), TII.get(WebAssembly::CATCH_ALL_LEGACY));
  BuildMI(Last, Last.end(), DebugLoc(), TII.get(WebAssembly::GLOBAL_SET_I32))
      .addExternalSymbol(MF.createExternalSymbolName("__stack_pointer"))
      .addReg(EntrySP);
  BuildMI(Last, Last.end(), DebugLoc(), TII.get(WebAssembly::RETHROW)).addImm(0);
  BuildMI(*Merge, Merge->end(), DebugLoc(), TII.get(WebAssembly::END_TRY));
  // Preserve the original typed fallthrough at function end. Original
  // explicit returns still exit directly; the outer typed end has exactly the
  // function result signature, including any existing typed end markers.
}
''')
needle='  // Add an end instruction at the end of the function body.'
assert text.count(needle)==1
text=text.replace(needle,'  addNativeEHRouting(MF);\n\n'+needle)
(T/'source/WebAssemblyCFGStackify-original.cpp').write_text(original)
(T/'source/WebAssemblyCFGStackify.cpp').write_text(text)
(T/'logs/compiler.patch').write_text(''.join(difflib.unified_diff(original.splitlines(True),text.splitlines(True),fromfile='llvm/lib/Target/WebAssembly/WebAssemblyCFGStackify.cpp',tofile='llvm/lib/Target/WebAssembly/WebAssemblyCFGStackify.cpp')))
for name in ['llc.cpp','NewPMDriver.cpp','NewPMDriver.h']:
 (T/'source'/name).write_bytes((S/'llvm/tools/llc'/name).read_bytes())
(T/'source/baseline-routes.bc').write_bytes((P/'objects/routes.bc').read_bytes())
(T/'logs/initial-inspection-failure.json').write_text(json.dumps({'scope':'Initial read-only llc inspection referenced nonexistent predecessor routes.adapted.bc; actual retained input is routes.bc. No output produced and no predecessor was modified. Initial shell-tool command was outside task supervisor, so no task PID/group record is claimed.'},indent=2)+'\n')
run('baseline-mir',[L/'bin/llc','-mattr=+atomics,+bulk-memory,+exception-handling','-exception-model=wasm','-wasm-enable-eh','-wasm-enable-sjlj','-stop-after=wasm-late-eh-prepare',T/'source/baseline-routes.bc','-o',T/'source/baseline.mir'])
print('owned minimal patch and original baseline prepared')
