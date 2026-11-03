#!/usr/bin/env python3
"""Rebuild the existing guest admin helper without changing its privilege policy."""
import argparse,hashlib,json,pathlib
from bounded import run
q=argparse.ArgumentParser();q.add_argument('--cc',required=True);q.add_argument('--out',type=pathlib.Path,required=True);a=q.parse_args();a.out.mkdir(parents=True,exist_ok=False);source=pathlib.Path(__file__).resolve().parents[1]/'guest-rootfs/sudo.c';binary=a.out/'sudo';cmd=[a.cc,'-O2','-g0','-pthread','-matomics','-mbulk-memory','-static','-Wl,--gc-sections,--import-memory,--export-table,--shared-memory,--initial-memory=16777216,--max-memory=4294967296,-z,stack-size=1048576',str(source),'-o',str(binary.resolve())];r=run(cmd,pathlib.Path.cwd(),a.out/'build-log',60)
if not r['pass']:raise SystemExit(1)
(a.out/'provenance.json').write_text(json.dumps({'source':str(source),'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'binarySha256':hashlib.sha256(binary.read_bytes()).hexdigest(),'sourceUnchanged':True,'mode':'04755','policy':'existing project UID0/1000 restriction','runtimeAccepted':False},indent=2)+'\n')
