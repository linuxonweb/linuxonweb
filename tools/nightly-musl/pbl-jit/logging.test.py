#!/usr/bin/env python3
"""Execute extracted production IC/method logging controls with real stderr.

Small host types supply CacheOp names and mismatch operands, not JIT behavior.
The production initialization, detail budgets, stats/step function and mismatch
block are compiled verbatim. No guest or generated-code acceptance is claimed.
"""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess

p=argparse.ArgumentParser()
p.add_argument('--source',type=Path,required=True)
p.add_argument('--output',type=Path,required=True)
a=p.parse_args();a.output.mkdir(parents=True,exist_ok=False)
ic=(a.source/'PblIc.inc').read_text();bc=(a.source/'PblMethod.inc').read_text()
ic_controls=ic[ic.index('enum : uint32_t { kStatEntries'):ic.index('// Slot stores that may need GC barriers')]
bc_controls=bc[bc.index('std::atomic<int> gEnabled{-1};'):bc.index('// Frame field offsets from the BaselineFrame')]
start=bc.index('    if (gMismatch++ < 20');end=bc.index('\n    return kPending;',start)
mismatch=bc[start:end]
hits=re.search(r'constexpr uint32_t kHits = (\d+);',ic).group(0)
program='''#include <atomic>
#include <cstdio>
#include <cstdlib>
#include <cstdint>
#include <cstddef>
namespace pblic {
enum class CacheOp { Test, NumOpcodes };
const char* CacheIROpNames[] = {"Test"};
'''+hits+'\n'+ic_controls+'''
}
namespace pblbc {
'''+bc_controls+'''
const char* CodeName(int) { return "Test"; }
void Mismatch() {
  int entries[3] = {}; int* icEntries = entries; int* icEntry = entries+1;
  uint32_t indices[] = {2}; struct Entry { uint32_t* icIdx; } entry{indices};
  Entry* e = &entry; uint32_t j=0, off=7; int jop=0;
'''+mismatch+'''
}
}
int main() {
  bool ic=pblic::Enabled(), bc=pblbc::Enabled();
  if (pblic::Enabled()!=ic || pblbc::Enabled()!=bc) return 2;
  int icDetails=0,bcDetails=0;
  for (int i=0;i<64;i++) { if(pblic::TakeLog())icDetails++;if(pblbc::TakeLog())bcDetails++; }
  pblic::gNextStatSteps=1;
  const uint8_t op[]={0,0};
  for(int i=0;i<40;i++)pblic::CountStep(op);
  pblic::PrintStats("compiles");
  for(int i=0;i<40;i++)pblbc::Mismatch();
  printf("ic=%d bc=%d details=%d,%d steps=%u op=%u next=%u mismatch=%u flags=%u,%d,%d,%d\\n",
    int(ic),int(bc),icDetails,bcDetails,pblic::gStats[pblic::kStatSteps],
    pblic::gStepOps[0],pblic::gNextStatSteps,pblbc::gMismatch,pblbc::gHits,
    int(pblbc::gIcInline),int(pblbc::gLoopExit),int(pblbc::gLoopJit));
}
'''
cpp=a.output/'logging.cpp';cpp.write_text(program);exe=a.output/'logging'
cmd=['/usr/bin/g++','-std=c++20','-O2','-g0',str(cpp),'-o',str(exe)]
c=subprocess.run(cmd,capture_output=True,text=True,timeout=30)
(a.output/'compile.stderr').write_text(c.stderr)
if c.returncode:raise SystemExit(c.returncode)
results=[]
cases=[('zero-enabled','0','0','1'),('zero-disabled','0','0','0'),('negative','-1','-1','1'),
       ('one','1','1','1'),('three','3','3','1'),('default',None,None,'1'),
       ('default-disabled',None,None,'0'),('positive-disabled','3','3','0'),
       ('ic-quiet-method-verbose','0','3','1'),('ic-verbose-method-quiet','3','0','1')]
for name,il,bl,enabled in cases:
    env=dict(os.environ)
    for k in ['PBLIC','PBLIC_LOG','PBLBC','PBLBC_LOG','PBLBC_HITS','PBLBC_IC','PBLBC_LOOPEXIT','PBLBC_LOOPJIT']:env.pop(k,None)
    env.update(PBLIC=enabled,PBLBC=enabled)
    if il is not None:env['PBLIC_LOG']=il
    if bl is not None:env['PBLBC_LOG']=bl
    ib=max(0,int(il)) if il is not None else 40;bb=max(0,int(bl)) if bl is not None else 40
    state='enabled' if enabled=='1' else 'disabled';expected=''
    if ib:expected+=f'PBLIC {state} (threshold=200)\n'
    if bb:expected+=f'PBLBC {state} (threshold=50 ic=1 loopexit=0 loopjit=1)\n'
    if ib:
        for why,steps in [('steps',1),('steps',4),('steps',16),('compiles',40)]:
            expected+=f'PBLIC stats({why}) compiles=0 rejects=0 installs=0 entries=0 fails=0 steps={steps} top: Test={steps}\n'
    if bb:expected+='PBLBC ic mismatch at Test off=7 dyn=1 static=2\n'*20
    stdout=f'ic={enabled} bc={enabled} details={ib},{bb} steps=40 op=40 next=64 mismatch=40 flags=50,1,0,1\n'
    run=subprocess.run([str(exe)],env=env,capture_output=True,text=True,timeout=5)
    passed=run.returncode==0 and run.stderr==expected and run.stdout==stdout
    (a.output/(name+'.stderr')).write_text(run.stderr)
    results.append(dict(name=name,passed=passed,returncode=run.returncode,stdout=run.stdout,expectedStdout=stdout,stderr=run.stderr,expectedStderr=expected))
report=dict(source=str(a.source),scope='extracted actual logging C++; no JIT runtime proof',passed=sum(x['passed'] for x in results),total=len(results),results=results,compiler=cmd)
(a.output/'result.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({k:report[k] for k in ['source','passed','total']}))
raise SystemExit(0 if all(x['passed'] for x in results) else 1)
