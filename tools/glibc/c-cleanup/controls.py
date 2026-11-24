#!/usr/bin/env python3
"""Compare unchanged language/no-EH behavior and prove scoped raw C cleanup IR."""
import pathlib,os,subprocess,json,hashlib
T=pathlib.Path(os.environ['GLIBC_TASK']);L=pathlib.Path(os.environ['GLIBC_TOOLCHAIN']);D=T/'logs/controls';D.mkdir();S=T/'source-snapshots/controls';S.mkdir();rows=[]
normal=S/'normal.c';normal.write_text('''#ifdef __cplusplus
#error GNU source must remain C
#endif
#if __STDC_VERSION__ != 201112L
#error C11 required
#endif
int ordinary(int x) { int result=0; for(int i=0;i<x;i++) result+=i*3; return result; }
''')
cleanup=S/'cleanup.c';cleanup.write_text('extern void release(int*); extern void may_throw(void);\nint cleanup_scope(void) { int value __attribute__((cleanup(release)))=19; may_throw(); return value; }\n')
for name,source,flags in [('ordinary',normal,[]),('disabled-EH',cleanup,['-fno-exceptions']),('native-EH',cleanup,['-fexceptions','-fwasm-exceptions']),('host-EH',cleanup,['-fexceptions'])]:
 outputs=[]
 for kind,cc in [('original',L/'bin/clang'),('owned',T/'objects/compiler/clang')]:
  output=D/(name+'-'+kind+'.ll');cmd=[str(cc),'--target='+('x86_64-unknown-linux-gnu' if name=='host-EH' else 'wasm32-unknown-linux-gnu'),'-std=gnu11','-nostdinc','-O0','-Xclang','-disable-llvm-passes','-S','-emit-llvm',*flags,str(source),'-o',str(output)]
  p=subprocess.run(cmd,capture_output=True,text=True);(D/(name+'-'+kind+'.log')).write_text(p.stdout+p.stderr);rows.append({'argv':cmd,'cwd':os.getcwd(),'exit':p.returncode,'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest()});assert p.returncode==0;outputs.append(output.read_bytes())
 if name!='native-EH':assert outputs[0]==outputs[1],name+' differs'
 else:
  original=outputs[0].decode();owned=outputs[1].decode();assert 'landingpad' in original and '__gcc_personality_v0' in original
  assert 'cleanuppad' in owned and 'cleanupret' in owned and '__gxx_wasm_personality_v0' in owned
  assert 'landingpad' not in owned and '__gcc_personality_v0' not in owned
  assert 'invoke void @may_throw' in owned and 'call void @release' in owned
(D/'result.json').write_text(json.dumps({'pass':True,'ordinaryCIdentical':True,'noEHIdentical':True,'hostEHIdentical':True,'nativeCleanupScopedPads':True,'CNotReinterpretedAsCXX':True,'commands':rows},indent=2)+'\n');print('C controls PASS; real raw scoped cleanup pads')
