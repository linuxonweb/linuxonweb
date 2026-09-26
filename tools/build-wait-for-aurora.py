#!/usr/bin/env python3
"""Build an isolated wasm guest WM readiness helper; never package or deploy."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shlex
import subprocess

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output',type=Path,required=True)
parser.add_argument('--cc',default='/nix/store/j8mdl69qafyijllv7s703219nb5fnrdp-wasm32-unknown-linux-musl-llvm-toolchain-wrapper-22.1.8/bin/wasm32-unknown-linux-musl-clang')
parser.add_argument('--x11',type=Path,default=Path('/nix/store/gqaysz4gcpwh3hjpj55k8j9mf7lya7xs-libX11-static-wasm32-unknown-linux-musl-1.8.13'))
parser.add_argument('--xcb',type=Path,default=Path('/nix/store/wlbxw5w935lipm9imsz9jvsyk0mm322x-libxcb-static-wasm32-unknown-linux-musl-1.17.0'))
parser.add_argument('--xau',type=Path,default=Path('/nix/store/r79l4jh7kmlcz6vmfiv02gw1p1iqb4m5-libXau-static-wasm32-unknown-linux-musl-1.0.12'))
parser.add_argument('--xproto',type=Path,default=Path('/nix/store/7fl11iw0s4srx2300pnb28wwpibky6wh-xorgproto-static-wasm32-unknown-linux-musl-2024.1'))
args=parser.parse_args()
out=args.output.resolve();out.mkdir(parents=True,exist_ok=True)
artifact=out/'wait-for-aurora.wasm'
if artifact.exists():parser.error('use a fresh output directory')
source=Path(__file__).resolve().parent/'guest-rootfs/wait-for-aurora.c'
command=[args.cc,'-std=c11','-O2','-Wall','-Wextra','-Werror','-pthread','-matomics','-mbulk-memory',
         '-ffunction-sections','-fdata-sections','-static',
         '-I'+str(args.x11/'include'),'-I'+str(args.xproto/'include'),
         str(source),str(args.x11/'lib/libX11.a'),str(args.xcb/'lib/libxcb.a'),str(args.xau/'lib/libXau.a'),
         '-Wl,--gc-sections,--import-memory,--export-table,--shared-memory',
         '-Wl,--initial-memory=2097152,--max-memory=4294967296,-z,stack-size=262144',
         '-o',str(artifact)]
env=os.environ.copy();env['TMPDIR']=str(out)
def run(command,name):
    (out/(name+'.command.txt')).write_text(shlex.join(command)+'\n')
    with (out/(name+'.log')).open('w') as log:
        subprocess.run(command,stdout=log,stderr=subprocess.STDOUT,env=env,check=True,timeout=120)
run(command,'compile')
run(['wasm-validate','--enable-all',str(artifact)],'validate')
run(['wasm-objdump','-x',str(artifact)],'abi')
with artifact.open('rb') as stream:sha=hashlib.file_digest(stream,'sha256').hexdigest()
report={'artifact':str(artifact),'bytes':artifact.stat().st_size,'sha256':sha,
        'status':'built and Wasm-validated; guest deadline/handshake tests required',
        'guestTests':['--self-test-timeout must exit after ~1 second','DISPLAY=:0 ready property handshake','DISPLAY=:99 absent server must wait ~10 seconds']}
(out/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
