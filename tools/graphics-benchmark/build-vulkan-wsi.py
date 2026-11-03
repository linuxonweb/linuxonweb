#!/usr/bin/env python3
"""Fresh current guest Vulkan SDK and public vkgears WSI sample; no Firefox inputs."""
import argparse,pathlib,json,hashlib,subprocess,shutil,sys,re,time,importlib.util,os
sys.dont_write_bytecode=True
p=argparse.ArgumentParser();p.add_argument('--source-audit',type=pathlib.Path,required=True);p.add_argument('--output',type=pathlib.Path,required=True);a=p.parse_args();out=a.output.resolve();out.mkdir(parents=True,exist_ok=False);root=pathlib.Path(__file__).resolve().parents[2];tests=root/'web/linux/tests';started=time.time();steps=[];sha=lambda b:hashlib.sha256(b).hexdigest()
if os.statvfs(out).f_bavail*os.statvfs(out).f_frsize<20*1024**3:raise ValueError('20GiB reserve required')
if subprocess.check_output(['findmnt','-n','-o','FSTYPE','--target',str(out)],text=True).strip() in ('tmpfs','ramfs'):raise ValueError('disk-backed build required')
def run(name,cmd):
 begin=time.time();(out/(name+'.command.json')).write_text(json.dumps(cmd)+'\n')
 with (out/(name+'.log')).open('w') as log:r=subprocess.run(cmd,stdout=log,stderr=subprocess.STDOUT,timeout=180)
 steps.append({'name':name,'seconds':time.time()-begin,'exitCode':r.returncode});(out/'steps.json').write_text(json.dumps(steps,indent=2)+'\n');r.check_returncode()
lock=json.loads((a.source_audit/'source-lock.json').read_text())
for entry in lock['files']:
 data=(a.source_audit/entry['group']/entry['path']).read_bytes();assert sha(data)==entry['sha256'];target=out/entry['group']/entry['path'];target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
sources={}
for directory in ('guest-vulkan','guest-gpu','guest-vulkan-loader','vkgears'):
 for source in (tests/directory).iterdir():
  if source.is_file() and source.suffix in ('.c','.h','.inc','.py','.json'):
   relative=source.relative_to(tests);target=out/'frozen'/relative;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(source.read_bytes());sources[str(relative)]=sha(source.read_bytes())
shutil.copytree(tests/'vkgears/shaders',out/'frozen/vkgears/shaders')
spec=importlib.util.spec_from_file_location('static_port',out/'frozen/guest-vulkan-loader/port.py');port=importlib.util.module_from_spec(spec);spec.loader.exec_module(port);port.apply_port(out/'loader-source',out/'frozen/guest-vulkan-loader',out)
x11={'x11':'gqaysz4gcpwh3hjpj55k8j9mf7lya7xs-libX11-static-wasm32-unknown-linux-musl-1.8.13','proto':'7fl11iw0s4srx2300pnb28wwpibky6wh-xorgproto-static-wasm32-unknown-linux-musl-2024.1','xcb':'wlbxw5w935lipm9imsz9jvsyk0mm322x-libxcb-static-wasm32-unknown-linux-musl-1.17.0','xau':'r79l4jh7kmlcz6vmfiv02gw1p1iqb4m5-libXau-static-wasm32-unknown-linux-musl-1.0.12'}
includes=[];libs=[];inputs={}
for key in ('x11','proto','xcb'):
 src=pathlib.Path('/nix/store')/x11[key]/'include';target=out/'x11-inputs'/key/'include';shutil.copytree(src,target);includes.append('-I'+str(target))
 for f in src.rglob('*'):
  if f.is_file():inputs[str(f)]=sha(f.read_bytes())
for key,name in [('x11','libX11.a'),('xcb','libxcb.a'),('xau','libXau.a')]:
 src=pathlib.Path('/nix/store')/x11[key]/'lib'/name;target=out/'x11-inputs'/name;target.write_bytes(src.read_bytes());libs.append(str(target));inputs[str(src)]=sha(src.read_bytes())
generated=[];shaders={}
for tag in ('gears.vert','gears.frag'):
 source=out/'frozen/vkgears/shaders'/tag;spv=source.with_suffix(source.suffix+'.spv');run('shader-'+tag,['glslangValidator','-V','--target-env','vulkan1.0',str(source),'-o',str(spv)]);run('validate-'+tag,['spirv-val','--target-env','vulkan1.0',str(spv)]);data=spv.read_bytes();shaders[tag]={'sourceSha256':sha(source.read_bytes()),'spirvSha256':sha(data)};generated.append('static const unsigned char shader_'+tag.replace('.','_')+'[] = {'+','.join(map(str,data))+'};')
