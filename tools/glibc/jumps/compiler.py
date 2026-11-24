#!/usr/bin/env python3
"""GNU make compiler driver. Every C translation unit is lowered before LLVM O2."""
import os,pathlib,subprocess,sys,tempfile,shutil,json
root=pathlib.Path(__file__).resolve().parent
task=pathlib.Path(os.environ['GLIBC_TASK']);tool=pathlib.Path(os.environ['GLIBC_TOOLCHAIN'])/'bin'
a=sys.argv[1:]
if '-c' not in a or not any(x.endswith('.c') for x in a):
 sys.exit(subprocess.call([str(tool/'clang'),'--target=wasm32-unknown-linux-gnu',*a,*(['-fwasm-exceptions'] if '-c' in a else [])]))
if '-o' not in a:
 source=next(x for x in a if x.endswith('.c'));a += ['-o',pathlib.Path(source).stem+'.o']
pos=a.index('-o')+1;output=a[pos]
work=pathlib.Path(tempfile.mkdtemp(prefix='jump-cc-',dir=task/'tmp'))
success=False
try:
 a[pos]=str(work/'front.bc')
 stages=[
 [str(tool/'clang'),'--target=wasm32-unknown-linux-gnu',*a,'-fwasm-exceptions','-Xclang','-disable-llvm-passes','-emit-llvm'],
 [str(task/'objects/lower'),str(work/'front.bc'),str(work/'lower.bc')],
 [str(tool/'opt'),'-passes=default<O2>',str(work/'lower.bc'),'-o',str(work/'opt.bc')],
 [str(tool/'llc'),'-mattr=+atomics,+bulk-memory,+exception-handling','-exception-model=wasm','-wasm-enable-eh','-wasm-enable-sjlj','-wasm-use-legacy-eh','-filetype=obj',str(work/'opt.bc'),'-o',output]]
 (work/'commands.json').write_text(json.dumps(stages,indent=2)+'\n')
 for command in stages:
  code=subprocess.call(command)
  if code:raise SystemExit(code)
 success=True
finally:
 if success:shutil.rmtree(work)
 else:print("retained failed compiler inputs:",work,file=sys.stderr)
