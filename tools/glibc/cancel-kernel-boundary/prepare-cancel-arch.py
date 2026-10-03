#!/usr/bin/env python3
"""Select GNU's actual cancel syscall body without unsupported ELF PC labels."""
import argparse
import hashlib
import json
from pathlib import Path


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    source, output = args.source.resolve(), args.output.resolve()
    assert output.is_relative_to(Path('/mnt/p6/build')) and not output.exists()
    data = source.read_bytes()
    assert sha(data) == "1552ef7f9424bd54d0897abc77df370de2d655be8e7b37ee40fed1c99f5155bd", "signed GNU 2.44 syscall_cancel.c bytes"
    text = data.decode()
    warning = '#warning "This implementation should be use just as reference or for bootstrapping"\n'
    assert text.count(warning) == 1
    begin = text.index('#define ADD_LABEL(__label)')
    end = text.index('  if (__glibc_unlikely (*ch & CANCELED_BITMASK))', begin)
    first = text[begin:end]
    assert first.count('ADD_LABEL ("__syscall_cancel_arch_start");') == 1
    last = '  ADD_LABEL ("__syscall_cancel_arch_end");\n'
    assert text.count(last) == 1
    # Only the assembler-label definition and its two calls are removed.
    # All actual GNU pending checks, syscall transport and result semantics
    # remain unchanged. The owned predicate authenticates this real function's
    # admitted descriptor and restored delivery instead of inventing a PC.
    transformed = text.replace(warning, '', 1).replace(first, '', 1).replace(last, '', 1)
    introduction = ('/* Owned Wasm selection of the GNU reference body. ELF PC labels\n'
                    '   are replaced by the version3 authenticated real activation/result\n'
                    '   predicate. This source alone does not implement forced unwind. */\n')
    output.mkdir()
    (output / 'syscall_cancel-original.c').write_bytes(data)
    (output / 'syscall_cancel_arch.c').write_text(introduction + transformed)
    restored = transformed.replace('  if (__glibc_unlikely (*ch & CANCELED_BITMASK))',
                                   first + '  if (__glibc_unlikely (*ch & CANCELED_BITMASK))', 1)
    restored = restored.replace('  if (__glibc_unlikely (INTERNAL_SYSCALL_ERROR_P (result)))',
                                last + '  if (__glibc_unlikely (INTERNAL_SYSCALL_ERROR_P (result)))', 1)
    restored = restored.replace('#include <pthreadP.h>\n', '#include <pthreadP.h>\n\n' + warning, 1)
    # Original blank line around the reference warning is preserved exactly.
    restored = restored.replace(warning + '\n\n', warning + '\n', 1)
    assert restored.encode() == data
    proof = {'scope': 'GNU reference-body selection, not runtime acceptance',
             'source': {'path': str(source), 'sha256': sha(data), 'bytes': len(data)},
             'output': {'path': str(output / 'syscall_cancel_arch.c'),
                        'sha256': sha((introduction + transformed).encode())},
             'removed': {'warning': warning, 'startMacroAndCall': first, 'endCall': last},
             'reverseExactGNUBytes': True, 'runtimeAcceptance': False}
    (output / 'proof.json').write_text(json.dumps(proof, indent=2) + '\n')
    print(json.dumps({'pass': True, 'proof': str(output / 'proof.json')}))


if __name__ == '__main__':
    main()
