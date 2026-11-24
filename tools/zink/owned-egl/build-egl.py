import fcntl,hashlib,json,os,pathlib,shutil,subprocess
root=pathlib.Path.cwd()
build=root/'build/headless'
env=os.environ.copy()
env.pop('LD_LIBRARY_PATH',None)
env['PATH']=str(root/'venv/bin')+os.pathsep+env['PATH']
env.update(TMPDIR=str(root/'tmp'),TMP=str(root/'tmp'),TEMP=str(root/'tmp'),XDG_CACHE_HOME=str(root/'cache'),CCACHE_DIR=str(root/'cache/ccache'))
all_commands=json.loads((build/'compile_commands.json').read_text())
commands=[e for e in all_commands if e.get('output','').startswith('src/egl/libEGL.so.1.0.0.p/')]
(root/'evidence/egl-compile-commands.json').write_text(json.dumps(commands,indent=2)+'\n')
targets=sorted(e['output'] for e in commands)
pins=json.loads(pathlib.Path(__file__).with_name('pins.json').read_text())
assert targets==pins['egl_targets'],targets
assert len(targets)==16,targets
ninja=shutil.which('ninja',path=env['PATH'])
with (root/'egl-build.lock').open('a') as lock:
    fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    dry=subprocess.run([ninja,'-C',str(build),'-n',*targets],env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,check=True,timeout=15)
    (root/'evidence/egl-dry-run.log').write_text(dry.stdout)
    print(dry.stdout,flush=True)
    assert len(dry.stdout.splitlines())<200,'unexpectedly broad EGL dependency graph'
    subprocess.run([ninja,'-C',str(build),'-j2',*targets],env=env,check=True,timeout=150)
    output=root/'artifacts'
    output.mkdir(exist_ok=True)
    archive=output/'libEGL_mesa.a'
    assert not archive.exists(),str(archive)
    subprocess.run(['llvm-ar','qcs',str(archive),*[str(build/t) for t in targets]],env=env,check=True,timeout=15)
    members=subprocess.run(['llvm-ar','t',str(archive)],env=env,text=True,stdout=subprocess.PIPE,check=True,timeout=10).stdout.splitlines()
    assert members==[pathlib.Path(t).name for t in targets],members
    for target in targets:
        assert (build/target).read_bytes()[:8]==b'\x00asm\x01\x00\x00\x00',target
    symbols=subprocess.run(['llvm-nm','--format=posix',str(archive)],env=env,text=True,stdout=subprocess.PIPE,check=True,timeout=15).stdout
    (root/'evidence/egl-symbols.txt').write_text(symbols)
    rec={'archive':str(archive),'sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'bytes':archive.stat().st_size,'object_count':len(members),'members':members,'all_objects_wasm_version_1':True,'targets':targets,'object_sha256':{t:hashlib.sha256((build/t).read_bytes()).hexdigest() for t in targets}}
    assert rec['sha256']==pins['historical_egl_sha256'],rec['sha256']
    (root/'evidence/egl-artifact.json').write_text(json.dumps(rec,indent=2)+'\n')
    print(json.dumps(rec),flush=True)
