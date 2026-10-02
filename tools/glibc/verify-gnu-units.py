#!/usr/bin/env python3
"""Require every compiled GNU implementation to match its pinned release bytes."""
import hashlib,json,os
from pathlib import Path
root=Path(__file__).resolve().parent
src=Path(os.environ['GLIBC_TASK'])/'source/glibc-2.44'
units=json.loads((root/'gnu-unit-provenance.json').read_text())
for relative,entry in units.items():
    body=(src/relative).read_bytes()
    if len(body)!=entry['bytes'] or hashlib.sha256(body).hexdigest()!=entry['sha256']:
        raise SystemExit('GNU implementation changed: '+relative)
print(f'{len(units)} unchanged GNU implementation units verified')
