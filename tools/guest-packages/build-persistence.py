#!/usr/bin/env python3
"""Build the native checked APK-generation helper; never enable or publish it."""
import argparse, hashlib, json, pathlib, sys
from bounded import run
p=argparse.ArgumentParser();p.add_argument('--out',type=pathlib.Path,required=True);p.add_argument('--kind',choices=['helper','primitives'],default='helper');a=p.parse_args()
a.out.mkdir(parents=True,exist_ok=False)
here=pathlib.Path(__file__).resolve().parent
cc=pathlib.Path('/nix/store/j8mdl69qafyijllv7s703219nb5fnrdp-wasm32-unknown-linux-musl-llvm-toolchain-wrapper-22.1.8/bin/wasm32-unknown-linux-musl-clang')
ssl=pathlib.Path('/nix/store/8wn6rsgn53csybzs905al73f3q7j67nx-openssl-static-wasm32-unknown-linux-musl-3.5.7')
zlib=pathlib.Path('/nix/store/sjhvjggjz2czv2nhyncnp6xs4fapjidh-zlib-static-wasm32-unknown-linux-musl-1.3.1')
name='apk-persist' if a.kind=='helper' else 'persistence-primitives'
source=here/(name+'.c');target=a.out.resolve()/name
inputs=[source,ssl/'lib/libcrypto.a',zlib/'lib/libz.a']
def sha(path):
 with path.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
command=[str(cc),'-O2','-g0','-std=c11','-Wall','-Wextra','-Werror','-Wno-deprecated-declarations','-fstack-usage','-pthread','-matomics','-mbulk-memory','-ffunction-sections','-fdata-sections','-I'+str(ssl/'include'),'-I'+str(zlib/'include'),str(source),str(ssl/'lib/libcrypto.a'),str(zlib/'lib/libz.a'),'-static','-pthread','-Wl,--gc-sections,--import-memory,--export-table,--shared-memory,--initial-memory=16777216,--max-memory=4294967296,-z,stack-size=2097152','-o',str(target)]
receipt={'candidateOnly':True,'productionAccepted':False,'target':'wasm32-unknown-linux-musl','inputs':{str(f):sha(f) for f in inputs},'compiler':str(cc),'command':command}
result=run(command,pathlib.Path.cwd(),a.out/'compile',90);receipt['build']=result
if result['pass']:
 if target.read_bytes()[:8]!=b'\0asm\x01\0\0\0':raise ValueError('compiler did not produce native Wasm module')
 receipt.update(nativeSha256=sha(target),nativeBytes=target.stat().st_size)
(a.out/'build.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps({k:receipt[k] for k in ['candidateOnly','productionAccepted','target']},indent=2));print(json.dumps(result,indent=2));sys.exit(0 if result['pass'] else 1)
