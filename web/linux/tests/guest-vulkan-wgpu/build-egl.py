#!/usr/bin/env python3
"""Bounded EGL primitive using immutable retained Mesa26.2.3 and fresh guest ICD."""
import argparse,hashlib,json,os,pathlib,resource,subprocess,shutil
from build import ROOT,SOURCE,TASK,OLD,CC,sha
MESA=pathlib.Path('/mnt/p6/build/zink-b3-20260930/mesa-26.2.3')
RETAINED=pathlib.Path('/mnt/p6/build/glgears-zink-20261001/link/egl2')
PINS={'libEGL_mesa.a':'b87506ed6dcb83778bf7ba53d1bc56587b330d68dff54b0838bc97e281f6efc8','libGLESv2_mesa.a':'77d10b095649bc5c24cb89cee6e5990e3cf6b4a7fee23bae62a531d51b0e4cba','libgallium_zink.a':'c7216add6a70a2a3d94ccae7eefbbd9e7884e1cb2af2c4d257536de15a6b88aa'}
def main():
 ap=argparse.ArgumentParser();ap.add_argument('--output',type=pathlib.Path,required=True);o=ap.parse_args().output.resolve();assert o.is_relative_to(TASK) and not o.exists();assert shutil.disk_usage(TASK).free>=20*1024**3
 o.mkdir();(o/'tmp').mkdir();env={**os.environ,'TMPDIR':str(o/'tmp'),'TMP':str(o/'tmp'),'TEMP':str(o/'tmp')};commands=[]
 def run(args,name):
  def guard():resource.setrlimit(resource.RLIMIT_AS,(4*1024**3,4*1024**3));resource.setrlimit(resource.RLIMIT_CORE,(0,0));os.sched_setaffinity(0,{min(os.sched_getaffinity(0))})
  p=subprocess.run(list(map(str,args)),stdout=subprocess.PIPE,stderr=subprocess.STDOUT,env=env,timeout=180,preexec_fn=guard);(o/(name+'.log')).write_bytes(p.stdout);commands.append({'argv':list(map(str,args)),'exit':p.returncode,'log':str(o/(name+'.log'))});assert not p.returncode,p.stdout.decode(errors='replace')
 libs=[]
 for name,pin in PINS.items():
  p=RETAINED/'lib'/name;assert sha(p)==pin,'retained Mesa archive changed';libs.append(p)
 flags=['-O2','-std=c11','-Wall','-Wextra','-Werror','-pthread','-matomics','-mbulk-memory','-ffunction-sections','-fdata-sections','-I'+str(OLD/'headers-source/include'),'-I'+str(MESA/'include')]
 for name,source in [('egl-primitive',SOURCE/'egl-primitive.c'),('icd',ROOT/'web/linux/tests/guest-vulkan/icd.c'),('transport',ROOT/'web/linux/tests/guest-gpu/guest-gpu.c')]:run([CC,*flags,'-DGUEST_VK_ZINK=1','-MMD','-MF',o/(name+'.d'),'-c',source,'-o',o/(name+'.o')],'compile-'+name)
 objects=[RETAINED/'obj'/name for name in ['zink_static_vk.o','mmap-shim.o','unwind-stubs.o','ovr-builtin_functions.o']]
 app=o/'guest-wgpu-egl-primitive.wasm';run([CC+'++','-pthread','-matomics','-mbulk-memory','-static','-nostdlib++','-Wl,--gc-sections,--import-memory,--export-table,--shared-memory','-Wl,--initial-memory=16777216,--max-memory=4294967296,-z,stack-size=1048576',o/'egl-primitive.o',*objects,*libs,o/'icd.o',o/'transport.o','-lc++','-lc++abi','-lm','-o',app],'link');run(['wasm-validate','--enable-all',app],'validate')
 inputs=[SOURCE/'egl-primitive.c',*objects,*libs,RETAINED/'artifacts.txt',RETAINED/'link.command.txt']
 for dep in o.glob('*.d'):inputs.extend(pathlib.Path(p) for p in dep.read_text().replace('\\\n',' ').split(':',1)[1].split())
 report={'pass':True,'testOnly':True,'artifact':str(app),'bytes':app.stat().st_size,'sha256':sha(app),'inputs':[{'path':str(p),'bytes':p.stat().st_size,'sha256':sha(p)}for p in sorted(set(inputs))],'commands':commands,'scope':'actual retained Mesa26.2.3 EGL/GLES2/Zink archives; fresh nonconformant Vulkan ICD; indexed uniform/texture/depth primitive; no Firefox acceptance'};(o/'build.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'pass':True,'artifact':str(app),'bytes':app.stat().st_size}))
if __name__=='__main__':main()
