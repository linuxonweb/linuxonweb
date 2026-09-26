#!/usr/bin/env python3
"""Isolated accepted-rootfs candidate: honor Firefox's saved startup preferences."""
import argparse
import copy
import gzip
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import sys
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('ready_package', Path(__file__).with_name('package-aurora-ready.py'))
base = importlib.util.module_from_spec(spec); spec.loader.exec_module(base)
TASK = Path('/mnt/p6/build/firefox-homepage-20260926')
SOURCE_SHA = 'd929b7576238a733d62d41a7bb7d4d02e4dcaf58db20ee56130994e2971a3550'
MANIFEST_SHA = '10242a22c9ee3645e3d3d9769f21073e510d355589616d3fca38d082f85de730'
OLD = b'exec /bin/firefox --no-remote --new-instance -profile /home/admin/.mozilla/firefox/http1-profile https://www.bing.com" "$account"'
NEW = OLD.replace(b' https://www.bing.com', b'')

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args(); out = args.output.resolve()
    if not out.is_relative_to(TASK) or out == TASK or out.exists() or args.output.is_symlink() or not out.parent.is_dir():
        parser.error('fresh output under existing task root required')
    filesystems = {str(p.resolve()): base.disk_filesystem(p) for p in (args.source, args.manifest, out.parent)}
    scratch = {}
    for name in ('TMPDIR', 'TMP', 'TEMP'):
        p = Path(os.environ.get(name, '/tmp')).resolve()
        if not p.is_relative_to(TASK) or not p.is_dir(): parser.error(name+' must be an existing disk-backed task directory')
        filesystems[str(p)] = base.disk_filesystem(p); scratch[name] = str(p)
    if shutil.disk_usage(out.parent).free < 2*1024**3: parser.error('2 GiB free disk required')
    source = args.source.read_bytes(); manifest_bytes = args.manifest.read_bytes()
    if base.digest(source) != SOURCE_SHA or base.digest(manifest_bytes) != MANIFEST_SHA: parser.error('accepted input hash mismatch')
    manifest = json.loads(manifest_bytes)
    for key in ('kernel', 'plain'):
        a = manifest['assets'][key]; p = args.manifest.parent/a['url']; filesystems[str(p.resolve())] = base.disk_filesystem(p)
        if p.stat().st_size != a['bytes'] or base.file_digest(p) != a['sha256']: parser.error('accepted '+key+' mismatch')
    raw = gzip.decompress(source); original = list(base.records(raw)); old = {r[0]: r for r in original}
    if len(old) != len(original): raise ValueError('duplicate archive paths')
    before = old['init'][3]
    if before.count(OLD) != 1: raise ValueError('unique accepted launch command required')
    after = before.replace(OLD, NEW)
    if after.replace(NEW, OLD) != before: raise ValueError('unintended init substitution')
    tail = raw[sum(len(r[4]) for r in original):]
    candidate = b''.join(base.replace_body(r, after) if r[0]=='init' else r[4] for r in original)+tail
    changed = list(base.records(candidate)); new = {r[0]: r for r in changed}
    if [r[0] for r in original] != [r[0] for r in changed]: raise ValueError('archive paths/order changed')
    if [k for k in old if old[k][4] != new[k][4]] != ['init']: raise ValueError('unexpected record change')
    if old['init'][1][:54]+old['init'][1][62:] != new['init'][1][:54]+new['init'][1][62:]: raise ValueError('init metadata change')
    if candidate[sum(len(r[4]) for r in changed):] != tail: raise ValueError('archive tail changed')
    compressed = io.BytesIO()
    with gzip.GzipFile(filename='',fileobj=compressed,mode='wb',compresslevel=9,mtime=0) as stream: stream.write(candidate)
    encoded = compressed.getvalue(); new_manifest = copy.deepcopy(manifest)
    new_manifest['assets']['firefox'].update(bytes=len(encoded),sha256=base.digest(encoded))
    new_manifest['version'] = base.digest(json.dumps(new_manifest['assets'],sort_keys=True).encode())[:12]
    out.mkdir();(out/'init.before.sh').write_bytes(before);(out/'init.after.sh').write_bytes(after)
    (out/'initramfs-firefox.cpio.gz').write_bytes(encoded);(out/'boot-manifest.json').write_text(json.dumps(new_manifest,indent=2)+'\n')
    report = dict(passPackage=True,candidateOnly=True,sourceSha256=SOURCE_SHA,sourceManifestSha256=MANIFEST_SHA,
        archiveSha256=base.digest(encoded),bytes=len(encoded),uncompressedBytes=len(candidate),version=new_manifest['version'],
        initBeforeSha256=base.digest(before),initAfterSha256=base.digest(after),unchangedRecords=len(old)-1,modified=['init'],added=[],
        originalOrderPreserved=True,tailPreserved=True,initMetadataExceptSizePreserved=True,profilePreferencesUnchanged=True,
        source=str(args.source.resolve()),manifest=str(args.manifest.resolve()),filesystems=filesystems,scratch=scratch,
        releaseGatesPending=['actual-Firefox-homepage-and-input','warm-cache','update-and-profile-preservation','startup-observations'])
    (out/'package.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'passPackage':True,'version':report['version'],'bytes':len(encoded),'output':str(out)}))
if __name__ == '__main__': main()
