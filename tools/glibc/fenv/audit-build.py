#!/usr/bin/env python3
"""Pin actual public GNU symbols, metadata, calls and arithmetic instructions."""
import os,pathlib,json,subprocess,hashlib,re
T=pathlib.Path(os.environ['GLIBC_TASK']);L=pathlib.Path(os.environ['GLIBC_TOOLCHAIN'])/'bin';S=T/'source/glibc-2.44';D=T/'logs/public-evidence';n=1
while D.exists():n+=1;D=T/('logs/public-evidence-'+str(n))
D.mkdir()
def save(label,args):
 q=subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE);(D/(label+'.txt')).write_bytes(q.stdout+q.stderr);assert q.returncode==0
 return q.stdout.decode()
attempts={}
for p in (T/'logs/c-attempts').glob('*/attempt.json'):
 j=json.loads(p.read_text());name=pathlib.Path(j['output']).name
 if name in ['fenv-get.o','fenv-set.o','fenv-fixture.o']:
  assert j['pass'];attempts[name]=p.parent
assert len(attempts)==3
rows={}
for name,stem in [('get','fegetround'),('set','fesetround')]:
 p=T/'objects/guest'/('fenv-'+name+'.o')
 symbols=save(name+'-symbols',[str(L/'llvm-readobj'),'--symbols',str(p)])
 sections=save(name+'-sections',['wasm-objdump','-x',str(p)])
 assert 'Name: __'+stem in symbols and 'Name: '+stem in symbols and 'BINDING_WEAK' in symbols
 assert '.gnu.warning.'+stem in sections and '.gnu.glibc-stub.'+stem in sections
 source=S/'math'/(stem+'.c');raw=(attempts[p.name]/'front.ll').read_text();assert 'define hidden i32 @__'+stem in raw or 'define i32 @__'+stem in raw
 assert re.search('@'+stem+r' = weak (?:hidden )?alias',raw)
 rows[stem]={'source':str(source),'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'object':str(p),'objectSha256':hashlib.sha256(p.read_bytes()).hexdigest(),'rawIR':str(attempts[p.name]/'front.ll'),'publicWeakAlias':True,'stubAndWarningMetadata':True}
work=attempts['fenv-fixture.o'];raw=(work/'front.ll').read_text();assert '@fegetround' in raw and '@fesetround' in raw and 'load volatile ptr' in raw
opt=save('fixture-opt-ir',[str(L/'llvm-dis'),str(work/'opt.bc'),'-o','-']);assert 'load volatile ptr' in opt and 'fadd float' in opt and 'fadd double' in opt and 'fadd fast' not in opt
dis=save('fixture-disassembly',['wasm-objdump','-dr',str(T/'objects/guest/fenv-fixture.o')]);assert 'f32.add' in dis and 'f64.add' in dis and 'call_indirect' in dis
dep=(T/'objects/fenv-fixture.d').read_text();assert str(S/'math/fenv.h') in dep and str(S/'sysdeps/wasm32/bits/fenv.h') in dep
result={'pass':True,'publicGNUObjects':rows,'fixtureRawIR':str(work/'front.ll'),'fixtureOptimizedIR':str(D/'fixture-opt-ir.txt'),'publicFunctionPointersVolatile':True,'nativeFloatAdd':True,'nativeDoubleAdd':True,'fastMath':False,'actualHeaderDependencies':[str(S/'math/fenv.h'),str(S/'sysdeps/wasm32/bits/fenv.h')],'unitCompileReport':str(T/'logs/fenv-units/result.json')}
(D/'result.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
