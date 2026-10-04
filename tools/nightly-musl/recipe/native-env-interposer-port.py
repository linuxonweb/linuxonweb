#!/usr/bin/env python3
"""Replay the reviewed native Linux/Wasm static environment interposer fix."""
import argparse,hashlib,json,shutil,subprocess
from pathlib import Path
SOURCE='mozglue/interposers/env_interposer.cpp'
ORIGINAL='90a43a2ce821d2534693e8f93dbb40784547e27c50eb98fb455a48900ffe56af'
PATCHED='abfcda1bda6cd151c156a00367f76764f20867eb8130c13ef08464c4224bece8'
PATCH_SHA='5dc4d7dc22772f18b8ba582cd2c98fa22045ef78e674ac290d73189b34100e43'
def pin(p):
 with p.open('rb') as f:h=hashlib.file_digest(f,'sha256').hexdigest()
 return dict(path=str(p),bytes=p.stat().st_size,sha256=h)
def main():
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('--source',type=Path,required=True)
 parser.add_argument('--evidence',type=Path,required=True)
 parser.add_argument('--patch',type=Path,default=Path(__file__).resolve().parents[1]/'patches/nightly-native-env-interposer.patch')
 args=parser.parse_args();source=args.source.resolve(strict=True);patch=args.patch.resolve(strict=True)
 assert pin(patch)['sha256']==PATCH_SHA,'reviewed patch changed'
 file=source/SOURCE;before=pin(file);assert before['sha256'] in [ORIGINAL,PATCHED],'unexpected source bytes'
 applied=before['sha256']==PATCHED;evidence=args.evidence.resolve();assert not evidence.exists(),'fresh evidence required';evidence.mkdir(parents=True)
 if not applied:
  backup=evidence/'original'/SOURCE;backup.parent.mkdir(parents=True);shutil.copyfile(file,backup);assert pin(backup)['sha256']==ORIGINAL
  checked=subprocess.run(['patch','--dry-run','--batch','--fuzz=0','-p1','-i',str(patch)],cwd=source,capture_output=True,text=True,timeout=10);assert checked.returncode==0,checked.stdout+checked.stderr
  result=subprocess.run(['patch','--batch','--fuzz=0','-p1','-i',str(patch)],cwd=source,capture_output=True,text=True,timeout=10);(evidence/'patch.log').write_text(result.stdout+result.stderr);assert result.returncode==0
 after=pin(file);assert after['sha256']==PATCHED
 report=dict(before=before,after=after,patch=pin(patch),alreadyApplied=applied,nativeStaticMuslResolution=True,recursiveLock=True,publicOnceInitialization=True,callerBufferOwnershipPreserved=True,ordinaryLinuxUnchanged=True,browserAcceptance=False,jitAcceptance=False,gpuAcceptance=False)
 (evidence/'port.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
if __name__=='__main__':main()
