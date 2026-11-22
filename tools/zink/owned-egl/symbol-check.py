import ast,configparser,hashlib,json,os,pathlib,subprocess,sys
root=pathlib.Path.cwd()
evidence=root/'evidence'
env=os.environ.copy();env.pop('LD_LIBRARY_PATH',None)
p=json.loads(pathlib.Path(sys.argv[1]).read_text())
archive=root/'artifacts/libEGL_mesa.a'
def symbols(path):
 r=subprocess.run(['llvm-nm','--format=posix','-g',str(path)],env=env,check=True,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=20)
 defined=set();undefined=set()
 for line in r.stdout.splitlines():
  parts=line.split()
  if len(parts)>=2 and len(parts[1])==1:
   if parts[1]=='U':undefined.add(parts[0])
   elif parts[1].isupper() and parts[1] not in ['U']:defined.add(parts[0])
 return defined,undefined
exports,imports=symbols(archive)
external=imports-exports
paths={x['path']:x for x in p['inputs'] if x.get('status')=='available' and x.get('requiredBy')=='final159-link' and pathlib.Path(x['path']).suffix in ['.a','.o']}
cross=configparser.ConfigParser();cross.read(root/'cross/wasm32-musl.ini')
clang=ast.literal_eval(cross['binaries']['c'])
libc=subprocess.run([clang,'-print-file-name=libc.a'],env=env,text=True,stdout=subprocess.PIPE,check=True,timeout=10).stdout.strip()
if pathlib.Path(libc).is_file():paths[libc]={'path':libc,'family':'target-musl-runtime'}
providers={name:[] for name in external}
records=[]
for raw,entry in sorted(paths.items()):
 path=pathlib.Path(raw)
 sha=hashlib.sha256(path.read_bytes()).hexdigest()
 expected=entry.get('expectedSha256') or entry.get('sha256')
 if expected:assert sha==expected,(raw,sha,expected)
 defs,uses=symbols(path)
 for name in external&defs: providers[name].append(raw)
 records.append({'path':raw,'sha256':sha,'family':entry.get('family'),'providedEglImports':sorted(external&defs)})
# LLVM's WebAssembly ABI linker synthesizes these relocation globals/table.
linker_symbols={'__indirect_function_table','__memory_base','__stack_pointer','__table_base','__tls_base'}
missing=sorted(name for name,locations in providers.items() if not locations and name not in linker_symbols)
required=set()
for raw,entry in paths.items():
 if entry.get('family')=='mesa-egl-gpu':
  _,uses=symbols(pathlib.Path(raw));required.update(n for n in uses if n.startswith('egl'))
rec={'archive':str(archive),'sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'historical_sha256':'b87506ed6dcb83778bf7ba53d1bc56587b330d68dff54b0838bc97e281f6efc8','matches_historical_archive':hashlib.sha256(archive.read_bytes()).hexdigest()=='b87506ed6dcb83778bf7ba53d1bc56587b330d68dff54b0838bc97e281f6efc8','exportedEglSymbols':sorted(n for n in exports if n.startswith('egl')),'requiredEglSymbols':sorted(required),'missingRequiredEglSymbols':sorted(required-exports),'externalImports':sorted(external),'providers':providers,'linkerSynthesized':sorted(external&linker_symbols),'missingExternalProviders':missing,'providerInputs':records,'scope':'Direct EGL symbol closure against readable retained final159 link inputs and target musl; final Firefox link and guest execution not performed.'}
(evidence/'symbol-closure.json').write_text(json.dumps(rec,indent=2)+'\n')
print(json.dumps({k:v for k,v in rec.items() if k not in ['providers','providerInputs','externalImports']},indent=2))
assert not (required-exports)
assert not missing,missing
