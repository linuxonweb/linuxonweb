#!/usr/bin/env python3
"""Exact C++ scoped frontend intrinsic validation over frozen20 producer."""
import difflib,json
from evidence import T,R,sha,budget

def main():
 budget(True);base=T/'module4-proposal-20';out=T/'cxx-operations-proposal-2';assert not out.exists();out.mkdir()
 rel='llvm/lib/Target/WebAssembly/WebAssemblyGNUFrames.cpp';basis=base/'source'/rel;old=basis.read_text()
 needle='namespace {\nclass WebAssemblyGNUFrames';assert old.count(needle)==1
 new=old.replace(needle,(R/'cxx-eh-operations.cpp').read_text()+'\n'+needle)
 needle='''                Callee->getName().starts_with("llvm.wasm."))''';assert new.count(needle)==1
 new=new.replace(needle,'''                (Callee->getName().starts_with("llvm.wasm.") &&
                 !gnuSourceCatchOperation(*CB)))''')
 dest=out/'source'/rel;dest.parent.mkdir(parents=True);dest.write_text(new);snap=out/'basis'/rel;snap.parent.mkdir(parents=True);snap.write_bytes(basis.read_bytes())
 patch=out/'compiler.patch';patch.write_text(''.join(difflib.unified_diff(old.splitlines(True),new.splitlines(True),fromfile='a/'+rel,tofile='b/'+rel)))
 proof={'compiled':False,'runtimeAcceptance':False,'patchSha256':sha(patch),'sourcePairs':{rel:{'basis':str(basis),'basisSnapshot':str(snap),'basisSha256':sha(basis),'path':str(dest),'ownedSha256':sha(dest)}},'actualFrontendIR':{'path':str(T/'cxx-frontend-provenance-1/front.ll'),'sha256':sha(T/'cxx-frontend-provenance-1/front.ll')},'storage':budget()};(out/'prepared.json').write_text(json.dumps(proof,indent=2)+'\n');print(json.dumps({'prepared':str(out/'prepared.json'),'sha256':sha(out/'prepared.json'),'patchSha256':sha(patch)}))
if __name__=='__main__':main()
