#!/usr/bin/env python3
"""Lower genuine GNU libio's two offset aliases to native LLVM data aliases.

All other assembly is preserved for the subsequent warning/metadata verifier.
No GNU source, table contents, public symbol identity or runtime code changes.
"""
import json
import pathlib
import re
import sys


def normalize(text):
    names = ('_IO_file_jumps', '_IO_wfile_jumps')
    lines = text.splitlines(keepends=True)
    asm = [(i, line.rstrip('\n')) for i, line in enumerate(lines)
           if line.startswith('module asm ')]
    relevant = [(i, line) for i, line in asm
                if any(re.search(r'(?<![A-Za-z0-9_])' + name + r'(?![A-Za-z0-9_])', line)
                       for name in names)]
    if not relevant:
        return text, []
    if 'target triple = "wasm32-unknown-linux-gnu"' not in text:
        raise ValueError('GNU offset alias adapter requires the native Linux/Wasm target')
    # This GNU type has two ABI placeholders and nineteen function pointers.
    # Its actual wasm32 allocation size is 84, with no padding between i32/ptr.
    typ = re.search(r'^%struct\._IO_jump_t = type \{ (.*) \}$', text, re.M)
    if not typ or typ.group(1).split(', ') != ['i32', 'i32'] + ['ptr'] * 19:
        raise ValueError('unexpected genuine GNU IO jump-table layout')
    table = re.search(r'^@__io_vtables = hidden constant \[(\d+) x %struct\._IO_jump_t\]', text, re.M)
    if not table or int(table.group(1)) < 6:
        raise ValueError('missing or incompatible defined GNU vtable storage')
    rows = []
    remove = set()
    for name, index in zip(names, (2, 5)):
        offset = index * 84
        expected = [f'module asm ".global {name}"',
                    f'module asm ".type {name}, %object"',
                    f'module asm "{name} = __io_vtables + {offset}"',
                    f'module asm ".size {name}, 84"']
        actual = [(i, line) for i, line in relevant
                  if re.search(r'(?<![A-Za-z0-9_])' + name + r'(?![A-Za-z0-9_])', line)]
        if [line for _, line in actual] != expected:
            raise ValueError(f'unrecognized or incomplete GNU alias directives: {name}')
        if re.search(r'^@' + name + r'\s*=', text, re.M):
            raise ValueError(f'GNU alias symbol already defined: {name}')
        remove.update(i for i, _ in actual)
        rows.append({'symbol': name, 'storage': '__io_vtables', 'offset': offset, 'size': 84})
    result = ''.join(line for i, line in enumerate(lines) if i not in remove)
    result += '\n' + ''.join(
        f'@{row["symbol"]} = alias %struct._IO_jump_t, ptr getelementptr (i8, ptr @__io_vtables, i32 {row["offset"]})\n'
        for row in rows)
    return result, rows


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('usage: normalize.py input.ll output.ll')
    source = pathlib.Path(sys.argv[1]).read_text()
    try:
        output, aliases = normalize(source)
    except ValueError as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(3)
    pathlib.Path(sys.argv[2]).write_text(output)
    print(json.dumps({'aliases': aliases, 'runtimeCodeChanged': False}), file=sys.stderr)
