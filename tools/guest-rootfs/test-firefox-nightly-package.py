#!/usr/bin/env python3
"""Synthetic tests of the Nightly archive adapter; no real browser acceptance."""
import copy
import argparse
import gzip
import importlib.util
import json
import os
import re
from pathlib import Path
import subprocess
import sys

sys.dont_write_bytecode = True
TOOL = Path(__file__).with_name('package-firefox-nightly.py')
spec = importlib.util.spec_from_file_location('packager', TOOL)
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run-name', default='fixture-run1')
    args = parser.parse_args()
    if not re.fullmatch('fixture-run[0-9]+', args.run_name): parser.error('named fixture-runN required')
    root = p.TASK / args.run_name
    if root.exists(): raise ValueError('fresh fixture run required; preserve earlier evidence')
    root.mkdir()
    scratch = root / 'scratch'; scratch.mkdir()
    env = dict(os.environ, TMPDIR=str(scratch), TMP=str(scratch), TEMP=str(scratch), PYTHONDONTWRITEBYTECODE='1')
    source = root / 'source'; source.mkdir()
    obj = root / 'object'; obj.mkdir()
    runtime = obj / 'dist/bin'; runtime.mkdir(parents=True)
    for name, body in {
        'config/milestone.txt': '159.0a1\n',
        'modules/libpref/init/StaticPrefList.yaml': '\n'.join('- name: ' + k for k in p.PREFS),
        'modules/libpref/init/all.js': '// fixture\n',
        'browser/app/profile/firefox.js': '// fixture\n',
        'browser/new.mjs': 'export const nightly = 159;\n',
    }.items():
        f = source / name; f.parent.mkdir(parents=True, exist_ok=True); f.write_text(body)
    identity = {'version': '159.0a1', 'officialBuildID': '20261002211853',
                'localBuildID': '20261003042618', 'hgRevision': 'dfc77f7a6d716f1a20a2576597638d4fc21cd916'}
    identity_file = root / 'identity.json'; identity_file.write_text(json.dumps(identity))
    binary = runtime / 'firefox'; binary.write_bytes(b'\0asm\x01\0\0\0'); binary.chmod(0o755)
    final = root / 'final.wasm'; final.write_bytes(binary.read_bytes())
    for name, body in {
        'application.ini': '[App]\nVersion=159.0a1\nBuildID=20261003042618\nSourceStamp=' + identity['hgRevision'] + '\n',
        'platform.ini': '[Build]\nMilestone=159.0a1\nBuildID=20261003042618\nSourceStamp=' + identity['hgRevision'] + '\n',
        'chrome/toolkit.js': '// fixture current toolkit\n',
        'browser/chrome/nightly.js': '// fixture current browser\n',
        'defaults/pref/wasm.js': '// preserve current-build comment\npref("fixture.unrelated", true);\npref("network.process.enabled", true);\n',
    }.items():
        f = runtime / name; f.parent.mkdir(parents=True, exist_ok=True); f.write_text(body)
    (runtime / 'modules').mkdir()
    (runtime / 'modules/new.mjs').symlink_to(source / 'browser/new.mjs')
    baseline_entries = [(name, 0o100644, ('unchanged:' + name).encode()) for name in sorted(p.CRITICAL)]
    baseline_entries = [(name, 0o120777 if name == 'bin/firefox' else mode,
                         b'/opt/firefox/firefox' if name == 'bin/firefox' else
                         b'home: persistent storage mounted\n' if name == 'init' else body)
                        for name, mode, body in baseline_entries]
    baseline_entries += [('home/admin/.mozilla/profile/user.js', 0o100600, b'preserve saved profile\n'),
                         ('opt/firefox', 0o40755, b''), ('opt/firefox/firefox', 0o100755, b'old binary'),
                         ('opt/firefox/modules/obsolete128.mjs', 0o100644, b'old ESR JS'),
                         ('TRAILER!!!', 0, b'')]
    encoded = b''.join(p.encode(name, mode, body, i + 1) for i, (name, mode, body) in enumerate(baseline_entries)) + b'\0' * 100
    archive = root / 'baseline.cpio.gz'; archive.write_bytes(gzip.compress(encoded, mtime=0))
    for name in ('kernel', 'plain'): (root / name).write_bytes(('fixture:' + name).encode())
    manifest = {'version': 'fixture128', 'schema': 1, 'assets': {
        name: {'url': './' + name, 'bytes': (root / name).stat().st_size, 'sha256': p.sha(root / name)}
        for name in ('kernel', 'plain')}}
    manifest['assets']['firefox'] = {'url': './baseline.cpio.gz', 'bytes': archive.stat().st_size, 'sha256': p.sha(archive)}
    mf = root / 'manifest.json'; mf.write_text(json.dumps(manifest))
    rows, _ = p.runtime_inventory(runtime, source, obj)
    evidence = {'schema': 1, 'completeBuild': True, 'sourceIdentitySHA256': p.sha(identity_file),
                'runtimeInventorySHA256': p.base.digest(p.canonical(rows)), 'rawBinarySHA256': p.sha(binary),
                'finalBinarySHA256': p.sha(final), 'commands': {}}
    for name, argv in [('fullBuild', ['python3', 'mach', 'build']),
                       ('fpcast', ['wasm-opt', '--fpcast-emu', '--pass-arg=max-func-params@23']),
                       ('structuralValidation', ['wasm-validate', '--enable-all', str(final)])]:
        log = root / (name + '.log'); log.write_text('SYNTHETIC FIXTURE ONLY: command evidence parser test; command not run\n')
        evidence['commands'][name] = {'argv': argv, 'exitCode': 0, 'log': str(log), 'logSHA256': p.sha(log)}
    ef = root / 'evidence.json'; ef.write_text(json.dumps(evidence))
    results = []

    def run(name, expect, *, inv=False, overrides=None):
        options = {'source': archive, 'manifest': mf, 'source-root': source, 'object-root': obj, 'runtime': runtime,
                   'source-identity': identity_file, 'source-sha256': p.sha(archive), 'manifest-sha256': p.sha(mf),
                   'source-identity-sha256': p.sha(identity_file), 'output': root / name}
        if inv: options['inventory-only'] = None
        else: options.update({'binary': final, 'build-evidence': ef, 'build-evidence-sha256': p.sha(ef)})
        options.update(overrides or {})
        argv = [sys.executable, '-B', str(TOOL)]
        for key, value in options.items():
            argv.append('--' + key)
            if value is not None: argv.append(str(value))
        result = subprocess.run(argv, env=env, text=True, capture_output=True)
        (root / (name + '.stdout')).write_text(result.stdout)
        (root / (name + '.stderr')).write_text(result.stderr)
        passed = (result.returncode == 0) == expect
        results.append({'name': name, 'pass': passed, 'expectedSuccess': expect, 'exitCode': result.returncode})
        if not passed: raise AssertionError(name + ': ' + result.stderr)

    run('preflight', True, inv=True)
    run('package', True)
    after, tail = p.inventory_archive(root / 'package/initramfs-firefox.cpio.gz')
    names = {r['name'] for r in after}
    assert 'opt/firefox/modules/obsolete128.mjs' not in names
    assert 'opt/firefox/modules/new.mjs' in names
    assert all(not (r['mode'] & 0o170000) == 0o120000 for r in after if r['name'].startswith('opt/firefox/'))
    before, bt = p.inventory_archive(archive)
    assert [r for r in before if not r['name'].startswith('opt/firefox')] == [r for r in after if not r['name'].startswith('opt/firefox')]
    assert bt == tail
    assert json.loads((root / 'package/boot-manifest.json').read_text())['assets']['kernel'] == manifest['assets']['kernel']
    results.append({'name': 'independent-complete-record-preservation-removal-and-symlink-audit', 'pass': True})
    with gzip.open(root / 'package/initramfs-firefox.cpio.gz', 'rb') as stream:
        prefs = {k: b for k, _, b, _ in p.cpio(stream)}['opt/firefox/defaults/pref/wasm.js']
    assert b'pref("fixture.unrelated", true);' in prefs
    assert b'// preserve current-build comment' in prefs
    assert b'pref("network.process.enabled", true);' not in prefs
    assert prefs.count(b'pref("network.process.enabled", false);') == 1
    compatible = json.loads((root / 'package/package.json').read_text())
    assert compatible['archiveSha256'] == compatible['archiveSHA256'] and compatible['version'].startswith('test-nightly-')
    results.append({'name': 'current-defaults-merge-and-candidate-package-json', 'pass': True})
    run('wrong-manifest-sha', False, overrides={'manifest-sha256': '0' * 64})
    modified = copy.deepcopy(manifest); modified['assets']['firefox']['sha256'] = '0' * 64
    mf.write_text(json.dumps(modified)); run('manifest-content-mismatch', False); mf.write_text(json.dumps(manifest))
    original = (runtime / 'application.ini').read_text()
    (runtime / 'application.ini').write_text(original.replace('159.0a1', '128.14.0'))
    run('old-runtime-stamp', False, inv=True); (runtime / 'application.ini').write_text(original)
    platform = (runtime / 'platform.ini').read_text()
    (runtime / 'platform.ini').write_text(platform.replace(identity['hgRevision'], '0' * 40))
    run('wrong-source-stamp', False, inv=True); (runtime / 'platform.ini').write_text(platform)
    binary.rename(runtime / 'missing-firefox')
    run('honest-missing-binary', False, inv=True); (runtime / 'missing-firefox').rename(binary)
    (runtime / 'modules/escape.mjs').symlink_to(root / 'manifest.json')
    run('outside-symlink', False, inv=True); (runtime / 'modules/escape.mjs').unlink()
    (runtime / 'loop').symlink_to(runtime, target_is_directory=True)
    run('directory-symlink-cycle', False, inv=True); (runtime / 'loop').unlink()
    (runtime / 'broken').symlink_to(source / 'absent')
    run('broken-symlink', False, inv=True); (runtime / 'broken').unlink()
    (runtime / 'modules/path.mjs').write_text('const leak="/mnt/p6/build/task/resource";')
    run('host-path-leak', False, inv=True); (runtime / 'modules/path.mjs').unlink()
    binary.chmod(0o4755); run('special-permissions', False, inv=True); binary.chmod(0o755)
    binary.write_bytes(b'\x7fELFfixture'); run('native-x86-rejected', False, inv=True); binary.write_bytes(final.read_bytes())
    e = copy.deepcopy(evidence); e['completeBuild'] = False; ef.write_text(json.dumps(e))
    run('incomplete-build-report', False); ef.write_text(json.dumps(evidence))
    e = copy.deepcopy(evidence); e['commands']['fpcast']['argv'] = ['wasm-opt', '--fpcast-emu']; ef.write_text(json.dumps(e))
    run('missing-fpcast-23', False); ef.write_text(json.dumps(evidence))
    e = copy.deepcopy(evidence); e['runtimeInventorySHA256'] = '0' * 64; ef.write_text(json.dumps(e))
    run('stale-runtime-evidence', False); ef.write_text(json.dumps(evidence))
    log = root / 'structuralValidation.log'; prior = log.read_text(); log.write_text('changed evidence\n')
    run('changed-validator-log', False); log.write_text(prior)
    prefs = source / 'modules/libpref/init/StaticPrefList.yaml'; prior = prefs.read_text()
    prefs.write_text(prior.replace('network.process.enabled', 'obsolete.network.process'))
    run('current-source-pref-missing', False, inv=True); prefs.write_text(prior)
    output = {'pass': all(r['pass'] for r in results), 'checks': len(results), 'syntheticOnly': True,
              'actualNightlyPackaged': False, 'guestAcceptance': False, 'results': results}
    (root / 'result.json').write_text(json.dumps(output, indent=2) + '\n')
    print(json.dumps(output))


if __name__ == '__main__': main()
