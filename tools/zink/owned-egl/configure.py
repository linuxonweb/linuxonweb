import hashlib, json, os, pathlib, subprocess
root=pathlib.Path.cwd()
repo=pathlib.Path(__file__).resolve().parents[3]
env=os.environ.copy()
for key in ['LD_LIBRARY_PATH','CC','CXX','CPP','AR','LD','CFLAGS','CXXFLAGS','CPPFLAGS','LDFLAGS','PKG_CONFIG_PATH','PKG_CONFIG_LIBDIR']:
    env.pop(key,None)
env['PATH']=str(root/'venv/bin')+os.pathsep+env['PATH']
env.update(TMPDIR=str(root/'tmp'),TMP=str(root/'tmp'),TEMP=str(root/'tmp'),XDG_CACHE_HOME=str(root/'cache'),PIP_CACHE_DIR=str(root/'cache/pip'),CCACHE_DIR=str(root/'cache/ccache'))
cross=root/'cross/wasm32-musl.ini'
cross.parent.mkdir(exist_ok=True)
assert not cross.exists()
text=(repo/'tools/zink/cross/wasm32-musl.ini.in').read_text().replace('@TASKDIR@',str(root)).replace('@ROOT@',str(repo))
cross.write_text(text)
smoke=root/'evidence/host-smoke.c'
smoke.write_text('int main(void) { return 0; }\n')
subprocess.run(['cc',str(smoke),'-o',str(smoke.with_suffix(''))],env=env,check=True,timeout=20)
subprocess.run([str(smoke.with_suffix(''))],env=env,check=True,timeout=5)
args=[str(root/'venv/bin/meson'),'setup',str(root/'build/headless'),str(root/'mesa-26.2.3'),'--cross-file',str(cross),'--wrap-mode=nodownload','-Dbuildtype=release','-Db_ndebug=true','-Dgallium-drivers=zink','-Dvulkan-drivers=','-Dllvm=disabled','-Dgallium-rusticl=false','-Dopengl=true','-Dgles1=disabled','-Dgles2=enabled','-Degl=enabled','-Dglx=disabled','-Dplatforms=','-Dgbm=disabled','-Dbuild-tests=false','-Dvalgrind=disabled','-Dlibunwind=disabled','-Dzstd=disabled','-Dshader-cache=disabled','-Dzlib=disabled','-Dxmlconfig=disabled','-Dexpat=disabled','-Dallow-fallback-for=libdrm','-Dlibdrm:tests=false','-Dlibdrm:install-test-programs=false']
(root/'evidence/configure-argv.json').write_text(json.dumps(args,indent=2)+'\n')
print(json.dumps({'cross_sha256':hashlib.sha256(cross.read_bytes()).hexdigest(),'host_link_smoke':'pass','args':args}),flush=True)
subprocess.run(args,env=env,check=True,timeout=240)
