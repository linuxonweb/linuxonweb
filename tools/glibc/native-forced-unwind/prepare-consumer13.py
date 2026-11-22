#!/usr/bin/env python3
"""Authenticate duplicate pure i32 handle casts from the same native catch SSA."""
import sys
sys.dont_write_bytecode=True
import difflib,json
from common import T,R,pin

root=T/'source/compiler-attempt13';root.mkdir()
rows=[];patch='';delta=''
for relative in ['llvm/lib/CodeGen/WasmEHPrepare.cpp',
                 'llvm/lib/Target/WebAssembly/WebAssemblyCFGStackify.cpp']:
    beforepath=T/'source/compiler-attempt12'/relative
    before=beforepath.read_text();after=before
    if beforepath.name=='WasmEHPrepare.cpp':
        old='''         Resolve->arg_size()==1 && Resolve->getArgOperand(0)==Handle &&
         Resolve->getMetadata("wasm.gnu.tag1.resolve.v2")) {'''
        new='''         Resolve->arg_size()==1 &&
         Resolve->getMetadata("wasm.gnu.tag1.resolve.v2")) {
        // WinEHPrepare may duplicate this pure cast in the matching edge.
        // Both casts must encode the exact same native catch SSA, never a
        // loaded/phi/reconstructed handle or a mutable delivery field.
        auto *ResolverHandle=dyn_cast<PtrToIntInst>(Resolve->getArgOperand(0));
        if(!ResolverHandle || !Handle->getType()->isIntegerTy(32) ||
           !ResolverHandle->getType()->isIntegerTy(32) ||
           ResolverHandle->getOperand(0)!=Raw ||
           !DT.dominates(ResolverHandle,Resolve)) continue;'''
        assert after.count(old)==1
        after=after.replace(old,new)
    output=root/relative;output.parent.mkdir(parents=True,exist_ok=True)
    output.write_text(after)
    basis=T/'source'/('basis-'+beforepath.name)
    patch+=''.join(difflib.unified_diff(basis.read_text().splitlines(True),after.splitlines(True),fromfile='a/'+relative,tofile='b/'+relative))
    delta+=''.join(difflib.unified_diff(before.splitlines(True),after.splitlines(True),fromfile='a/'+relative,tofile='b/'+relative))
    rows.append({'predecessor':str(beforepath),'predecessorPin':pin(beforepath),
                 'basis':str(basis),'basisPin':pin(basis),'output':str(output),'outputPin':pin(output)})
patchpath=T/'logs/compiler-attempt13.patch';patchpath.write_text(patch)
deltapath=T/'logs/compiler-attempt13-vs12.patch';deltapath.write_text(delta)
evidence=T/'logs/consumer-coherent1-target-O2-pre-consumer-ir-attempt1.log'
proof=T/'logs/consumer13-source-plan.json'
proof.write_text(json.dumps({'compiled':False,'sourcePins':rows,
    'recipe':{'path':str(R/'prepare-consumer13.py'),**pin(R/'prepare-consumer13.py')},
    'actualFailureIR':{'path':str(evidence),**pin(evidence)},
    'patch':{'path':str(patchpath),**pin(patchpath)},
    'delta':{'path':str(deltapath),**pin(deltapath)},
    'limits':'Exact i32 PtrToInt of the SAME native catch SSA only; no load/phi/cast stripping. Existing metadata, resolver uniqueness, authenticated non-null edge, Env/Version offsets and dominance checks remain.'},indent=2)+'\n')
print(json.dumps({'proof':str(proof),**pin(proof),'delta':pin(deltapath)},indent=2))