(out/'frozen/vkgears/shaders.h').write_text('\n'.join(generated)+'\n')
cc='/nix/store/j8mdl69qafyijllv7s703219nb5fnrdp-wasm32-unknown-linux-musl-llvm-toolchain-wrapper-22.1.8/bin/wasm32-unknown-linux-musl-clang'
flags=['-std=c11','-O2','-ffile-prefix-map='+str(out)+'=/gpt6-astra-vulkan-sdk','-Wall','-Wextra','-Werror','-pthread','-matomics','-mbulk-memory','-ffunction-sections','-fdata-sections','-I'+str(out/'headers-source/include'),*includes,'-DVK_USE_PLATFORM_XLIB_KHR','-DVK_USE_PLATFORM_XCB_KHR']
loader_flags=flags+['-I'+str(out/'loader-source/loader'),'-I'+str(out/'loader-source/loader/generated'),'-D_GNU_SOURCE','-DHAVE_ALLOCA_H','-DHAVE_SECURE_GETENV','-DAPI_NAME="Vulkan"','-DVK_ENABLE_BETA_EXTENSIONS','-DFALLBACK_CONFIG_DIRS="/etc/xdg"','-DFALLBACK_DATA_DIRS="/usr/local/share:/usr/share"','-DSYSCONFDIR="/etc"','-fno-strict-aliasing','-fno-builtin-memcmp','-Wno-unused-parameter','-Wno-unused-function','-Wno-missing-field-initializers']
obj=out/'objects';obj.mkdir();objects=[]
for name in ['allocation','cJSON','debug_utils','extension_manual','get_environment','gpa_helper','loader','log','terminator','trampoline','wsi']:
 target=obj/(name+'.o');run('compile-'+name,[cc,*loader_flags,'-c',str(out/'loader-source/loader'/(name+'.c')),'-o',str(target)]);objects.append(str(target))
target=obj/'unknown-disabled.o';run('compile-unknown-disabled',[cc,*loader_flags,'-c',str(out/'frozen/guest-vulkan-loader/unknown-disabled.c'),'-o',str(target)]);objects.append(str(target));archive=out/'libvulkan-guest-static.a';run('archive',['llvm-ar','rcs',str(archive),*objects])
for name,relative,extra in [('client','vkgears/vkgears.c',[]),('icd','guest-vulkan/icd.c',['-DGUEST_VK_WSI=1']),('transport','guest-gpu/guest-gpu.c',[])]:run('compile-'+name,[cc,*flags,*extra,'-c',str(out/'frozen'/relative),'-o',str(obj/(name+'.o'))])
public=re.findall(r'\bU (vk\w+)$',subprocess.check_output(['llvm-nm','--undefined-only',str(obj/'client.o')],text=True),re.M);assert 'vkQueuePresentKHR' in public and 'vkAcquireNextImageKHR' in public and len(public)>25
binary=out/'vkgears-wsi.wasm';run('link',[cc,'-pthread','-matomics','-mbulk-memory','-static',str(obj/'client.o'),str(archive),str(obj/'icd.o'),str(obj/'transport.o'),*libs,'-lm','-Wl,--gc-sections,--import-memory,--export-table,--shared-memory','-Wl,--initial-memory=2097152,--max-memory=4294967296,-z,stack-size=262144','-o',str(binary)])
run('validate',['wasm-validate','--enable-all',str(binary)]);abi=subprocess.check_output(['wasm-objdump','-x',str(binary)],text=True);(out/'abi.log').write_text(abi);imports=re.findall(r' <- (\S+)',abi);assert 'env.memory' in imports and not(set(imports)-{'env.memory','linux.syscall','linux.get_thread_area','linux.copy_siginfo'})
report={'buildPass':True,'runtimeAcceptance':False,'scope':'Current experimental guest Vulkan SDK with public Xlib WSI sample; nonconformant subset, no full Vulkan or OpenGL claim','binary':str(binary),'bytes':binary.stat().st_size,'sha256':sha(binary.read_bytes()),'sourceInputs':sources,'x11Inputs':inputs,'upstream':lock,'shaders':shaders,'publicSymbols':public,'imports':imports,'steps':steps,'seconds':time.time()-started};(out/'build.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:report[k] for k in ('buildPass','runtimeAcceptance','binary','bytes','sha256','seconds')}))
