#!/usr/bin/env python3
"""Compile clipboard and Mesa gears ports using an existing static Mesa/Vulkan build.
No Firefox or Mesa rebuild. Explicit dependency directories keep builds reviewable.
"""
import argparse
import shlex
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--cc', required=True)
    p.add_argument('--cxx', required=True)
    p.add_argument('--gl-build', type=Path, required=True, help='completed tools/glgears link directory')
    p.add_argument('--mesa-source', type=Path, required=True)
    p.add_argument('--vk-build', type=Path, required=True, help='completed vkgears static loader directory')
    p.add_argument('--output', type=Path, required=True)
    a = p.parse_args(); a.output.mkdir(parents=True, exist_ok=False)
    common = ['-O2', '-pthread', '-matomics', '-mbulk-memory', '-ffunction-sections', '-fdata-sections']
    link = ['-pthread', '-matomics', '-mbulk-memory', '-static', '-Wl,--gc-sections,--import-memory,--export-table,--shared-memory', '-Wl,--initial-memory=16777216,--max-memory=4294967296,-z,stack-size=1048576']
    g = a.gl_build.resolve(); v = a.vk_build.resolve(); out = a.output.resolve()
    for name in ['gears.vert', 'gears.frag']:
        if (ROOT / 'web/linux/tests/vkgears/shaders' / name).read_bytes() != (v / 'frozen/vkgears/shaders' / name).read_bytes():
            raise ValueError('Generated Vulkan shader header requires matching source: ' + name)
    def run(name, cmd):
        (out / (name + '.command.txt')).write_text(shlex.join(map(str, cmd)) + '\n')
        with (out / (name + '.log')).open('w') as log:
            subprocess.run(list(map(str,cmd)), check=True, stdout=log, stderr=subprocess.STDOUT, timeout=120)
        print(name + ': passed', flush=True)
    xi = ['-I' + str(g / 'x11/x11-include'), '-I' + str(g / 'x11/proto-include')]
    xlib = [g / ('x11/' + x) for x in ['libX11.a','libxcb.a','libXau.a']]
    run('clipboard', [a.cc, *common, '-std=c11', '-Wall', '-Wextra', '-Werror', '-Wno-misleading-indentation', *xi, ROOT / 'tools/guest-rootfs/clipboard-bridge.c', *link, *xlib, '-o', out / 'clipboard-bridge.wasm'])
    xs = ROOT / 'tools/guest-rootfs/xclip'
    run('xclip', [a.cc, *common, '-DPACKAGE_NAME="xclip"', '-DPACKAGE_VERSION="0.13"', '-I' + str(xs), *xi, xs / 'xclip.c', xs / 'xclib.c', xs / 'xcprint.c', xs / 'guest-input.c', *link, *xlib, '-o', out / 'xclip.wasm'])
    run('glgears-compile', [a.cc, *common, '-std=c11', '-Wall', '-Wextra', '-Werror', '-Wno-unused-parameter', '-I' + str(a.mesa_source.resolve() / 'include'), *xi, '-c', ROOT / 'web/linux/tests/glgears/glgears.c', '-o', out / 'glgears.o'])
    globjects = [g / ('obj/' + x) for x in ['zink_static_vk.o','mmap-shim.o','unwind-stubs.o','ovr-builtin_functions.o']]
    run('glgears-link', [a.cxx, *link, '-nostdlib++', out / 'glgears.o', *globjects, g / 'lib/libEGL_mesa.a', g / 'lib/libgallium_s1.a', g / 'lib/libguest_vk_icd.a', *xlib, '-lc++','-lc++abi','-lm','-o',out / 'glgears.wasm'])
    run('vkgears-compile', [a.cc, *common, '-std=c11', '-Wall', '-Wextra', '-Werror', '-I' + str(v / 'headers-source/include'), '-I' + str(v / 'frozen/vkgears'), *xi, '-c', ROOT / 'web/linux/tests/vkgears/vkgears.c', '-o', out / 'vkgears.o'])
    run('vkgears-link', [a.cc, *link, out / 'vkgears.o', v / 'libvulkan-guest-static.a', v / 'objects/icd.o', v / 'objects/transport.o', *xlib, '-lm','-o',out / 'vkgears.wasm'])
    for name in ['clipboard-bridge','xclip','glgears','vkgears']:
        run(name + '-validate', ['wasm-validate','--enable-all',out / (name + '.wasm')])
        print(name + ': ' + str((out / (name + '.wasm')).stat().st_size) + ' bytes')

if __name__ == '__main__': main()
