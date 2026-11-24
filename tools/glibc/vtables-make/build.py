#!/usr/bin/env python3
"""Build the actual unchanged GNU libio vtables target in the fresh tree."""
import hashlib,json,os,pathlib,subprocess
T=pathlib.Path(os.environ['GLIBC_TASK']);S=T/'source/glibc-2.44';O=T/'objects/fullmake';R=pathlib.Path(__file__).resolve().parent
p=S/'libio/vtables.c';pristine=pathlib.Path(os.environ['GNU_RELEASE_ARCHIVE']).parent.parent/'source/glibc-2.44/libio/vtables.c';assert p.read_bytes()==pristine.read_bytes()
out=O/'libio/vtables.o';assert not out.exists();log=T/'logs/vtables-make.log';assert not log.exists()
argv=['make','-C',str(S/'libio'),'objdir='+str(O),'-j2','CC=python3 '+str(R/'compiler.py')+' -nostdlib -nostdinc -isystem '+os.environ['GLIBC_TOOLCHAIN']+'/lib/clang/22/include',str(out)]
row={'argv':argv,'cwd':str(pathlib.Path.cwd()),'source':str(p),'sourceSha256':hashlib.sha256(p.read_bytes()).hexdigest()};proof=T/'logs/vtables-make.json';assert not proof.exists();proof.write_text(json.dumps(row,indent=2)+'\n')
with log.open('wb') as f:run=subprocess.run(argv,stdout=f,stderr=subprocess.STDOUT)
row['exit']=run.returncode
if run.returncode==0:row['output']={'path':str(out),'bytes':out.stat().st_size,'sha256':hashlib.sha256(out.read_bytes()).hexdigest()}
proof.write_text(json.dumps(row,indent=2)+'\n');raise SystemExit(run.returncode)
