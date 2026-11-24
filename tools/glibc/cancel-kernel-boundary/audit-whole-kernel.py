#!/usr/bin/env python3
"""Inspect actual fresh kernel outputs and retained Kbuild dependencies."""
import argparse
import collections
import glob
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import subprocess


def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def pin(path):
    return {'path': str(path), 'sha256': sha(path), 'bytes': path.stat().st_size}


def number(data, pos):
    value = 0
    for shift in range(0, 70, 7):
        assert pos < len(data), 'truncated LEB'
        byte = data[pos]
        pos += 1
        value |= (byte & 127) << shift
        if byte < 128:
            return value, pos
    raise AssertionError('oversize LEB')


def name(data, pos):
    length, pos = number(data, pos)
    end = pos + length
    assert end <= len(data)
    return data[pos:end].decode('utf-8'), end


def sections(data):
    assert data[:8] == b'\0asm\1\0\0\0', 'not Wasm-v1'
    pos = 8
    result = []
    while pos < len(data):
        kind = data[pos]
        length, begin = number(data, pos + 1)
        end = begin + length
        assert end <= len(data), 'truncated section'
        row = {'id': kind, 'offset': begin, 'bytes': length}
        if kind == 0:
            row['name'], row['payloadOffset'] = name(data, begin)
            assert row['payloadOffset'] <= end
        result.append(row)
        pos = end
    assert pos == len(data)
    return result


def imports(data, rows):
    types = []
    for row in rows:
        if row['id'] != 1:
            continue
        pos = row['offset']
        count, pos = number(data, pos)
        for _ in range(count):
            assert data[pos] == 0x60, 'unsupported nonfunction type'
            pos += 1
            params, pos = number(data, pos)
            parameter_types = list(data[pos:pos + params])
            pos += params
            results, pos = number(data, pos)
            result_types = list(data[pos:pos + results])
            pos += results
            types.append({'parameters': parameter_types, 'results': result_types})
        assert pos == row['offset'] + row['bytes']
    result = []

    def limits(pos):
        flags, pos = number(data, pos)
        minimum, pos = number(data, pos)
        maximum = None
        if flags & 1:
            maximum, pos = number(data, pos)
        return {'flags': flags, 'minimum': minimum, 'maximum': maximum}, pos

    for row in rows:
        if row['id'] != 2:
            continue
        pos = row['offset']
        count, pos = number(data, pos)
        for _ in range(count):
            module, pos = name(data, pos)
            symbol, pos = name(data, pos)
            kind = data[pos]
            pos += 1
            item = {'module': module, 'name': symbol, 'kind': kind}
            if kind == 0:
                index, pos = number(data, pos)
                item['type'] = types[index]
            elif kind == 1:
                item['elementType'] = data[pos]
                pos += 1
                item['limits'], pos = limits(pos)
            elif kind == 2:
                item['limits'], pos = limits(pos)
            elif kind == 3:
                item['valueType'], item['mutable'] = data[pos:pos + 2]
                pos += 2
            elif kind == 4:
                item['attribute'] = data[pos]
                pos += 1
                index, pos = number(data, pos)
                item['type'] = types[index]
            else:
                raise AssertionError('unknown import kind')
            result.append(item)
        assert pos == row['offset'] + row['bytes']
    return result


def members(pgid):
    found = []
    for path in Path('/proc').glob('[0-9]*/stat'):
        try:
            fields = path.read_text().rsplit(')', 1)[1].split()
            if int(fields[2]) == pgid:
                found.append({'pid': int(path.parent.name), 'state': fields[0]})
        except (OSError, ValueError):
            pass
    return found


