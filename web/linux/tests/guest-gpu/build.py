#!/usr/bin/env python3
"""Build the isolated C/X11 GPU transport test. Does not package or deploy."""
import argparse, hashlib, json, os, shlex, subprocess
from pathlib import Path
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--output',type=Path,required=True)
a=p.parse_args(); out=a.output.resolve(); out.mkdir(parents=True,exist_ok=True)
artifact=out/'guest-gpu-triangle.wasm'
if artifact.exists(): p.error('use a fresh output directory')
here=Path(__file__).resolve().parent
cc='/nix/store/j8mdl69qafyijllv7s703219nb5fnrdp-wasm32-unknown-linux-musl-llvm-toolchain-wrapper-22.1.8/bin/wasm32-unknown-linux-musl-clang'
x11=Path('/nix/store/gqaysz4gcpwh3hjpj55k8j9mf7lya7xs-libX11-static-wasm32-unknown-linux-musl-1.8.13')
xcb=Path('/nix/store/wlbxw5w935lipm9imsz9jvsyk0mm322x-libxcb-static-wasm32-unknown-linux-musl-1.17.0')
xau=Path('/nix/store/r79l4jh7kmlcz6vmfiv02gw1p1iqb4m5-libXau-static-wasm32-unknown-linux-musl-1.0.12')
xproto=Path('/nix/store/7fl11iw0s4srx2300pnb28wwpibky6wh-xorgproto-static-wasm32-unknown-linux-musl-2024.1')
command=[cc,'-std=c11','-O2','-Wall','-Wextra','-Werror','-pthread','-matomics','-mbulk-memory','-ffunction-sections','-fdata-sections','-static',
 '-I'+str(x11/'include'),'-I'+str(xproto/'include'),str(here/'triangle.c'),str(here/'guest-gpu.c'),
 str(x11/'lib/libX11.a'),str(xcb/'lib/libxcb.a'),str(xau/'lib/libXau.a'),
 '-Wl,--gc-sections,--import-memory,--export-table,--shared-memory','-Wl,--initial-memory=2097152,--max-memory=4294967296,-z,stack-size=262144','-o',str(artifact)]
env=os.environ.copy(); env['TMPDIR']=str(out)
for name,cmd in [('compile',command),('validate',['wasm-validate','--enable-all',str(artifact)]),('abi',['wasm-objdump','-x',str(artifact)])]:
 (out/(name+'.command.txt')).write_text(shlex.join(cmd)+'\n')
 with (out/(name+'.log')).open('w') as log: subprocess.run(cmd,stdout=log,stderr=subprocess.STDOUT,env=env,check=True,timeout=120)
report={'pass':True,'artifact':str(artifact),'bytes':artifact.stat().st_size,'sha256':hashlib.sha256(artifact.read_bytes()).hexdigest(),'status':'built and Wasm-validated; live guest test still required'}
(out/'build.json').write_text(json.dumps(report,indent=2)+'\n'); print(json.dumps(report))
