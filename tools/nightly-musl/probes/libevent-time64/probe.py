from pathlib import Path
import subprocess,json,hashlib,os
T=Path('/mnt/p6/build/firefox-nightly-musl-recovery-20261002');S=T/'source/firefox-159.0a1';L=S/'ipc/chromium/src/third_party/libevent';P=T/'libevent-time64-preflight'
env=dict(item.split('=',1) for item in subprocess.check_output(['bash','-c','source "$1"; env -0','probe',str(T/'recipe/environment.sh')]).decode().split('\0') if '=' in item)
for part in ['linux/event2','wasm/event2','missing-time64']: (P/part).mkdir(parents=True,exist_ok=True)
original=(L/'linux/event2/event-config.h').read_text();(P/'linux/event2/event-config.h').write_text(original)
adapter='''/* Native Linux/Wasm musl has ILP32 pointers and 64-bit time/file offsets. */
#ifndef MOZ_NATIVE_WASM_LIBEVENT_CONFIG_H
#define MOZ_NATIVE_WASM_LIBEVENT_CONFIG_H
#if !defined(__wasm__) || !defined(__linux__) || defined(__wasi__)
#  error "Native musl libevent adapter requires Linux/Wasm"
#endif
/* Load the actual libc time64 marker before the upstream config. */
#include <time.h>
#include "../../linux/event2/event-config.h"
#if !defined(__USE_TIME_BITS64) || __USE_TIME_BITS64 != 1
#  error "Native musl libevent adapter requires time64"
#endif
#undef EVENT__SIZEOF_TIME_T
#define EVENT__SIZEOF_TIME_T 8
#undef EVENT__SIZEOF_OFF_T
#define EVENT__SIZEOF_OFF_T 8
#endif
''';(P/'wasm/event2/event-config.h').write_text(adapter)
(P/'missing-time64/time.h').write_text('#include_next <time.h>\n#undef __USE_TIME_BITS64\n')
body='''#include <event2/util.h>
#include <pthread.h>
#include <stddef.h>
#include <sys/time.h>
#define CHECK(M,T) static_assert(EVENT__SIZEOF_##M == sizeof(T), "bad config " #M)
#ifndef __cplusplus
#undef CHECK
#define static_assert _Static_assert
#define alignof _Alignof
#define CHECK(M,T) _Static_assert(EVENT__SIZEOF_##M == sizeof(T), "bad config " #M)
#endif
CHECK(INT,int); CHECK(LONG,long); CHECK(LONG_LONG,long long);
CHECK(OFF_T,off_t); CHECK(PTHREAD_T,pthread_t); CHECK(SHORT,short);
CHECK(SIZE_T,size_t); CHECK(TIME_T,time_t); CHECK(VOID_P,void*);
static_assert(sizeof(time_t)==8,"native time64");
static_assert(sizeof(off_t)==8,"native off64");
static_assert(sizeof(ev_off_t)==8,"libevent off64");
static_assert(sizeof(void*)==4,"native pointer32");
static_assert(sizeof(long)==4,"native long32");
static_assert(sizeof(pthread_t)==4,"native pthread32");
static_assert(sizeof(struct timeval)==16,"timeval size");
static_assert(offsetof(struct timeval,tv_sec)==0,"timeval seconds");
static_assert(offsetof(struct timeval,tv_usec)==8,"timeval microseconds");
static_assert(sizeof(struct timespec)==16,"timespec size");
static_assert(offsetof(struct timespec,tv_sec)==0,"timespec seconds");
static_assert(offsetof(struct timespec,tv_nsec)==8,"timespec nanoseconds");
int libevent_config_abi_probe(void){return EVENT__SIZEOF_TIME_T+EVENT__SIZEOF_OFF_T;}
'''
results={};commands={}
for name,lang,order,scope,extra in [('baseline','c++','config','linux',[]),('c-config-first','c','config','wasm',[]),('c-time-first','c','time','wasm',[]),('cxx-config-first','c++','config','wasm',[]),('cxx-time-first','c++','time','wasm',[]),('reject-wasi','c','config','wasm',['-D__wasi__=1']),('reject-missing-time64','c','config','wasm',['-I'+str(P/'missing-time64')])]:
 src=P/(name+('.cpp' if lang=='c++' else '.c'));src.write_text(('#include <time.h>\n' if order=='time' else '')+'#include <event2/event-config.h>\n'+body);out=P/(name+'.o');cc='/nix/store/j8mdl69qafyijllv7s703219nb5fnrdp-wasm32-unknown-linux-musl-llvm-toolchain-wrapper-22.1.8/bin/wasm32-unknown-linux-musl-clang'+('++' if lang=='c++' else '')
 cmd=[cc,*extra,'-I'+str(P/scope),'-I'+str(L/'include'),'-include',str(T/'obj-nightly/mozilla-config.h'),'-c',str(src),'-o',str(out)]
 if lang=='c++':cmd+=['-std=c++20','-Xclang','-fc++-abi=webassembly']
 else:cmd+=['-std=c11']
 with (P/(name+'.log')).open('w') as log:r=subprocess.run(cmd,env=env,stdout=log,stderr=subprocess.STDOUT)
 results[name]={'exit':r.returncode,'expected_success':name not in ['baseline','reject-wasi','reject-missing-time64'],'object_magic':out.read_bytes()[:8].hex() if out.exists() else None};commands[name]=cmd
assert all((r['exit']==0)==r['expected_success'] for r in results.values()),results
assert all(r['object_magic']=='0061736d01000000' for r in results.values() if r['expected_success'])
def pin(p):b=p.read_bytes();return {'path':str(p),'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()}
report={'claim':'Native musl paired C/C++ libevent config ABI checks; fault-injected predicates are diagnostics, not guest or WASI acceptance','assertions_per_fixed_arm':21,'results':results,'commands':commands,'pins':[pin(p) for p in [L/'linux/event2/event-config.h',P/'linux/event2/event-config.h',P/'wasm/event2/event-config.h',T/'obj-nightly/config.status.json',T/'status/build-run21-group-cleanup.json']]+[pin(p) for p in P.iterdir() if p.is_file()]}
(P/'result.json').write_text(json.dumps(report,indent=2));print(json.dumps(results,indent=2))
