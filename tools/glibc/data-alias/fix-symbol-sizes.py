#!/usr/bin/env python3
"""Preserve GNU's two 84-byte alias extents in Wasm linking metadata.

LLVM emits alias extents through the end of the entire backing array. This
adapter corrects only those symbol-size fields. Code/data/relocations stay exact.
"""
import json
import pathlib
import sys


def read_u(data, pos):
    value = shift = 0
    for index in range(5):
        if pos >= len(data):
            raise ValueError('truncated unsigned LEB')
        byte = data[pos]
        pos += 1
        if index == 4 and byte > 15:
            raise ValueError('oversized Wasm32 unsigned LEB')
        value |= (byte & 127) << shift
        if byte < 128:
            return value, pos
        shift += 7
    raise ValueError('oversized Wasm32 unsigned LEB')


def write_u(value):
    out = bytearray()
    while value >= 128:
        out.append((value & 127) | 128)
        value >>= 7
    out.append(value)
    return bytes(out)


def string(data, pos):
    count, pos = read_u(data, pos)
    if count > len(data) - pos:
        raise ValueError('truncated Wasm string')
    return data[pos:pos + count].decode(), pos + count


def fix(data):
    if data[:8] != b'\0asm\1\0\0\0':
        raise ValueError('requires a Wasm-v1 object')
    p = 8
    result = bytearray(data[:8])
    aliases = {}
    storage = None
    linkings = 0
    while p < len(data):
        kind = data[p]
        size, start = read_u(data, p + 1)
        end = start + size
        if end > len(data):
            raise ValueError('truncated Wasm section')
        raw = data[start:end]
        if kind == 0:
            name, q = string(raw, 0)
            if name == 'linking':
                linkings += 1
                version, q = read_u(raw, q)
                if version != 2:
                    raise ValueError('unknown Wasm linking version')
                rebuilt = bytearray(raw[:q])
                while q < len(raw):
                    subkind = raw[q]
                    length, substart = read_u(raw, q + 1)
                    subend = substart + length
                    sub = raw[substart:subend]
                    if len(sub) != length:
                        raise ValueError('truncated linking subsection')
                    if subkind == 8:
                        count, pos = read_u(sub, 0)
                        patched = bytearray(sub[:pos])
                        for _ in range(count):
                            symbol_start = pos
                            symkind = sub[pos]
                            flags, pos = read_u(sub, pos + 1)
                            if symkind == 1:
                                symname, pos = string(sub, pos)
                                if not flags & 0x10:
                                    segment, pos = read_u(sub, pos)
                                    offset, pos = read_u(sub, pos)
                                    size_start = pos
                                    extent, pos = read_u(sub, pos)
                                    if symname == '__io_vtables':
                                        if storage is not None or flags != 4:
                                            raise ValueError('unexpected GNU hidden vtable storage')
                                        storage = (segment, offset, extent)
                                    if symname in ('_IO_file_jumps', '_IO_wfile_jumps'):
                                        expected = {'_IO_file_jumps':168, '_IO_wfile_jumps':420}[symname]
                                        if symname in aliases or flags != 0 or offset != expected:
                                            raise ValueError('unexpected GNU alias identity/binding/offset')
                                        aliases[symname] = {'segment':segment,'offset':offset,'originalSize':extent,'size':84}
                                        patched += sub[symbol_start:size_start] + write_u(84)
                                        continue
                            elif symkind in (0, 2, 4, 5):
                                _, pos = read_u(sub, pos)
                                if not flags & 0x10 or flags & 0x40:
                                    _, pos = string(sub, pos)
                            elif symkind == 3:
                                _, pos = read_u(sub, pos)
                            else:
                                raise ValueError('unknown Wasm symbol kind')
                            patched += sub[symbol_start:pos]
                        if pos != len(sub):
                            raise ValueError('trailing symbol-table bytes')
                        sub = bytes(patched)
                    rebuilt += bytes([subkind]) + write_u(len(sub)) + sub
                    q = subend
                raw = bytes(rebuilt)
        result += bytes([kind]) + write_u(len(raw)) + raw
        p = end
    if linkings != 1 or storage is None or set(aliases) != {'_IO_file_jumps', '_IO_wfile_jumps'}:
        raise ValueError('expected exactly two defined GNU offset aliases')
    if storage[1] != 0 or storage[2] < 504 or storage[2] % 84:
        raise ValueError('unexpected GNU backing-array extent')
    for row in aliases.values():
        if row['segment'] != storage[0] or row['originalSize'] not in (84,storage[2]-row['offset']):
            raise ValueError('alias storage/extent does not match its defined table')
    return bytes(result), aliases


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('usage: fix-symbol-sizes.py input.o output.o')
    try:
        output, aliases = fix(pathlib.Path(sys.argv[1]).read_bytes())
    except (ValueError, IndexError, UnicodeError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(3)
    pathlib.Path(sys.argv[2]).write_bytes(output)
    print(json.dumps({'aliases':aliases,'runtimeCodeChanged':False}),file=sys.stderr)
