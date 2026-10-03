#!/usr/bin/env python3
"""Small isolated guest Vulkan app build, reusing hash-recorded Khronos loader."""
import argparse,hashlib,json,pathlib,subprocess,struct,shutil,os,resource
ROOT=pathlib.Path(__file__).resolve().parents[4]
SOURCE=pathlib.Path(__file__).resolve().parent
TASK=pathlib.Path('/mnt/p6/project/build/guest-vulkan-wgpu-20261003')
OLD=pathlib.Path('/mnt/p6/build/gpu-host-p1-20261001/graphics-build-run1')
CC='/nix/store/j8mdl69qafyijllv7s703219nb5fnrdp-wasm32-unknown-linux-musl-llvm-toolchain-wrapper-22.1.8/bin/wasm32-unknown-linux-musl-clang'
LOADER_SHA='de3ea65041731fd32e319a34e3282ec68933d7372ecc184a06b364fd671683f8'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def main():
 a=argparse.ArgumentParser();a.add_argument('--output',type=pathlib.Path,default=TASK/'app-build');o=a.parse_args().output.resolve();assert o.is_relative_to(TASK) and not o.exists();assert shutil.disk_usage(TASK).free>=20*1024**3;assert sha(OLD/'libvulkan-guest-static.a')==LOADER_SHA,'retained Khronos loader changed';upstream=json.loads((OLD/'build.json').read_text())['upstream'];
 for row in upstream['files']:
  if row['group']=='headers-source':assert sha(OLD/row['group']/row['path'])==row['sha256'],'retained Khronos header changed'
 o.mkdir(parents=True);(o/'tmp').mkdir();env={**os.environ,'TMPDIR':str(o/'tmp'),'TMP':str(o/'tmp'),'TEMP':str(o/'tmp')};commands=[]
 def run(args,name):
  def guards():resource.setrlimit(resource.RLIMIT_AS,(4*1024**3,4*1024**3));resource.setrlimit(resource.RLIMIT_CORE,(0,0));os.sched_setaffinity(0,{min(os.sched_getaffinity(0))});
  p=subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,env=env,timeout=180,preexec_fn=guards);(o/(name+'.log')).write_bytes(p.stdout);commands.append({'argv':list(map(str,args)),'exit':p.returncode,'log':str(o/(name+'.log'))});assert p.returncode==0,p.stdout.decode(errors='replace')
 shaders=[]
 for stage in ['vert','frag']:
  spv=o/('benchmark.'+stage+'.spv');run(['glslangValidator','-V','--target-env','vulkan1.0',str(SOURCE/('benchmark.'+stage)),'-o',str(spv)],'shader-'+stage);run(['spirv-val','--target-env','vulkan1.0',str(spv)],'validate-'+stage);words=struct.unpack('<'+'I'*(spv.stat().st_size//4),spv.read_bytes());shaders.append('static const uint32_t benchmark_'+stage+'[]={'+','.join(map(str,words))+'};\n')
 (o/'shaders.h').write_text('#include <stdint.h>\n'+''.join(shaders));flags=['-std=c11','-O2','-Wall','-Wextra','-Werror','-pthread','-matomics','-mbulk-memory','-ffunction-sections','-fdata-sections','-I'+str(OLD/'headers-source/include'),'-I'+str(o)]
 for name,source in [('benchmark',SOURCE/'benchmark.c'),('icd',ROOT/'web/linux/tests/guest-vulkan/icd.c'),('transport',ROOT/'web/linux/tests/guest-gpu/guest-gpu.c')]:run([CC,*flags,'-MMD','-MF',str(o/(name+'.d')),'-c',str(source),'-o',str(o/(name+'.o'))],'compile-'+name)
 loader=o/'libvulkan-guest-static.a';shutil.copyfile(OLD/loader.name,loader);app=o/'guest-vulkan-wgpu-benchmark.wasm';run([CC,'-pthread','-matomics','-mbulk-memory','-static',str(o/'benchmark.o'),str(loader),str(o/'icd.o'),str(o/'transport.o'),'-lm','-Wl,--gc-sections,--import-memory,--export-table,--shared-memory','-Wl,--initial-memory=2097152,--max-memory=4294967296,-z,stack-size=262144','-o',str(app)],'link');run(['wasm-validate','--enable-all',str(app)],'validate-app')
 inputs=[SOURCE/'benchmark.c',SOURCE/'benchmark.vert',SOURCE/'benchmark.frag',ROOT/'web/linux/tests/guest-vulkan/icd.c',ROOT/'web/linux/tests/guest-gpu/guest-gpu.c',OLD/'libvulkan-guest-static.a',o/'benchmark.vert.spv',o/'benchmark.frag.spv']
 for dep in o.glob('*.d'):inputs.extend(pathlib.Path(p) for p in dep.read_text().replace('\\\n',' ').split(':',1)[1].split())
 inputs=sorted(set(inputs));report={'pass':True,'testOnly':True,'artifact':str(app),'bytes':app.stat().st_size,'sha256':sha(app),'inputs':[{'path':str(p),'bytes':p.stat().st_size,'sha256':sha(p)}for p in inputs],'commands':commands,'loaderProvenance':{'metadata':str(OLD/'build.json'),'sha256':sha(OLD/'build.json'),'loaderCommit':upstream['loaderCommit'],'headersCommit':upstream['headersCommit'],'archiveSha256':LOADER_SHA},'scope':'public static Khronos loader; bounded nonconformant ICD; same shader/app for hardware and software'};(o/'build.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
if __name__=='__main__':main()
