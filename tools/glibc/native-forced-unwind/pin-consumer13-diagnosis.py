#!/usr/bin/env python3
"""Pin actual retained Call-to-Invoke failure evidence without rewriting execution."""
import sys
sys.dont_write_bytecode=True
import json
from common_consumer13 import T,S,pin
from pathlib import Path

out=T/'source/consumer13-call-admission-diagnosis-1';out.mkdir()
paths=[
 T/'logs/consumer13-target-O0-call-audit-ir-attempt1.log',
 T/'logs/consumer13-continuation-controls-O0-flagged-attempt1.log',
 T/'logs/consumer13-opt-diagnostics-1-result.json',
 T/'logs/consumer13-independent-O2-flagged-attempt1.log',
 T/'logs/consumer13-independent-O3-flagged-attempt1.log',
 S/'llvm/lib/Transforms/Utils/Local.cpp',
 Path('/mnt/p6/build/glibc-native-frame-plan-20261002/module4-proposal-23/source/llvm/lib/Target/WebAssembly/WebAssemblyLowerEmscriptenEHSjLj.cpp'),
 Path('/mnt/p6/build/glibc-native-frame-plan-20261002/module4-proposal-27/source/llvm/lib/Target/WebAssembly/WebAssemblyGNUFrames.cpp')]
rows=[]
for index,path in enumerate(paths):
 snapshot=out/f'{index}-{path.name}';snapshot.write_bytes(path.read_bytes())
 rows.append({'path':str(path),'snapshot':str(snapshot),**pin(path)})
commands=json.loads((T/'logs/commands.json').read_text())
stages=['consumer13-continuation-controls-O0-flagged','consumer13-target-O0-call-audit-ir',
        'consumer13-independent-O2-flagged','consumer13-independent-O3-flagged']
proof={'scope':'actual compiler failure diagnosis; no runtime acceptance',
 'cause':'LowerSjLj Call-to-Invoke conversion retains the preceding actual admission but drops admitted call metadata; FinalAdmission creates a second admission and the unchanged machine audit rejects it before CFGStackify',
 'sourceLocations':{'conversion':'LowerSjLj23:2000','upstreamUtility':'Local.cpp:2603-2642',
                    'finalAdmission':'GNUFrames27:848,878'},
 'dumpLocations':{'preLower':'241-272','postLower':'273-374','beforeFinal':'1302-1414','afterFinal':'1415-1542'},
 'runtimeAcceptance':False,'pins':rows,
 'commands':[row for row in commands if row['stage'] in stages]}
assert all(row['exit']==1 and not row['terminalGroupMembers'] and
           not row['supervisorError'] and not row['stopReason'] for row in proof['commands'])
(T/'logs/consumer13-call-admission-diagnosis-1.json').write_text(json.dumps(proof,indent=2)+'\n')
