#!/usr/bin/env python3
"""Fresh include-only repair; preserves failed coherent26 source/build."""
import difflib,json
from evidence import T,sha,budget

def main():
 budget(True);base=T/'module4-proposal-26';out=T/'module4-proposal-27';assert not out.exists();out.mkdir();pairs={};chunks=[]
 for basis in sorted((base/'source').rglob('*')):
  if not basis.is_file():continue
  rel=basis.relative_to(base/'source');old=basis.read_text();new=old
  if basis.name=='WebAssemblyGNUFrames.cpp':
   needle='#include "llvm/IR/Intrinsics.h"\n';assert new.count(needle)==1
   new=new.replace(needle,needle+'#include "llvm/IR/IntrinsicsWebAssembly.h"\n')
  dest=out/'source'/rel;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_text(new)
  snap=out/'basis'/rel;snap.parent.mkdir(parents=True,exist_ok=True);snap.write_bytes(basis.read_bytes())
  pairs[str(rel)]={'basis':str(basis),'basisSnapshot':str(snap),'basisSha256':sha(basis),'path':str(dest),'ownedSha256':sha(dest)}
  if new!=old:chunks.append(''.join(difflib.unified_diff(old.splitlines(True),new.splitlines(True),fromfile='a/'+str(rel),tofile='b/'+str(rel))))
 for name in ['module4-call-audit.cpp','module4-final-ir.cpp','jump-abi-v2.h','frame-abi.h','module4-runtime.c','jump-delivery-v2.c','jump-helpers-v2.c']:(out/name).write_bytes((base/name).read_bytes())
 patch=out/'compiler.patch';patch.write_text(''.join(chunks))
 proof={'compiled':False,'runtimeAcceptance':False,'sourcePairs':pairs,'patchSha256':sha(patch),'basisFailure':'module4-proposal-26 missing IntrinsicsWebAssembly.h','storage':budget()}
 (out/'prepared.json').write_text(json.dumps(proof,indent=2)+'\n')
 print(json.dumps({'prepared':str(out/'prepared.json'),'sha256':sha(out/'prepared.json'),'patchSha256':sha(patch)}))
if __name__=='__main__':main()
