#!/usr/bin/env python3
"""Compile the isolated lifecycle/partial clear-copy guest. No execution or packaging."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys
sys.dont_write_bytecode = True
from storage import checked_storage

def digest(data):
    return hashlib.sha256(data).hexdigest()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    out, storage = checked_storage(args.output)
    out.mkdir(parents=True, exist_ok=False)
    here = Path(__file__).resolve().parent
    provenance = json.loads((here / 'header-provenance.json').read_text())
    headers = out / 'include/vulkan'; headers.mkdir(parents=True)
    for name, expected in provenance['files'].items():
        data = (Path(provenance['sourceDirectory']) / name).read_bytes()
        if digest(data) != expected:
            raise ValueError('pinned header changed: ' + name)
        (headers / name).write_bytes(data)
    if b'#define VK_HEADER_VERSION 231' not in (headers / 'vulkan_core.h').read_bytes():
        raise ValueError('unexpected header version')
    sources = {}
    for relative in ('guest-vulkan/icd.c', 'guest-vulkan/icd.h', 'guest-vulkan/lifecycle.c', 'guest-vulkan/transfer.inc', 'guest-vulkan/compute.inc', 'guest-vulkan/graphics.inc', 'guest-vulkan/graphics-commands.inc', 'guest-vulkan/uniform.inc','guest-vulkan/texture.inc', 'guest-vulkan/clear-test.inc', 'guest-vulkan/exhaustion-test.inc',
                     'guest-gpu/guest-gpu.c', 'guest-gpu/guest-gpu.h'):
        original = here.parent / relative
        data = original.read_bytes(); target = out / 'frozen' / relative
        target.parent.mkdir(parents=True, exist_ok=True); target.write_bytes(data)
        sources[relative] = {'source': str(original), 'sha256': digest(data)}
    cc = '/nix/store/j8mdl69qafyijllv7s703219nb5fnrdp-wasm32-unknown-linux-musl-llvm-toolchain-wrapper-22.1.8/bin/wasm32-unknown-linux-musl-clang'
    artifact = out / 'guest-vulkan-lifecycle.wasm'
    command = [cc, '-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', '-pthread', '-matomics', '-mbulk-memory',
               '-ffunction-sections', '-fdata-sections', '-static', '-I' + str(out / 'include'),
               str(out / 'frozen/guest-vulkan/icd.c'), str(out / 'frozen/guest-vulkan/lifecycle.c'),
               str(out / 'frozen/guest-gpu/guest-gpu.c'),
               '-Wl,--gc-sections,--import-memory,--export-table,--shared-memory',
               '-Wl,--initial-memory=2097152,--max-memory=4294967296,-z,stack-size=262144', '-o', str(artifact)]
    for name, cmd in [('compile', command), ('validate', ['wasm-validate', '--enable-all', str(artifact)]),
                      ('abi', ['wasm-objdump', '-x', str(artifact)])]:
        (out / (name + '.command.txt')).write_text(shlex.join(cmd) + '\n')
        with (out / (name + '.log')).open('w') as log:
            subprocess.run(cmd, stdout=log, stderr=subprocess.STDOUT, env=os.environ.copy(), check=True, timeout=120)
    imports = re.findall(r' <- (\S+)', (out / 'abi.log').read_text())
    allowed = {'env.memory', 'linux.syscall', 'linux.get_thread_area', 'linux.copy_siginfo'}
    if not imports or 'env.memory' not in imports or set(imports) - allowed:
        raise ValueError('unexpected Wasm imports: ' + repr(imports))
    host_sources = {relative: digest((here.parent / relative).read_bytes()) for relative in
                    ('guest-gpu/host.mjs', 'guest-vulkan/host.mjs', 'guest-vulkan/index.html')}
    report = {'pass': True, 'testOnly': True, 'scope': 'Compiled experimental lifecycle and partial clear-copy profile; guest execution still required; not conformant Vulkan',
              'artifact': str(artifact), 'bytes': artifact.stat().st_size, 'sha256': digest(artifact.read_bytes()),
              'headers': provenance, 'sources': sources, 'hostSources': host_sources, 'imports': imports, 'storage': storage}
    (out / 'build.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'pass': True, 'artifact': str(artifact), 'report': str(out / 'build.json')}))

if __name__ == '__main__':
    main()
