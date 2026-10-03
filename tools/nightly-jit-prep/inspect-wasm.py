#!/usr/bin/env python3
"""Measure a linked Wasm module's JIT ABI using pinned WABT section dumps.

This is structural evidence, not guest or browser acceptance. No historical
Firefox table size, stack value or function signature is assumed or rewritten.
"""
import argparse
from collections import Counter
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess


def pin(path):
    with path.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    return {'path': str(path), 'bytes': path.stat().st_size, 'sha256': digest}


def inspect(module, out, objdump):
    original = pin(module)
    dumps, commands = {}, []
    header_argv = [str(objdump), '-h', str(module)]
    header = subprocess.run(header_argv, capture_output=True, text=True, timeout=120)
    header_log = out / 'headers.log'
    header_log.write_text(header.stdout + header.stderr)
    commands.append({'argv': header_argv, 'exitCode': header.returncode, 'log': pin(header_log)})
    if header.returncode:
        raise ValueError('module header dump failed')
    present = set(re.findall(r'^\s*(\w+) start=0x[0-9a-f]+ end=0x[0-9a-f]+ ', header.stdout, re.M))
    if not {'Type', 'Function', 'Code'} <= present:
        raise ValueError('linked native module requires types, functions and code')
    for section in ('Type', 'Import', 'Function', 'Table', 'Memory', 'Global',
                    'Export', 'Elem', 'Code', 'Tag'):
        if section not in present:
            dumps[section] = ''
            continue
        argv = [str(objdump), '-x', '-j', section, str(module)]
        result = subprocess.run(argv, capture_output=True, text=True, timeout=120)
        log = out / (section.lower() + '.log')
        log.write_text(result.stdout + result.stderr)
        commands.append({'argv': argv, 'exitCode': result.returncode, 'log': pin(log)})
        if result.returncode:
            raise ValueError('section dump failed: ' + section)
        dumps[section] = result.stdout

    types = {}
    for line in dumps['Type'].splitlines():
        if not line.startswith(' - '):
            continue
        match = re.fullmatch(r' - type\[(\d+)\] \(([^)]*)\) -> (.+)', line)
        if not match:
            raise ValueError('unsupported native function type: ' + line)
        index, params, results = match.groups()
        params = [p.strip() for p in params.split(',') if p.strip()]
        results = [] if results == 'nil' else [p.strip() for p in results.strip('()').split(',')]
        types[int(index)] = {'params': params, 'results': results}
    if not types or set(types) != set(range(len(types))):
        raise ValueError('incomplete type census')

    functions, imports = {}, []
    for section in ('Import', 'Function'):
        for line in dumps[section].splitlines():
            if not line.startswith(' - '):
                continue
            if section == 'Import':
                match = re.fullmatch(r' - (\w+)\[(\d+)\](.*?) <- (.+)', line)
                if not match:
                    raise ValueError('unparsed import: ' + line)
                kind, index, descriptor, binding = match.groups()
                imports.append({'kind': kind, 'index': int(index),
                                'binding': binding, 'descriptor': descriptor.strip()})
                if kind != 'func':
                    continue
            match = re.match(r' - func\[(\d+)\] sig=(\d+)(?: |$)', line)
            if not match:
                raise ValueError('unparsed function signature: ' + line)
            index, signature = map(int, match.groups())
            if signature not in types or index in functions:
                raise ValueError('invalid function/type index')
            functions[index] = signature
    if set(functions) != set(range(len(functions))):
        raise ValueError('incomplete function census')
    defined = len(functions) - sum(i['kind'] == 'func' for i in imports)
    code_count = len(re.findall(r'^ - func\[\d+\] size=\d+', dumps['Code'], re.M))
    if code_count != defined:
        raise ValueError('function/code count mismatch')

    exports = []
    for line in dumps['Export'].splitlines():
        if not line.startswith(' - '):
            continue
        match = re.fullmatch(r' - (\w+)\[(\d+)\](?: <[^>]*>)? -> (".*")', line)
        if not match:
            raise ValueError('unparsed export: ' + line)
        kind, index, name = match.groups()
        exports.append({'kind': kind, 'index': int(index), 'name': json.loads(name)})

    elements, segments = [], []
    for line in dumps['Elem'].splitlines():
        if line.startswith(' - segment['):
            segments.append(line.strip())
        elif line.startswith('  - elem['):
            match = re.fullmatch(r'  - elem\[(\d+)\] = ref.func:(\d+)(?: <[^>]*>)?', line)
            if not match:
                raise ValueError('unsupported element initializer: ' + line)
            slot, function = map(int, match.groups())
            if function not in functions:
                raise ValueError('element function index outside census')
            elements.append({'segment': len(segments) - 1, 'slot': slot,
                             'function': function, 'type': functions[function]})
    expected_elements = sum(int(re.search(r'\bcount=(\d+)', s).group(1)) for s in segments)
    if expected_elements != len(elements):
        raise ValueError('element count mismatch')

    def signature_key(sig):
        return json.dumps(sig, sort_keys=True, separators=(',', ':'))

    def histogram(signatures):
        return [{'signature': json.loads(k), 'count': v}
                for k, v in sorted(Counter(signature_key(s) for s in signatures).items())]

    raw = lambda section: [line.strip() for line in dumps[section].splitlines()
                           if line.startswith(' - ')]
    stack = next((e for e in exports if e['name'] == '__stack_pointer'), None)
    stack_global = next((g for g in raw('Global') if stack and
                         g.startswith('- global[' + str(stack['index']) + '] ')), None)
    uniform = bool(elements) and all(types[e['type']] ==
                                    {'params': ['i64'] * 23, 'results': ['i64']}
                                    for e in elements)
    if pin(module) != original:
        raise ValueError('module changed during inspection')
    inspector = Path(__file__).resolve()
    snapshot = out / 'inspector.py'
    snapshot.write_bytes(inspector.read_bytes())
    return {'claim': 'Measured linked Wasm sections and indirect signatures only',
            'module': original, 'objdump': pin(objdump), 'inspector': pin(inspector),
            'inspectorSnapshot': pin(snapshot), 'presentSections': sorted(present),
            'commands': commands, 'imports': imports, 'exports': exports,
            'tableDeclarations': raw('Table'), 'memoryDeclarations': raw('Memory'),
            'globalDeclarations': raw('Global'), 'tagDeclarations': raw('Tag'),
            'stackPointerExport': stack, 'stackPointerGlobal': stack_global,
            'typeCount': len(types), 'functionCount': len(functions),
            'definedFunctionCount': defined, 'codeBodyCount': code_count,
            'allFunctionSignatures': histogram(types[s] for s in functions.values()),
            'maxFunctionParameters': max(len(types[s]['params']) for s in functions.values()),
            'elementSegments': segments, 'elementEntryCount': len(elements),
            'elementSignatures': histogram(types[e['type']] for e in elements),
            'maxElementParameters': max((len(types[e['type']]['params']) for e in elements), default=0),
            'everyElementUses23I64ToI64': uniform,
            'structuralValidation': False, 'guestAcceptance': False, 'releaseAcceptance': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--module', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--objdump', type=Path, default=Path('/usr/bin/wasm-objdump'))
    parser.add_argument('--require-fpcast', action='store_true',
                        help='require all real element targets to use (23 i64) -> i64')
    args = parser.parse_args()
    out, module, tool = args.output.resolve(), args.module.resolve(), args.objdump.resolve()
    if not out.is_relative_to('/mnt/p6/build') or out.exists() or not out.parent.is_dir():
        parser.error('fresh existing-parent output under /mnt/p6/build required')
    for key in ('TMPDIR', 'TMP', 'TEMP'):
        scratch = Path(os.environ[key]).resolve()
        if not scratch.is_relative_to('/mnt/p6/build') or not scratch.is_dir():
            parser.error('disk-backed scratch under /mnt/p6/build required')
    if shutil.disk_usage(out.parent).free < 20 * 1024**3:
        parser.error('20 GiB free reserve required')
    out.mkdir()
    report = inspect(module, out, tool)
    report['requireFpcast'] = args.require_fpcast
    report['pass'] = not args.require_fpcast or report['everyElementUses23I64ToI64']
    target = out / 'result.json'
    target.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'output': str(target), 'sha256': pin(target)['sha256'],
                      'functions': report['functionCount'], 'elements': report['elementEntryCount'],
                      'maxElementParameters': report['maxElementParameters'], 'pass': report['pass']}))
    if not report['pass']:
        raise SystemExit('actual element signatures do not match fpcast contract')


if __name__ == '__main__':
    main()
