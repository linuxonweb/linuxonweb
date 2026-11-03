#!/usr/bin/env python3
"""Build upstream apk-tools 2.14.12 as genuine static wasm32-linux-musl."""
import argparse,hashlib,json,os,pathlib,tarfile
from bounded import run
ARCHIVE_SHA256='62dcb1951108ba24c7478bbca402ea9a34b3bb09baa161b220d0a18e15645e35'
q=argparse.ArgumentParser();q.add_argument('--archive',type=pathlib.Path,required=True);q.add_argument('--out',type=pathlib.Path,required=True);q.add_argument('--cc',required=True);q.add_argument('--ar',required=True);q.add_argument('--openssl',type=pathlib.Path,required=True);q.add_argument('--zlib',type=pathlib.Path,required=True);q.add_argument('--jobs',type=int,default=2);a=q.parse_args()
if hashlib.sha256(a.archive.read_bytes()).hexdigest()!=ARCHIVE_SHA256:raise SystemExit('upstream archive hash mismatch')
a.out.mkdir(parents=True,exist_ok=False)
with tarfile.open(a.archive) as t:t.extractall(a.out,filter='data')
src=a.out/'apk-tools-v2.14.12';p=src/'src/apk_defines.h';s=p.read_text();anchor='#if defined(__x86_64__)\n#define APK_DEFAULT_ARCH'
if s.count(anchor)!=1:raise SystemExit('architecture patch anchor mismatch')
p.write_text(s.replace(anchor,'#if defined(__wasm32__)\n#define APK_DEFAULT_ARCH "wasm32"\n#elif defined(__x86_64__)\n#define APK_DEFAULT_ARCH'))
p=src/'src/database.c';s=p.read_text();s=s.replace('#include "apk_database.h"','#include "apk_database.h"\n#if defined(__wasm32__)\n#include <spawn.h>\n#endif')
start=s.index('\tpid = fork();',s.index('int apk_db_run_script('));end=s.index('\twhile (waitpid(pid, &status, 0)',start);original=s[start:end]
wasm=r"""#if defined(__wasm32__)
    posix_spawn_file_actions_t actions;
    int count = 0, rc;
    char **helper_argv;
    while (argv[count]) count++;
    helper_argv = calloc((size_t)count + 4, sizeof(char *));
    if (!helper_argv) return -2;
    helper_argv[0] = "/usr/libexec/apk-script";
    helper_argv[1] = db->no_chroot ? "--no-chroot" : "--chroot";
    helper_argv[2] = fn;
    memcpy(helper_argv + 3, argv, ((size_t)count + 1) * sizeof(char *));
    rc = posix_spawn_file_actions_init(&actions);
    if (rc == 0) {
        rc = posix_spawn_file_actions_adddup2(&actions, db->root_fd, 3);
        if (rc == 0) rc = posix_spawn(&pid, helper_argv[0], &actions, NULL, helper_argv, environment);
        posix_spawn_file_actions_destroy(&actions);
    }
    free(helper_argv);
    if (rc != 0) {
        apk_error("%s: posix_spawn: %s", basename(fn), strerror(rc));
        return -2;
    }
#else
"""
s=s[:start]+wasm+original+'#endif\n'+s[end:];p.write_text(s)
p=src/'src/io.c';s=p.read_text();start=s.index('struct apk_mmap_istream {');end=s.index('struct apk_fd_istream {',start)
s=s[:start]+'#if !defined(__wasm32__)\n'+s[start:end]+'#else\nstatic inline struct apk_istream *apk_mmap_istream_from_fd(int fd) { (void)fd; return ERR_PTR(-ENOSYS); }\n#endif\n\n'+s[end:];p.write_text(s)
p=src/'src/Makefile';s=p.read_text();s=s.replace('-Wl,--as-needed','').replace('-Wl,--no-as-needed','');s=s.replace('shlibs-y\t\t+= libapk.so.$(libapk_soname)','shlibs-y\t\t+=');s=s.replace('progs-y\t\t\t+= apk\n','progs-y\t\t\t+=\n');p.write_text(s)
ssl=a.openssl.resolve();zlib=a.zlib.resolve()
argv=['make',f'-j{a.jobs}','STATIC=y','LUA=no','LUAAPK=no',f'CC={a.cc}',f'AR={a.ar}','CFLAGS=-O2 -g0 -pthread -matomics -mbulk-memory -ffunction-sections -fdata-sections','LDFLAGS=-pthread -matomics -mbulk-memory -Wl,--gc-sections,--import-memory,--export-table,--shared-memory,--initial-memory=16777216,--max-memory=4294967296,-z,stack-size=1048576',f'OPENSSL_CFLAGS=-I{ssl}/include',f'OPENSSL_LIBS={ssl}/lib/libssl.a {ssl}/lib/libcrypto.a -ldl -pthread',f'ZLIB_CFLAGS=-I{zlib}/include',f'ZLIB_LIBS={zlib}/lib/libz.a','compile']
r=run(argv,src,a.out/'build-log',240)
if r['pass']:
 helper=pathlib.Path(__file__).resolve().with_name('apk-script.c')
 helper_cmd=[a.cc,'-O2','-g0','-pthread','-matomics','-mbulk-memory','-static','-Wl,--gc-sections,--import-memory,--export-table,--shared-memory,--initial-memory=16777216,--max-memory=4294967296,-z,stack-size=1048576',str(helper),'-o',str((a.out/'apk-script').resolve())]
 helper_result=run(helper_cmd,pathlib.Path.cwd(),a.out/'helper-log',60)
 if not helper_result['pass']:raise SystemExit('script helper build failed')
 result=src/'src/apk.static';r.update({'binary':str(result.resolve()),'binaryBytes':result.stat().st_size,'binarySha256':hashlib.sha256(result.read_bytes()).hexdigest(),'runtimeValidated':False,'upstreamArchiveSha256':ARCHIVE_SHA256})
 (a.out/'build.json').write_text(json.dumps(r,indent=2)+'\n')
 print(json.dumps({k:r[k] for k in ['binary','binaryBytes','binarySha256','runtimeValidated']}))
raise SystemExit(0 if r['pass'] else 1)
