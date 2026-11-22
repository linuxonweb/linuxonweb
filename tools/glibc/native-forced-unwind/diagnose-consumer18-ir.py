#!/usr/bin/env python3
"""Preserve real post-SjLj IR at the composed ownership rejection."""
import sys
sys.dont_write_bytecode = True
import json
from common import T, run

out=T/'objects/consumer18-ir-diagnostic-1';out.mkdir()
rows=json.loads((T/'logs/commands.json').read_text())
failure=next(row for row in rows if row['stage']=='consumer18-controls-O0-flagged')
argv=list(failure['argv']);argv[argv.index('-o')+1]=str(out/'control.o')
argv+=['-mllvm','-print-before-all','-mllvm','-filter-print-funcs=consumer_target']
run('consumer18-target-O0-post-sjlj-ir',argv,expected=1)
