#!/usr/bin/env python3
"""Diagnostic GNU driver: exact warning metadata then frozen caller jump lowering."""
import os,pathlib,subprocess,sys,tempfile,shutil,json,hashlib
root=pathlib.Path(__file__).resolve().parent
task=pathlib.Path(os.environ['GLIBC_TASK']);tool=pathlib.Path(os.environ['GLIBC_TOOLCHAIN'])/'bin'
a=sys.argv[1:]
if '-c' not in a or not any(x.endswith('.c') for x in a):
 sys.exit(subprocess.call([str(tool/'clang'),'--target=wasm32-unknown-linux-gnu',*a,*(['-fwasm-exceptions'] if '-c' in a else [])]))
if '-o' not in a:
 source=next(x for x in a if x.endswith('.c'));a += ['-o',pathlib.Path(source).stem+'.o']
pos=a.index('-o')+1;output=a[pos]
work=pathlib.Path(tempfile.mkdtemp(prefix='fullmake-cc-',dir=task/'tmp'));success=False
try:
 a[pos]=str(work/'front.ll');a.remove('-c')
 stages=[
 [str(tool/'clang'),'--target=wasm32-unknown-linux-gnu',*a,'-fwasm-exceptions','-Xclang','-disable-llvm-passes','-S','-emit-llvm'],
 [str(task/'objects/warnings'),str(work/'front.ll'),str(work/'warnings.bc')],
 [str(task/'objects/lower'),str(work/'warnings.bc'),str(work/'lower.bc')],
 [str(tool/'opt'),'-passes=default<O2>',str(work/'lower.bc'),'-o',str(work/'opt.bc')],
 [str(tool/'llc'),'-mattr=+atomics,+bulk-memory,+exception-handling','-exception-model=wasm','-wasm-enable-eh','-wasm-enable-sjlj','-wasm-use-legacy-eh','-filetype=obj',str(work/'opt.bc'),'-o',output]]
 (work/'commands.json').write_text(json.dumps(stages,indent=2)+'\n')
 for command in stages:
  code=subprocess.call(command)
  if code:raise SystemExit(code)
 # Preserve exact original/lowered marker IR and commands for affected objects.
 text=(work/'front.ll').read_text()
 if '.gnu.warning.' in text or '.gnu.glibc-stub.' in text:
  parent=task/'logs/warning-units'/hashlib.sha256(str(pathlib.Path(output).resolve()).encode()).hexdigest()[:16]
  parent.mkdir(parents=True,exist_ok=True)
  destination=pathlib.Path(tempfile.mkdtemp(prefix='attempt-',dir=parent))
  for name in ['commands.json','front.ll','warnings.bc']:(destination/name).write_bytes((work/name).read_bytes())
  (destination/'output.json').write_text(json.dumps({'object':str(pathlib.Path(output).resolve()),'sha256':hashlib.sha256(pathlib.Path(output).read_bytes()).hexdigest()},indent=2)+'\n')
 success=True
finally:
 if success:shutil.rmtree(work)
 else:print('retained failed compiler inputs:',work,file=sys.stderr)
