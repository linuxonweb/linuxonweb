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
    parser.add_argument('--shader-dir',type=Path,required=False)
    parser.add_argument('--host-profile',choices=['graphics','webgl'],default='graphics')
    parser.add_argument('--present-x11',action='store_true')
    parser.add_argument('--app',choices=['graphics','uniform','texture','depth','wsi','zinkcaps'],default='graphics')
    args=parser.parse_args()
    if args.app in ('uniform','texture','depth','wsi','zinkcaps') and (args.host_profile!='webgl' or args.present_x11):
        raise ValueError(args.app+' application requires the dual-backend host profile without X11')
    if args.app!='wsi' and not args.shader_dir: raise ValueError('--shader-dir is required for '+args.app)
    app_dir={'uniform':'guest-vulkan-uniform','texture':'guest-vulkan-texture','depth':'guest-vulkan-depth','wsi':'guest-vulkan-wsi','zinkcaps':'guest-vulkan-zinkcaps'}.get(args.app,'guest-vulkan-graphics')
    out,storage=checked_storage(args.output);out.mkdir(parents=True,exist_ok=False)
    here=Path(__file__).resolve().parent
    lock=json.loads((here.parent/'guest-vulkan-loader/source-lock.json').read_text())
    for entry in lock['files']:
        data=(args.source_audit/entry['group']/entry['path']).read_bytes()
        if digest(data)!=entry['sha256'] or len(data)!=entry['bytes']: raise ValueError('upstream source changed: '+entry['path'])
        target=out/entry['group']/entry['path'];target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
    sources={}
    for relative in (app_dir+'/client.c','guest-vulkan-loader/unknown-disabled.c','guest-vulkan-loader/static-provider.inc',
            'guest-vulkan-loader/port.py','guest-vulkan-loader/build.py','guest-vulkan-graphics/build.py','guest-vulkan-graphics/storage.py','guest-vulkan-loader/storage.py','guest-vulkan-loader/source-lock.json',
            'guest-vulkan/icd.c','guest-vulkan/icd.h','guest-vulkan/transfer.inc', 'guest-vulkan/compute.inc','guest-vulkan/graphics.inc','guest-vulkan/graphics-commands.inc','guest-vulkan/uniform.inc','guest-vulkan/texture.inc','guest-vulkan/wsi.inc','guest-vulkan/zink.inc','guest-vulkan/zink-stubs.inc','guest-vulkan/zink-ext.h','guest-gpu/guest-gpu.c','guest-gpu/guest-gpu.h'):
        data=(here.parent/relative).read_bytes();target=out/'frozen'/relative
        target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
        sources[relative]={'source':str(here.parent/relative),'sha256':digest(data)}
    x11_inputs={};x11_libraries=[];x11_flags=[];wsi_flags=[]
    if args.present_x11 or args.app=='wsi':
        if args.host_profile!='webgl':raise ValueError('X11 presentation gate requires dual-backend host profile')
        if args.present_x11:
            relative='guest-vulkan-graphics/presentation-x11.inc';data=(here.parent/relative).read_bytes()
            (out/'frozen'/relative).write_bytes(data);sources[relative]={'source':str(here.parent/relative),'sha256':digest(data)}
        packages={'x11':'gqaysz4gcpwh3hjpj55k8j9mf7lya7xs-libX11-static-wasm32-unknown-linux-musl-1.8.13',
          'proto':'7fl11iw0s4srx2300pnb28wwpibky6wh-xorgproto-static-wasm32-unknown-linux-musl-2024.1',
          'xcb':'wlbxw5w935lipm9imsz9jvsyk0mm322x-libxcb-static-wasm32-unknown-linux-musl-1.17.0',
          'xau':'r79l4jh7kmlcz6vmfiv02gw1p1iqb4m5-libXau-static-wasm32-unknown-linux-musl-1.0.12'}
        for key in (('x11','proto','xcb') if args.app=='wsi' else ('x11','proto')):
            include=Path('/nix/store')/packages[key]/'include'
            for source in sorted(include.rglob('*')):
                if source.is_file():
                    data=source.read_bytes();target=out/'x11-inputs'/key/'include'/source.relative_to(include)
                    target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data);x11_inputs[str(source)]=digest(data)
            x11_flags+=['-I'+str(out/'x11-inputs'/key/'include')]
        for key,name in [('x11','libX11.a'),('xcb','libxcb.a'),('xau','libXau.a')]:
            source=Path('/nix/store')/packages[key]/'lib'/name;data=source.read_bytes();target=out/'x11-inputs'/name
            target.write_bytes(data);x11_inputs[str(source)]=digest(data);x11_libraries.append(str(target))
        if args.present_x11: x11_flags+=['-DGUEST_PRESENT_X11=1']
        if args.app=='wsi':
            # A6a: loader wsi.c X platforms plus the ICD's WSI surface/swapchain objects.
            wsi_flags=['-DVK_USE_PLATFORM_XLIB_KHR','-DVK_USE_PLATFORM_XCB_KHR',*x11_flags]
            # The loader source audit froze only the core/beta headers; the two platform headers come from the same
            # Vulkan-Headers commit 98f440ce (v1.3.231), retrieved once into the A6a task and pinned here by hash.
            wsi_headers=Path('/mnt/p6/build/guest-vulkan-a6a-20260930/wsi-headers-run1/include/vulkan')
            for name,sha in (('vulkan_xlib.h','e2efd24ada4479131f932dea1cd2f4dad9b3aad44aae60330fde9679a70f3d52'),
                             ('vulkan_xcb.h','972d6d7f2ff66bc3d8f627bd66cffcc75ba9fb1d16a7acec7fd9d93dd85c243c')):
                data=(wsi_headers/name).read_bytes()
                if digest(data)!=sha: raise ValueError('pinned WSI header changed: '+name)
                (out/'headers-source/include/vulkan'/name).write_bytes(data);x11_inputs[str(wsi_headers/name)]=sha
    shader_sources={}
    generated=[]
    expected={
        'index.vert':'732d95164134409bf7f05283bfa8aefc716c206ed31652595b540083ad5b9a90',
        'color.frag':'771776ecc4dd700bf345309318799f006b8712186fa040d8b298d0da59ff625e',
        'offset.vert':'699703bbc6ca5d438dfc07af28503cae838c66980cb9c9c33dc56fa551d75791',
        'tint.frag':'688c8ec2e04d2733eadbd9ef497a60e737f30672d5247fcb4f94bc0596f4729f',
        'bad-binding.frag':'bf200eee73b09712b46825f53aab6f180e48fedc8d31bf002ef23e25080bffa3',
        'bad-member.frag':'faeb3c4322df26c0f0175473fbf909f5bdefb8b3b1db62966eeb9b5d47f6f061'} if args.app=='uniform' else {
        'tex.vert':'2ddd32eb3a31409e2aad1c0fe8c0de42adcca49a61804620cedd0e4a57db7610',
        'tex.frag':'9acca836e7816bae502c85fd48fdc6702728ccae14358e67b40d4ebe72906326',
        'pair.frag':'ca35919041af6532728e731adcead6427fa94acf1eae7e4259eee427dc3912d3',
        'vfetch.vert':'85db68bd3889d8a543931f03ee96e768bb8a2b0479cbbdb4871ccdcefbf08230',
        'vcolor.frag':'2767646d0184ab7bf388b6279d10e84cb5ba97ad4d448b0e355a743b35317c70',
        'bad-separate.frag':'ec692ed6766b21ee54129e804050de33265e93b6f0d1a782e717fa8bb8da0c78',
        'bad-array.frag':'973f7afd7ad307c9914f8ef62a7b96988b2898ec72410212742891b965302f1b',
        'bad-3d.frag':'628541ae120150162f4804a2cefb08f52e04ddcbbd415a29cd093580e69961ed',
        'bad-shadow.frag':'a6954aa00c1dbd93bea59536c85b60ab811a9c990de4ed6ad0feee1c4ac1c854',
        'bad-integer.frag':'76d76a74ba291f58d3e6b3ab40904b14147e74146050195c3cc06dda27b5c618',
        'bad-param.frag':'c2f5314a734fbf9a692c48aa8dbb269cfde5943a95fb78eb72e3fadc7527b73d',
        'bad-fetch.frag':'9b5fea1e53047d29751abb4a60a89c82a58d4c0b5c1bcf3d4f48efd5b63f249c',
        'bad-binding.frag':'45cf2db2a1961aa781475523856cfd75db365462b54f36f465f579106f95e789'} if args.app=='texture' else {
        'depth.vert':'82a84601b8a267e8e6eb477065e53e4687fc4ada80b53f7d3fef4aed85506b1e',
        'depth.frag':'2767646d0184ab7bf388b6279d10e84cb5ba97ad4d448b0e355a743b35317c70'} if args.app=='depth' else {
        'depth.vert':'82a84601b8a267e8e6eb477065e53e4687fc4ada80b53f7d3fef4aed85506b1e',
        'depth.frag':'2767646d0184ab7bf388b6279d10e84cb5ba97ad4d448b0e355a743b35317c70',
        'offset.vert':'699703bbc6ca5d438dfc07af28503cae838c66980cb9c9c33dc56fa551d75791',
        'tint.frag':'688c8ec2e04d2733eadbd9ef497a60e737f30672d5247fcb4f94bc0596f4729f'} if args.app=='zinkcaps' else {
        'pair-a.vert':'3c5c5f393543b169146cb487d2754661eb881233c54023cc4ad357802519314f',
        'pair-a.frag':'6302e16384abb31306db37b6e39702d4e98e65734f2ec7d31d1b49c30243f3e4',
        'pair-b.vert':'13469cb19a3cde7d666ac87631f7b9640d4c932727ad2e984803078a0a4183f5',
        'pair-b.frag':'4042e45c744fb5ef2b227c18cf87468d371af1d8ee581f1e30e8f026f4f4d5e8',
        'resource.frag':'de7e4f2a0fc86fd2762faffa5e88afaf7cf9d1b6eba4d5d59e432d12ea53200f'}
    if args.app=='wsi': expected={}
    manifest=(args.shader_dir/'fixtures.json').read_bytes() if args.shader_dir else b'{"shaders":[]}\n'
    (out/'frozen'/app_dir/'fixtures.json').write_bytes(manifest)
    for tag,sha in expected.items():
        data=(args.shader_dir/(tag+'.spv')).read_bytes()
        if len(data)<20 or len(data)>65536 or len(data)%4 or digest(data)!=sha:raise ValueError('SPIR-V fixture hash mismatch: '+tag)
        (out/'frozen'/app_dir/(tag+'.spv')).write_bytes(data)
        shader_sources[tag]={'sha256':digest(data),'bytes':len(data)}
        symbol=tag.replace('-','_').replace('.','_')
        generated.append('static const unsigned char shader_'+symbol+'[] = {'+','.join(str(n) for n in data)+'};')
    (out/'frozen'/app_dir/'shaders.h').write_text('\n'.join(generated)+'\n')
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
        '-fno-strict-aliasing','-fno-builtin-memcmp','-Wno-unused-parameter','-Wno-unused-function','-Wno-missing-field-initializers',*wsi_flags]
    # Upstream metadata requires beta declarations; ICD advertises none.
    # No WSI, Linux PCI sorting, assembly, generic unknown thunks.
    names=['allocation','cJSON','debug_utils','extension_manual','get_environment','gpa_helper','loader','log','terminator','trampoline','wsi']
    objects=[]
    for name in names:
        target=obj/(name+'.o');run('compile-'+name,[cc,*loader_flags,'-c',str(out/'loader-source/loader'/(name+'.c')),'-o',str(target)]);objects.append(target)
    target=obj/'unknown-disabled.o';run('compile-unknown-disabled',[cc,*loader_flags,'-c',str(fixture/'unknown-disabled.c'),'-o',str(target)]);objects.append(target)
    archive=out/'libvulkan-guest-static.a'
    run('archive',['llvm-ar','rcs',str(archive),*[str(p) for p in objects]])
    for name,relative in [('client',app_dir+'/client.c'),('icd','guest-vulkan/icd.c'),('transport','guest-gpu/guest-gpu.c')]:
        extra=(wsi_flags+(['-DGUEST_VK_WSI=1'] if name=='icd' else []) if name!='transport' else []) if args.app=='wsi' else (x11_flags if name=='client' else [])
        if args.app=='zinkcaps' and name=='icd': extra=extra+['-DGUEST_VK_ZINK=1']  # B2a Zink extension profile
        run('compile-'+name,[cc,*flags,*extra,'-c',str(out/'frozen'/relative),'-o',str(obj/(name+'.o'))])
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
    run('link',[cc,'-pthread','-matomics','-mbulk-memory','-static',str(obj/'client.o'),str(archive),str(obj/'icd.o'),str(obj/'transport.o'),*x11_libraries,'-lm',
        '-Wl,--gc-sections,--import-memory,--export-table,--shared-memory','-Wl,--initial-memory=2097152,--max-memory=4294967296,-z,stack-size=262144',
        '-Wl,-Map='+str(out/'link.map'),'-o',str(artifact)])
    run('validate',['wasm-validate','--enable-all',str(artifact)])
    run('abi',['wasm-objdump','-x',str(artifact)])
    imports=re.findall(r' <- (\S+)',(out/'abi.log').read_text())
    if 'env.memory' not in imports or set(imports)-{'env.memory','linux.syscall','linux.get_thread_area','linux.copy_siginfo'}:
        raise ValueError('unexpected imports: '+repr(imports))
    host_files=[
        'guest-gpu/host.mjs','guest-vulkan/host.mjs','guest-vulkan-graphics/index.html','guest-vulkan-graphics/host.mjs',
        'guest-vulkan-graphics/renderer.mjs','guest-vulkan-graphics/translator/index.mjs','guest-vulkan-graphics/translator/worker.mjs','guest-vulkan-graphics/translator/abi.mjs']
    if args.host_profile=='webgl':
        host_files += ['guest-vulkan-webgl/'+name for name in ('guest.html','host.mjs','renderer.mjs','x11-framebuffer.mjs',
            'translator/index.mjs','translator/worker.mjs','translator/abi.mjs')]
    if args.app=='uniform': host_files += ['guest-vulkan-uniform/guest.html']
    if args.app=='texture': host_files += ['guest-vulkan-texture/guest.html']
    if args.app=='depth': host_files += ['guest-vulkan-depth/guest.html']
    if args.app=='wsi': host_files += ['guest-vulkan-wsi/guest.html']
    if args.app=='zinkcaps': host_files += ['guest-vulkan-zinkcaps/guest.html']
    host_sources={relative:digest((here.parent/relative).read_bytes()) for relative in host_files}
    report={'pass':True,'testOnly':True,'artifact':str(artifact),'bytes':artifact.stat().st_size,'sha256':digest(artifact.read_bytes()),
        'scope':'Compiled public Vulkan SPIR-V graphics client; actual guest execution required; partial nonconformant ICD',
        'presentX11':args.present_x11,'wsi':args.app=='wsi','wsiFlags':wsi_flags,'x11Inputs':x11_inputs,
        'upstream':lock,'shaders':shader_sources,'fixtureManifestSha256':digest(manifest),'sources':sources,'hostSources':host_sources,'hostProfile':args.host_profile,'app':args.app,'imports':imports,'storage':storage,
        'publicClientSymbols':public,'loaderArchive':str(archive),'loaderObjects':names+['unknown-disabled'],
        'portPatchSha256':digest((out/'static-loader-port.patch').read_bytes()),'linkMap':str(out/'link.map')}
    (out/'build.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'pass':True,'artifact':str(artifact),'report':str(out/'build.json')}))

if __name__=='__main__':main()