def metadata_ranges(data, rows, wat, metadata):
    # These sections are not static exported linker ranges: genuine kernel
    # init_sections consumes metadata. Cross-check actual passive bytes and
    # the real __wasm_init_memory destinations used to generate that metadata.
    names, lengths = {}, []
    for row in rows:
        if row.get('name') == 'name':
            pos, end = row['payloadOffset'], row['offset'] + row['bytes']
            while pos < end:
                kind = data[pos]
                length, begin = number(data, pos + 1)
                pos = begin + length
                if kind == 9:
                    count, cur = number(data, begin)
                    for _ in range(count):
                        index, cur = number(data, cur)
                        text, cur = name(data, cur)
                        assert text not in names
                        names[text] = index
                    assert cur == pos
        if row['id'] == 11:
            count, pos = number(data, row['offset'])
            for _ in range(count):
                flags, pos = number(data, pos)
                assert flags == 1, 'expected native shared-memory passive data'
                length, pos = number(data, pos)
                lengths.append(length)
                pos += length
            assert pos == row['offset'] + row['bytes']
    text = wat.read_text().split('(func $__wasm_init_memory ', 1)[1]
    text = re.split(r'^\s*data\.drop\b', text, maxsplit=1, flags=re.M)[0]
    ranges = {}
    for match in re.finditer(r'i32\.const (\d+)\s+i32\.const (\d+)\s+i32\.const (\d+)\s+memory\.init \$(\S+)', text):
        address, offset, size = map(int, match.groups()[:3])
        section = match[4]
        assert offset == 0 and lengths[names[section]] == size
        assert address + size <= 2**32
        ranges[section] = [address, size]
    assert metadata and all(ranges.get(key) == value for key, value in metadata.items())
    return {key: ranges[key] for key in metadata}


