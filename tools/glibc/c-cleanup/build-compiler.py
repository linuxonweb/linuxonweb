#!/usr/bin/env python3
"""Privately rebuild one pinned Clang frontend unit and unchanged driver sources."""
import pathlib,os,json,subprocess,shlex,hashlib,shutil,resource,concurrent.futures,time
import importlib.util
_spec=importlib.util.spec_from_file_location('owned_archive_audit',pathlib.Path(__file__).with_name('archive-audit.py'));_module=importlib.util.module_from_spec(_spec);_spec.loader.exec_module(_module)
archiveMembers=_module.members
T=pathlib.Path(os.environ['GLIBC_TASK']);S=pathlib.Path(os.environ['GLIBC_LLVM_SOURCE']);L=pathlib.Path(os.environ['GLIBC_TOOLCHAIN']);R=pathlib.Path(__file__).resolve().parent
for d in ['logs/compiler','objects/compiler','source-snapshots/compiler','tmp','cache']: (T/d).mkdir(parents=True,exist_ok=True)
resource.setrlimit(resource.RLIMIT_CORE,(0,0));records=[]
def digest(b):return hashlib.sha256(b).hexdigest()
def raw(args):return subprocess.check_output(args).decode().strip()
def checkstorage():
 assert shutil.disk_usage(T).free>5368709120
 assert int(subprocess.check_output(['du','-sk',str(T)]).split()[0])*1024<3221225472
 assert raw(['stat','-f','-c','%T',str(T)])=='ext2/ext3'
def members(pgid):
 result=[]
 for entry in pathlib.Path('/proc').glob('[0-9]*/stat'):
  try:
   fields=entry.read_text().rsplit(')',1)[1].split()
   if int(fields[2])==pgid and fields[0]!='Z':result.append(int(entry.parent.name))
  except (FileNotFoundError,ProcessLookupError,PermissionError):pass
 return result
def command(name,args):
 checkstorage();out=T/'logs/compiler'/name;started=time.monotonic();p=subprocess.Popen(args,cwd=T,stdout=out.with_suffix('.log').open('wb'),stderr=subprocess.STDOUT,start_new_session=True)
 row={'stage':name,'argv':args,'cwd':str(T),'pid':p.pid,'pgid':p.pid};out.with_suffix('.command.json').write_text(json.dumps(row,indent=2)+'\n');print(name,'owned PID/PGID',p.pid,flush=True)
 try:code=p.wait(timeout=300)
 except subprocess.TimeoutExpired:
  import signal
  os.killpg(p.pid,signal.SIGTERM)
  try:p.wait(timeout=2)
  except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGKILL);p.wait()
  code=p.returncode
 remaining=members(p.pid);actions=[]
 if remaining:
  import signal
  os.killpg(p.pid,signal.SIGTERM);actions.append('SIGTERM owned remaining group');deadline=time.monotonic()+2
  while members(p.pid) and time.monotonic()<deadline:time.sleep(.1)
  if members(p.pid):os.killpg(p.pid,signal.SIGKILL);actions.append('SIGKILL owned remaining group')
  deadline=time.monotonic()+5
  while members(p.pid) and time.monotonic()<deadline:time.sleep(.1)
 assert not members(p.pid), 'owned compiler group remains'
 checkstorage()
 row.update(exit=code,elapsedSeconds=round(time.monotonic()-started,2),terminalGroupMembers=members(p.pid),groupActions=actions);out.with_suffix('.command.json').write_text(json.dumps(row,indent=2)+'\n')
 if code:raise RuntimeError('compiler stage failed, retained '+name)
 return row
