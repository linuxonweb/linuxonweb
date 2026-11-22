#!/usr/bin/env python3
"""Reject any reserved capture marker remaining in selected native link inputs."""
import pathlib,subprocess,sys,json
L=pathlib.Path('/mnt/p6/project/linux/.tmp-firefox-build/nix-local-store/nix/store/xwpycnlb71djqs4gyxhbkxhzb3pw1ib4-llvm-toolchain-22.1.8')
for arg in sys.argv[1:]:
 p=pathlib.Path(arg)
 r=subprocess.run([str(L/'bin/llvm-nm'),'--format=posix',str(p)],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
 if r.returncode:
  print(r.stderr,file=sys.stderr);raise SystemExit(3)
 if '__wasm_gnu_caller_sp_v1' in r.stdout:
  print(json.dumps({'rejected':str(p),'reason':'compiler-owned caller SP marker remains as an undefined reference or external definition'}));raise SystemExit(3)
print(json.dumps({'pass':True,'nativeInputs':len(sys.argv)-1}))
