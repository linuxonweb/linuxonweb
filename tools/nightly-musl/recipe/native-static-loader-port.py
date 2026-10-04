#!/usr/bin/env python3
"""Replay the reviewed native Linux/Wasm NSPR loader and fatal trap fix."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

FILES = {
    'nsprpub/pr/src/linking/prlink.c': (
        '7782dc5b77502b553b5951bd9e9846353293caefbbe1ac0222b99e53bf25e56e',
        '1c49f69b582aff62a6b3f2c69b37c8ca29fecfce162716df7d22b0d3801f5677'),
    'memory/mozalloc/mozalloc_abort.cpp': (
        '2a8710438dbde0a678951758a0350302901922f458ee9e98a541ccaa4c16e95e',
        '9bdc66779ab0186742703be06543bfede91e5bc41d14e08864ea412e1c28f620'),
}
PATCH_SHA = '9b7d2f3cf4093e28b5a9e2912ee273c4aeca8e8162003690c6e0c148ef15c6eb'

def pin(path):
    with path.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    return dict(path=str(path), bytes=path.stat().st_size, sha256=digest)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--evidence', type=Path, required=True)
    args = parser.parse_args()
    source = args.source.resolve(strict=True)
    patch = Path(__file__).resolve().parents[1]/'patches/nightly-native-static-loader.patch'
    assert pin(patch)['sha256'] == PATCH_SHA, 'reviewed patch changed'
    before = {name: pin(source/name) for name in FILES}
    states = [before[name]['sha256'] for name in FILES]
    original = states == [pair[0] for pair in FILES.values()]
    applied = states == [pair[1] for pair in FILES.values()]
    assert original or applied, 'unexpected or partially patched source bytes'
    evidence = args.evidence.resolve()
    assert not evidence.exists(), 'fresh replay evidence directory required'
    evidence.mkdir(parents=True)
    if original:
        for name in FILES:
            backup = evidence/'original'/name
            backup.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source/name, backup)
            assert pin(backup)['sha256'] == before[name]['sha256']
        checked = subprocess.run(['patch', '--dry-run', '--batch', '--fuzz=0', '-p1', '-i', str(patch)],
                                 cwd=source, capture_output=True, text=True, timeout=10)
        assert checked.returncode == 0, checked.stdout + checked.stderr
        result = subprocess.run(['patch', '--batch', '--fuzz=0', '-p1', '-i', str(patch)],
                                cwd=source, capture_output=True, text=True, timeout=10)
        (evidence/'patch.log').write_text(result.stdout + result.stderr)
        assert result.returncode == 0, result.stdout + result.stderr
    after = {name: pin(source/name) for name in FILES}
    assert all(after[name]['sha256'] == FILES[name][1] for name in FILES)
    report = dict(before=before, after=after, patch=pin(patch), alreadyApplied=applied,
                  nativeStaticLoader=True, dynamicFailurePreserved=True,
                  nativeAbortUsesRealTrap=True, browserAcceptance=False, gpuAcceptance=False)
    (evidence/'port.json').write_text(json.dumps(report, indent=2)+'\n')
    print(json.dumps(report))

if __name__ == '__main__':
    main()
