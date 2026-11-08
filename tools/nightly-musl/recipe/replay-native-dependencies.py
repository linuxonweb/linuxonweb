#!/usr/bin/env python3
"""Rebuild the readable, pinned native adapters and Wasm C++ runtimes.

Run each phase beneath tools/guest-packages/bounded.py. This script never reads
historical denied output trees, changes upstream sources, or accepts a browser.
"""
import argparse, hashlib, json, os, pathlib, shutil, subprocess, time

REPO = pathlib.Path(__file__).resolve().parents[3]
SOURCE_PINS = {
    'runtime.c': '3ee136b2ee2154221e26d070703dbc3d988824cf99c399c62ba047e09956e7a3',
    'stack.c': '7d1d0d85dacd408c3b94278be44d1ac00baf0d81a8c3b2ffa936416e1f0590d5',
    'mmap-shim.c': 'cf9f7592186c95dbe9589d8e86bd86fd724b8f06f9c539826ca3a3707c621e97',
}
EXPECTED = {
    'libnightly-native-runtime.a': 'f5dd22ed404f36a9be25b9bb87665e3d9601dd49969cea23dec5b25a4c58d725',
    'libnightly-native-stack.a': '9a4fc27adfbc60dd1bf3752a36e46a1f6655fb000c0f240a63f65bb70fa7285f',
    'libc++.a': '5265c4a1fec02eeb62648d21479c9b06a1d5e5e3599fea4aea89534963f7463c',
    'libc++abi.a': '5019f48eb0ac1c57f3ac94d1ba1f03f8f6b0d1363f54b565d4c06d7fd93af1f5',
    'libunwind.a': '39003fecea73e2fc9c810026f80b6b1cb3171e0d259fb801ed365e3cdb0d4d4b',
}
LIBRARIES = [
    ('native-mapping-wrapped-shm', 'libnightly-native-mapping.a'),
    ('native-runtime-accepted-run1', 'libnightly-native-runtime.a'),
    ('native-stack-accepted-run1', 'libnightly-native-stack.a'),
    ('native-unwind/runtimes-build/lib', 'libc++.a'),
    ('native-unwind/runtimes-build/lib', 'libc++abi.a'),
    ('native-unwind/runtimes-build/lib', 'libunwind.a'),
]


def sha(path):
    h = hashlib.sha256()
    with pathlib.Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1048576), b''): h.update(chunk)
    return h.hexdigest()


def pin(path):
    path = pathlib.Path(path)
    return dict(path=str(path), bytes=path.stat().st_size, sha256=sha(path))


def write_json(path, value):
    pathlib.Path(path).write_text(json.dumps(value, indent=2) + '\n')


def tool_env(out):
    env = dict(x.split('=', 1) for x in subprocess.check_output(
        ['bash', '-c', 'source "$1"; env -0', 'native-dependencies', str(out/'recipe/environment.sh')]
    ).decode().split('\0') if '=' in x)
    # The captured host-library path no longer exists. Restrict this adjustment
    # to these owned child processes; no profile or global environment edit.
    env.pop('LD_LIBRARY_PATH', None)
    for key in ('TMPDIR', 'TMP', 'TEMP', 'XDG_CACHE_HOME', 'CCACHE_DIR', 'SCCACHE_DIR'):
        directory = out/'cache'/key.lower()
        directory.mkdir(parents=True, exist_ok=True)
        env[key] = str(directory)
    return env


def command(out, name, argv, env, timeout=120, cwd=None):
    log = out/'logs'/(name+'.log')
    if log.exists(): raise RuntimeError('retain prior phase evidence: '+str(log))
    start = time.time()
    with log.open('w') as stream:
        result = subprocess.run(argv, cwd=cwd, env=env, stdout=stream, stderr=subprocess.STDOUT, timeout=timeout)
    write_json(out/'logs'/(name+'.json'), dict(argv=argv, cwd=str(cwd) if cwd else None,
        exitCode=result.returncode, durationSeconds=round(time.time()-start,3), log=pin(log)))
    if result.returncode: raise RuntimeError(str(name)+' failed; see '+str(log))


