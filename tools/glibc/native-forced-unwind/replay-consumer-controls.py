#!/usr/bin/env python3
"""Replay an unchanged finite suite against an explicit new coherent compiler."""
import sys
sys.dont_write_bytecode=True
import argparse,json
from pathlib import Path
from common_consumer13 import T,R,pin

parser=argparse.ArgumentParser()
parser.add_argument('--compiler',required=True)
parser.add_argument('--compiler-sha256',required=True)
parser.add_argument('--version',required=True)
parser.add_argument('--suite',choices=['sjlj','normal','cxx','forged','cxx-negative'],required=True)
args=parser.parse_args()
assert args.version.isalnum()
compiler=Path(args.compiler).resolve()
assert compiler.is_relative_to(T.parent)
assert pin(compiler)['sha256']==args.compiler_sha256
original=R/f'test-consumer13-{args.suite}.py'
text=original.read_text()
# Preserve the exact reviewed flags, assertions and diagnostic requirements.
# The sole semantic selection change is the explicitly hashed driver path;
# fresh result/output names preserve the previous executed failures.
old="compiler=T/'objects/compiler-consumer13-continuation/clang'"
if old not in text:old="compiler = T/'objects/compiler-consumer13-continuation/clang'"
assert text.count(old)==1
text=text.replace(old,'compiler=__import__(\'pathlib\').Path('+repr(str(compiler))+')')
prefix=f'consumer13-replay{args.version}'
text=text.replace('consumer13-continuation',prefix)
directory=T/'source'/f'{prefix}-{args.suite}-recipe';directory.mkdir()
recipe=directory/'replay.py';recipe.write_text(text)
proof={'scope':'unchanged finite compiler suite; no runtime acceptance',
       'compiler':{'path':str(compiler),**pin(compiler)},
       'original':{'path':str(original),**pin(original)},
       'recipe':{'path':str(recipe),**pin(recipe)},
       'launcher':{'path':str(R/'replay-consumer-controls.py'),**pin(R/'replay-consumer-controls.py')},
       'selectedSuite':args.suite,'resultPrefix':prefix,
       'changes':['explicit pinned driver','fresh result, stage and output names']}
(directory/'plan.json').write_text(json.dumps(proof,indent=2)+'\n')
exec(compile(text,str(recipe),'exec'),{'__name__':'__main__','__file__':str(recipe)})
