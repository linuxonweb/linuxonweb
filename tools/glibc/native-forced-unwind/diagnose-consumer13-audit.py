#!/usr/bin/env python3
"""Preserve the actual post-CFG call/admission sequence at the audit failure."""
import sys
sys.dont_write_bytecode=True
import json
from common_consumer13 import T,run

out=T/'objects/consumer13-audit-diagnostic-1';out.mkdir()
original=next(row for row in json.loads((T/'logs/commands.json').read_text())
              if row['stage']=='consumer13-continuation-controls-O0-flagged')
argv=list(original['argv']);argv[argv.index('-o')+1]=str(out/'control.o')
argv+=['-mllvm','-print-before-all','-mllvm','-filter-print-funcs=consumer_target']
run('consumer13-target-O0-call-audit-ir',argv,expected=1)
