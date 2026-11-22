#!/usr/bin/env python3
"""Canonical real record/context addresses in true prologue; source review only."""
import difflib,json
from evidence import T,sha,budget

def main():
 budget(True);base=T/'module4-proposal-27';out=T/'module4-proposal-29';assert not out.exists();out.mkdir();pairs={};chunks=[]
 for basis in sorted((base/'source').rglob('*')):
  if not basis.is_file():continue
  rel=basis.relative_to(base/'source');old=basis.read_text();new=old
  if basis.name=='WebAssemblyFrameLowering.cpp':
   needle='#include \"WebAssemblyTargetMachine.h\"\n';assert new.count(needle)==1
   new=new.replace(needle,needle+'#include \"WebAssemblyUtilities.h\"\n#include <cstdint>\n')
   needle='''  if (!needsSP(MF))
    return;
  uint64_t StackSize = MFI.getStackSize();'''
   assert new.count(needle)==1
   new=new.replace(needle,'''  // SjLj may resume without executing the original IR entry. Only the exact
  // generated Enter/Bind frame-index operands select canonical fixed objects.
  SmallVector<MachineOperand *, 2> GNURecordOperands;
  MachineOperand *GNUContextOperand = nullptr;
  int GNURecordFI = 0, GNUContextFI = 0;
  if (MF.getFunction().getFnAttribute("wasm-gnu-frame-records")
          .getValueAsString() == "4") {
    unsigned Enters = 0, Binds = 0;
    for (auto &BB : MF) for (auto &MI : BB) {
      if (!MI.isCall()) continue;
      const auto &Callee = WebAssembly::getCalleeOp(MI);
      StringRef Name;
      if (Callee.isGlobal()) Name = Callee.getGlobal()->getName();
      else if (Callee.isSymbol()) Name = Callee.getSymbolName();
      bool Enter = Name == "__wasm_gnu_frame_enter_v1";
      bool Bind = Name == "__wasm_gnu_unwind_bind_v1";
      if (!Enter && !Bind) continue;
      SmallVector<MachineOperand *, 4> Args;
      for (auto &MO : MI.operands())
        if ((MO.isReg() && MO.isUse() && !MO.isImplicit()) || MO.isFI())
          Args.push_back(&MO);
      if (Args.size() != (Enter ? 4u : 2u) || !Args[0]->isFI() ||
          (Enter && ++Enters != 1) || (Bind && ++Binds != 1))
        report_fatal_error("GNU fixed address lacks unique actual Enter/Bind FI operands");
      int RecordFI = Args[0]->getIndex();
      if (RecordFI < MFI.getObjectIndexBegin() || RecordFI >= MFI.getObjectIndexEnd() ||
          MFI.isDeadObjectIndex(RecordFI))
        report_fatal_error("GNU fixed record index is not a live frame object");
      const auto *Record = MFI.getObjectAllocation(RecordFI);
      if (!Record || !Record->getMetadata("wasm.gnu.frame.record.v1") ||
          MFI.getObjectSize(RecordFI) != 64 || MFI.getObjectAlign(RecordFI) < Align(16) ||
          MFI.getStackID(RecordFI) == TargetStackID::WasmLocal ||
          (!GNURecordOperands.empty() && RecordFI != GNURecordFI))
        report_fatal_error("GNU Enter/Bind do not identify the same real record64");
      GNURecordFI = RecordFI;
      GNURecordOperands.push_back(Args[0]);
      if (!Bind) continue;
      if (!Args[1]->isFI())
        report_fatal_error("GNU Bind context is not an actual fixed frame index");
      GNUContextFI = Args[1]->getIndex();
      if (GNUContextFI < MFI.getObjectIndexBegin() || GNUContextFI >= MFI.getObjectIndexEnd() ||
          MFI.isDeadObjectIndex(GNUContextFI))
        report_fatal_error("GNU Bind context index is not a live frame object");
      const auto *Context = MFI.getObjectAllocation(GNUContextFI);
      if (!Context || !Context->isStaticAlloca() || !Context->getMetadata("wasm.gnu.unwind.context.v1") ||
          MFI.getObjectSize(GNUContextFI) != 40 || MFI.getObjectAlign(GNUContextFI) < Align(4) ||
          MFI.getStackID(GNUContextFI) == TargetStackID::WasmLocal || GNUContextFI == GNURecordFI)
        report_fatal_error("GNU Bind does not identify its actual fixed context40");
      GNUContextOperand = Args[1];
    }
    if (Enters != 1 || Binds != 1 || GNURecordOperands.size() != 2 || !GNUContextOperand)
      report_fatal_error("GNU fixed addresses require unique actual Enter and Bind");
  }

'''+needle)
   needle='''  // InsertPt may be the capture marker: erase only after prologue insertion.''';assert new.count(needle)==1
   new=new.replace(needle,'''  if (!GNURecordOperands.empty()) {
    // Use the actual initialized fixed-frame base, never the abandoned global
    // SP of a dynamic allocation or an address definition in moved OrigEntry.
    auto FixedAddress = [&](int FI) {
      uint64_t Offset = StackSize + MFI.getObjectOffset(FI);
      if (Offset > UINT32_MAX)
        report_fatal_error("GNU fixed frame offset exceeds actual wasm32 address");
      Register Constant = MRI.createVirtualRegister(PtrRC);
      Register Address = MRI.createVirtualRegister(PtrRC);
      BuildMI(MBB, InsertPt, DL, TII->get(getOpcConst(MF)), Constant).addImm(Offset);
      BuildMI(MBB, InsertPt, DL, TII->get(getOpcAdd(MF)), Address)
          .addReg(hasFP(MF) ? getFPReg(MF) : getSPReg(MF)).addReg(Constant);
      return Address;
    };
    Register Record = FixedAddress(GNURecordFI);
    Register Context = FixedAddress(GNUContextFI);
    for (auto *MO : GNURecordOperands) MO->ChangeToRegister(Record, false);
    GNUContextOperand->ChangeToRegister(Context, false);
  }
'''+needle)
  dest=out/'source'/rel;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_text(new)
  snap=out/'basis'/rel;snap.parent.mkdir(parents=True,exist_ok=True);snap.write_bytes(basis.read_bytes());pairs[str(rel)]={'basis':str(basis),'basisSnapshot':str(snap),'basisSha256':sha(basis),'path':str(dest),'ownedSha256':sha(dest)}
  if new!=old:chunks.append(''.join(difflib.unified_diff(old.splitlines(True),new.splitlines(True),fromfile='a/'+str(rel),tofile='b/'+str(rel))))
 for name in ['module4-call-audit.cpp','module4-final-ir.cpp','jump-abi-v2.h','frame-abi.h','module4-runtime.c','jump-delivery-v2.c','jump-helpers-v2.c']:(out/name).write_bytes((base/name).read_bytes())
 patch=out/'compiler.patch';patch.write_text(''.join(chunks));proof={'compiled':False,'runtimeAcceptance':False,'sourcePairs':pairs,'patchSha256':sha(patch),'contextSelection':'actual unique Bind argument FI, not metadata name enumeration','storage':budget()};(out/'prepared.json').write_text(json.dumps(proof,indent=2)+'\n');print(json.dumps({'prepared':str(out/'prepared.json'),'sha256':sha(out/'prepared.json'),'patchSha256':sha(patch)}))
if __name__=='__main__':main()
