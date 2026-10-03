#!/usr/bin/env python3
"""Retain the exact cc1 crash stack of the first composed flagged control."""
import sys
sys.dont_write_bytecode = True
import json, shlex
from common import T, run, pin

out = T/'objects/consumer16-diagnostic-1';out.mkdir()
rows = json.loads((T/'logs/commands.json').read_text())
failure = next(row for row in rows if row['stage']=='consumer16-normal-O0-flagged')
argv = list(failure['argv'])
argv[argv.index('-o')+1] = str(out/'control.o')
run('consumer16-normal-O0-driver-argv',[*argv,'-###'])
log = T/'logs/consumer16-normal-O0-driver-argv-attempt1.log'
lines = [shlex.split(line) for line in log.read_text().splitlines() if '"-cc1"' in line]
assert len(lines)==1 and '-cc1' in lines[0]
cc1 = lines[0]
run('consumer16-normal-O0-gdb',['/usr/bin/gdb','-q','--batch',
    '-ex','set pagination off','-ex','run','-ex','bt 40','--args',*cc1])
result={'runtimeAccepted':False,'inputFailureStage':failure['stage'],
        'actualDriverArgv':argv,'actualCC1Argv':cc1,
        'gdbLog':str(T/'logs/consumer16-normal-O0-gdb-attempt1.log')}
(T/'logs/consumer16-diagnostic-1-result.json').write_text(json.dumps(result,indent=2)+'\n')
