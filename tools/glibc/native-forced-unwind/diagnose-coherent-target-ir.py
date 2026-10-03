#!/usr/bin/env python3
"""Retain actual optimized matching-target IR before the strict consumer gate."""
import sys
sys.dont_write_bytecode = True
import json
from common import T, run

out=T/'objects/consumer-coherent1-target-ir-diagnostic-1';out.mkdir()
original=next(row for row in json.loads((T/'logs/commands.json').read_text())
              if row['stage']=='consumer-coherent1-controls-O0-flagged')
argv=list(original['argv']);argv[argv.index('-O0')]='-O2'
argv[argv.index('-o')+1]=str(out/'control.o')
argv+=['-mllvm','-print-before-all','-mllvm','-filter-print-funcs=consumer_target']
run('consumer-coherent1-target-O2-pre-consumer-ir',argv,expected=1)
