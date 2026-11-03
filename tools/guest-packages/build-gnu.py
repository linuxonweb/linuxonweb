#!/usr/bin/env python3
"""Cross-build pinned GNU sources for the project's Linux/Wasm libc."""
import argparse,hashlib,json,os,pathlib,subprocess,tarfile
from bounded import run
q=argparse.ArgumentParser();q.add_argument('--manifest',type=pathlib.Path,required=True);q.add_argument('--name',required=True);q.add_argument('--out',type=pathlib.Path,required=True);q.add_argument('--jobs',type=int,default=2);q.add_argument('--resume',action='store_true');a=q.parse_args();record=next(r for r in json.loads(a.manifest.read_text()) if r['name']==a.name);archive=pathlib.Path(record['archive']).resolve();assert hashlib.sha256(archive.read_bytes()).hexdigest()==record['sha256'];a.out.mkdir(parents=True,exist_ok=a.resume)
source_root=a.out/'source'
if not a.resume:
 source_root.mkdir()
 with tarfile.open(archive) as t:t.extractall(source_root,filter='data')
source=source_root/(record['name']+'-'+record['version'])
if a.name=='grep' and 'LINUXONWEB_NO_MMU_GUARD' not in (source/'lib/stackvma.c').read_text():
 subprocess.run(['patch','-p1','-i',str((pathlib.Path(__file__).resolve().parent/'grep-no-mmu.patch'))],cwd=source,check=True,stdout=subprocess.DEVNULL)
build=a.out/'build';build.mkdir(exist_ok=a.resume)
cc='/nix/store/j8mdl69qafyijllv7s703219nb5fnrdp-wasm32-unknown-linux-musl-llvm-toolchain-wrapper-22.1.8/bin/wasm32-unknown-linux-musl-clang';binutils='/nix/store/l56920apsf6c40hylrqladab7npy8pfv-llvm-binutils-wrapper-21.1.8/bin/'
env={'CC':cc,'AR':binutils+'ar','RANLIB':binutils+'ranlib','NM':binutils+'nm','CFLAGS':'-O2 -g0 -pthread -matomics -mbulk-memory -ffunction-sections -fdata-sections','LDFLAGS':'-static -pthread -Wl,--gc-sections,--import-memory,--export-table,--shared-memory,--initial-memory=16777216,--max-memory=4294967296,-z,stack-size=1048576','ac_cv_c_stack_direction':'-1','sv_cv_stack_direction':'-1','sv_cv_stack_direction_msg':'grows down (actual guest probe)','ac_cv_func_fork':'no','ac_cv_func_vfork':'no','ac_cv_func_mmap':'no','ac_cv_func_mremap':'no','ac_cv_func_mprotect':'no','ac_cv_func_posix_madvise':'no','ac_cv_func_madvise':'no','LC_ALL':'C'}
options={'coreutils':['--enable-single-binary=symlinks','--enable-no-install-program=stdbuf','--disable-libcap','--disable-acl','--disable-xattr'],'wget':['--with-ssl=openssl','--disable-iri','--without-libpsl'],'tar':[],'gzip':[],'findutils':[],'grep':['--disable-perl-regexp'],'sed':['--disable-acl']}
if a.name=='wget':
 ssl='/nix/store/8wn6rsgn53csybzs905al73f3q7j67nx-openssl-static-wasm32-unknown-linux-musl-3.5.7';env.update({'OPENSSL_CFLAGS':'-I'+ssl+'/include','OPENSSL_LIBS':ssl+'/lib/libssl.a '+ssl+'/lib/libcrypto.a -ldl -pthread'})
here=pathlib.Path(__file__).resolve().parent;compat=a.out/'compat';compat.mkdir(exist_ok=True)
subprocess.run([cc,*env['CFLAGS'].split(),'-c',str(here/'no-fork.c'),'-o',str(compat/'no-fork.o')],check=True)
subprocess.run([binutils+'ar','rcs',str(compat/'liblinuxonweb-nofork.a'),str(compat/'no-fork.o')],check=True)
env['CPPFLAGS']='-include '+str(here/'no-fork.h');env['LIBS']=str((compat/'liblinuxonweb-nofork.a').resolve())
os.environ.update(env);(a.out/'build-provenance.json').write_text(json.dumps({'source':record,'environment':env,'configureOptions':options[a.name],'target':'wasm32-unknown-linux-musl','guestRuntimeValidated':False},indent=2)+'\n')
cmd=[str((source/'configure').resolve()),'--host=wasm32-unknown-linux-musl','--build=x86_64-pc-linux-gnu','--prefix=/usr','--disable-nls','--disable-dependency-tracking',*options[a.name]]
if not a.resume:
 saved_cppflags=os.environ.pop('CPPFLAGS',None)
 r=run(cmd,build,a.out/'configure-log',300)
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
r=run(['make','-j'+str(a.jobs),*make_scope,'GL_CFLAG_GNULIB_WARNINGS='+warning_flags,'CPPFLAGS='+env['CPPFLAGS'],'LIBS='+env['LIBS'],*targets[a.name]],build,a.out/f'build-log{index}',600)
raise SystemExit(0 if r['pass'] else 1)
