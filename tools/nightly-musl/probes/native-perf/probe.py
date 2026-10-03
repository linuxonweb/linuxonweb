from pathlib import Path
import hashlib,json,subprocess,os
T=Path('/mnt/p6/build/firefox-nightly-musl-recovery-20261002');S=T/'source/firefox-159.0a1';P=T/'native-perf-preflight';P.mkdir(exist_ok=False)
source=S/'js/src/builtin/Profilers.cpp';s=source.read_text();body=s[s.index('#  if !defined(__wasm__) || defined(__wasi__)\nstatic bool perfInitialized'):s.index('\nbool js_StopPerf()')]
prefix='''#include <cstdlib>
#include <cstring>
#include <cstdio>
#include <string>
#include <sys/types.h>
static std::string lastError;
static void UnsafeError(const char* message) { lastError=message; }
'''
main='''
int main(int argc,char**argv) {
  const char* mode=argv[1]; const char* outfile=argv[2];
  if(!strcmp(mode,"unset")) unsetenv("MOZ_PROFILE_WITH_PERF");
  else setenv("MOZ_PROFILE_WITH_PERF", !strcmp(mode,"empty") ? "" : "1",1);
  bool expected=strcmp(mode,"requested")!=0;
  const char* name=argc>3 ? (!strcmp(argv[3],"null") ? nullptr : "") : outfile;
  if(js_StartPerf(name)!=expected || perfPid!=0) return 1;
  if(expected ? !lastError.empty() : lastError.find("unavailable on native Linux/Wasm")==std::string::npos) return 2;
  return 0;
}
'''
(P/'source-derived.cpp').write_text(prefix+body+main)
cc='/nix/store/vdaz6sk455r8sbpi7wzaf9vlz5i9yyvx-gcc-wrapper-15.2.0/bin/c++';argv=[cc,'-std=c++17','-D__wasm__',str(P/'source-derived.cpp'),'-o',str(P/'probe')]
r=subprocess.run(argv,capture_output=True,text=True);(P/'compile.log').write_text(r.stdout+r.stderr);assert r.returncode==0
sentinel=b'preserved external profile data\x00\xff';profile=P/'mozperf.data';profile.write_bytes(sentinel)
results=[]
for mode in ('unset','empty','requested'):
 for name in ('custom','empty','null'):
  args=[str(P/'probe'),mode,str(profile)]+([] if name=='custom' else [name]);r=subprocess.run(args,cwd=P,capture_output=True,text=True)
  results.append({'environment':mode,'profile_name':name,'exit':r.returncode,'profile_bytes_preserved':profile.read_bytes()==sentinel})
assert all(r['exit']==0 and r['profile_bytes_preserved'] for r in results)
proof={'claim':'Host source-derived native-branch behavior diagnostic only; actual native component compilation separately required','source':str(source),'source_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'extracted_body_sha256':hashlib.sha256(body.encode()).hexdigest(),'compile_argv':argv,'results':results}
(P/'result.json').write_text(json.dumps(proof,indent=2));print(json.dumps(proof,indent=2))