def prepare(args, out, packet):
    if (out/'inputs.json').exists(): raise RuntimeError('already prepared')
    if shutil.disk_usage(out).free < 20*1024**3: raise RuntimeError('disk reserve')
    for part in ('recipe', 'inputs', 'logs', 'cache', 'native-unwind'):
        (out/part).mkdir(parents=True, exist_ok=True)
    data = json.loads((packet/'preflight.json').read_text())
    llvm = next(pathlib.Path(x['path']).parents[1] for x in data['inputs']
                if x.get('family') == 'cxx-abi-unwind-source' and x['path'].endswith('/runtimes/CMakeLists.txt'))
    musl = next(pathlib.Path(x['path']).parents[2] for x in data['inputs']
                if x.get('family') == 'musl-private-header' and x['path'].endswith('/src/include/features.h'))
    export = pathlib.Path(args.source_export).resolve()
    env_source = packet/'recipe/environment.sh'
    text = env_source.read_text().replace(str(packet/'deps'), str(out)).replace(str(packet/'recipe'),str(out/'recipe'))
    (out/'recipe/environment.sh').write_text(text)
    shutil.copytree(export/'linuxonweb-build/recipe/shim',out/'recipe/shim')
    shutil.copytree(llvm/'libunwind/include',out/'native-unwind/include')
    for name, sub in [('runtime.c','native-runtime'),('stack.c','native-stack')]:
        shutil.copyfile(export/'linuxonweb-build/adapters'/sub/name, out/'inputs'/name)
    mapping = subprocess.check_output(['git','show','91c80e0:web/linux/firefox-shims/mmap-shim.c'],cwd=REPO)
    (out/'inputs/mmap-shim.c').write_bytes(mapping)
    for name, digest in SOURCE_PINS.items():
        if sha(out/'inputs'/name) != digest: raise RuntimeError('source pin mismatch '+name)
    recipes = []
    for name in ('configure-cxx-runtime.py','build-cxx-runtime.py','build-native-mapping.py','build-native-runtime.py','build-native-stack.py'):
        a = export/'linuxonweb-build/recipe'/name
        b = REPO/'tools/nightly-musl/recipe'/name
        if a.read_bytes() != b.read_bytes(): raise RuntimeError('export/repository recipe disagreement '+name)
        recipes.append(pin(a))
    env = tool_env(out)
    libc = pathlib.Path(env['WASM_MUSL_SYSROOT'])/'lib/libc.a'
    if sha(libc) != 'f2636fe6df25bd50e23a1726d9e28e6cdc82a03a4f000c693e569b6a65d5608b':
        raise RuntimeError('selected musl ABI differs from receipt')
    inputs = dict(sourceExport=str(export), packet=pin(packet/'preflight.json'), llvmSource=str(llvm),
        muslSource=str(musl), environmentInput=pin(env_source), environmentOutput=pin(out/'recipe/environment.sh'),
        sourceFiles=[pin(out/'inputs'/x) for x in SOURCE_PINS], libc=pin(libc), recipes=recipes,
        mappingGitCommit=subprocess.check_output(['git','rev-parse','91c80e0'],cwd=REPO,text=True).strip(),
        mappingCurrentTreeUsed=False, tools={k:pin(env[k]) for k in ('CC','CXX','AR')},
        replayAdjustments=['owned output/source paths','disk temp and caches','remove obsolete LD_LIBRARY_PATH in child only','ninja jobs limited to three'],
        historicalGuestReceiptsReusedAsCurrentAcceptance=False)
    write_json(out/'inputs.json', inputs)
    print(json.dumps({'prepared':str(out),'llvm':str(llvm),'musl':str(musl)},indent=2))


