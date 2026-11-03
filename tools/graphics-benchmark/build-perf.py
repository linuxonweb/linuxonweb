#!/usr/bin/env python3
"""Link matched workload against a specified, already-reviewed guest GL object."""
import argparse,pathlib,subprocess,json,hashlib,time
p=argparse.ArgumentParser();p.add_argument('--driver-object',required=True);p.add_argument('--headers',required=True);p.add_argument('--output',required=True);a=p.parse_args()
repo=pathlib.Path(__file__).resolve().parents[2];out=pathlib.Path(a.output).resolve();out.mkdir(parents=True,exist_ok=False)
cc='/nix/store/j8mdl69qafyijllv7s703219nb5fnrdp-wasm32-unknown-linux-musl-llvm-toolchain-wrapper-22.1.8/bin/wasm32-unknown-linux-musl-clang'
source=repo/'tools/graphics-benchmark/gl-perf.c';driver=pathlib.Path(a.driver_object).resolve();started=time.time()
subprocess.run([cc,'-std=c11','-O2','-g0','-Wall','-Wextra','-Werror','-Wno-unused-result','-pthread','-matomics','-mbulk-memory','-ffunction-sections','-fdata-sections','-I'+str(pathlib.Path(a.headers).resolve()),'-c',str(source),'-o',str(out/'gl-perf.o')],check=True,timeout=30)
subprocess.run([cc,'-pthread','-matomics','-mbulk-memory','-static',str(out/'gl-perf.o'),str(driver),'-lm','-Wl,--gc-sections,--import-memory,--export-table,--shared-memory','-Wl,--initial-memory=33554432,--max-memory=4294967296,-z,stack-size=1048576','-o',str(out/'gl-perf.wasm')],check=True,timeout=30)
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
report={'seconds':time.time()-started,'sourceSha256':sha(source),'driverObjectSha256':sha(driver),'binarySha256':sha(out/'gl-perf.wasm'),'driverObject':str(driver)}
(out/'build.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
