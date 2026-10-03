#!/usr/bin/env python3
"""Retain consumer8 and require the producer's real scoped personality."""
import sys
sys.dont_write_bytecode = True
import difflib, shutil
from common import T, R, pin

root = T/'source/compiler-attempt9'
root.mkdir()
patch = ''
rows = []
for relative in ['llvm/lib/CodeGen/WasmEHPrepare.cpp',
                 'llvm/lib/Target/WebAssembly/WebAssemblyCFGStackify.cpp']:
    source = T/'source/compiler-attempt8'/relative
    text = source.read_text()
    if source.name == 'WasmEHPrepare.cpp':
        before = '  if (F.isDeclaration()) return false;\n  if (F.getFnAttribute("wasm-gnu-frame-records")'
        after = '''  if (F.isDeclaration()) return false;
  // GNUFrames must establish this before publishing the real descriptor.
  // Attaching a personality here would leave descriptor provenance stale.
  if (!F.hasPersonalityFn() ||
      !isScopedEHPersonality(classifyEHPersonality(F.getPersonalityFn())))
    report_fatal_error("GNU forced unwind requires a producer-owned scoped personality: " + F.getName());
  if (F.getFnAttribute("wasm-gnu-frame-records")'''
        assert text.count(before) == 1
        text = text.replace(before, after)
    target = root/relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text)
    basis = T/'source'/('basis-'+source.name)
    patch += ''.join(difflib.unified_diff(basis.read_text().splitlines(True),
                        text.splitlines(True), fromfile='a/'+relative, tofile='b/'+relative))
    rows.append({'basis':str(basis), 'basisPin':pin(basis),
                 'predecessor':str(source), 'predecessorPin':pin(source),
                 'output':str(target), 'outputPin':pin(target)})
patchpath = T/'logs/compiler-attempt9.patch'
assert not patchpath.exists()
patchpath.write_text(patch)
import json
proof = T/'logs/consumer9-source-plan.json'
proof.write_text(json.dumps({'compiled':False, 'sourcePins':rows,
    'recipe':{'path':str(R/'prepare-consumer9.py'), **pin(R/'prepare-consumer9.py')},
    'patch':{'path':str(patchpath), **pin(patchpath)},
    'change':'Consumer assertion only; no personality attachment or descriptor mutation.'},indent=2)+'\n')
print(json.dumps({'proof':str(proof), **pin(proof), 'patch':pin(patchpath)},indent=2))
