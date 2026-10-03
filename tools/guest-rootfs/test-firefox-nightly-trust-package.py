#!/usr/bin/env python3
"""Malformed-input and exact-preservation tests; no browser or TLS execution."""
import argparse
import copy
import gzip
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import subprocess
import sys

sys.dont_write_bytecode = True
TOOL = Path(__file__).with_name('package-firefox-nightly-trust.py')
spec = importlib.util.spec_from_file_location('trust_package', TOOL)
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)
AUDIT = Path('/mnt/p6/build/firefox-nightly-nss-adapter-audit-20261002')


def encode(name, body, *, mode=0o100644, inode=47, nlink=1):
    name = name.encode() + b'\0'
    fields = [inode, mode, 123, 456, nlink, 789, len(body), 1, 2, 3, 4, len(name), 0]
    header = b'070701' + b''.join(f'{v:08x}'.encode() for v in fields)
    # Deliberately nonzero legal padding, preserved byte-for-byte outside init.
    return header + name + b'X' * (-(110 + len(name)) % 4) + body + b'Y' * (-len(body) % 4)


def field(record, index, value):
    start = 6 + index * 8
    return record[:start] + f'{value:08x}'.encode() + record[start + 8:]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run-name', default='fixture-run1')
    args = parser.parse_args()
    if not re.fullmatch(r'fixture-run[0-9]+', args.run_name):
        parser.error('fresh fixture-runN name required')
    root = p.TASK / args.run_name
    root.mkdir(parents=True)
    scratch = root / 'scratch'; scratch.mkdir()
    env = dict(os.environ, TMPDIR=str(scratch), TMP=str(scratch), TEMP=str(scratch),
               PYTHONDONTWRITEBYTECODE='1')
    original_init = (AUDIT / 'public-v10-init.readonly').read_bytes()
    assert p.base.digest(original_init) == p.INIT_SHA
    expected_init = (AUDIT / 'nightly-static-roots-init.draft').read_bytes()
    assert p.base.digest(expected_init) == p.ADAPTED_INIT_SHA
    results = []

    def check(name, condition):
        assert condition, name
        results.append({'name': name, 'pass': True})

    def refuses(name, fn):
        try:
            fn()
        except (ValueError, EOFError, UnicodeError, gzip.BadGzipFile):
            results.append({'name': name, 'pass': True, 'expectedRefusal': True})
        else:
            raise AssertionError(name + ': malformed input accepted')

    check('matches-exact-independent-audited-draft', p.adapt_init(original_init) == expected_init)
    refuses('unknown-init-body', lambda: p.adapt_init(original_init + b'\n'))
    refuses('repeated-init-transformation', lambda: p.adapt_init(expected_init))
    refuses('duplicate-seed-anchor', lambda: p.adapt_init(original_init + p.OLD_SEED))
    refuses('missing-chown-anchor', lambda: p.adapt_init(original_init.replace(p.OLD_CHOWN, b'')))
    entry = encode('init', original_init, mode=0o100755)
    trailer = encode('TRAILER!!!', b'', mode=0)
    malformed = {
        'truncated-header': b'070701',
        'bad-magic': b'070702' + entry[6:] + trailer,
        'bad-hex': entry[:10] + b'ZZ' + entry[12:] + trailer,
        'zero-name-size': field(entry, 11, 0) + trailer,
        'oversized-name': field(entry, 11, 4097) + trailer,
        'oversized-record': field(entry, 6, p.MAX_RECORD_BYTES + 1) + trailer,
        'nonzero-newc-checksum': field(entry, 12, 1) + trailer,
        'missing-name-terminator': entry[:114] + b'X' + entry[115:] + trailer,
        'embedded-name-nul': entry[:111] + b'\0' + entry[112:] + trailer,
        'truncated-body': entry[:-100],
        'missing-trailer': entry,
        'nonempty-trailer': entry + encode('TRAILER!!!', b'not empty', mode=0),
        'duplicate-init': entry + entry + trailer,
        'duplicate-aliased-init': entry + encode('./init', original_init) + trailer,
        'absolute-path': encode('/init', original_init) + trailer,
        'parent-path': encode('x/../init', original_init) + trailer,
        'dot-path-alias': encode('././init', original_init) + trailer,
        'empty-path-segment': encode('x//init', original_init) + trailer,
    }
    for name, raw in malformed.items():
        refuses(name, lambda raw=raw: list(p.records(io.BytesIO(raw))))

    entries = [('.', b'', 0o40755), ('init', original_init, 0o100755),
               ('opt/firefox/firefox', b'FIXTURE128 BROWSER RETAINED', 0o100755),
               ('nss-ca-profile/cert9.db', b'old unused cert seed', 0o100600),
               ('nss-ca-profile/key4.db', b'old unused key seed', 0o100600),
               ('nss-ca-profile/pkcs11.txt', b'old unused module seed', 0o100600),
               ('home/admin/.mozilla/firefox/http1-profile/cert9.db', b'existing user trust/distrust', 0o100600),
               ('home/admin/.mozilla/firefox/http1-profile/pkcs11.txt', b'existing module config', 0o100600),
               ('home/admin/.mozilla/firefox/another/key4.db', b'existing private authentication data', 0o100600),
               ('lowland-OpenSans-Regular.ttf', b'font retained', 0o100644),
               ('etc/ssl/cert.pem', b'system PEM retained', 0o100644),
               ('bin/firefox', b'/opt/firefox/firefox', 0o120777)]
    encoded = b''.join(encode(n, b, mode=m, inode=i + 50) for i, (n, b, m) in enumerate(entries))
    tail = b'\0padding\xffopaque tail bytes\0' * 31
    valid_raw = encoded + trailer + tail
    archive = root / 'baseline.cpio.gz'
    archive.write_bytes(gzip.compress(valid_raw, mtime=0))
    for name in ('kernel', 'plain'):
        (root / name).write_bytes(('retained system fixture:' + name).encode())
    manifest = {'schema': 1, 'version': 'fixture128', 'previous': {'fixture': True}, 'assets': {
        name: {'url': './' + name, 'bytes': (root / name).stat().st_size,
               'sha256': p.base.file_digest(root / name), 'label': name}
        for name in ('kernel', 'plain')}}
    manifest['assets']['firefox'] = {'url': './initramfs-firefox.cpio.gz',
            'bytes': archive.stat().st_size, 'sha256': p.base.file_digest(archive), 'label': 'fixture128'}
    mf = root / 'manifest.json'; mf.write_text(json.dumps(manifest))

    def run(name, success=False, overrides=None, environment=None):
        options = {'source': archive, 'manifest': mf, 'source-sha256': p.base.file_digest(archive),
                   'manifest-sha256': p.base.file_digest(mf), 'output': root / name}
        options.update(overrides or {})
        argv = [sys.executable, '-B', str(TOOL)]
        for key, value in options.items(): argv.extend(['--' + key, str(value)])
        result = subprocess.run(argv, env=environment or env, capture_output=True, text=True)
        (root / (name + '.stdout')).write_text(result.stdout)
        (root / (name + '.stderr')).write_text(result.stderr)
        check(name, (result.returncode == 0) == success)
        if not success and 'output' not in (overrides or {}):
            check(name + '-no-output', not (root / name).exists())

    run('package', True)
    out = root / 'package'
    new_raw = gzip.decompress((out / 'initramfs-firefox.cpio.gz').read_bytes())
    # Independent complete-byte parser, not the packager's inventory comparison.
    before = list(p.base.records(valid_raw)); after = list(p.base.records(new_raw))
    check('independent-record-order', [r[0] for r in before] == [r[0] for r in after])
    check('independent-only-init-encoded-bytes-change',
          [a[0] for a, b in zip(before, after) if a[4] != b[4]] == ['init'])
    old_init_row = next(r for r in before if r[0] == 'init')
    new_init_row = next(r for r in after if r[0] == 'init')
    check('independent-init-metadata-name-padding-preserved',
          old_init_row[1][:54] + old_init_row[1][62:] == new_init_row[1][:54] + new_init_row[1][62:] and
          old_init_row[4][110:old_init_row[5]] == new_init_row[4][110:new_init_row[5]])
    check('independent-init-body-exact-draft', new_init_row[3] == expected_init)
    check('independent-arbitrary-archive-tail', new_raw[sum(len(r[4]) for r in after):] == tail)
    check('partial-profile-missing-key-not-added',
          'home/admin/.mozilla/firefox/http1-profile/key4.db' not in {r[0] for r in after})
    updated = json.loads((out / 'boot-manifest.json').read_text())
    check('preserved-kernel-plain-descriptors-and-companion-references',
          all(updated['assets'][name] == manifest['assets'][name] and
              (out / name).is_symlink() and p.base.file_digest(out / name) == manifest['assets'][name]['sha256']
              for name in ('kernel', 'plain')))
    report = json.loads((out / 'package-report.json').read_text())
    check('truthful-preparatory-evidence', report['passPackage'] is True and report['candidateOnly'] is True and
          report['runtimeAcceptance'] is False and report['tlsAcceptance'] is False and
          report['browserRuntimeChanged'] is False and report['mustNotRunStandalone'] is True and
          report['inputMatchesPublicV10'] is False)
    check('report-bound-to-source-and-output-hashes',
          report['sourceArchiveSHA256'] == p.base.file_digest(archive) and
          report['archiveSHA256'] == p.base.file_digest(out / 'initramfs-firefox.cpio.gz') and
          report['outputManifestSHA256'] == p.base.file_digest(out / 'boot-manifest.json') and
          report['sourceInitSHA256'] == p.INIT_SHA and report['outputInitSHA256'] == p.ADAPTED_INIT_SHA)
    check('report-and-compatible-package-json-identical',
          (out / 'package-report.json').read_bytes() == (out / 'package.json').read_bytes())
    run('repeated-package-refused', overrides={'source': out / 'initramfs-firefox.cpio.gz',
         'source-sha256': report['archiveSHA256'], 'manifest': out / 'boot-manifest.json',
         'manifest-sha256': report['outputManifestSHA256']})
    run('wrong-source-hash', overrides={'source-sha256': '0' * 64})
    run('wrong-manifest-hash', overrides={'manifest-sha256': '0' * 64})
    changed = copy.deepcopy(manifest); changed['assets']['firefox']['bytes'] += 1
    mf.write_text(json.dumps(changed)); run('wrong-manifest-content'); mf.write_text(json.dumps(manifest))
    changed = copy.deepcopy(manifest); changed['assets']['kernel']['url'] = '../kernel'
    mf.write_text(json.dumps(changed)); run('unsafe-companion-url'); mf.write_text(json.dumps(manifest))
    run('existing-output-refused', overrides={'output': out})
    run('outside-task-output-refused', overrides={'output': Path('/mnt/p6/build/trust-unsafe-output-never-created')})
    link = root / 'output-link'; link.symlink_to(root / 'absent-output')
    run('symlink-output-refused', overrides={'output': link})
    run('nonowned-scratch-refused', environment=dict(env, TMP='/tmp'))
    kernel_body = (root / 'kernel').read_bytes()
    (root / 'kernel').write_bytes(b'changed kernel')
    run('changed-preserved-system-asset'); (root / 'kernel').write_bytes(kernel_body)
    for name, raw in [('missing-init', trailer), ('unknown-init', valid_raw.replace(original_init, original_init[:-1] + b'X')),
                      ('duplicate-init-main', encoded + entry + trailer),
                      ('init-symlink', encode('init', original_init, mode=0o120777) + trailer),
                      ('init-hardlink', encode('init', original_init, nlink=2) + trailer)]:
        archive.write_bytes(gzip.compress(raw, mtime=0))
        m = copy.deepcopy(manifest); m['assets']['firefox'].update(bytes=archive.stat().st_size,
                                                               sha256=p.base.file_digest(archive))
        mf.write_text(json.dumps(m)); run(name)
    result = {'pass': True, 'checks': len(results), 'syntheticOnly': True,
              'runtimeAcceptance': False, 'guestAcceptance': False, 'tlsAcceptance': False,
              'packagerSHA256': p.base.file_digest(TOOL), 'results': results}
    (root / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result))


if __name__ == '__main__':
    main()
