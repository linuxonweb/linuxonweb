#!/usr/bin/env python3
"""Authenticate actual direct FI or unique COPY_I32 of FI; source review only."""
import difflib,json
from evidence import T,sha,budget

def main():
 budget(True);base=T/'module4-proposal-29';out=T/'module4-proposal-30';assert not out.exists();out.mkdir();pairs={};chunks=[]
 for basis in sorted((base/'source').rglob('*')):
  if not basis.is_file():continue
  rel=basis.relative_to(base/'source');old=basis.read_text();new=old
  if basis.name=='WebAssemblyFrameLowering.cpp':
   needle='''    unsigned Enters = 0, Binds = 0;
    for (auto &BB : MF) for (auto &MI : BB) {''';assert new.count(needle)==1
   new=new.replace(needle,'''    unsigned Enters = 0, Binds = 0;
    auto ActualFI = [&](const MachineOperand &MO) {
      if (MO.isFI()) return MO.getIndex();
      if (MO.isReg() && MO.getReg().isVirtual()) {
        const auto *Def = MRI.getUniqueVRegDef(MO.getReg());
        if (Def && Def->getOpcode() == WebAssembly::COPY_I32 &&
            Def->getNumExplicitOperands() == 2 &&
            Def->getOperand(0).isReg() && Def->getOperand(0).isDef() &&
            Def->getOperand(0).getReg() == MO.getReg() &&
            Def->getOperand(1).isFI())
          return Def->getOperand(1).getIndex();
      }
      report_fatal_error("GNU fixed address lacks actual FI or unique COPY_I32 FI provenance");
    };
    for (auto &BB : MF) for (auto &MI : BB) {''')
   new=new.replace('Args.size() != (Enter ? 4u : 2u) || !Args[0]->isFI() ||','Args.size() != (Enter ? 4u : 2u) ||')
   new=new.replace('int RecordFI = Args[0]->getIndex();','int RecordFI = ActualFI(*Args[0]);')
   needle='''      if (!Args[1]->isFI())
        report_fatal_error("GNU Bind context is not an actual fixed frame index");
      GNUContextFI = Args[1]->getIndex();''';assert new.count(needle)==1
   new=new.replace(needle,'      GNUContextFI = ActualFI(*Args[1]);')
  dest=out/'source'/rel;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_text(new)
  snap=out/'basis'/rel;snap.parent.mkdir(parents=True,exist_ok=True);snap.write_bytes(basis.read_bytes());pairs[str(rel)]={'basis':str(basis),'basisSnapshot':str(snap),'basisSha256':sha(basis),'path':str(dest),'ownedSha256':sha(dest)}
  if new!=old:chunks.append(''.join(difflib.unified_diff(old.splitlines(True),new.splitlines(True),fromfile='a/'+str(rel),tofile='b/'+str(rel))))
 for name in ['module4-call-audit.cpp','module4-final-ir.cpp','jump-abi-v2.h','frame-abi.h','module4-runtime.c','jump-delivery-v2.c','jump-helpers-v2.c']:(out/name).write_bytes((base/name).read_bytes())
 patch=out/'compiler.patch';patch.write_text(''.join(chunks));proof={'compiled':False,'runtimeAcceptance':False,'sourcePairs':pairs,'patchSha256':sha(patch),'provenance':'direct FI or one unique COPY_I32 with exact FI source only','storage':budget()};(out/'prepared.json').write_text(json.dumps(proof,indent=2)+'\n');print(json.dumps({'prepared':str(out/'prepared.json'),'sha256':sha(out/'prepared.json'),'patchSha256':sha(patch)}))
if __name__=='__main__':main()
