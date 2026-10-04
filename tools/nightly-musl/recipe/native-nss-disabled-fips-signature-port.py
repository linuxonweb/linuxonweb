#!/usr/bin/env python3
"""Give the disabled-FIPS native Wasm fallback its declared PRBool argument."""
import hashlib, json, shutil, subprocess
from pathlib import Path

BUILD = Path('/mnt/p6/build/firefox-nightly-musl-recovery-20261002')
TASK = Path('/mnt/p6/project/build/nightly-baseline-guest-20261003')
REPO = Path(__file__).resolve().parents[3]
SOURCE = BUILD/'source/firefox-159.0a1/security/nss/lib/softoken/fipstest.c'

def pin(path):
    with path.open('rb') as f: digest=hashlib.file_digest(f,'sha256').hexdigest()
    return dict(path=str(path),bytes=path.stat().st_size,sha256=digest)

def main():
    proposal=json.loads((TASK/'native-nss-disabled-fips-signature-proposal.json').read_text())
    patch=Path(proposal['patch'])
    assert pin(SOURCE)['sha256']==proposal['originalSHA256']
    assert pin(patch)['sha256']==proposal['patchSHA256']
    backup=TASK/'native-nss-signature-preflight/original-fipstest.c'
    assert not backup.exists();shutil.copyfile(SOURCE,backup)
    result=subprocess.run(['patch','--batch','--fuzz=0','-p1','-i',str(patch)],
                          cwd=BUILD/'source/firefox-159.0a1',capture_output=True,text=True,timeout=10)
    assert result.returncode==0,result.stderr
    tracked=REPO/'tools/nightly-musl/patches/nightly-native-nss-disabled-fips-signature.patch'
    assert not tracked.exists();shutil.copyfile(patch,tracked)
    report=dict(before=pin(backup),after=pin(SOURCE),patch=pin(tracked),
                policy='NSS_FIPS_DISABLED fallback remains CKR_DEVICE_ERROR',
                enabledBranchUnchanged=True,otherPlatformsUnchanged=True,
                tlsAcceptance=False,browserAcceptance=False)
    (TASK/'native-nss-signature-port.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report))

if __name__=='__main__':main()
