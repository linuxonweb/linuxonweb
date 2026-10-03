#!/usr/bin/env python3
"""Reuse the actual ABI parser under this task's separately enforced disk guards."""
from pathlib import Path
import importlib.util,json
ROOT=Path(__file__).resolve().parents[4]
TASK=Path('/mnt/p6/project/build/nightly-webgpu-current-abi-20261003')
spec=importlib.util.spec_from_file_location('native_abi',ROOT/'tools/nightly-jit-prep/inspect-wasm.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
for name in ['layout','layout-fpcast']:
 out=TASK/(name+'-inspect');out.mkdir()
 row=m.inspect(TASK/(name+'.wasm'),out,Path('/usr/bin/wasm-objdump'))
 row['pass']=row['everyElementUses23I64ToI64'] if name.endswith('fpcast') else not row['everyElementUses23I64ToI64']
 (out/'result.json').write_text(json.dumps(row,indent=2)+'\n');assert row['pass']
 print(name,row['elementEntryCount'],row['everyElementUses23I64ToI64'])
