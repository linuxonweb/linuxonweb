#!/usr/bin/env python3
"""Preserve actual new SjLj handler's implicit unwind-to-caller calls."""
import difflib,json
from evidence import T,sha,budget

def main():
 budget(True);base=T/'module4-proposal-20';out=T/'module4-proposal-23';assert not out.exists();out.mkdir();pairs={};chunks=[]
 for basis in sorted((base/'source').rglob('*')):
  if not basis.is_file():continue
  rel=basis.relative_to(base/'source');old=basis.read_text();new=old
  if basis.name=='WebAssemblyLowerEmscriptenEHSjLj.cpp':
   needle='''        if (auto *CPI = dyn_cast<CatchPadInst>(FromPad)) {
          UnwindDest = CPI->getCatchSwitch()->getUnwindDest();
          break;
        }'''
   replacement='''        if (auto *CPI = dyn_cast<CatchPadInst>(FromPad)) {
          // The handler created above cannot catch its own helper throws.
          // Keep its actual funclet call's implicit unwind-to-caller edge;
          // native outer routing still owns escaping restoration/pop.
          if (F.getFnAttribute("wasm-gnu-frame-records").getValueAsString() == "4" &&
              CPI->getCatchSwitch() == CatchSwitchLongjmp) {
            if (!CatchSwitchLongjmp->unwindsToCaller())
              report_fatal_error("GNU owned SjLj catch has an unexpected parent unwind");
            break;
          }
          UnwindDest = CPI->getCatchSwitch()->getUnwindDest();
          break;
        }'''
   assert old.count(needle)==1;new=old.replace(needle,replacement)
   needle2='''    if (!UnwindDest)
      UnwindDest = CatchDispatchLongjmpBB;'''
   replacement2='''    if (!UnwindDest) {
      auto Bundle = CI->getOperandBundle(LLVMContext::OB_funclet);
      auto *Pad = Bundle ? dyn_cast<CatchPadInst>(Bundle->Inputs[0]) : nullptr;
      if (F.getFnAttribute("wasm-gnu-frame-records").getValueAsString() == "4" &&
          Pad && Pad->getCatchSwitch() == CatchSwitchLongjmp) {
        if (!CatchSwitchLongjmp->unwindsToCaller())
          report_fatal_error("GNU owned SjLj catch has an unexpected parent unwind");
        continue; // Real may-throw call; never an invoke back into its own pad.
      }
      UnwindDest = CatchDispatchLongjmpBB;
    }'''
   assert new.count(needle2)==1;new=new.replace(needle2,replacement2)
  dest=out/'source'/rel;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_text(new)
  snap=out/'basis'/rel;snap.parent.mkdir(parents=True,exist_ok=True);snap.write_bytes(basis.read_bytes())
  pairs[str(rel)]={'basis':str(basis),'basisSnapshot':str(snap),'basisSha256':sha(basis),'path':str(dest),'ownedSha256':sha(dest)}
  if new!=old:chunks.append(''.join(difflib.unified_diff(old.splitlines(True),new.splitlines(True),fromfile='a/'+str(rel),tofile='b/'+str(rel))))
 for name in ['module4-call-audit.cpp','module4-final-ir.cpp','jump-abi-v2.h','frame-abi.h','module4-runtime.c','jump-delivery-v2.c','jump-helpers-v2.c']:(out/name).write_bytes((base/name).read_bytes())
 patch=out/'compiler.patch';patch.write_text(''.join(chunks));proof={'compiled':False,'runtimeAcceptance':False,'basis':str(base),'sourcePairs':pairs,'patchSha256':sha(patch),'scope':'actual pass-owned SjLj catch parent edge; genuine calls remain allocating and maythrow','storage':budget()};(out/'prepared.json').write_text(json.dumps(proof,indent=2)+'\n');print(json.dumps({'prepared':str(out/'prepared.json'),'sha256':sha(out/'prepared.json'),'patchSha256':sha(patch)}))
if __name__=='__main__':main()
