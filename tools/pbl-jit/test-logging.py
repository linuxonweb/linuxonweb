#!/usr/bin/env python3
"""Run the production logging controls on the host, without a guest/JIT build.

Extract the actual initialization, detail budget, and stats block verbatim.
Only the host driver supplies synthetic compile counters; output uses real stderr.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess

p = argparse.ArgumentParser()
p.add_argument('--source', type=Path, required=True)
p.add_argument('--output', type=Path, required=True)
a = p.parse_args()
a.output.mkdir(parents=True, exist_ok=False)
s = a.source.read_text()
controls = s[s.index('std::atomic<uint32_t> gInstalls{0};'):s.index('// ---- wasm byte emitter')]
begin = s.index('  if ((n & (n - 1)) == 0', s.index('bool Install('))
end = s.index('\n  return true;', begin)
stats = s[begin:end]
program = '''#include <atomic>
#include <cstdio>
#include <cstdlib>
#include <cstdint>
constexpr uint32_t kCompileHits = 1000;
''' + controls + '\nvoid Stats(uint32_t n) {\n' + stats + '''
}
int main() {
  const bool enabled = Enabled();
  if (Enabled() != enabled) return 2;
  int detail = 0;
  if (enabled) {
    for (int i = 0; i < 40; ++i) if (TakeLog()) ++detail;
    for (uint32_t n : {1u, 2u, 3u, 4u, 8u}) Stats(n);
  }
  printf("enabled=%d detail=%d\\n", int(enabled), detail);
}
'''
# Explicit initializer_list is required by the small test driver's range loop.
program = '#include <initializer_list>\n' + program
cpp = a.output/'logging.cpp'
cpp.write_text(program)
exe = a.output/'logging'
compiler = ['/usr/bin/g++', '-std=c++20', '-O2', '-g0', str(cpp), '-o', str(exe)]
c = subprocess.run(compiler, capture_output=True, text=True, timeout=30)
(a.output/'compile.stdout').write_text(c.stdout)
(a.output/'compile.stderr').write_text(c.stderr)
if c.returncode:
    raise SystemExit(c.returncode)
results = []
for name, log, enable, detail in [('zero','0','1',0), ('negative','-1','1',0),
                                 ('positive-one','1','1',1), ('positive-three','3','1',3),
                                 ('default',None,'1',24), ('disabled','3','0',0)]:
    env = dict(os.environ)
    env.pop('PBLJIT_LOG',None)
    env['PBLJIT'] = enable
    if log is not None: env['PBLJIT_LOG'] = log
    r = subprocess.run([str(exe)],env=env,capture_output=True,text=True,timeout=5)
    expected = ''
    if enable == '1' and detail:
        expected = f'PBLJIT enabled (threshold=1000, logBudget={detail})\n'
        expected += ''.join(f'PBLJIT stats compiles={n} rejects=0 runs=0 bails=0\n' for n in [1,2,4,8])
    passed = r.returncode == 0 and r.stdout == f'enabled={enable} detail={detail}\n' and r.stderr == expected
    (a.output/(name+'.stderr')).write_text(r.stderr)
    results.append(dict(name=name,passed=passed,returncode=r.returncode,stdout=r.stdout,
                        stderr=r.stderr,expectedStderr=expected))
report = dict(source=str(a.source),scope='actual extracted C++ logging controls; no guest/JIT semantics acceptance',
              passed=sum(x['passed'] for x in results),total=len(results),results=results,compiler=compiler)
(a.output/'result.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({k:report[k] for k in ['source','passed','total']}))
raise SystemExit(0 if all(x['passed'] for x in results) else 1)
