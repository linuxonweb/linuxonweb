#!/usr/bin/env python3
"""Compose reviewed query3/C++ scoped operations2/actual-entry capture25."""
import difflib,json
from evidence import T,R,sha,budget

def main():
 budget(True);base=T/'module4-proposal-25';provider=T/'module4-proposal-21';out=T/'module4-proposal-26';assert not out.exists();out.mkdir();pairs={};chunks=[]
 assert sha(T/'cxx-operations-proposal-2/compiler.patch')=='e2ac057b675f5ebab3dc2805e97921d1b5becaea6585f1d81c3ffd9d059bccd1'
 for basis in sorted((base/'source').rglob('*')):
  if not basis.is_file():continue
  rel=basis.relative_to(base/'source');old=basis.read_text();new=old
  if basis.name in ['WebAssemblyGNUFrames.cpp','WebAssembly.h']:new=(provider/'source'/rel).read_text()
  if basis.name=='WebAssemblyGNUFrames.cpp':
   needle='namespace {\nclass WebAssemblyGNUFrames';assert new.count(needle)==1;new=new.replace(needle,(R/'cxx-eh-operations.cpp').read_text()+'\n'+needle)
   needle='''                 !gnuProviderIntrinsic(*F, Callee->getName())))''';assert new.count(needle)==1;new=new.replace(needle,'''                 !gnuProviderIntrinsic(*F, Callee->getName()) &&
                 !gnuSourceCatchOperation(*CB)))''')
  dest=out/'source'/rel;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_text(new);snap=out/'basis'/rel;snap.parent.mkdir(parents=True,exist_ok=True);snap.write_bytes(basis.read_bytes());pairs[str(rel)]={'basis':str(basis),'basisSnapshot':str(snap),'basisSha256':sha(basis),'path':str(dest),'ownedSha256':sha(dest)}
  if new!=old:chunks.append(''.join(difflib.unified_diff(old.splitlines(True),new.splitlines(True),fromfile='a/'+str(rel),tofile='b/'+str(rel))))
 for name in ['module4-call-audit.cpp','module4-final-ir.cpp','jump-abi-v2.h','frame-abi.h','module4-runtime.c','jump-delivery-v2.c','jump-helpers-v2.c']:(out/name).write_bytes((base/name).read_bytes())
 patch=out/'compiler.patch';patch.write_text(''.join(chunks));proof={'compiled':False,'runtimeAcceptance':False,'sourcePairs':pairs,'patchSha256':sha(patch),'reviewedComponents':['provider3','CXX2','LowerSjLj23','FrameLowering25'],'compileOnly':['WebAssemblyGNUFrames.cpp'],'storage':budget()};(out/'prepared.json').write_text(json.dumps(proof,indent=2)+'\n');print(json.dumps({'prepared':str(out/'prepared.json'),'sha256':sha(out/'prepared.json'),'patchSha256':sha(patch)}))
if __name__=='__main__':main()
