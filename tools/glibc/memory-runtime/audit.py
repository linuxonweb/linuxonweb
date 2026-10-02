#!/usr/bin/env python3
"""Audit actual GNU-selected sources, native clients and retained guest gates."""
import os,pathlib,json,hashlib,re,tarfile,subprocess,socket
T=pathlib.Path(os.environ['GLIBC_TASK']);R=pathlib.Path(__file__).resolve().parent
B=pathlib.Path(os.environ['GLIBC_ARITY_PACKET']);M=pathlib.Path(os.environ['GLIBC_MEMORY_MAKE_PACKET']);O=T/'objects/fullmake';S=T/'source/glibc-2.44'
def load(p):return json.loads(pathlib.Path(p).read_text())
def digest(p):
 p=pathlib.Path(p);b=p.read_bytes();return {'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b)}
pins={}
def pin(p):
 p=pathlib.Path(p).resolve();d=digest(p);pins[str(p)]=d;return d
base=load(T/'logs/base-inputs.json');a=load(B/'acceptance.json')
assert digest(B/'manifest.json')['sha256']==base['manifestSha256'];assert digest(B/'acceptance.json')['sha256']==base['acceptanceSha256']
for packet,expected in [(B,'e9002b3d9ef9d00a8df62566e2eabe05cb8f4c391b90343c90f3d75081167095'),(M,'cb26cde7b2306b44409d43e4568fe380be897e02c35de252755bc12edb70dd86')]:
 assert digest(packet/'manifest.json')['sha256']==expected
 for name,row in load(packet/'manifest.json')['files'].items():assert digest(name)==row,name
 pin(packet/'manifest.json');pin(packet/'acceptance.json')
for name,row in a['inputs'].items():assert digest(name)=={k:row[k]for k in ['sha256','bytes']},name
objects=[];common=0;old={pathlib.Path(r['copy']).name:r for r in base['objects']}
paths=[pathlib.Path(x)for x in(T/'logs/link-inputs.txt').read_text().splitlines()]
assert len(paths)==246 and len(set(paths))==246
assert not any(p.name in ['wasm-memory.o','startup.o']for p in paths)
for p in paths:
 d=pin(p);raw=p.read_bytes();fmt='wasm'if raw.startswith(b'\0asm')else 'llvm-bitcode'if raw.startswith(b'BC')else None;assert fmt
 objects.append({'path':str(p),'format':fmt,**d})
 if p.name in old:assert d=={k:old[p.name][k]for k in ['sha256','bytes']};common+=1
assert common==236
names=['brk','sbrk','mmap64','munmap','mremap','mprotect','madvise','wasm-memory-authority']
selected=[];attempts=[];fixture_ir=''
for name in names+['memory-fixture','memory-startup']:
 p=O/'misc'/(name+'.o')if name in names else T/'objects/guest'/(name+'.o')
 candidates=[]
 for q in(T/'logs/c-attempts').glob('*/attempt.json'):
  d=load(q)
  if d.get('pass')and d.get('output')==str(p)and d.get('objectSha256')==digest(p)['sha256']:candidates.append((q,d))
 assert candidates,name
 q,d=candidates[-1];assert digest(d['sourceSnapshot'])['sha256']==digest(d['source'])['sha256']==d['sourceSha256']
 assert digest(d['driverSnapshot'])['sha256']==d['driverSha256'];assert all(x['exit']==0 for x in d['stages'])
 for field in ['source','sourceSnapshot','driverSnapshot']:pin(d[field])
 pin(q);pin(q.parent/'front.ll');attempts.append(d)
 if name=='memory-fixture':fixture_ir=(q.parent/'front.ll').read_text()
 if name in names:
  source=pathlib.Path(d['source']);expected=S/('misc/sbrk.c'if name=='sbrk'else 'sysdeps/unix/sysv/linux/wasm32/'+name+'.c');assert source==expected
  original=M/'source/glibc-2.44'/source.relative_to(S)
  if name not in ['mremap','wasm-memory-authority']:assert source.read_bytes()==original.read_bytes()
  else:
   if name=='mremap':assert source.read_bytes()==(R/'mremap.c').read_bytes()
   else:
    text=original.read_text();lo=text.index('int __wasm_memory_madvise(');hi=text.index('uintptr_t __wasm_memory_cursor',lo)
    expected_text=(text[:lo]+(R/'madvise-ownership.inc').read_text()+'\n'+text[hi:]).replace('memcpy(replacement,addr,old_size);','memcpy(replacement,addr,oldn);')
    assert source.read_text()==expected_text
  assert digest(p)==digest(T/'objects/guest'/p.name);selected.append({'unit':'misc/'+name+'.o','source':str(source),'object':str(p),'makeAttempt':d,'derivative':name in ['mremap','wasm-memory-authority']});pin(original)
for variable,function in [('api_brk','brk'),('api_sbrk','sbrk'),('api_mmap','mmap'),('api_mmap64','mmap64'),('api_munmap','munmap'),('api_mremap','mremap'),('api_mprotect','mprotect'),('api_madvise','madvise'),('api_trim','malloc_trim')]:
 assert re.search(r'@'+variable+r' = internal global ptr @'+function+r'\b',fixture_ir)and 'load volatile ptr, ptr @'+variable in fixture_ir
assert 'call ptr (ptr, i32, i32, i32, ...)'in fixture_ir
headers={}
for name in names:
 dep=O/'misc'/(name+'.o.dt')
 if not dep.exists():dep=O/'misc'/(name+'.o.d')
 text=dep.read_text().replace('$(common-objpfx)',str(O)+'/').replace('\\\n',' ')
 first=text.split('\n')[0];tokens=first.split(':',1)[1].split()
 for token in tokens:
  p=pathlib.Path(token);p=p if p.is_absolute()else S/'misc'/p
  assert p.is_file(),(dep,p);headers[str(p.resolve())]=pin(p)
 pin(dep)
for dep in [T/'objects/memory-fixture-v4.d',T/'objects/memory-startup-v4.d']:
 for token in dep.read_text().replace('\\\n',' ').split('\n')[0].split(':',1)[1].split():
  p=pathlib.Path(token).resolve();headers[str(p)]=pin(p)
 pin(dep)
snapshots={}
for name,d in headers.items():
 p=pathlib.Path(name);out=T/'source-snapshots/headers'/hashlib.sha256(name.encode()).hexdigest()
 out.parent.mkdir(parents=True,exist_ok=True)
 if not out.exists():out.write_bytes(p.read_bytes())
 assert digest(out)==d;snapshots[name]={**d,'snapshot':str(out)};pin(out)
with tarfile.open(os.environ['GNU_RELEASE_ARCHIVE'])as archive:
 for rel in ['misc/sbrk.c','misc/sys/mman.h','malloc/malloc.c','malloc/malloc.h','posix/unistd.h']:
  p=S/rel;assert p.read_bytes()==archive.extractfile('glibc-2.44/'+rel).read();pin(p)
source=S/'malloc/malloc.c';text=source.read_text();assert '__madvise (paligned_mem, size & ~psm1, MADV_DONTNEED);'in text and 'memset (p, perturb_byte, n);'in text
abi=(T/'logs/abi.log').read_text();imports=re.findall(r'^ - func\[\d+\].*? <- (.+)$',abi,re.M)
assert sorted(imports)==['linux.copy_siginfo','linux.get_thread_area','linux.syscall'] and 'env.memory'in abi
assert '__wrap_abort'not in abi and '__internal_syscall_cancel'not in abi
nm=os.environ['GLIBC_TOOLCHAIN']+'/bin/llvm-nm';definitions={n:[]for n in ['__wasm_memory_init','__wasm_memory_cursor','__wasm_memory_brk','__sbrk','__brk','__mmap','__mmap64','__munmap','__mremap','__mprotect','__madvise','__curbrk']}
for p in paths:
 out=subprocess.run([nm,'--defined-only',str(p)],capture_output=True,text=True,check=True).stdout
 for line in out.splitlines():
  columns=line.split()
  if columns and columns[-1]in definitions:definitions[columns[-1]].append(str(p))
assert all(len(v)==1 for v in definitions.values())
def cpio(data):
 at=0;result={}
 while True:
  h=data[at:at+110];assert h[:6]==b'070701';size=int(h[54:62],16);length=int(h[94:102],16);at+=110
  name=data[at:at+length-1].decode().removeprefix('./').lstrip('/');at+=length;at+=(-at)%4;result[name]=data[at:at+size];at+=size;at+=(-at)%4
  if name=='TRAILER!!!':return result
runs={};gates=['memory','arity','final16','stat','next26','fixed','fenv','c-cleanup','warnings','syscalls','jumps']
for mode,directory,package,module in [('native','native-run2','native-package4','memory-v4.wasm'),('fpcast','fpcast-run1','fpcast-package4','memory-v4-fpcast.wasm')]:
 D=T/directory;result=load(D/'result.json');assert result['pass']and result['jit']['failures']==0 and result['jit']['exitStatus']==0
 assert result['serverClosed']and result['browserExit']['code']==0
 assert result['allocatorLocks']['waits']>0 and result['allocatorLocks']['woken']>0 and result['allocatorLocks']['errors']==0
 reports={}
 for gate in gates:
  p=D/(gate+'-result.json');reports[gate]=load(p);assert reports[gate]['pass'];pin(p)
 for name,d in result['inputs'].items():assert digest(name)['sha256']==d;pin(name)
 build=load(T/package/'build.json');assert digest(T/'objects'/module)['sha256']==build['sha256']
 archive=T/package/'initramfs.cpio';assert digest(archive)=={'sha256':build['archiveSha256'],'bytes':build['archiveBytes']}
 assert cpio(archive.read_bytes())['bin/gnu-allocator-probe']==(T/'objects'/module).read_bytes()
 pin(D/'result.json');pin(D/'guest-console.txt');pin(T/package/'build.json');pin(archive);pin(T/'objects'/module)
 lines=(D/'guest-console.txt').read_text();assert not re.search(r'^GUEST_JIT FAIL',lines,re.M)
 runs[mode]={'passes':result['jit']['passes'],'failures':0,'directory':str(D),'module':str(T/'objects'/module),'package':str(T/package),'allocatorLocks':result['allocatorLocks'],'gates':reports}
assert not load(T/'native-run1/memory-result.json')['pass']and load(T/'native-run1/result.json')['jit']['failures']==2
for p in R.iterdir():
 if p.is_file():pin(p)
for p in [T/'config.sh',T/'logs/input-full-readback.json',T/'logs/memory-overlay-final.json',T/'logs/link-inputs.txt',T/'logs/link-map.txt',T/'logs/abi.log',T/'logs/native-v4-tag-result.json',T/'logs/fpcast-v4-tag-result.json']:pin(p)
for port in [4213,9423]:
 sock=socket.socket();sock.bind(('127.0.0.1',port));sock.close()
result={'pass':True,'phase':'prepared; root review and freeze pending','linkObjects':len(objects),'formats':{f:sum(r['format']==f for r in objects)for f in ['wasm','llvm-bitcode']},'objects':objects,'unchangedBaseObjects':common,'excludedBaseObjects':['wasm-memory.o','startup.o'],'baseInputs':base,'selectedProviders':selected,'clientAndStartupAttempts':attempts[-2:],'headerSnapshots':snapshots,'inputs':pins,'imports':imports,'definitions':definitions,'runs':runs,'retainedFailures':['prepare1 preexisting replay startup assertion','reuse2 existing guest directory assertion','build1 duplicate old wasm-memory.o link','native1 GNU free perturb expectation:49863/2'],'limits':['anonymous private RW only','logical unmap/reuse/zero: no physical decommit/protection','exact whole mappings for munmap/remap; no files/shared/fixed/DONTUNMAP','single GNU arena explicitly tuned','no full NPTL/cancellation/C++/sysroot/Nightly/JIT/GPU acceptance']}
(T/'acceptance.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'pass':True,'objects':len(objects),'unchangedBaseObjects':common,'headerInputs':len(headers),'inputPins':len(pins),'runs':{k:v['passes']for k,v in runs.items()}}))
