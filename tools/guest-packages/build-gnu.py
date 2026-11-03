#!/usr/bin/env python3
"""Cross-build pinned GNU sources for the project's Linux/Wasm libc."""
import argparse,hashlib,json,os,pathlib,shutil,subprocess,sys,tarfile
from bounded import run
q=argparse.ArgumentParser();q.add_argument('--manifest',type=pathlib.Path,required=True);q.add_argument('--name',required=True);q.add_argument('--out',type=pathlib.Path,required=True);q.add_argument('--jobs',type=int,default=2);q.add_argument('--resume',action='store_true');q.add_argument('--reconfigure',action='store_true');q.add_argument('--native-spawn',action='store_true');a=q.parse_args();record=next(r for r in json.loads(a.manifest.read_text()) if r['name']==a.name);archive=pathlib.Path(record['archive']).resolve();assert hashlib.sha256(archive.read_bytes()).hexdigest()==record['sha256'];a.out.mkdir(parents=True,exist_ok=a.resume)
source_root=a.out/'source'
if not a.resume:
 source_root.mkdir()
 with tarfile.open(archive) as t:t.extractall(source_root,filter='data')
source=source_root/(record['name']+'-'+record['version'])
spawn_adapter=None
if a.native_spawn:
 if a.name not in ('tar','findutils'):raise ValueError('native spawn adapter is only reviewed for tar/findutils')
 port=a.out/'spawn-adapter';report_name=a.name+'-spawn-source.json'
 if not a.resume:
  tool=pathlib.Path(__file__).resolve().parent/('prepare-'+a.name+'-spawn.py')
  subprocess.run([sys.executable,str(tool),'--source-root',str(source),'--output',str(port)],check=True,stdout=subprocess.DEVNULL)
  for rel in (['src/system.c']if a.name=='tar'else['find/exec.c','xargs/xargs.c']):shutil.copyfile(port/rel,source/rel)
 spawn_adapter=json.loads((port/report_name).read_text())
 expected=({'src/system.c':spawn_adapter['patchedSha256']} if a.name=='tar' else {f['path']:f['patchedSha256'] for f in spawn_adapter['files']})
 for rel,digest in expected.items():
  if hashlib.sha256((source/rel).read_bytes()).hexdigest()!=digest:raise ValueError('spawn candidate source changed: '+rel)
if a.name=='grep' and 'LINUXONWEB_NO_MMU_GUARD' not in (source/'lib/stackvma.c').read_text():
 subprocess.run(['patch','-p1','-i',str((pathlib.Path(__file__).resolve().parent/'grep-no-mmu.patch'))],cwd=source,check=True,stdout=subprocess.DEVNULL)
build=a.out/'build';build.mkdir(exist_ok=a.resume)
cc='/nix/store/j8mdl69qafyijllv7s703219nb5fnrdp-wasm32-unknown-linux-musl-llvm-toolchain-wrapper-22.1.8/bin/wasm32-unknown-linux-musl-clang';binutils='/nix/store/l56920apsf6c40hylrqladab7npy8pfv-llvm-binutils-wrapper-21.1.8/bin/'
env={'CC':cc,'AR':binutils+'ar','RANLIB':binutils+'ranlib','NM':binutils+'nm','CFLAGS':'-O2 -g0 -pthread -matomics -mbulk-memory -ffunction-sections -fdata-sections','LDFLAGS':'-static -pthread -Wl,--gc-sections,--import-memory,--export-table,--shared-memory,--initial-memory=16777216,--max-memory=4294967296,-z,stack-size=1048576','ac_cv_c_stack_direction':'-1','sv_cv_stack_direction':'-1','sv_cv_stack_direction_msg':'grows down (actual guest probe)','ac_cv_func_fork':'no','ac_cv_func_vfork':'no','ac_cv_func_mmap':'no','ac_cv_func_mmap_fixed_mapped':'no','ac_cv_func_mremap':'no','ac_cv_func_mprotect':'no','ac_cv_func_posix_madvise':'no','ac_cv_func_madvise':'no','LC_ALL':'C'}
options={'coreutils':['--enable-single-binary=symlinks','--enable-no-install-program=stdbuf','--disable-libcap','--disable-acl','--disable-xattr'],'wget':['--with-ssl=openssl','--disable-iri','--without-libpsl','--disable-pcre','--disable-pcre2'],'tar':[],'gzip':[],'findutils':[],'grep':['--disable-perl-regexp'],'sed':['--disable-acl']}
if a.name=='wget':
 ssl='/nix/store/8wn6rsgn53csybzs905al73f3q7j67nx-openssl-static-wasm32-unknown-linux-musl-3.5.7';env.update({'OPENSSL_CFLAGS':'-I'+ssl+'/include','OPENSSL_LIBS':ssl+'/lib/libssl.a '+ssl+'/lib/libcrypto.a -ldl -pthread'})
 zlib='/nix/store/sjhvjggjz2czv2nhyncnp6xs4fapjidh-zlib-static-wasm32-unknown-linux-musl-1.3.1';env.update({'ZLIB_CFLAGS':'-I'+zlib+'/include','ZLIB_LIBS':zlib+'/lib/libz.a'})
