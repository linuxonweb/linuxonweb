#!/usr/bin/env python3
"""Curate actual readback fixtures with their continuous owned-tree CPU evidence."""
import argparse
import base64
import datetime
import hashlib
import json
import pathlib


def collect(owner_path):
    owner_path = pathlib.Path(owner_path)
    owner = json.loads((owner_path / 'result.json').read_text())
    lines = (owner_path / 'command.log').read_text().splitlines()
    summaries = []
    for line in lines:
        try:
            value = json.loads(line)
            if isinstance(value, dict) and 'run' in value: summaries.append(value)
        except json.JSONDecodeError: pass
    if len(summaries) != 1:
        return {'ownerPath': str(owner_path.resolve()), 'owner': owner, 'qualified': False,
                'failure': 'one exact browser result could not be recovered', 'summaryCount': len(summaries)}
    browser_path = pathlib.Path(summaries[0]['run']) / 'result.json'
    browser = json.loads(browser_path.read_text())
    samples = [json.loads(line) for line in (owner_path / 'resources.jsonl').read_text().splitlines()]
    snapshots = [sample.get('ownedQuota') for sample in samples]
    known = bool(snapshots) and all(snapshot and snapshot.get('valid') is True and snapshot.get('commonSharedAncestors') for snapshot in snapshots)
    common = None
    if known:
        for snapshot in snapshots:
            paths = {entry['path'] for entry in snapshot['commonSharedAncestors'] if 0 < entry['maximumObservedCpuLimit'] <= 3}
            common = paths if common is None else common & paths
    preflight = browser.get('quotaPreflight', {})
    qualified = owner.get('pass') is True and known and bool(common) and preflight.get('valid') is True and bool(preflight.get('commonSharedAncestors'))
    result = browser.get('page', {}).get('result') or {}
    return {'ownerPath': str(owner_path.resolve()), 'owner': owner, 'browserPath': str(browser_path.resolve()),
            'browserResultSha256': hashlib.sha256(browser_path.read_bytes()).hexdigest(),
            'qualified': bool(qualified), 'browserPassed': browser.get('pass') is True,
            'continuousQuota': {'samples': len(snapshots), 'allKnownAndValid': bool(known), 'commonAncestorPaths': sorted(common or []),
                                'allObservedProcesses': sum(sum(len(group['processes']) for group in snapshot.get('groups', [])) for snapshot in snapshots if snapshot)},
            'beforeNavigationQuota': preflight, 'flags': browser.get('flags'), 'inputs': browser.get('inputs'),
            'browserErrors': browser.get('errors'), 'result': result}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--raw-owner', required=True)
    parser.add_argument('--adapter-owner', required=True)
    parser.add_argument('--native-owner', required=True)
    parser.add_argument('--out', type=pathlib.Path, required=True)
    args = parser.parse_args()
    if args.out.exists(): raise SystemExit('fresh evidence output required')
    raw, adapter, native = [collect(path) for path in (args.raw_owner, args.adapter_owner, args.native_owner)]
    png = native.get('result', {}).pop('firstNativeFramePng', None)
    if png:
        prefix = 'data:image/png;base64,'
        if not png.startswith(prefix): raise SystemExit('unexpected native image encoding')
        image = base64.b64decode(png[len(prefix):], validate=True)
        if not image.startswith(b'\x89PNG\r\n\x1a\n') or len(image) > 4 * 1024 * 1024: raise SystemExit('invalid or unbounded native image')
        image_path = args.out.with_suffix('.png')
        if image_path.exists(): raise SystemExit('fresh native PNG output required')
        image_path.write_bytes(image)
        native['firstNativeFrame'] = {'path': str(image_path.resolve()), 'bytes': len(image), 'sha256': hashlib.sha256(image).hexdigest()}
    passed = lambda section: section.get('qualified') and section.get('browserPassed') and section.get('result', {}).get('pass') is True
    report = {'schema': 1, 'createdUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'scope': 'Explicit isolated WebGPU rendering with CPU readback/opaque 2D presentation',
              'acceptance': {'rawReadbackPixelsUnderSharedQuota': bool(passed(raw)), 'adapterPixelsAndCleanupUnderSharedQuota': bool(passed(adapter)),
                             'nativeVulkanWsiFixtureUnderSharedQuota': bool(passed(native)), 'fullApiConformance': False,
                             'performanceParity': False, 'directExportDriverBugFixed': False, 'publicDesktopDefaultChanged': False},
              'limits': ['Native WSI fixture is not a conformance suite', 'Uniform-colour pixel oracle is separate from native nonuniformity observation',
                         'Experimental isolated Linux WebGPU flags are recorded, not normal-browser compatibility acceptance',
                         'Canvas byte accounting is nominal width*height*4 and excludes browser/driver overhead',
                         'Resource observations are one-second samples, with PSS every five seconds; no throughput claim'],
              'rawDiagnostic': raw, 'adapterDiagnostic': adapter, 'nativeFixture': native}
    args.out.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'out': str(args.out), 'acceptance': report['acceptance']}))


if __name__ == '__main__': main()
