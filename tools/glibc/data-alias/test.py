#!/usr/bin/env python3
"""Native linked alias identity and dispatch controls; no full stdio acceptance."""
import hashlib,importlib.util,json,os,pathlib,resource,subprocess,sys
R=pathlib.Path(__file__).resolve().parent
T=pathlib.Path(os.environ['GLIBC_ALIAS_TASK']).resolve()
L=pathlib.Path('/nix/store/xwpycnlb71djqs4gyxhbkxhzb3pw1ib4-llvm-toolchain-22.1.8/bin')
T.mkdir(exist_ok=True);(T/'tmp').mkdir(exist_ok=True)
os.environ.update({k:str(T/'tmp') for k in ['TMPDIR','TMP','TEMP']})
resource.setrlimit(resource.RLIMIT_CORE,(0,0))
spec=importlib.util.spec_from_file_location('normalize',R/'normalize.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
spec=importlib.util.spec_from_file_location('symbol_sizes',R/'fix-symbol-sizes.py');sizes=importlib.util.module_from_spec(spec);spec.loader.exec_module(sizes)
front=pathlib.Path('/mnt/p6/build/glibc-fullmake-inventory-20261002/tmp/fullmake-cc-h4l_im2d/front.ll')
text=front.read_text();old_hash=hashlib.sha256(text.encode()).hexdigest();output,rows=m.normalize(text)
assert len(rows)==2 and output.count('module asm ')==0
assert m.normalize('target triple = "wasm32-unknown-linux-gnu"\n')[0]=='target triple = "wasm32-unknown-linux-gnu"\n'
negatives={
 'foreign-target':text.replace('wasm32-unknown-linux-gnu','x86_64-unknown-linux-gnu'),
 'wrong-offset':text.replace('__io_vtables + 168','__io_vtables + 169'),
 'wrong-size':text.replace('.size _IO_file_jumps, 84','.size _IO_file_jumps, 80'),
 'missing-directive':text.replace('module asm ".global _IO_file_jumps"\n',''),
 'duplicate-directive':text+'\nmodule asm ".global _IO_file_jumps"\n',
 'preexisting-definition':text+'\n@_IO_file_jumps = external global i8\n',
 'different-layout':text.replace('%struct._IO_jump_t = type { i32, i32,','%struct._IO_jump_t = type { i64, i32,')}
for label,bad in negatives.items():
 (T/(label+'.ll')).write_text(bad)
 try:m.normalize(bad)
 except ValueError:pass
 else:raise AssertionError(label)
commands=[]
def run(label,argv):
 p=subprocess.run(argv,cwd=T,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 (T/(label+'.stdout')).write_bytes(p.stdout);(T/(label+'.stderr')).write_bytes(p.stderr)
 commands.append({'label':label,'argv':list(map(str,argv)),'cwd':str(T),'exit':p.returncode})
 (T/'commands.json').write_text(json.dumps(commands,indent=2)+'\n');assert p.returncode==0,label
 return p.stdout
(T/'genuine-normalized.ll').write_text(output)
run('actual-gnu-backend',[str(L/'llc'),'-mattr=+atomics,+bulk-memory,+exception-handling','-exception-model=wasm','-wasm-enable-eh','-wasm-enable-sjlj','-wasm-use-legacy-eh','-filetype=obj',str(T/'genuine-normalized.ll'),'-o',str(T/'genuine-vtables.o')])
run('actual-gnu-size-fix',[sys.executable,str(R/'fix-symbol-sizes.py'),str(T/'genuine-vtables.o'),str(T/'genuine-vtables-sized.o')])
run('actual-gnu-validate',['wasm-validate','--enable-all',str(T/'genuine-vtables-sized.o')])
# Independently compare every section outside linking metadata byte-for-byte.
def sections(data):
 p=8;out=[]
 def leb(pos):
  v=shift=0
  while True:
   q=data[pos];pos+=1;v|=(q&127)<<shift
   if q<128:return v,pos
   shift+=7
 while p<len(data):
  kind=data[p];size,start=leb(p+1);payload=data[start:start+size];p=start+size
  if kind==0:
   n,q=leb(start)
   if data[q:q+n]==b'linking':continue
  out.append((kind,payload))
 return out
assert sections((T/'genuine-vtables.o').read_bytes())==sections((T/'genuine-vtables-sized.o').read_bytes())
# Exercise the actual symbol contract independently of the C/IR fixtures.
def minimal_object(rows, version=2):
 def u(value):
  out=[]
  while value>=128:out.append((value&127)|128);value>>=7
  return bytes(out+[value])
 def s(value):
  b=value.encode();return u(len(b))+b
 symbols=u(len(rows))
 for name,flags,segment,offset,extent in rows:
  symbols+=bytes([1])+u(flags)+s(name)+u(segment)+u(offset)+u(extent)
 linking=s('linking')+u(version)+bytes([8])+u(len(symbols))+symbols
 return b'\0asm\1\0\0\0'+bytes([0])+u(len(linking))+linking
contract=[('__io_vtables',4,0,0,1176),('_IO_file_jumps',0,0,168,1008),('_IO_wfile_jumps',0,0,420,756)]
metadata_negatives={
 'missing-alias':minimal_object(contract[:-1]),
 'wrong-offset':minimal_object([contract[0],('_IO_file_jumps',0,0,169,1008),contract[2]]),
 'wrong-size':minimal_object([contract[0],('_IO_file_jumps',0,0,168,85),contract[2]]),
 'hidden-alias':minimal_object([contract[0],('_IO_file_jumps',4,0,168,1008),contract[2]]),
 'wrong-segment':minimal_object([contract[0],('_IO_file_jumps',0,1,168,1008),contract[2]]),
 'public-storage':minimal_object([('__io_vtables',0,0,0,1176),*contract[1:]]),
 'wrong-storage':minimal_object([('__io_vtables',4,0,0,1177),*contract[1:]]),
 'duplicate-alias':minimal_object([*contract,contract[1]]),
 'unknown-version':minimal_object(contract,3),
 'truncated-object':minimal_object(contract)[:-1],
 'oversized-length':b'\0asm\1\0\0\0\0\x80\x80\x80\x80\x10'}
for label,bad in metadata_negatives.items():
 (T/('bad-metadata-'+label+'.o')).write_bytes(bad)
 try:sizes.fix(bad)
 except (ValueError,IndexError,UnicodeError):pass
 else:raise AssertionError(label)
fixed_contract,_=sizes.fix(minimal_object(contract))
assert sizes.fix(fixed_contract)[0]==fixed_contract
listing=run('actual-gnu-symbol-extents',['wasm-objdump','-x',str(T/'genuine-vtables-sized.o')]).decode()
for name,offset in [('_IO_file_jumps',168),('_IO_wfile_jumps',420)]:
 assert f'D <{name}> segment=0 offset={offset} size=84 [ binding=global vis=default ]' in listing
nm=run('actual-gnu-symbols',[str(L/'llvm-nm'),'--defined-only',str(T/'genuine-vtables.o')]).decode()
for offset,name in [('000000a8','_IO_file_jumps'),('000001a4','_IO_wfile_jumps'),('00000000','__io_vtables')]:assert f'{offset} D {name}' in nm
# Independent C consumer uses external data addresses and function-pointer
# loads. Fixture storage is deliberately separate from its consumer object.
fields=['i32 0','i32 0']+['ptr null']*19
entries=[]
for index in range(14):
 f=fields.copy()
 if index in (2,5):f[2]='ptr @marker'+str(index)
 entries.append('%struct._IO_jump_t { '+', '.join(f)+' }')
fixture='target triple = "wasm32-unknown-linux-gnu"\n'
fixture+='%struct._IO_jump_t = type { '+', '.join(['i32','i32']+['ptr']*19)+' }\n'
fixture+='@__io_vtables = hidden constant [14 x %struct._IO_jump_t] ['+', '.join(entries)+'], align 16\n'
fixture+='\n'.join(line for line in text.splitlines() if line.startswith('module asm '))+'\n'
fixture+='define i32 @marker2() { ret i32 22 }\ndefine i32 @marker5() { ret i32 55 }\n'
(T/'fixture-original.ll').write_text(fixture);(T/'fixture-normalized.ll').write_text(m.normalize(fixture)[0])
consumer='''struct table { unsigned a,b; int (*f[19])(void); };
_Static_assert(sizeof(struct table)==84,"independent Wasm table ABI");
extern const struct table __io_vtables[],_IO_file_jumps,_IO_wfile_jumps;
unsigned file_delta(void){return (unsigned)&_IO_file_jumps-(unsigned)__io_vtables;}
unsigned wide_delta(void){return (unsigned)&_IO_wfile_jumps-(unsigned)__io_vtables;}
int file_call(void){return _IO_file_jumps.f[0]();}
int wide_call(void){return _IO_wfile_jumps.f[0]();}
int file_identity(void){return &_IO_file_jumps==&__io_vtables[2];}
int wide_identity(void){return &_IO_wfile_jumps==&__io_vtables[5];}
'''
(T/'consumer.c').write_text(consumer)
run('fixture-backend',[str(L/'llc'),'-filetype=obj',str(T/'fixture-normalized.ll'),'-o',str(T/'fixture.o')])
run('independent-consumer',[str(L/'clang'),'--target=wasm32-unknown-linux-gnu','-nostdlib','-nostdinc','-O2','-c',str(T/'consumer.c'),'-o',str(T/'consumer.o')])
exports=['file_delta','wide_delta','file_call','wide_call','file_identity','wide_identity','__io_vtables','_IO_file_jumps','_IO_wfile_jumps']
run('fixture-size-fix',[sys.executable,str(R/'fix-symbol-sizes.py'),str(T/'fixture.o'),str(T/'fixture-sized.o')])
assert sections((T/'fixture.o').read_bytes())==sections((T/'fixture-sized.o').read_bytes())
run('native-link',[str(L/'wasm-ld'),'--no-entry',*[f'--export={name}' for name in exports],str(T/'fixture-sized.o'),str(T/'consumer.o'),'-o',str(T/'linked.wasm')])
script='''const fs=require('fs');const e=new WebAssembly.Instance(new WebAssembly.Module(fs.readFileSync(process.argv[2]))).exports;
const checks=[e.file_delta()===168,e.wide_delta()===420,e.file_call()===22,e.wide_call()===55,e.file_identity()===1,e.wide_identity()===1,e._IO_file_jumps.value===e.__io_vtables.value+168,e._IO_wfile_jumps.value===e.__io_vtables.value+420];
if(checks.some(v=>!v))throw Error(JSON.stringify(checks));console.log(JSON.stringify({pass:true,checks:checks.length}));'''
(T/'test.cjs').write_text(script);host=json.loads(run('host-runtime',['node',str(T/'test.cjs'),str(T/'linked.wasm')]))
assert hashlib.sha256(front.read_bytes()).hexdigest()==old_hash
files={str(p):{'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in [front,R/'normalize.py',R/'fix-symbol-sizes.py',R/'test.py',*T.glob('*')] if p.is_file() and p.name!='acceptance.json'}
result={'pass':True,'hostChecks':host['checks'],'rejectedMalformedControls':len(negatives),'rejectedMalformedObjectControls':len(metadata_negatives),'idempotentMetadataFix':True,'unchangedOrdinaryControl':True,'exactAliasSymbolSizes':84,'codeDataRelocationsUnchanged':True,'genuineIRSha256':old_hash,'aliases':rows,'inputs':files,'scope':'retained genuine GNU vtable IR compiles; linked native alias identity/dispatch controls, not fresh GNU make/full stdio acceptance'}
(T/'acceptance.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({k:v for k,v in result.items() if k!='inputs'}))
