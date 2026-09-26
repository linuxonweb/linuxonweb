#!/usr/bin/env python3
"""Relink a preserved picker-enabled Firefox with statically registered FFVPX.

The original source/object trees and live archives are never changed. Commands,
logs, the exact source patch and all replacement objects remain in --output.
"""
import argparse
import difflib
import json
import os
import re
from pathlib import Path
import shlex
import shutil
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--objects', type=Path, required=True)
parser.add_argument('--picker-build', type=Path, required=True)
parser.add_argument('--libcxx-include', type=Path, required=True)
parser.add_argument('--xcb-include', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--wasm-opt', default='wasm-opt')
parser.add_argument('--ar', default='llvm-ar')
parser.add_argument('--xpt-object', type=Path,
                    help='Verified replacement XPT transfer callback object')
parser.add_argument('--audio-backend', action='store_true',
                    help='Add the output-only linux.audio_write cubeb backend')
args = parser.parse_args()
obj, baseline, out = (p.resolve() for p in
                      (args.objects, args.picker_build, args.output))
out.mkdir(parents=True, exist_ok=True)
# The preserved incremental build kept the final MIME/prompt response separately.
response_name = ('firefox-aurora-prompts.list'
                 if (baseline / 'firefox-aurora-prompts.list').is_file()
                 else 'firefox-aurora.list')
link_name = ('link-prompts-command.txt'
             if response_name == 'firefox-aurora-prompts.list'
             else 'link-command.txt')


def run(command, name, cwd=out):
    (out / (name + '-command.txt')).write_text(shlex.join(command) + '\n')
    env = os.environ.copy()
    env['TMPDIR'] = str(out)
    with (out / (name + '.log')).open('w') as log:
        subprocess.run(command, cwd=cwd, env=env, stdout=log,
                       stderr=subprocess.STDOUT, check=True)
    print(name + ' passed', flush=True)


filename = 'dom/media/platforms/ffmpeg/ffvpx/FFVPXRuntimeLinker.cpp'
entries = json.loads((obj / 'clangd/compile_commands.json').read_text())
entry = next(e for e in entries if e['file'].endswith(filename))
source = Path(entry['file'])
if not source.is_absolute():
    source = Path(entry['directory']) / source
original = source.read_text()
text = original.replace('#include "FFVPXRuntimeLinker.h"',
                        '#ifdef __wasm__\n#include "prlink.h"\n'
                        '#include "ffvpx-static.h"\n#endif\n'
                        '#include "FFVPXRuntimeLinker.h"', 1)
anchor = '  sLinkStatus = LinkStatus_FAILED;\n'
assert text.count(anchor) == 1
text = text.replace(anchor, anchor + '''
#ifdef __wasm__
  // These codecs are linked into the executable; dlopen cannot load Wasm DSOs.
  sFFVPXLib.mAVCodecLib =
      PR_LoadStaticLibrary("mozavcodec-wasm", kLowlandAVCodec);
  sFFVPXLib.mAVUtilLib =
      PR_LoadStaticLibrary("mozavutil-wasm", kLowlandAVUtil);
  const auto result = sFFVPXLib.Link();
  fprintf(stderr, "[WASM_MEDIA] ffvpx link=%s codec=%u opus=%d\\n",
          FFmpegLibWrapper::LinkResultToString(result), ::avcodec_version(),
          ::avcodec_find_decoder(AV_CODEC_ID_OPUS) != nullptr);
  if (result == FFmpegLibWrapper::LinkResult::Success) {
    sLinkStatus = LinkStatus_SUCCEEDED;
    return true;
  }
  return false;
#else
''', 1)
anchor = '  return false;\n}\n\n/* static */\nalready_AddRefed<PlatformDecoderModule>'
assert text.count(anchor) == 1
text = text.replace(anchor, '  return false;\n#endif\n}\n\n/* static */\n'
                    'already_AddRefed<PlatformDecoderModule>', 1)
(out / 'FFVPXRuntimeLinker.cpp').write_text(text)
(out / 'static-media.patch').write_text(''.join(difflib.unified_diff(
    original.splitlines(True), text.splitlines(True),
    fromfile='a/' + filename, tofile='b/' + filename)))
shutil.copyfile(Path(__file__).with_name('ffvpx-static.h'), out / 'ffvpx-static.h')
command = shlex.split(entry['command'])
assert command[1:4] == ['-o', '/dev/null', '-c']
command[2] = str(out / 'FFVPXRuntimeLinker.o')
command[-1] = str(out / 'FFVPXRuntimeLinker.cpp')
command[4:4] = ['-I' + str(source.parents[5] / 'media/ffvpx')]
position = command.index('-I' + str(obj / 'dist/system_wrappers')) + 1
for include in (args.libcxx_include, args.xcb_include):
    assert include.is_dir(), include
    command[position:position] = ['-isystem', str(include.resolve())]
    position += 2
run(command, 'compile-static-media', Path(entry['directory']))

# Preserve strict Opus padding checks, but use the actual final packet duration
# when the container duration has already excluded its discard padding.
demux_entry = next(e for e in entries if e['file'].endswith('/webm/WebMDemuxer.cpp'))
demux_source = Path(demux_entry['file'])
if not demux_source.is_absolute():
    demux_source = Path(demux_entry['directory']) / demux_source
demux_patch = Path(__file__).resolve().parents[1] / 'firefox-patches/0009-wasm-webm-opus-tail-duration.patch'
demux_tree = out / 'demux-source/dom/media/webm'
demux_tree.mkdir(parents=True, exist_ok=True)
shutil.copyfile(demux_source, demux_tree / 'WebMDemuxer.cpp')
run(['patch', '-p1', '--forward', '--batch', '-i', str(demux_patch)],
    'patch-opus-duration', out / 'demux-source')
unified_name = 'Unified_cpp_dom_media_webm0'
unified = (obj / 'dom/media/webm' / (unified_name + '.cpp')).read_text()
assert str(demux_source) in unified
unified = unified.replace(str(demux_source), str(demux_tree / 'WebMDemuxer.cpp'))
(out / (unified_name + '.cpp')).write_text(unified)
demux_command = shlex.split(demux_entry['command'])
assert demux_command[1:4] == ['-o', '/dev/null', '-c']
demux_command[2] = str(out / (unified_name + '.o'))
demux_command[-1] = str(out / (unified_name + '.cpp'))
demux_command[4:4] = ['-I' + str(demux_source.parents[3] / 'media/libopus/include')]
position = demux_command.index('-I' + str(obj / 'dist/system_wrappers')) + 1
for include in (args.libcxx_include, args.xcb_include):
    demux_command[position:position] = ['-isystem', str(include.resolve())]
    position += 2
run(demux_command, 'compile-opus-duration', Path(demux_entry['directory']))

audio_entry = next(e for e in entries
                   if e['file'].endswith('media/libcubeb/src/cubeb.c'))
# Keep mmap allocations aligned to the actual guest page size. Rust memmap2
# rounds the address down to this boundary before unmapping audio IPC buffers.
mmap_tree = out / 'mmap-source'
(mmap_tree / 'sys').mkdir(parents=True, exist_ok=True)
shims = Path(__file__).resolve().parent
shutil.copyfile(shims / 'mmap-shim.c', mmap_tree / 'mmap-shim.c')
shutil.copyfile(shims / 'sys/mman.h', mmap_tree / 'sys/mman.h')
mmap_command = shlex.split(audio_entry['command'])
mmap_output = mmap_command.index('-o') + 1
assert mmap_command[mmap_output] == '/dev/null' and '-c' in mmap_command
mmap_command[mmap_output] = str(out / 'mmap-shim.o')
mmap_command[-1] = str(mmap_tree / 'mmap-shim.c')
mmap_command.insert(1, '-I' + str(mmap_tree))
run(mmap_command, 'compile-mmap-alignment', Path(audio_entry['directory']))

if args.audio_backend:
    audio_source = Path(audio_entry['file'])
    if not audio_source.is_absolute():
        audio_source = Path(audio_entry['directory']) / audio_source
    audio_original = audio_source.read_text()
    audio_text = audio_original.replace(
        'int\ncubeb_init(',
        '#ifdef __wasm__\nint wasm_init(cubeb **, char const *);\n#endif\n\n'
        'int\ncubeb_init(', 1)
    assert audio_text != audio_original
    assert audio_text.count('    init_oneshot,') == 1
    audio_text = audio_text.replace('    init_oneshot,',
        '    init_oneshot,\n#ifdef __wasm__\n    wasm_init,\n#endif', 1)
    (out / 'cubeb.c').write_text(audio_text)
    (out / 'cubeb-backend.patch').write_text(''.join(difflib.unified_diff(
        audio_original.splitlines(True), audio_text.splitlines(True),
        fromfile='a/media/libcubeb/src/cubeb.c',
        tofile='b/media/libcubeb/src/cubeb.c')))
    shutil.copyfile(Path(__file__).with_name('cubeb_wasm.c'), out / 'cubeb_wasm.c')
    for stem in ('cubeb', 'cubeb_wasm'):
        audio_command = shlex.split(audio_entry['command'])
        output_position = audio_command.index('-o') + 1
        assert audio_command[output_position] == '/dev/null' and '-c' in audio_command
        audio_command[output_position] = str(out / (stem + '.o'))
        audio_command[-1] = str(out / (stem + '.c'))
        run(audio_command, 'compile-' + stem, Path(audio_entry['directory']))

# Archive membership is lazy, which also avoids duplicate private FFmpeg
# utility definitions that normally live in separate native shared libraries.
archives = []
for name in ('libavcodec', 'libavutil'):
    members = sorted((obj / 'media/ffvpx' / name).rglob('*.o'))
    assert members, name
    archive = out / (name + '-wasm.a')
    archive.unlink(missing_ok=True)
    run([args.ar, 'crs', str(archive), *map(str, members)], 'archive-' + name)
    archives.append(archive)
response = (baseline / response_name).read_text()
old_object = '../../' + filename.removesuffix('.cpp') + '.o'
assert response.count(old_object) == 1
response = response.replace(old_object, str(out / 'FFVPXRuntimeLinker.o'))
old_demux = '../../dom/media/webm/' + unified_name + '.o'
assert response.count(old_demux) == 1
response = response.replace(old_demux, str(out / (unified_name + '.o')))
if args.audio_backend:
    old_cubeb = '../../media/libcubeb/src/cubeb.o'
    assert response.count(old_cubeb) == 1
    response = response.replace(old_cubeb, str(out / 'cubeb.o'))
    response += '\n' + str(out / 'cubeb_wasm.o') + '\n'
if args.xpt_object:
    matches = re.findall(r'(?m)^\S*/xptcall_wasm32\.o$', response)
    assert len(matches) == 1, matches
    old_xpt = matches[0]
    assert args.xpt_object.is_file()
    xpt_copy = out / 'xptcall_wasm32.o'
    if args.xpt_object.resolve() != xpt_copy:
        shutil.copyfile(args.xpt_object, xpt_copy)
    response = response.replace(old_xpt, str(xpt_copy))
response += '\n' + '\n'.join(map(str, archives)) + '\n'
(out / 'firefox-media.list').write_text(response)
command = shlex.split((baseline / link_name).read_text())
old_mmaps = [word for word in command if word.endswith('/mmap-shim-fixed.o')]
assert len(old_mmaps) == 1, 'expected the preserved Firefox mmap shim'
command[command.index(old_mmaps[0])] = str(out / 'mmap-shim.o')
# FFVPX adds static codec tables above the preserved build's 64 MiB minimum.
# Reserve 80 MiB while retaining the existing maximum and 16 MiB stack.
command = ['--initial-memory=83886080' if word.startswith('--initial-memory=')
           else word for word in command]
command[command.index('@' + str(baseline / response_name))] = \
    '@' + str(out / 'firefox-media.list')
command[command.index('-o') + 1] = str(out / 'firefox-media-raw.wasm')
run(command, 'link-static-media', obj / 'browser/app')
run([args.wasm_opt, '--all-features', '--disable-compact-imports',
     '--pass-arg=max-func-params@23', '--fpcast-emu',
     str(out / 'firefox-media-raw.wasm'), '-o', str(out / 'firefox-media.wasm')],
    'fpcast-static-media')
run(['wasm-validate', '--enable-all', str(out / 'firefox-media.wasm')],
    'validate-static-media')
print(out / 'firefox-media.wasm')
