#!/usr/bin/env python3
"""Preserve real post-SjLj IR at the composed ownership rejection."""
import sys
sys.dont_write_bytecode = True
import json
from common import T, run

out=T/'objects/consumer18-cxx-ir-diagnostic-1';out.mkdir()
rows=json.loads((T/'logs/commands.json').read_text())
failure=next(row for row in rows if row['stage']=='consumer18-cxx-O0-object')
argv=list(failure['argv']);argv[argv.index('-o')+1]=str(out/'control.o')
argv+=['-mllvm','-print-before-all']
run('consumer18-cxx-O0-pre-record-ir',argv,expected=1)
