#!/usr/bin/env python3
"""Add a one-time actual-PBL-entry marker to a coherent candidate, in new files.

This diagnostic candidate is for proving interpreter entry, not final timing or
deployment. The uninstrumented candidate, sources and objects are unchanged.
"""
import argparse
import difflib
import hashlib
import json
import os
from pathlib import Path
import shlex
import signal
import subprocess
import time

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--candidate',type=Path,required=True)
parser.add_argument('--output',type=Path,required=True)
parser.add_argument('--timeout',type=int,default=900)
args=parser.parse_args()
if not 1<=args.timeout<=900:parser.error('timeout must be 1..900 seconds')
candidate,out=args.candidate.resolve(),args.output.resolve()
if out==candidate or candidate in out.parents:parser.error('use a separate output directory')
report=json.loads((candidate/'report.json').read_text())
if not report.get('pass'):parser.error('coherent candidate must have completed successfully')
with Path(report['candidate']).open('rb') as stream:
    if hashlib.file_digest(stream,'sha256').hexdigest()!=report['sha256']:
        parser.error('coherent candidate hash mismatch')
plan=json.loads((candidate/'plan.json').read_text())
task=next(t for t in plan['tasks'] if t['name']=='PortableBaselineInterpret.o')
source=Path(task['source']);original=source.read_text()
needle='                                Value* result) {\n  State state(cx);'
if original.count(needle)!=1:parser.error('unexpected PBL trampoline source')
text=original.replace(needle,'''                                Value* result) {
  static std::atomic_flag announced = ATOMIC_FLAG_INIT;
  if (!announced.test_and_set(std::memory_order_relaxed)) {
    fputs("[WASM_PBL] PortableBaselineTrampoline entered\\n", stderr);
  }
  State state(cx);''')
text='#include <atomic>\n#include <stdio.h>\n'+text
out.mkdir(parents=True,exist_ok=True)
if (out/'report.json').exists():parser.error('use a fresh diagnostic directory')
copy=out/'PortableBaselineInterpret.cpp';copy.write_text(text)
(out/'diagnostic.patch').write_text(''.join(difflib.unified_diff(original.splitlines(True),text.splitlines(True),fromfile=str(source),tofile=str(copy))))
started=time.monotonic()
def run(command,name,cwd):
    (out/(name+'.command.txt')).write_text(shlex.join(command)+'\n')
    env=os.environ.copy();env['TMPDIR']=str(out)
    remaining=args.timeout-(time.monotonic()-started)
    if remaining<=0:raise TimeoutError('diagnostic build deadline exceeded')
    with (out/(name+'.log')).open('w') as log:
        process=subprocess.Popen(command,cwd=cwd,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
        try:
            status=process.wait(timeout=min(remaining,600))
        except subprocess.TimeoutExpired:
            os.killpg(process.pid,signal.SIGKILL);process.wait();raise
    if status:raise RuntimeError(name+' failed; see '+str(out/(name+'.log')))
    print(name+' passed',flush=True)
result={'pass':False,'scope':'actual PBL entry diagnostic; never use for final performance timing',
        'baseCandidateSHA256':report['sha256'],'marker':'[WASM_PBL] PortableBaselineTrampoline entered'}
try:
    command=task['command'].copy();new_object=out/'PortableBaselineInterpret.o'
    command[command.index('-o')+1]=str(new_object)
    if command.count(str(source))!=1:raise RuntimeError('unexpected diagnostic translation input')
    command[command.index(str(source))]=str(copy)
    run(command,'compile',task['cwd'])
    old_object=task['output']
    members=shlex.split((candidate/'libjs.list').read_text())
    if members.count(old_object)!=1:raise RuntimeError('unexpected PBL archive membership')
    members[members.index(old_object)]=str(new_object)
    archive_list=out/'libjs.list';archive_list.write_text('\n'.join(shlex.quote(p) for p in members)+'\n')
    archive=out/'libjs_static.a'
    run(['llvm-ar','crs',str(archive),'@'+str(archive_list)],'archive',out)
    command=shlex.split((candidate/'logs/link.command.txt').read_text())
    old_archive=str(candidate/'libjs_static.a')
    if command.count(old_archive)!=1:raise RuntimeError('unexpected coherent archive link')
    command[command.index(old_archive)]=str(archive)
    raw=out/'firefox-pbl-diagnostic-raw.wasm';command[command.index('-o')+1]=str(raw)
    run(command,'link',Path(plan['objects'])/'browser/app')
    final=out/'firefox-pbl-diagnostic.wasm'
    run(['wasm-opt','--all-features','--disable-compact-imports','--pass-arg=max-func-params@23',
         '--fpcast-emu',str(raw),'-o',str(final)],'fpcast',out)
    run(['wasm-validate','--enable-all',str(final)],'validate',out)
    with final.open('rb') as stream:sha=hashlib.file_digest(stream,'sha256').hexdigest()
    result.update({'pass':True,'candidate':str(final),'sha256':sha,'bytes':final.stat().st_size})
except Exception as error:
    result['error']=str(error)
finally:
    result['elapsedSeconds']=round(time.monotonic()-started,2)
    (out/'report.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result),flush=True)
raise SystemExit(0 if result['pass'] else 1)
