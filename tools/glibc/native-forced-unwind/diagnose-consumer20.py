#!/usr/bin/env python3
"""Retain the exact cc1 crash stack of the first composed flagged control."""
import sys
sys.dont_write_bytecode = True
import json, shlex
from common import T, run, pin

out = T/'objects/consumer20-diagnostic-2';out.mkdir()
rows = json.loads((T/'logs/commands.json').read_text())
failure = next(row for row in rows if row['stage']=='consumer20-controls-O0-flagged')
argv = list(failure['argv'])
argv[argv.index('-o')+1] = str(out/'control.o')
run('consumer20-controls-O0-driver-argv-v2',[*argv,'-###'])
log = T/'logs/consumer20-controls-O0-driver-argv-v2-attempt1.log'
lines = [shlex.split(line) for line in log.read_text().splitlines() if '"-cc1"' in line]
assert len(lines)==1 and '-cc1' in lines[0]
cc1 = lines[0]
# This custom driver prints its dispatch name as a second argv word.
assert cc1[1:3] == ["clang", "-cc1"]
cc1.pop(1)
run('consumer20-controls-O0-gdb-v2',['/usr/bin/gdb','-q','--batch',
    '-ex','set pagination off','-ex','run','-ex','bt 40','--args',*cc1])
result={'runtimeAccepted':False,'inputFailureStage':failure['stage'],
        'actualDriverArgv':argv,'actualCC1Argv':cc1,
        'gdbLog':str(T/'logs/consumer20-controls-O0-gdb-v2-attempt1.log')}
(T/'logs/consumer20-diagnostic-2-result.json').write_text(json.dumps(result,indent=2)+'\n')
