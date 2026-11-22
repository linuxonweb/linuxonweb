#!/usr/bin/env python3
"""Preserve authenticated owned call admission on actual SjLj Call->Invoke."""
import difflib,json
from evidence import T,sha,budget

def main():
 budget(True);base=T/'module4-proposal-31';out=T/'module4-proposal-32';out.mkdir();pairs={};chunks=[]
 for basis in sorted((base/'source').rglob('*')):
  if not basis.is_file():continue
  rel=basis.relative_to(base/'source');old=basis.read_text();new=old
  if basis.name=='WebAssemblyLowerEmscriptenEHSjLj.cpp':
   needle='''    changeToInvokeAndSplitBasicBlock(CI, UnwindDest);''';assert new.count(needle)==1
   new=new.replace(needle,'''    MDNode *GNUAdmitted = nullptr, *GNUPoll = nullptr;
    if (F.getFnAttribute("wasm-gnu-frame-records").getValueAsString() == "4") {
      GNUAdmitted = CI->getMetadata("wasm.gnu.call.admitted.v1");
      GNUPoll = CI->getMetadata("wasm.gnu.cancel.poll.v1");
      if (GNUAdmitted) {
        auto *Admission = dyn_cast_or_null<CallInst>(CI->getPrevNode());
        if (GNUAdmitted->getNumOperands() || !Admission ||
            !Admission->getCalledFunction() ||
            Admission->getCalledFunction()->getName() != "__wasm_gnu_frame_admit_call_v1" ||
            !Admission->getType()->isVoidTy() || Admission->arg_size() != 1 ||
            Admission->getArgOperand(0) != CI->getCalledOperand())
          report_fatal_error("GNU SjLj conversion lacks the actual adjacent call admission");
      }
      if (GNUPoll && (!GNUAdmitted || GNUPoll->getNumOperands() ||
          !CI->getCalledFunction() ||
          CI->getCalledFunction()->getName() != "__wasm_gnu_cancel_poll_v1" ||
          !CI->getType()->isVoidTy() || CI->arg_size() != 2 ||
          !CI->getArgOperand(0)->getType()->isIntegerTy(32) ||
          !isa<ConstantInt>(CI->getArgOperand(1)) ||
          !CI->getArgOperand(1)->getType()->isIntegerTy(32) ||
          cast<ConstantInt>(CI->getArgOperand(1))->getZExtValue() > 3))
        report_fatal_error("GNU SjLj conversion lacks the actual early poll");
    }
    BasicBlock *CallBlock = CI->getParent();
    changeToInvokeAndSplitBasicBlock(CI, UnwindDest);
    if (GNUAdmitted || GNUPoll) {
      auto *II = dyn_cast<InvokeInst>(CallBlock->getTerminator());
      if (!II) report_fatal_error("GNU SjLj conversion lost the actual invoke");
      II->setMetadata("wasm.gnu.call.admitted.v1", GNUAdmitted);
      II->setMetadata("wasm.gnu.cancel.poll.v1", GNUPoll);
    }''')
  dest=out/'source'/rel;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_text(new)
  snap=out/'basis'/rel;snap.parent.mkdir(parents=True,exist_ok=True);snap.write_bytes(basis.read_bytes());pairs[str(rel)]={'basis':str(basis),'basisSnapshot':str(snap),'basisSha256':sha(basis),'path':str(dest),'ownedSha256':sha(dest)}
  if new!=old:chunks.append(''.join(difflib.unified_diff(old.splitlines(True),new.splitlines(True),fromfile='a/'+str(rel),tofile='b/'+str(rel))))
 for name in ['module4-call-audit.cpp','module4-final-ir.cpp','jump-abi-v2.h','frame-abi.h','module4-runtime.c','jump-delivery-v2.c','jump-helpers-v2.c']:(out/name).write_bytes((base/name).read_bytes())
 patch=out/'compiler.patch';patch.write_text(''.join(chunks));proof={'compiled':False,'runtimeAcceptance':False,'sourcePairs':pairs,'patchSha256':sha(patch),'scope':'actual owned adjacent admission and early poll metadata preservation; no machine audit exemption','storage':budget()};(out/'prepared.json').write_text(json.dumps(proof,indent=2)+'\n');print(json.dumps({'prepared':str(out/'prepared.json'),'sha256':sha(out/'prepared.json'),'patchSha256':sha(patch)}))
if __name__=='__main__':main()