def configure(out, inputs):
    env=tool_env(out)
    env['NIX_CXXSTDLIB_COMPILE_wasm32_unknown_linux_musl']=''
    env['NIX_CXXSTDLIB_LINK_wasm32_unknown_linux_musl']=''
    build=out/'native-unwind/runtimes-build'
    if build.exists(): raise RuntimeError('preserve existing runtime build')
    argv=['cmake','-S',str(pathlib.Path(inputs['llvmSource'])/'runtimes'),'-B',str(build),'-G','Ninja',
        '-DCMAKE_BUILD_TYPE=Release','-DCMAKE_SYSTEM_NAME=Linux','-DCMAKE_SYSTEM_PROCESSOR=wasm32',
        '-DCMAKE_C_COMPILER='+env['CC'],'-DCMAKE_CXX_COMPILER='+env['CXX'],'-DCMAKE_AR='+env['AR'],
        '-DCMAKE_C_COMPILER_TARGET=wasm32-unknown-linux-musl','-DCMAKE_CXX_COMPILER_TARGET=wasm32-unknown-linux-musl',
        '-DCMAKE_TRY_COMPILE_TARGET_TYPE=STATIC_LIBRARY','-DCMAKE_C_FLAGS=-pthread -fwasm-exceptions',
        '-DCMAKE_CXX_FLAGS=-pthread -fwasm-exceptions -Xclang -fc++-abi=webassembly',
        '-DLLVM_ENABLE_RUNTIMES=libcxx;libcxxabi;libunwind','-DLLVM_INCLUDE_TESTS=OFF','-DCMAKE_EXPORT_COMPILE_COMMANDS=ON',
        '-DLIBCXX_ENABLE_SHARED=OFF','-DLIBCXXABI_ENABLE_SHARED=OFF','-DLIBUNWIND_ENABLE_SHARED=OFF',
        '-DLIBCXX_INCLUDE_TESTS=OFF','-DLIBCXXABI_INCLUDE_TESTS=OFF','-DLIBUNWIND_INCLUDE_TESTS=OFF',
        '-DLIBCXX_HAS_MUSL_LIBC=ON','-DLIBCXX_HAS_PTHREAD_API=OFF','-DLIBCXXABI_ENABLE_STATIC_UNWINDER=ON',
        '-DLIBUNWIND_ENABLE_THREADS=ON','-DLIBCXXABI_USE_COMPILER_RT=ON','-DLIBUNWIND_USE_COMPILER_RT=ON',
        '-DLIBUNWIND_HIDE_SYMBOLS=ON']
    command(out,'runtime-configure',argv,env,120)


def build_runtime(out, jobs, attempt, targets):
    env=tool_env(out)
    env['NIX_CXXSTDLIB_COMPILE_wasm32_unknown_linux_musl']=''
    env['NIX_CXXSTDLIB_LINK_wasm32_unknown_linux_musl']=''
    name='runtime-build' if attempt==1 else 'runtime-build-attempt-'+str(attempt)
    command(out,name,['ninja','-C',str(out/'native-unwind/runtimes-build'),'-j'+str(jobs),
        *targets],env,720)


def adapters(out, inputs):
    env=tool_env(out); musl=pathlib.Path(inputs['muslSource'])
    for kind, sub, source, flags in [
        ('mapping','native-mapping-wrapped-shm','mmap-shim.c', ['-Dshm_open=__wrap_shm_open','-Dshm_unlink=__wrap_shm_unlink',
            '-std=c11','-D_GNU_SOURCE','-pthread','-O2','-I'+str(out/'recipe/shim')]),
        ('runtime','native-runtime-accepted-run1','runtime.c',['-std=c11','-O2','-pthread','-Wall','-Wextra','-Werror',
            '-I'+str(out/'native-unwind/include')]),
        ('stack','native-stack-accepted-run1','stack.c',['-O2','-pthread','-Wall','-Wextra','-Werror','-matomics','-mbulk-memory',
            '-include',str(musl/'src/include/features.h'),'-isystem',str(musl/'src/internal'),
            '-isystem',str(musl/'arch/wasm32'),'-isystem',str(musl/'arch/generic')])]:
        p=out/sub; p.mkdir()
        src=p/source;shutil.copyfile(out/'inputs'/source,src)
        obj=src.with_suffix('.o'); archive=p/('libnightly-native-'+kind+'.a')
        command(out,kind+'-compile',[env['CC'],*flags,'-c',str(src),'-o',str(obj)],env,60)
        command(out,kind+'-validate',['wasm-validate','--enable-all',str(obj)],env,60)
        command(out,kind+'-archive',[env['AR'],'crs',str(archive),str(obj)],env,60)
        if kind=='stack' and sha(obj)!='46c762f103d7f09c899afccd9997a96e9da21db466fc75b58f5c10e0c4d00cda':
            raise RuntimeError('stack object must equal recorded guest-tested object')


