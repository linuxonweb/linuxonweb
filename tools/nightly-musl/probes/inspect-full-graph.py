#!/usr/bin/env python3
"""Read generated Firefox make inputs without running make or changing artifacts."""
import collections
import hashlib
import json
import re
import subprocess
import sys
import time
from pathlib import Path

root = Path(sys.argv[1]).resolve()
output = Path(sys.argv[2]).resolve()
assert str(root).startswith('/mnt/p6/build/firefox-nightly-musl-recovery-')
assert output.is_relative_to(root) and not output.exists()
obj = root / 'obj-nightly'
root_mk = obj / 'root.mk'
target_line = next(line for line in root_mk.read_text().splitlines()
                   if line.startswith('compile_targets :='))
targets = target_line.split(':=', 1)[1].split()
directories = sorted({target.rsplit('/', 1)[0] for target in targets
                      if not target.endswith('/host')})
objects, unresolved, input_hashes = {}, [], {}
for directory in directories:
    backend = obj / directory / 'backend.mk'
    assert backend.exists(), backend
    inputs = [backend]
    if directory == 'dom/bindings':
        inputs.append(obj / directory / 'webidlsrcs.mk')
    values = {}
    for path in inputs:
        data = path.read_bytes()
        input_hashes[str(path.relative_to(obj))] = hashlib.sha256(data).hexdigest()
        for line in data.decode().replace('\\\n', ' ').splitlines():
            match = re.match(r'([A-Za-z0-9_]+)\s*(\+=|:=|=)\s*(.*)', line)
            if match:
                key, operator, value = match.groups()
                values[key] = ((values.get(key, '') + ' ')
                               if operator == '+=' else '') + value

    def expand(value, depth=0):
        assert depth < 20
        def replace(match):
            name = match[1]
            if name in values:
                return expand(values[name], depth + 1)
            if name in ('srcdir', 'topsrcdir', 'DEPTH'):
                return '$'  # basename mapping in config/rules.mk ignores this prefix
            return match[0]
        return re.sub(r'\$\(([^)]+)\)', replace, value)

    for variable in ('CSRCS', 'CPPSRCS', 'SSRCS', 'ASFILES'):
        for source in expand(values.get(variable, '')).split():
            if '$(' in source:
                unresolved.append([directory, variable, source])
                continue
            path = obj / directory / (Path(source).stem + '.o')
            exists = path.exists()
            magic = None
            if exists:
                with path.open('rb') as stream:
                    magic = stream.read(8).hex()
            objects[str(path.relative_to(obj))] = {
                'exists': exists,
                'bytes': path.stat().st_size if exists else 0,
                'magic': magic,
            }
assert not unresolved, unresolved
groups = {}
for name, entry in objects.items():
    group = groups.setdefault(name.split('/')[0], {
        'expected': 0, 'existing': 0, 'bytes': 0})
    group['expected'] += 1
    group['existing'] += entry['exists']
    group['bytes'] += entry['bytes']
existing = [entry for entry in objects.values() if entry['exists']]
non_wasm = {name: entry for name, entry in objects.items()
            if entry['exists'] and entry['magic'] != '0061736d01000000'}
inventory = subprocess.check_output([
    'du', '-x', '--block-size=1', '--max-depth=1', str(root)], text=True)
report = {
    'checked': time.time(),
    'claim': 'Object-file progress estimate; no full-build or guest acceptance',
    'method': ('Generated compile_targets and backend CSRCS/CPPSRCS/SSRCS/ASFILES; '
               'unified variables and generated binding include expanded; '
               'host-only targets excluded; output basenames follow config/rules.mk'),
    'root_mk_sha256': hashlib.sha256(root_mk.read_bytes()).hexdigest(),
    'make_input_hashes': input_hashes,
    'compile_target_count': len(targets),
    'target_directory_count': len(directories),
    'expected_native_object_count': len(objects),
    'existing_expected_object_count': len(existing),
    'missing_expected_object_count': len(objects) - len(existing),
    'existing_expected_object_bytes': sum(entry['bytes'] for entry in existing),
    'existing_non_wasm_magic': non_wasm,
    'groups': groups,
    'objects': objects,
    'du_inventory': inventory,
    'cleanup': 'None; preserved source, objects, cache and diagnostic outputs',
}
output.write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({key: report[key] for key in (
    'expected_native_object_count', 'existing_expected_object_count',
    'missing_expected_object_count', 'existing_expected_object_bytes',
    'existing_non_wasm_magic')}, indent=2))
