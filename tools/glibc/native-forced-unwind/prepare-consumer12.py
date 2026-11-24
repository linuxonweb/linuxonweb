#!/usr/bin/env python3
"""Consume only compiler-authenticated primitive2 admission, never names."""
import sys
sys.dont_write_bytecode = True
import json, difflib
from common import T, R, pin

root=T/'source/compiler-attempt12';root.mkdir()
rows=[];patch='';delta=''
for relative in ['llvm/lib/CodeGen/WasmEHPrepare.cpp',
                 'llvm/lib/Target/WebAssembly/WebAssemblyCFGStackify.cpp']:
    beforepath=T/'source/compiler-attempt11'/relative
    before=beforepath.read_text();after=before
    if beforepath.name=='WasmEHPrepare.cpp':
        old='  GNUForced = GNUForcedUnwind;'
        new='''  // This attribute is produced only by the external body-pin verifier.
  // GNUFrames rejects it in all incoming source/IR before authenticating it.
  const bool Primitive =
      F.getFnAttribute("wasm-gnu-provider-sealed").getValueAsString() == "2";
  if (Primitive && !isWebAssemblyGNUPrimitiveAuthenticated(F))
    report_fatal_error("GNU primitive skip lacks actual producer authentication");
  if (Primitive && F.hasFnAttribute("wasm-gnu-native-forced-unwind"))
    report_fatal_error("sealed GNU primitive cannot own forced guards");
  GNUForced = GNUForcedUnwind && !Primitive;'''
    else:
        old='''static void addNativeEHRouting(MachineFunction &MF, Register GNUFrame, Register GNUContext) {
  if (!NativeEHRouting)'''
        new='''static void addNativeEHRouting(MachineFunction &MF, Register GNUFrame, Register GNUContext) {
  // Actual sealed primitive bodies may not gain a stack-writing escape scope.
  // Final GNUFrames machine audits still cover their exact call closure.
  if (MF.getFunction().getFnAttribute("wasm-gnu-provider-sealed")
          .getValueAsString() == "2") {
    if (!isWebAssemblyGNUPrimitiveAuthenticated(MF.getFunction()))
      report_fatal_error("GNU native primitive skip lacks actual producer authentication");
    if (GNUFrame || GNUContext ||
        MF.getFunction().hasFnAttribute("wasm-gnu-native-forced-unwind"))
      report_fatal_error("sealed GNU primitive cannot own native frame guards");
    return;
  }
  if (!NativeEHRouting)'''
    assert after.count(old)==1
    after=after.replace(old,new)
    declaration = "\nnamespace llvm {\nbool isWebAssemblyGNUPrimitiveAuthenticated(const Function &F);\n}\n"
    anchor = "using namespace llvm;"
    assert after.count(anchor) == 1
    after = after.replace(anchor, anchor + declaration)
    output=root/relative;output.parent.mkdir(parents=True,exist_ok=True);output.write_text(after)
    basis=T/'source'/('basis-'+beforepath.name)
    patch+=''.join(difflib.unified_diff(basis.read_text().splitlines(True),after.splitlines(True),fromfile='a/'+relative,tofile='b/'+relative))
    delta+=''.join(difflib.unified_diff(before.splitlines(True),after.splitlines(True),fromfile='a/'+relative,tofile='b/'+relative))
    rows.append({'predecessor':str(beforepath),'predecessorPin':pin(beforepath),
                 'basis':str(basis),'basisPin':pin(basis),'output':str(output),'outputPin':pin(output)})
patchpath=T/'logs/compiler-attempt12.patch';patchpath.write_text(patch)
deltapath=T/'logs/compiler-attempt12-vs11.patch';deltapath.write_text(delta)
proof=T/'logs/consumer12-source-plan.json'
proof.write_text(json.dumps({'compiled':False,'sourcePins':rows,
    'recipe':{'path':str(R/'prepare-consumer12.py'),**pin(R/'prepare-consumer12.py')},
    'patch':{'path':str(patchpath),**pin(patchpath)},
    'delta':{'path':str(deltapath),**pin(deltapath)},
    'limits':'Requires producer authenticated external manifest and before/after-CFG primitive machine audits; Consumer queries actual validated producer Module/class membership even when incoming IR carries seal2; flags-off producer cannot grant it.'},indent=2)+'\n')
print(json.dumps({'proof':str(proof),**pin(proof),'delta':pin(deltapath)},indent=2))
