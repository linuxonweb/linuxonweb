#!/usr/bin/env python3
"""Define actual marker destination in true machine entry before SP allocation."""
import difflib,json
from evidence import T,sha,budget

def main():
 budget(True);base=T/'module4-proposal-23';out=T/'module4-proposal-25';assert not out.exists();out.mkdir();pairs={}
 for basis in sorted((base/'source').rglob('*')):
  if not basis.is_file():continue
  rel=basis.relative_to(base/'source');dest=out/'source'/rel;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(basis.read_bytes());snap=out/'basis'/rel;snap.parent.mkdir(parents=True,exist_ok=True);snap.write_bytes(basis.read_bytes());pairs[str(rel)]={'basis':str(basis),'basisSnapshot':str(snap),'basisSha256':sha(basis),'path':str(dest),'ownedSha256':sha(dest)}
 rel='llvm/lib/Target/WebAssembly/WebAssemblyFrameLowering.cpp';basis=T/'records-patch-7/source'/rel;old=basis.read_text()
 needle='''        BuildMI(BB, MI, MI.getDebugLoc(), TII->get(WebAssembly::COPY),
                MI.getOperand(0).getReg()).addReg(CallerEntrySP);'''
 replacement='''        // SjLj dispatch may bypass the marker's original IR entry block.
        // Its unique result must be defined in true machine entry as well,
        // before any own-frame SP subtraction, and dominate retained returns.
        BuildMI(MBB, InsertPt, DL, TII->get(WebAssembly::COPY),
                MI.getOperand(0).getReg()).addReg(CallerEntrySP);'''
 assert old.count(needle)==1;new=old.replace(needle,replacement)
 dest=out/'source'/rel;dest.write_text(new);snap=out/'basis'/rel;snap.write_bytes(basis.read_bytes());pairs[rel]={'basis':str(basis),'basisSnapshot':str(snap),'basisSha256':sha(basis),'path':str(dest),'ownedSha256':sha(dest)}
 patch=out/'compiler.patch';patch.write_text(''.join(difflib.unified_diff(old.splitlines(True),new.splitlines(True),fromfile='a/'+rel,tofile='b/'+rel)))
 for name in ['module4-call-audit.cpp','module4-final-ir.cpp','jump-abi-v2.h','frame-abi.h','module4-runtime.c','jump-delivery-v2.c','jump-helpers-v2.c']:(out/name).write_bytes((base/name).read_bytes())
 proof={'compiled':False,'runtimeAcceptance':False,'sourcePairs':pairs,'patchSha256':sha(patch),'scope':'unique marker result dominates actual SjLj retained returns from real entry; callerSP unchanged','compileOnly':['WebAssemblyFrameLowering.cpp'],'storage':budget()};(out/'prepared.json').write_text(json.dumps(proof,indent=2)+'\n');print(json.dumps({'prepared':str(out/'prepared.json'),'sha256':sha(out/'prepared.json'),'patchSha256':sha(patch)}))
if __name__=='__main__':main()