here=pathlib.Path(__file__).resolve().parent;compat=a.out/'compat';compat.mkdir(exist_ok=True)
subprocess.run([cc,*env['CFLAGS'].split(),'-c',str(here/'no-fork.c'),'-o',str(compat/'no-fork.o')],check=True)
subprocess.run([binutils+'ar','rcs',str(compat/'liblinuxonweb-nofork.a'),str(compat/'no-fork.o')],check=True)
dependency_cppflags=' '.join(env.get(k,'') for k in ['OPENSSL_CFLAGS','ZLIB_CFLAGS']).strip()
env['CPPFLAGS']='-include '+str(here/'no-fork.h')+' '+dependency_cppflags;env['LIBS']=str((compat/'liblinuxonweb-nofork.a').resolve())
os.environ.update(env);(a.out/'build-provenance.json').write_text(json.dumps({'source':record,'environment':env,'configureOptions':options[a.name],'target':'wasm32-unknown-linux-musl','guestRuntimeValidated':False,'spawnAdapter':spawn_adapter},indent=2)+'\n')
cmd=[str((source/'configure').resolve()),'--host=wasm32-unknown-linux-musl','--build=x86_64-pc-linux-gnu','--prefix=/usr','--disable-nls','--disable-dependency-tracking',*options[a.name]]
if not a.resume or a.reconfigure:
 saved_cppflags=os.environ.get('CPPFLAGS')
 os.environ['CPPFLAGS']=dependency_cppflags
 configure_out=a.out/'configure-log';ci=1
 while configure_out.exists():
  ci+=1;configure_out=a.out/('configure-log'+str(ci))
 r=run(cmd,build,configure_out,300)
 if saved_cppflags is not None:os.environ['CPPFLAGS']=saved_cppflags
 if not r['pass']:raise SystemExit(1)
index=1
while (a.out/f'build-log{index}').exists():index+=1
targets={'coreutils':['src/coreutils'],'wget':['all'],'tar':['all'],'gzip':['all'],'findutils':['all'],'grep':['all'],'sed':['all']}
warning_line=next((line.split('=',1)[1] for line in (build/'Makefile').read_text().splitlines() if line.startswith('GL_CFLAG_GNULIB_WARNINGS =')), '')
# Older configured trees included forced-header declarations in a preprocessor probe.
# Preserve only the actual compiler warning options; never send declarations to a shell.
warning_flags=' '.join(token for token in warning_line.split() if token.startswith('-W') and all(c not in token for c in ';()'))
# Build program/library targets; cross-target test executables are not host-run gates.
subdirs={'gzip':'lib .','grep':'lib src','sed':'.'}.get(a.name)
make_scope=['SUBDIRS='+subdirs] if subdirs else []
r=run(['make','-j'+str(a.jobs),*make_scope,'GL_CFLAG_GNULIB_WARNINGS='+warning_flags,'CPPFLAGS='+env['CPPFLAGS'],*targets[a.name]],build,a.out/f'build-log{index}',600)
raise SystemExit(0 if r['pass'] else 1)
