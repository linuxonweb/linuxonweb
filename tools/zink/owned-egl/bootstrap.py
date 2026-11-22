import configparser, hashlib, json, os, pathlib, subprocess, sys
root=pathlib.Path.cwd()
env=os.environ.copy()
env.pop('LD_LIBRARY_PATH',None)
env.update(TMPDIR=str(root/'tmp'),TMP=str(root/'tmp'),TEMP=str(root/'tmp'),PIP_CACHE_DIR=str(root/'cache/pip'),XDG_CACHE_HOME=str(root/'cache'))
def run(argv):
    print(json.dumps(argv),flush=True)
    subprocess.run(argv,env=env,check=True,timeout=110)
wrap=configparser.ConfigParser()
wrap.read(root/'mesa-26.2.3/subprojects/libdrm.wrap')
w=wrap['wrap-file']
a=root/'downloads'/w['source_filename']
assert not a.exists(),str(a)
cache=pathlib.Path(sys.argv[1]) if len(sys.argv)>1 else None
if cache is None:
    run(['curl','--fail','--location','--connect-timeout','10','--max-time','60','--retry','0','--output',str(a),w['source_url']])
else:
    import shutil
    shutil.copyfile(cache/a.name,a)
assert w['source_hash']=='fc68f9d0ba2ea63c9432a299e14fea09fad7a8a66e8039fcd7802ca59f77b4f5'
sha=hashlib.sha256(a.read_bytes()).hexdigest()
assert sha==w['source_hash'],sha
cache=root/'mesa-26.2.3/subprojects/packagecache'
cache.mkdir(exist_ok=True)
os.link(a,cache/a.name)
venv=root/'venv'
assert not venv.exists(),str(venv)
run([sys.executable,'-m','venv',str(venv)])
requirements=['meson==1.12.0','Mako==1.3.10','MarkupSafe==3.0.3','packaging==25.0','PyYAML==6.0.3','ply==3.11']
run([str(venv/'bin/python'),'-m','pip','install','--disable-pip-version-check','--only-binary=:all:','--timeout','20','--retries','0','--report',str(root/'evidence/python-packages.json'),'--require-hashes','-r',str(pathlib.Path(__file__).with_name('requirements-cpython312-linux-x86_64.txt'))])
(root/'evidence/source-closure.json').write_text(json.dumps({'mesa_version':'26.2.3','mesa_sha256':'1628058a8d2c0615975de5a15ab7bbb9638c50000b5bed9456ff423ea034a81f','mesa_url':'https://archive.mesa3d.org/mesa-26.2.3.tar.xz','libdrm_version':'2.4.133','libdrm_sha256':sha,'libdrm_url':w['source_url'],'python_requirements':requirements,'port_recipe':'tools/zink/configure-wasm32.sh','cross_template':'tools/zink/cross/wasm32-musl.ini.in','glsl_override_patch':'tools/zink/patches/0001-glsl-builtin-image-memfnptr-wasm.patch','upstream_source_modified':False},indent=2)+'\n')