def ar_members(data):
    if data[:8]!=b'!<arch>\n': raise RuntimeError('not a static archive')
    index=8;names=b'';members=[]
    while index<len(data):
        header=data[index:index+60]
        if len(header)!=60 or header[58:]!=b'`\n': raise RuntimeError('invalid ar header')
        name=header[:16].decode().strip();size=int(header[48:58]);payload=data[index+60:index+60+size]
        if len(payload)!=size: raise RuntimeError('short archive member')
        index+=60+size+(size&1)
        if name=='//': names=payload;continue
        if name in ('/','/SYM64/'):continue
        if name.startswith('#1/'):
            n=int(name[3:]); name=payload[:n].rstrip(b'\0').decode();payload=payload[n:]
        elif name.startswith('/') and name[1:].isdigit():
            name=names[int(name[1:]):].split(b'/\n',1)[0].decode()
        else: name=name.rstrip('/')
        members.append((name,payload))
    return members


def verify(out, inputs, packet, attempt):
    env=tool_env(out); verified=[];missing=[]
    check=out/('archive-validation' if attempt==1 else 'archive-validation-attempt-'+str(attempt));check.mkdir()
    required={
        'libnightly-native-mapping.a':['__wrap_shm_open','__wrap_shm_unlink','mmap','munmap'],
        'libnightly-native-runtime.a':['__cxa_thread_atexit_impl','__wrap_exit','__wrap___pthread_tsd_run_dtors','_Unwind_Backtrace'],
        'libnightly-native-stack.a':['__wrap_pthread_getattr_np'],
        'libc++abi.a':['__cxa_throw','__cxa_begin_catch','__cxa_end_catch'],
        'libunwind.a':['_Unwind_RaiseException','_Unwind_DeleteException','_Unwind_CallPersonality'],
    }
    for sub,name in LIBRARIES:
        p=out/sub/name
        if not p.exists():
            missing.append(str(p));continue
        members=ar_members(p.read_bytes())
        if not members: raise RuntimeError('empty archive '+name)
        member_records=[]
        for i,(member,data) in enumerate(members):
            if data[:8]!=b'\0asm\x01\0\0\0': raise RuntimeError('not real Wasm object '+name+':'+member)
            temp=check/(name+'-'+str(i)+'.o');temp.write_bytes(data)
            r=subprocess.run(['wasm-validate','--enable-all',str(temp)],env=env,capture_output=True,text=True,timeout=30)
            if r.returncode:raise RuntimeError(r.stderr)
            member_records.append(dict(name=member,bytes=len(data),sha256=hashlib.sha256(data).hexdigest(),wasmValidated=True))
            temp.unlink()
        symbols=subprocess.check_output(['llvm-nm','--defined-only',str(p)],env=env,text=True,stderr=subprocess.STDOUT)
        (check/(name+'.symbols.txt')).write_text(symbols)
        defined={line.split()[-1] for line in symbols.splitlines() if len(line.split())>=3}
        for symbol in required.get(name,[]):
            if symbol not in defined:raise RuntimeError('missing '+symbol+' in '+name)
        identity=pin(p);expected=EXPECTED.get(name)
        if expected and identity['sha256']!=expected:
            raise RuntimeError('historical archive pin mismatch '+name)
        verified.append(dict(**identity,members=member_records,nativeMembers=len(members),expectedHistoricalSHA256=expected,
            historicalByteIdentity=(identity['sha256']==expected if expected else None),requiredSymbols=required.get(name,[])))
    build=out/'native-unwind/runtimes-build'
    commands=json.loads((build/'compile_commands.json').read_text())
    source_paths={pathlib.Path(c['file']) for c in commands}
    dependencies=subprocess.check_output(['ninja','-C',str(build),'-t','deps'],env=env,text=True)
    (check/'runtime-dependencies.txt').write_text(dependencies)
    for line in dependencies.splitlines():
        if line.startswith('    '):
            p=pathlib.Path(line.strip());p=p if p.is_absolute() else build/p
            if p.is_file():source_paths.add(p)
    closure=[pin(p) for p in sorted(source_paths)]
    write_json(out/'source-closure.json',closure)
    data=json.loads((packet/'preflight.json').read_text());path_map={}
    for row in data['inputs']:
        if row.get('family') in ('native-adapter','cxx-abi-unwind'):
            for sub,name in LIBRARIES:
                if row['path'].endswith('/'+sub+'/'+name): path_map[row['path']]=str(out/sub/name)
    for old,new in data['pathMappings'].items():
        if new==str(packet/'deps'):
            for sub,name in LIBRARIES:path_map[str(pathlib.Path(old)/sub/name)]=str(out/sub/name)
    path_map[str(packet/'deps/native-unwind/runtimes-build/lib')]=str(build/'lib')
    write_json(out/'planned-replacement-paths.json',path_map)
    ready_map={k:v for k,v in path_map.items() if pathlib.Path(v).is_file() or (pathlib.Path(v).is_dir() and not missing)}
    write_json(out/'replacement-paths.json',ready_map)
    dependency_roots=[packet/'deps',*(pathlib.Path(old) for old,new in data['pathMappings'].items() if new==str(packet/'deps'))]
    header_map={}
    for root in dependency_roots:
        for relative in ('native-unwind/include','native-unwind/runtimes-build/include/c++/v1'):
            if (out/relative).is_dir():header_map[str(root/relative)]=str(out/relative)
    write_json(out/'header-replacement-paths.json',header_map)
    report=dict(passArtifactValidation=not missing,presentArtifactValidation=True,missingArtifacts=missing,validationDirectory=str(check),artifacts=verified,compileUnits=len(commands),sourceClosureFiles=len(closure),
        sourceClosure=pin(out/'source-closure.json'),inputs=pin(out/'inputs.json'),replacementPaths=pin(out/'replacement-paths.json'),
        browserLinkAcceptance=False,guestRuntimeAcceptance=False,fullJitAcceptance=False,
        notes=['Historical receipts describe earlier runs only; this run validates rebuilt artifacts.',
               'No Firefox link or guest execution occurred in this dependency task.'])
    write_json(out/'validation.json',report)
    print(json.dumps({k:v for k,v in report.items() if k!='artifacts'},indent=2))
    for a in verified:print(json.dumps({k:v for k,v in a.items() if k!='members'}))


