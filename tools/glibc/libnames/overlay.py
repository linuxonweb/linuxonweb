#!/usr/bin/env python3
"""Expose GNU's genuine library-name generator to the static Wasm port."""
import hashlib
import json
import os
import pathlib
import re
import sys

task = pathlib.Path(os.environ['GLIBC_TASK'])
source = task / 'source/glibc-2.44'
makerules = source / 'Makerules'
text = makerules.read_text()
start = text.index('# Generate the header containing the names of all shared libraries.')
ending = 'common-generated += $(lib-names-h-abi) $(lib-names-stmp-abi)\n'
end = text.index(ending, start) + len(ending)
fragment = text[start:end]
# The upstream build-shared=yes guard encloses this entire genuine recipe.
# Static NPTL sources include this header too; select the same recipe for no.
overlay = ('\nifeq ($(build-shared),no)\n' + fragment + 'endif\n'
           '\n$(common-objpfx)wasm-libnames-sonames.txt:\n'
           '\t{ $(foreach s,$(all-sonames),echo $(s);) } > $@\n')
arch = source / 'sysdeps/wasm32/Makefile'
original = arch.read_bytes()
label = sys.argv[1] if len(sys.argv) == 2 else 'libnames'
assert re.fullmatch(r'[A-Za-z0-9_-]+', label)
snapshot = task / 'source-snapshots' / label
snapshot.mkdir(parents=True)
(snapshot / 'Makefile-before').write_bytes(original)
(snapshot / 'Makerules').write_bytes(makerules.read_bytes())
(snapshot / 'genuine-generator-fragment.mk').write_text(fragment)
arch.write_bytes(original + overlay.encode())
(task / 'logs' / (label + '-overlay.json')).write_text(json.dumps({
    'scope': 'static build metadata; no installed shared libraries or unwind runtime',
    'makerules': str(makerules),
    'makerulesSha256': hashlib.sha256(makerules.read_bytes()).hexdigest(),
    'fragmentSha256': hashlib.sha256(fragment.encode()).hexdigest(),
    'architectureMakefile': str(arch),
    'architectureMakefileSha256': hashlib.sha256(arch.read_bytes()).hexdigest(),
    'upstreamSourceModified': False,
}, indent=2) + '\n')
header = source / 'sysdeps/unix/sysv/linux/wasm32/pthreadP.h'
assert not header.exists()
header.write_bytes((pathlib.Path(__file__).parent / 'pthreadP.h').read_bytes())