def main():
    ap = argparse.ArgumentParser()
    for key in ('task', 'output', 'baseline', 'toolchain'):
        ap.add_argument('--' + key, type=Path, required=True)
    ap.add_argument('--packaging', type=Path)
    args = ap.parse_args()
    task = args.task.resolve()
    assert task.parent == Path('/mnt/p6/build')
    assert re.fullmatch(r'glibc-cancel-kernel-whole-run[0-9]+-20261002', task.name)
    output = args.output.resolve()
    assert output.is_relative_to(task) and not output.exists()
    assert all(Path(os.environ[key]).resolve().is_relative_to(task)
               for key in ('TMPDIR', 'TMP', 'TEMP'))
    output.mkdir()
    objects = task / 'objects'
    recipe = json.loads((task / 'recipe.json').read_text())
    source = Path(recipe['sourceReuse']['path'])
    stage_rows = json.loads((task / 'stages.json').read_text())
    groups = [{'pgid': row['pgid'], 'members': members(row['pgid'])} for row in stage_rows]
    assert not any(row['members'] for row in groups)
    artifact_rows = []
    counts = collections.Counter()
    for path in sorted(objects.rglob('*.o')):
        row = pin(path)
        with path.open('rb') as stream:
            header = stream.read(8)
        if header == b'\0asm\1\0\0\0':
            try:
                row['sections'] = len(sections(path.read_bytes()))
                row['format'] = 'Wasm-v1 complete section framing'
            except AssertionError as error:
                row['format'] = 'invalid Wasm framing'
                row['error'] = str(error)
        elif header.startswith((b'BC\xc0\xde', b'\xde\xc0\x17\x0b')):
            row['format'] = 'LLVM bitcode'
        elif header.startswith(b'\x7fELF'):
            row['format'] = 'host ELF'
        else:
            row['format'] = 'unknown or incomplete'
        counts[row['format']] += 1
        artifact_rows.append(row)
    dependency_rows, command_rows, unresolved = {}, [], []
    depfile_rows = []
    resolved_values, wildcard_values = {}, {}

    def dependency(value, command_file):
        if value in resolved_values:
            return
        candidate = Path(value)
        choices = [candidate] if candidate.is_absolute() else [objects / candidate, source / candidate]
        selected = next((choice for choice in choices if choice.is_file()), None)
        if selected is None:
            unresolved.append({'commandFile': str(command_file), 'dependency': value})
            return
        selected = selected.resolve()
        scope = ('owned source' if selected.is_relative_to(source) else
                 'fresh output/generated' if selected.is_relative_to(objects) else
                 'external host/tool dependency')
        if str(selected) not in dependency_rows:
            dependency_rows[str(selected)] = dict(pin(selected), scope=scope)
        resolved_values[value] = str(selected)

    for command_index, path in enumerate(sorted(objects.rglob('*.cmd'))):
        if command_index % 100 == 0:
            print(json.dumps({'phase': 'command dependencies', 'commandIndex': command_index,
                              'uniqueDependencies': len(dependency_rows)}), flush=True)
        depfile_rows.append(pin(path))
        text = path.read_text()
        for match in re.finditer(r'^savedcmd_(.+?) := (.*)$', text, re.M):
            command_rows.append({'target': match[1], 'argvText': match[2], 'commandFile': str(path)})
        for match in re.finditer(r'^source_[^ ]+ := (.*)$', text, re.M):
            for value in shlex.split(match[1]):
                dependency(value, path)
        match = re.search(r'^deps_[^ ]+ := (.*?)(?=\n\n|\Z)', text, re.M | re.S)
        if not match:
            continue
        # The regex excludes the terminating blank line. Restore its first
        # newline so a final Make continuation is normalized as well.
        expression = (match[1] + '\n').replace('\\\n', ' ')

        def wildcard(match):
            patterns = shlex.split(match[1])
            found = []
            for pattern in patterns:
                if pattern not in wildcard_values:
                    wildcard_values[pattern] = [value for root in (objects, source)
                                                for value in glob.glob(str(root / pattern))]
                found.extend(wildcard_values[pattern])
            return ' '.join(shlex.quote(value) for value in sorted(set(found)))

        expression = re.sub(r'\$\(wildcard ([^)]+)\)', wildcard, expression)
        expression = expression.replace('$(srctree)', str(source)).replace('$(objtree)', str(objects))
        if '$' in expression:
            unresolved.append({'commandFile': str(path), 'expression': expression})
            continue
        for value in shlex.split(expression):
            dependency(value, path)
    for path in sorted(objects.rglob('*.d')):
        depfile_rows.append(pin(path))
        text = path.read_text().replace('\\\n', ' ')
        for line in text.splitlines():
            if not line.strip():
                continue
            if ':' not in line or '$' in line:
                unresolved.append({'commandFile': str(path), 'expression': line})
                continue
            assignment = re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*\s*:=\s*(.*)', line)
            expression = assignment[1] if assignment else line.split(':', 1)[1]
            for value in shlex.split(expression):
                dependency(value, path)
    archives = []
    ar = args.toolchain / 'bin/llvm-ar'
    for path in sorted(objects.rglob('*.a')):
        print(json.dumps({'phase': 'archive list', 'path': str(path)}), flush=True)
        row = pin(path)
        process = subprocess.run([str(ar), 't', str(path)], capture_output=True, text=True, timeout=30)
        row['listExit'] = process.returncode
        row['orderedMembers'] = process.stdout.splitlines()
        row['stderr'] = process.stderr
        # Names retain duplicates and order; archive membership is distinct
        # from the separately measured actual object bytes.
        archives.append(row)
    image_objects = objects
    packaging = None
    if args.packaging:
        packaging_task = args.packaging.resolve()
        packaging = json.loads((packaging_task / 'preparation.json').read_text())
        assert packaging['wholeTask'] == str(task)
        image_objects = packaging_task / 'objects'
        assert sha(objects / 'vmlinux.o') == sha(image_objects / 'vmlinux.o')
        assert sha(objects / 'usr/initramfs_inc_data') == sha(image_objects / 'usr/initramfs_inc_data')
        packaging['result'] = json.loads((packaging_task / 'supervision/packaging1/result.json').read_text())
        groups.append({'pgid': packaging['result']['pgid'], 'members': members(packaging['result']['pgid'])})
        packaging['preparationPin'] = pin(packaging_task / 'preparation.json')
    final = image_objects / 'tools/wasm/vmlinux.wasm'
    image = None
    if final.exists():
        data = final.read_bytes()
        rows = sections(data)
        customs = {row['name']: data[row['payloadOffset']:row['offset'] + row['bytes']]
                   for row in rows if row['id'] == 0}
        for expected in ('.linux.sections', '.linux.initramfs'):
            assert sum(row.get('name') == expected for row in rows) == 1, expected
        assert customs['.linux.sections'] == (image_objects / 'arch/wasm/sections.json').read_bytes()
        assert customs['.linux.initramfs'] == (image_objects / 'usr/initramfs_inc_data').read_bytes()
        metadata = json.loads(customs['.linux.sections'])
        assert metadata and all(len(value) == 2 and all(isinstance(x, int) and x >= 0 for x in value)
                                for value in metadata.values())
        validator = Path('/usr/bin/wasm-validate')
        command = [str(validator), '--enable-all', str(final)]
        process = subprocess.run(command, capture_output=True, text=True, timeout=60)
        (output / 'wasm-validation.log').write_text(process.stdout + process.stderr)
        baseline = args.baseline.resolve()
        assert sha(baseline) == '21c15250e6f27c95fef333a16ffbc411159838f194f0ea19f8adcda3f21b0e75'
        before = imports(baseline.read_bytes(), sections(baseline.read_bytes()))
        after = imports(data, rows)
        checked_ranges = metadata_ranges(data, rows, image_objects / 'arch/wasm/vmlinux.wat', metadata)
        image = {'module': pin(final), 'sections': rows, 'imports': after,
                 'baseline': pin(baseline), 'baselineImports': before,
                 'addedImports': [row for row in after if row not in before],
                 'removedImports': [row for row in before if row not in after],
                 'linuxSections': pin(image_objects / 'arch/wasm/sections.json'),
                 'sectionMetadata': metadata, 'checkedPassiveRanges': checked_ranges,
                 'wat': pin(image_objects / 'arch/wasm/vmlinux.wat'),
                 'initramfs': pin(image_objects / 'usr/initramfs_inc_data'),
                 'validator': pin(validator), 'validationArgv': command, 'validationExit': process.returncode}
    failures = []
    if unresolved:
        failures.append('unresolved retained dependencies')
    if any(row['listExit'] != 0 for row in archives):
        failures.append('archive inspection failed')
    if any(row['format'] not in ('Wasm-v1 complete section framing', 'LLVM bitcode', 'host ELF') for row in artifact_rows):
        failures.append('malformed/unknown artifacts')
    if not image or image['validationExit'] != 0:
        failures.append('final image absent or invalid')
    expected_added = [{'module': 'user', 'name': 'call_signal_handler_v3', 'kind': 0,
                       'type': {'parameters': [127] * 4, 'results': [127]}},
                      {'module': 'user', 'name': 'signal_return_policy_v3', 'kind': 0,
                       'type': {'parameters': [127], 'results': [127]}}]
    expected_removed = [{'module': 'user', 'name': 'call_siginfo_handler', 'kind': 0,
                         'type': {'parameters': [127] * 3, 'results': [127]}},
                        {'module': 'user', 'name': 'call_signal_handler', 'kind': 0,
                         'type': {'parameters': [127] * 2, 'results': []}}]
    if image and (image['addedImports'] != expected_added or image['removedImports'] != expected_removed):
        failures.append('unexpected import delta')
    if packaging:
        failed_log = (task / 'logs/kernel-build/output.log').read_text()
        if (any(row['exit'] != 0 for row in stage_rows[:-1]) or stage_rows[-1]['exit'] != 2 or
                'Can\'t open perl script "arch/wasm/scripts/sections.pl"' not in failed_log or
                packaging['result']['exit'] != 0):
            failures.append('compile/link/packaging outcome mismatch')
    elif any(row['exit'] != 0 for row in stage_rows):
        failures.append('whole build failed')
    if any(row['members'] for row in groups):
        failures.append('owned groups remain')
    tools = [pin(source / relative) for relative in
             ('arch/wasm/scripts/sections.pl', 'scripts/Kbuild.include', 'scripts/check-function-names.sh')]
    result = {'scope': 'actual whole-kernel build artifact/dependency inspection; not runtime cancellation acceptance',
              'recipe': pin(task / 'recipe.json'), 'stageOutcomes': stage_rows, 'freshGroups': groups,
              'objects': artifact_rows, 'objectCounts': dict(counts), 'archives': archives,
              'commandFiles': depfile_rows, 'commands': command_rows,
              'dependencies': list(dependency_rows.values()), 'unresolvedDependencies': unresolved,
              'dependencyScope': 'retained Kbuild .cmd source/deps plus .d union; MMD omits host system headers, host linker inputs are separately pinned by recipe controls',
              'finalImage': image, 'packaging': packaging, 'packagingScripts': tools,
              'readiness': {'pass': not failures, 'failures': failures}, 'runtimeAcceptance': False}
    (output / 'proof.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'objects': dict(counts), 'commands': len(command_rows),
                      'dependencies': len(dependency_rows), 'unresolvedDependencies': len(unresolved),
                      'finalImage': image['module'] if image else None}))


if __name__ == '__main__':
    main()
