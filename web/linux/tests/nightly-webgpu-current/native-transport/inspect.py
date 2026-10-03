#!/usr/bin/env python3
"""Reuse read-only native ABI inspector within this different disk-task scope."""
from pathlib import Path
import importlib.util,json
ROOT=Path(__file__).resolve().parents[5];TASK=Path('/mnt/p6/project/build/nightly-current-native-gpu-transport-20261003')
spec=importlib.util.spec_from_file_location('inspect_wasm',ROOT/'tools/nightly-jit-prep/inspect-wasm.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
out=TASK/'native-abi-inspection';out.mkdir();r=m.inspect(TASK/'guest.wasm',out,Path('/usr/bin/wasm-objdump'));assert r['everyElementUses23I64ToI64'] and r['elementEntryCount']>0
(out/'result.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps({'elementEntryCount':r['elementEntryCount'],'all23i64':r['everyElementUses23I64ToI64']}))
