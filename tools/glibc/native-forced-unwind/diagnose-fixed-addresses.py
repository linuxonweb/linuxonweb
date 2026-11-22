#!/usr/bin/env python3
"""Retain actual pre-PEI fixed-allocation operands; failures stay failures."""
import sys
sys.dont_write_bytecode = True
import json
from common import T, R, pin, run

original = next(row for row in json.loads((T/'logs/commands.json').read_text())
                if row['stage']=='consumer-coherent1-controls-O0-flagged')
out=T/'objects/consumer-coherent1-fixed-address-diagnostic-1'
out.mkdir()
rows=[]
for opt in [0,2]:
    argv=list(original['argv'])
    argv[argv.index('-O0')]='-O'+str(opt)
    argv[argv.index('-o')+1]=str(out/f'O{opt}.o')
    argv += ['-mllvm','-print-before=prologepilog']
    rows.append(run(f'consumer-coherent1-fixed-address-O{opt}',argv,expected=1))
(T/'logs/consumer-coherent1-fixed-address-diagnostic-1.json').write_text(
    json.dumps({'runtimeAccepted':False,'retainedExpectedCompilerFailures':rows,
                'script':pin(R/'diagnose-fixed-addresses.py')},indent=2)+'\n')