def main():
    p=argparse.ArgumentParser();p.add_argument('--out',required=True);p.add_argument('--packet',required=True)
    p.add_argument('--targets',nargs='+',choices=['cxx_static','cxxabi_static','unwind_static'],default=['cxx_static','cxxabi_static','unwind_static'])
    p.add_argument('--jobs',type=int,choices=[1,2,3],default=3);p.add_argument('--attempt',type=int,default=1)
    p.add_argument('--source-export');p.add_argument('--phase',choices=['prepare','configure','build','adapters','verify'],required=True)
    a=p.parse_args();out=pathlib.Path(a.out).resolve();packet=pathlib.Path(a.packet).resolve()
    if a.attempt<1:p.error('--attempt must be positive')
    if a.phase=='prepare' and not a.source_export:p.error('--source-export is required for prepare')
    out.mkdir(parents=True,exist_ok=True)
    if a.phase=='prepare':return prepare(a,out,packet)
    inputs=json.loads((out/'inputs.json').read_text())
    if a.phase=='configure':configure(out,inputs)
    elif a.phase=='build':build_runtime(out,a.jobs,a.attempt,a.targets)
    elif a.phase=='adapters':adapters(out,inputs)
    elif a.phase=='verify':verify(out,inputs,packet,a.attempt)

if __name__=='__main__':main()
