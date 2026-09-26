#!/usr/bin/env python3
"""Reproducible static upstream loader and separate public client; no guest run."""
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
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'guest-vulkan-loader'))
from port import apply_port

def digest(data): return hashlib.sha256(data).hexdigest()

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-audit',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--shader-dir',type=Path,required=True)
    args=parser.parse_args()
    out,storage=checked_storage(args.output);out.mkdir(parents=True,exist_ok=False)
    here=Path(__file__).resolve().parent
    lock=json.loads((here.parent/'guest-vulkan-loader/source-lock.json').read_text())
    for entry in lock['files']:
        data=(args.source_audit/entry['group']/entry['path']).read_bytes()
        if digest(data)!=entry['sha256'] or len(data)!=entry['bytes']: raise ValueError('upstream source changed: '+entry['path'])
        target=out/entry['group']/entry['path'];target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
    sources={}
    for relative in ('guest-vulkan-graphics/client.c','guest-vulkan-loader/unknown-disabled.c','guest-vulkan-loader/static-provider.inc',
            'guest-vulkan-loader/port.py','guest-vulkan-loader/build.py','guest-vulkan-graphics/build.py','guest-vulkan-graphics/storage.py','guest-vulkan-loader/storage.py','guest-vulkan-loader/source-lock.json',
            'guest-vulkan/icd.c','guest-vulkan/icd.h','guest-vulkan/transfer.inc', 'guest-vulkan/compute.inc','guest-vulkan/graphics.inc','guest-vulkan/graphics-commands.inc','guest-gpu/guest-gpu.c','guest-gpu/guest-gpu.h'):
        data=(here.parent/relative).read_bytes();target=out/'frozen'/relative
        target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
        sources[relative]={'source':str(here.parent/relative),'sha256':digest(data)}
    shader_sources={}
    generated=[]
    expected={
        'pair-a.vert':'3c5c5f393543b169146cb487d2754661eb881233c54023cc4ad357802519314f',
        'pair-a.frag':'6302e16384abb31306db37b6e39702d4e98e65734f2ec7d31d1b49c30243f3e4',
        'pair-b.vert':'13469cb19a3cde7d666ac87631f7b9640d4c932727ad2e984803078a0a4183f5',
        'pair-b.frag':'4042e45c744fb5ef2b227c18cf87468d371af1d8ee581f1e30e8f026f4f4d5e8',
        'resource.frag':'de7e4f2a0fc86fd2762faffa5e88afaf7cf9d1b6eba4d5d59e432d12ea53200f'}
    manifest=(args.shader_dir/'fixtures.json').read_bytes()
    (out/'frozen/guest-vulkan-graphics/fixtures.json').write_bytes(manifest)
    for tag,sha in expected.items():
        data=(args.shader_dir/(tag+'.spv')).read_bytes()
        if len(data)<20 or len(data)>65536 or len(data)%4 or digest(data)!=sha:raise ValueError('SPIR-V fixture hash mismatch: '+tag)
        (out/'frozen/guest-vulkan-graphics'/(tag+'.spv')).write_bytes(data)
        shader_sources[tag]={'sha256':digest(data),'bytes':len(data)}
        symbol=tag.replace('-','_').replace('.','_')
        generated.append('static const unsigned char shader_'+symbol+'[] = {'+','.join(str(n) for n in data)+'};')
    (out/'frozen/guest-vulkan-graphics/shaders.h').write_text('\n'.join(generated)+'\n')
    fixture=out/'frozen/guest-vulkan-loader'
    apply_port(out/'loader-source',fixture,out)
    cc='/nix/store/j8mdl69qafyijllv7s703219nb5fnrdp-wasm32-unknown-linux-musl-llvm-toolchain-wrapper-22.1.8/bin/wasm32-unknown-linux-musl-clang'
    flags=['-std=c11','-O2','-Wall','-Wextra','-Werror','-pthread','-matomics','-mbulk-memory',
        '-ffunction-sections','-fdata-sections','-I'+str(out/'headers-source/include')]
    def run(name,cmd):
        (out/(name+'.command.txt')).write_text(shlex.join(cmd)+'\n')
        with (out/(name+'.log')).open('w') as log:
            subprocess.run(cmd,stdout=log,stderr=subprocess.STDOUT,env=os.environ.copy(),check=True,timeout=120)
    obj=out/'objects';obj.mkdir()
    loader_flags=flags+['-I'+str(out/'loader-source/loader'),'-I'+str(out/'loader-source/loader/generated'),
        '-D_GNU_SOURCE','-DHAVE_ALLOCA_H','-DHAVE_SECURE_GETENV','-DAPI_NAME="Vulkan"','-DVK_ENABLE_BETA_EXTENSIONS',
        '-DFALLBACK_CONFIG_DIRS="/etc/xdg"','-DFALLBACK_DATA_DIRS="/usr/local/share:/usr/share"','-DSYSCONFDIR="/etc"',
        '-fno-strict-aliasing','-fno-builtin-memcmp','-Wno-unused-parameter','-Wno-unused-function','-Wno-missing-field-initializers']
    # Upstream metadata requires beta declarations; ICD advertises none.
    # No WSI, Linux PCI sorting, assembly, generic unknown thunks.
    names=['allocation','cJSON','debug_utils','extension_manual','get_environment','gpa_helper','loader','log','terminator','trampoline','wsi']
    objects=[]
    for name in names:
        target=obj/(name+'.o');run('compile-'+name,[cc,*loader_flags,'-c',str(out/'loader-source/loader'/(name+'.c')),'-o',str(target)]);objects.append(target)
    target=obj/'unknown-disabled.o';run('compile-unknown-disabled',[cc,*loader_flags,'-c',str(fixture/'unknown-disabled.c'),'-o',str(target)]);objects.append(target)
    archive=out/'libvulkan-guest-static.a'
    run('archive',['llvm-ar','rcs',str(archive),*[str(p) for p in objects]])
    for name,relative in [('client','guest-vulkan-graphics/client.c'),('icd','guest-vulkan/icd.c'),('transport','guest-gpu/guest-gpu.c')]:
        run('compile-'+name,[cc,*flags,'-c',str(out/'frozen'/relative),'-o',str(obj/(name+'.o'))])
    run('client-symbols',['llvm-nm','--undefined-only',str(obj/'client.o')])
    client_symbols=(out/'client-symbols.log').read_text()
    public=re.findall(r'\bU (vk\w+)$',client_symbols,re.M)
    if len(public)<25 or any('vk_icd' in name or 'guest_vk' in name for name in public) or re.search(r'\bU (?:guest_vk|gpu_)',client_symbols):
        raise ValueError('client does not meet public-only symbol contract')
    run('archive-symbols',['llvm-nm','--defined-only',str(archive)])
    symbols=(out/'archive-symbols.log').read_text()
    for name in public:
        if not re.search(r'\bT '+re.escape(name)+r'$',symbols,re.M): raise ValueError('public symbol absent from upstream archive: '+name)
    if re.search(r'loader_get_(?:dev_ext_trampoline|phys_dev_ext_tramp|phys_dev_ext_termin)|\b(?:vkdev_ext|vkPhysDevExtTramp|vkPhysDevExtTermin)',symbols):
        raise ValueError('unsafe unknown trampoline present')
    artifact=out/'guest-vulkan-public-client.wasm'
    run('link',[cc,'-pthread','-matomics','-mbulk-memory','-static',str(obj/'client.o'),str(archive),str(obj/'icd.o'),str(obj/'transport.o'),'-lm',
        '-Wl,--gc-sections,--import-memory,--export-table,--shared-memory','-Wl,--initial-memory=2097152,--max-memory=4294967296,-z,stack-size=262144',
        '-Wl,-Map='+str(out/'link.map'),'-o',str(artifact)])
    run('validate',['wasm-validate','--enable-all',str(artifact)])
    run('abi',['wasm-objdump','-x',str(artifact)])
    imports=re.findall(r' <- (\S+)',(out/'abi.log').read_text())
    if 'env.memory' not in imports or set(imports)-{'env.memory','linux.syscall','linux.get_thread_area','linux.copy_siginfo'}:
        raise ValueError('unexpected imports: '+repr(imports))
    host_sources={relative:digest((here.parent/relative).read_bytes()) for relative in (
        'guest-gpu/host.mjs','guest-vulkan/host.mjs','guest-vulkan-graphics/index.html','guest-vulkan-graphics/host.mjs',
        'guest-vulkan-graphics/renderer.mjs','guest-vulkan-graphics/translator/index.mjs','guest-vulkan-graphics/translator/worker.mjs','guest-vulkan-graphics/translator/abi.mjs')}
    report={'pass':True,'testOnly':True,'artifact':str(artifact),'bytes':artifact.stat().st_size,'sha256':digest(artifact.read_bytes()),
        'scope':'Compiled public Vulkan SPIR-V graphics client; actual guest execution required; partial nonconformant ICD',
        'upstream':lock,'shaders':shader_sources,'fixtureManifestSha256':digest(manifest),'sources':sources,'hostSources':host_sources,'imports':imports,'storage':storage,
        'publicClientSymbols':public,'loaderArchive':str(archive),'loaderObjects':names+['unknown-disabled'],
        'portPatchSha256':digest((out/'static-loader-port.patch').read_bytes()),'linkMap':str(out/'link.map')}
    (out/'build.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'pass':True,'artifact':str(artifact),'report':str(out/'build.json')}))

if __name__=='__main__':main()
