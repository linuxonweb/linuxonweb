#!/usr/bin/env python3
"""Read back prepared finite evidence; this is not a freeze or runtime acceptance."""
import hashlib,json,os,pathlib,re,shlex
T=pathlib.Path('/mnt/p6/build/glibc-native-static-loader-20261002')
R=pathlib.Path(__file__).resolve().parent
G=pathlib.Path('/mnt/p6/build/glibc-wasm-bootstrap-20261002/source/glibc-2.44')
C=pathlib.Path('/mnt/p6/build/glibc-cumulative-make-20261002/source/glibc-2.44')
L=pathlib.Path('/mnt/p6/project/linux/.tmp-firefox-build/nix-local-store/nix/store/xwpycnlb71djqs4gyxhbkxhzb3pw1ib4-llvm-toolchain-22.1.8')
os.environ.update(TMPDIR=str(T/'tmp'),TMP=str(T/'tmp'),TEMP=str(T/'tmp'),XDG_CACHE_HOME=str(T/'cache'),PYTHONDONTWRITEBYTECODE='1')
cache={}
def pin(p):
 p=pathlib.Path(p)
 key=str(p)
 if key not in cache:
  b=p.read_bytes();cache[key]={'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b)}
 return cache[key]
def save(name,value):
 p=T/'logs'/name;p.write_text(json.dumps(value,indent=2,sort_keys=True)+'\n');return pin(p)
def equal(p,row):
 assert pin(p)=={'sha256':row['sha256'],'bytes':row['bytes']},str(p)
commands=json.loads((T/'logs/commands.json').read_text())
design=json.loads((T/'logs/design-source-pins.json').read_text())
for row in design:
 equal(row['path'],row)
 if 'snapshot' in row:equal(row['snapshot'],row)
report=R.parents[2]/'docs/glibc-native-static-loader-20261002.md'
assert report.is_file(),str(report)
for original,name in [(report,'prepared-report.md'),(G/'sysdeps/riscv/nptl/tls.h','gnu-riscv-gscope-source.h')]:
 q=T/'source/imported'/name;q.write_bytes(original.read_bytes())
source=set(p for p in R.rglob('*') if p.is_file())
source.add(report)
source.update(p for p in (T/'source').rglob('*') if p.is_file())
includes=set()
for dep in (T/'objects').glob('*.d'):
 text=dep.read_text().replace('\\\n',' ')
 for name in shlex.split(text.split(':',1)[1]):
  if name.endswith(':'):continue # -MP phony dependency target
  p=pathlib.Path(name)
  assert p.is_file(),name
  includes.add(p);source.add(p)
gnu=[]
for name in ['dlfcn/dlopen.c','dlfcn/dlsym.c','dlfcn/dlvsym.c','dlfcn/dlmopen.c','dlfcn/dlclose.c','dlfcn/dlerror.c','dlfcn/libc_dlerror_result.c','elf/dl-libc.c','elf/dl-sym.c','elf/dl-catch.c','elf/dl-exception.c','elf/dl-printf.c']:
 assert (G/name).read_bytes()==(C/name).read_bytes(),name
 source.update([G/name,C/name]);gnu.append({'source':name,'pristine':str(G/name),'configured':str(C/name),**pin(G/name)})
source.update([G/'elf/dl-support.c',G/'sysdeps/riscv/nptl/tls.h'])
source.update(pathlib.Path('/mnt/p6/build/glibc-cxx-exception-closure-20261002')/'logs'/name for name in ['source-tool-pins.json','object-pins.json'])
source.add(pathlib.Path('/mnt/p6/build/glibc-checked-jump-runtime-20261002/logs/final-runtime-inputs.json'))
for row in commands:
 tool=pathlib.Path(row['argv'][0])
 if tool.is_file():source.add(tool)
 for arg in row['argv']:
  if arg.startswith('-lLLVM'):
   p=L/'lib'/('lib'+arg[2:]+'.a');assert p.is_file(),str(p);source.add(p)
 for art in row.get('artifacts',[]):equal(art['path'],art)
 for inp in row.get('inputs',[]):
  if 'snapshot' in inp:equal(inp['snapshot'],inp)
 # Mutable historical input paths may now differ; immutable output/input
 # snapshots, not the latest file at that path, preserve the attempt bytes.
source.update(pathlib.Path(row['path']) for row in design)
source.update(pathlib.Path(row['snapshot']) for row in design if 'snapshot' in row)
imported=json.loads((T/'logs/full-link-imported-pins.json').read_text())
for row in imported:equal(row['original'],row);equal(row['copy'],row)
leaf=json.loads((T/'logs/metadata-gnu-leaf-pins.json').read_text())
for row in leaf:equal(row['original'],row);equal(row['copy'],row)
startup=json.loads((T/'logs/startup-data-source-pin.json').read_text())
equal(startup['original'],startup);equal(startup['snapshot'],startup)
links=json.loads((T/'logs/gnu-full-link-results.json').read_text())
ordered=[]
for row in links:
 cmd=row['command'];argv=cmd['argv'];ins=[]
 for index,arg in enumerate(argv):
  p=pathlib.Path(arg)
  if p.suffix in ['.o','.a'] and p.is_file():ins.append({'index':index,'path':str(p),**pin(p)})
 stderr=pathlib.Path(cmd['log']).read_text()
 missing=re.findall(r'undefined symbol: (\S+)',stderr)
 assert cmd['exit']==1 and missing==['__syscall_cancel_arch'],(row['mode'],stderr)
 ordered.append({'mode':row['mode'],'argv':argv,'argvSha256':hashlib.sha256(json.dumps(argv,separators=(',',':')).encode()).hexdigest(),'inputs':ins,'orderedInputsSha256':hashlib.sha256(json.dumps(ins,sort_keys=True,separators=(',',':')).encode()).hexdigest(),'stderr':stderr,'stderrFile':cmd['log'],'stderrPin':pin(cmd['log']),'pid':cmd['pid'],'pgid':cmd['pgid'],'exit':cmd['exit'],'missing':missing})
linkpin=save('final-link-inputs.json',ordered)
extractions=[]
for mode in ['default','release']:
 p=T/'logs'/f'public-cxx-{mode}-why.txt'
 records=[]
 for line in p.read_text().splitlines()[1:]:
  fields=line.split('\t')
  if len(fields)==3:records.append(dict(zip(['reference','extracted','symbol'],fields)))
 extractions.append({'mode':mode,'path':str(p),**pin(p),'records':records})
save('final-extraction-records.json',extractions)
boundary=json.loads((T/'logs/gnu-native-results.json').read_text())['boundaries']
save('boundary-provider-records.json',{'boundaries':boundary,'definedProviders':json.loads((T/'logs/boundary-defined-providers.json').read_text())['providers'],'records':[r for x in extractions for r in x['records'] if r['symbol'] in boundary or r['symbol']=='__wasm_setjmp'],'scope':'Exact compiler declaration boundaries and actual strict-link extraction/defined-symbol providers. setjmp is native LLVM SjLj lowering, not a returning wrapper. Covered code clears pending TLS before these pinned unchanged GNU/provider entries; their callbacks are not transitively covered.'})
groups=[]
for row in commands:
 try:os.killpg(row['pgid'],0);empty=False
 except ProcessLookupError:empty=True
 groups.append({'stage':row['stage'],'pid':row['pid'],'pgid':row['pgid'],'exit':row['exit'],'terminalRecordedEmpty':row['group_empty'],'currentlyEmpty':empty})
assert all(r['terminalRecordedEmpty'] and r['currentlyEmpty'] for r in groups)
save('terminal-groups.json',groups)
sourcepins={str(p):pin(p) for p in sorted(source)}
sourcepin=save('source-tool-pins.json',sourcepins)
objects={str(p):pin(p) for p in sorted((T/'objects').rglob('*')) if p.is_file()}
objectpin=save('object-pins.json',objects)
save('gnu-unchanged-source-pins.json',gnu)
resultnames=['caller-results.json','caller-negative-results.json','metadata-results.json','layout-results.json','gnu-compile-results.json','gnu-native-results.json','routes-results.json','gnu-full-link-results.json']
results={name:pin(T/'logs'/name) for name in resultnames}
evidencepin=save('evidence-pins.json',{str(p):pin(p) for p in sorted((T/'logs').rglob('*')) if p.is_file() and p.name not in ['evidence-pins.json','prepared-acceptance.json']})
disk=sum(p.stat().st_size for p in T.rglob('*') if p.is_file())
assert disk<2147483648
acceptance={'prepared':True,'rootReviewPending':True,'frozen':False,'fullDesignPass':False,'publicGNUDlfcnRuntime':False,'cppRuntime':False,'generalSjLjRouting':False,'forcedUnwind':False,'sourceToolEntries':len(sourcepins),'actualIncludeEntries':len(includes),'objectArtifactEntries':len(objects),'recordedCommands':len(commands),'terminalGroupsEmpty':True,'designRowsVerified':len(design),'importedOriginalCopyRowsVerified':len(imported),'gnuUnchangedUnits':len(gnu),'diskBytes':disk,'sourceToolPins':sourcepin,'objectPins':objectpin,'finalLinkInputs':linkpin,'results':results,'limits':['Finite direct/guarded-indirect instrumented coverage only; unknown native/JS/tail callbacks reject','No public loader/C++ runtime: both genuine strict links fail solely __syscall_cancel_arch','Tag0 route passes; tag1 prematurely repeats retained cleanup [1,9,9] and remains FAIL','Metadata primitive-only host gate; no recursive mutex/refcount/dlerror concurrency execution','Historical input/report and concurrent-ledger gaps are explicitly retained in evidence-gaps.json; no complete retrospective attempt-pin claim']}
acceptance['evidencePins']=evidencepin
save('prepared-acceptance.json',acceptance)
print(json.dumps({k:acceptance[k] for k in ['prepared','fullDesignPass','sourceToolEntries','actualIncludeEntries','objectArtifactEntries','recordedCommands','diskBytes']},indent=2))