assert raw([str(L/'bin/llvm-config'),'--version'])=='22.1.8'
assert raw([str(L/'bin/llvm-config'),'--assertion-mode'])=='OFF'
version=(L/'include/clang/Basic/Version.inc').read_text();assert '#define CLANG_VERSION_STRING "22.1.8"' in version
config=(L/'lib/cmake/llvm/LLVMConfig.cmake').read_text();assert 'set(LLVM_ENABLE_RTTI OFF)' in config and 'set(LLVM_ENABLE_EH OFF)' in config and '_GLIBCXX_USE_CXX11_ABI=1' in config
src=S/'clang/lib/CodeGen/CGException.cpp';original=src.read_bytes();text=original.decode()
needle='''static const EHPersonality &getCPersonality(const TargetInfo &Target,
                                            const CodeGenOptions &CGOpts) {
  const llvm::Triple &T = Target.getTriple();
  if (T.isWindowsMSVCEnvironment())
    return EHPersonality::MSVC_CxxFrameHandler3;
'''
assert text.count(needle)==1
replacement=needle+'''  if (CGOpts.hasWasmExceptions())
    return EHPersonality::GNU_Wasm_CPlusPlus;
'''
assert text.count('if (CGOpts.hasWasmExceptions())')>=1
owned=T/'source-snapshots/compiler';patched=owned/'CGException.cpp';assert not patched.exists();patched.write_text(text.replace(needle,replacement));(owned/'CGException-original.cpp').write_bytes(original)
import difflib
(T/'logs/compiler/frontend-hook.patch').write_text(''.join(difflib.unified_diff(text.splitlines(True),patched.read_text().splitlines(True),fromfile='clang/lib/CodeGen/CGException.cpp',tofile='clang/lib/CodeGen/CGException.cpp')))
archive=L/'lib/libclangCodeGen.a';member='CGException.cpp.o';ar=str(L/'bin/llvm-ar');names=raw([ar,'t',str(archive)]).splitlines();assert names.count(member)==1
memberHashes=archiveMembers(archive);assert [x['name'] for x in memberHashes]==names
flags=shlex.split(raw([str(L/'bin/llvm-config'),'--cxxflags']));assert '-fno-exceptions' in flags and '-fno-rtti' in flags
flags+=['-DNDEBUG','-O1','-g0','-I'+str(S/'clang/lib/CodeGen')]
units=[(patched,member)]
for name in ['driver.cpp','cc1_main.cpp','cc1as_main.cpp','cc1gen_reproducer_main.cpp']:
 p=owned/name;shutil.copyfile(S/'clang/tools/driver'/name,p);units.append((p,name+'.o'))
p=owned/'main.cpp';shutil.copyfile(R/'main.cpp',p);units.append((p,'main.cpp.o'))
(T/'logs/compiler/provenance.json').write_text(json.dumps({'source':str(src),'sourceSha256':digest(original),'patchedSha256':digest(patched.read_bytes()),'member':member,'originalArchive':str(archive),'archiveSha256':digest(archive.read_bytes()),'memberHashes':memberHashes,'version':'22.1.8','ABI':'EHoff RTTIoff assertionsoff _GLIBCXX_USE_CXX11_ABI1','flags':flags,'sourceFiles':{str(p):digest(p.read_bytes()) for p,_ in units}},indent=2)+'\n')
def compile(unit):
 p,name=unit;return command('compile-'+name,['/usr/bin/g++',*flags,'-MD','-MF',str(T/'logs/compiler'/(name+'.d')),'-c',str(p),'-o',str(T/'objects/compiler'/name)])
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
 records.extend(pool.map(compile,units))
private=T/'objects/compiler/libclangCodeGen.a';shutil.copyfile(archive,private)
records.append(command('archive-replace',[ar,'r',str(private),str(T/'objects/compiler'/member)]));assert raw([ar,'t',str(private)]).splitlines()==names
privateMembers=archiveMembers(private);assert all(x==y for x,y in zip(memberHashes,privateMembers) if x['name']!=member)
clanglibs=[str(p) for p in sorted((L/'lib').glob('libclang*.a')) if p.name!='libclangCodeGen.a']
llvmlibs=shlex.split(raw([str(L/'bin/llvm-config'),'--libfiles','all']));system=shlex.split(raw([str(L/'bin/llvm-config'),'--system-libs']))
binary=T/'objects/compiler/clang';args=['/usr/bin/g++','-fuse-ld=lld','-o',str(binary),*[str(T/'objects/compiler'/n) for _,n in units if n!=member],'-Wl,--start-group',str(private),*clanglibs,*llvmlibs,'-Wl,--end-group',*system,'-pthread']
records.append(command('link-driver',args));assert 'clang version 22.1.8' in raw([str(binary),'--version'])
(T/'logs/compiler/result.json').write_text(json.dumps({'pass':True,'compiler':str(binary),'sha256':digest(binary.read_bytes()),'privateArchive':digest(private.read_bytes()),'otherCodeGenMembersUnchanged':len(names)-1,'records':records,'linkArchives':clanglibs+llvmlibs},indent=2)+'\n');print('PRIVATE COMPILER BUILT',str(binary),flush=True)
