#!/usr/bin/env python3
"""Stage matched, off-default PBLBC_HITS arms without changing native Firefox.

The selected extras already contain the accepted matched full-scene workload.
They are preserved byte-for-byte as a prefix. Every arm adds the same diagnostic
content-console preference and changes only the method compiler's supported
threshold environment variable. Cache-lifecycle images are deliberately refused;
all arms retain the legacy native purge-marker policy for a fair comparison.
"""
import argparse
import copy
import datetime
import gzip
import hashlib
import importlib.util
import json
import pathlib
import stat
import sys
import time
sys.dont_write_bytecode = True


def digest(data):
    return hashlib.sha256(data).hexdigest()


def prepare(args):
    start = time.monotonic()
    started = datetime.datetime.now(datetime.timezone.utc).isoformat()
    if args.output.exists() or args.output.is_symlink():
        raise ValueError('Use a fresh private experiment directory')
    module_path = pathlib.Path(__file__).with_name('build-cache-image.py')
    spec = importlib.util.spec_from_file_location('cache_image', module_path)
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    manifest = json.loads((args.base_dir / 'boot-manifest.json').read_text())
    firefox = manifest['assets']['firefox']
    if firefox.get('cacheLifecycle') is not None:
        raise ValueError('Use the original APK4 image; cache proof must not cover diagnostic overrides')
    archive = args.base_dir / 'initramfs-firefox.cpio.gz'
    if helper.sha(archive) != firefox['sha256']:
        raise ValueError('Native system image differs from its selected manifest')
    inventory = helper.records(archive)
    if inventory[helper.NATIVE]['sha256'] != helper.NATIVE_SHA:
        raise ValueError('Unreviewed native Firefox identity')
    if helper.MARKER not in inventory or inventory[helper.MARKER]['uid'] != 0:
        raise ValueError('Expected original root-owned purge marker')
    launcher = inventory[helper.LAUNCHER]['body']
    if launcher.count(helper.EXPECTED_EXEC) != 1 or b'XUL_APP_FILE' in launcher or b'PBLBC_HITS' in launcher:
        raise ValueError('Expected unmodified legacy Firefox diagnostic launcher')
    extras_manifest = json.loads((args.extras_dir / 'desktop-extras.cpio.json').read_text())
    raw = (args.extras_dir / 'desktop-extras.cpio').read_bytes()
    if extras_manifest.get('schema') != 1 or len(raw) != extras_manifest['bytes'] or digest(raw) != extras_manifest['sha256']:
        raise ValueError('Matched workload extras identity differs')
    if not 0 < len(raw) < 64 * 1024**2:
        raise ValueError('Matched workload exceeds frontend extras bound')
    encoded = None
    if extras_manifest.get('gzip'):
        encoded = (args.extras_dir / 'desktop-extras.cpio.gz').read_bytes()
        wanted = extras_manifest['gzip']
        if len(encoded) != wanted['bytes'] or digest(encoded) != wanted['sha256'] or gzip.decompress(encoded) != raw:
            raise ValueError('Matched raw/gzip workload extras differ')
    pref = b'// Diagnostic only, identical in every method-threshold arm.\npref("devtools.console.stdout.content", true);\n'
    args.output.mkdir(parents=True)
    arms = []
    # Baseline first, then candidates. Actual benchmark order is randomized or
    # alternating by the measurement owner; these directory names do not set it.
    for threshold in (50, 10, 200):
        directory = args.output / ('hits-' + str(threshold))
        directory.mkdir()
        updated_launcher = launcher.replace(helper.EXPECTED_EXEC,
            ('export PBLBC_HITS=' + str(threshold) + '\n').encode() + helper.EXPECTED_EXEC)
        overlay = b''.join([
            helper.entry(helper.LAUNCHER, updated_launcher, inventory[helper.LAUNCHER]['mode'], 0x32000001),
            helper.entry('opt/firefox/defaults/pref/zz-method-threshold-test.js', pref, stat.S_IFREG | 0o644, 0x32000002),
            helper.entry('TRAILER!!!', b'', 0, 0x32000003),
        ])
        overlay += bytes(-len(overlay) % 512)
        padding = bytes(-len(raw) % 4)
        combined = raw + padding + overlay
        if len(combined) > 64 * 1024**2:
            raise ValueError('Experiment extras exceed frontend size bound')
        # Preserve the raw workload prefix, but emit one gzip member. Chromium's
        # DecompressionStream rejects concatenated members even though the guest
        # kernel's preserved-compressed path accepts them. Do not depend on that
        # path-specific exception for an otherwise reusable diagnostic overlay.
        compressed = gzip.compress(combined, compresslevel=1, mtime=0)
        if gzip.decompress(compressed) != combined:
            raise ValueError('Threshold extras gzip composition failed')
        metadata = copy.deepcopy(extras_manifest)
        metadata.update(bytes=len(combined), sha256=digest(combined),
                        gzip={'bytes': len(compressed), 'sha256': digest(compressed)})
        (directory / 'desktop-extras.cpio').write_bytes(combined)
        (directory / 'desktop-extras.cpio.gz').write_bytes(compressed)
        (directory / 'desktop-extras.cpio.json').write_text(json.dumps(metadata, indent=2) + '\n')
        (directory / 'firefox-launcher.sh').write_bytes(updated_launcher)
        arms.append({'threshold': threshold, 'directory': str(directory.resolve()),
                     'extrasSha256': metadata['sha256'], 'gzipSha256': metadata['gzip']['sha256'],
                     'launcherSha256': digest(updated_launcher), 'nativeChanged': False,
                     'expectedNativeHeader': 'PBLBC enabled (threshold=' + str(threshold) + ' ic=1 loopexit=0 loopjit=1)'})
    report = {'schema': 1, 'testOnly': True, 'startedUtc': started,
              'finishedUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'durationSeconds': round(time.monotonic() - start, 3),
              'systemArchiveSha256': firefox['sha256'], 'nativeFirefoxSha256': helper.NATIVE_SHA,
              'baseLauncherSha256': digest(launcher), 'matchedExtrasSha256': extras_manifest['sha256'],
              'sharedDiagnosticPrefSha256': digest(pref), 'arms': arms,
              'changesBetweenArms': ['PBLBC_HITS supported method compiler threshold only'],
              'unchanged': ['native Firefox bytes', 'matched scene bytes', 'PBLIC/PBLJIT thresholds',
                            'coverage admission flags', 'guard and GC policies', 'original purge-marker cache policy'],
              'runtimeAccepted': False, 'guardGcAcceptancePassed': False, 'publicDefaultChanged': False,
              'required': ['verify selected original APK4 manifest and native threshold header for every run',
                           'same CPU/RAM/resolution/backend and fresh profiles or matched closed-profile copies',
                           'untraced full-scene wall-clock FPS, frame intervals including stalls and correctness pixel',
                           'real usable readiness and keyboard/navigation separately from process-start markers',
                           'retain sparse native tier snapshots as observations, never final-total estimates',
                           'existing native guard/GC/session gates before any broad JIT acceptance',
                           'monitor CPU/RSS/available RAM each second and PSS every five seconds; owned Stop cleanup']}
    (args.output / 'method-threshold-experiment.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({k: report[k] for k in ('durationSeconds', 'systemArchiveSha256', 'matchedExtrasSha256', 'runtimeAccepted')}))


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--base-dir', type=pathlib.Path, required=True)
    p.add_argument('--extras-dir', type=pathlib.Path, required=True)
    p.add_argument('--output', type=pathlib.Path, required=True)
    prepare(p.parse_args())
