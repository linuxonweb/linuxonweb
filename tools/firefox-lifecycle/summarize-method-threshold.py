#!/usr/bin/env python3
"""Curate actual native-page callback measurements, never broad JIT acceptance."""
import argparse
import datetime
import hashlib
import json
import pathlib
import re
import statistics

SCENE_SHA = 'e610e6b07da7622ed0724308dd5867b93330ad2a740c515dea46bfa1b1a929c0'
SETTINGS = {'width': 320, 'height': 240, 'warmupMs': 10000, 'sampleMs': 20000,
            'webglVersion': 2, 'webgpu': False, 'media': False}

def read(path):
    return json.loads(pathlib.Path(path).read_text())

def pin(path):
    path = pathlib.Path(path)
    return {'path': str(path.resolve()), 'bytes': path.stat().st_size,
            'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}

def measurements(data):
    if not isinstance(data, dict):
        return None
    keys = ['pass', 'done', 'settings', 'hardwareConcurrency', 'sampleFrames', 'fps', 'elapsedMs',
            'wallElapsedMs', 'firstFrameEpochMs', 'sampleStartEpochMs', 'sampleEndEpochMs',
            'sampleStartUTC', 'sampleEndUTC', 'frameMs', 'histogram', 'finalPixel', 'glError',
            'webglState', 'renderer', 'browser', 'errors']
    out = {k: data.get(k) for k in keys}
    if all(isinstance(data.get(k), (int, float)) for k in ['firstFrameEpochMs', 'sampleStartEpochMs', 'sampleEndEpochMs']):
        out['actualWarmupWallMs'] = data['sampleStartEpochMs'] - data['firstFrameEpochMs']
        out['firstFrameToSampleEndWallMs'] = data['sampleEndEpochMs'] - data['firstFrameEpochMs']
    return out

def metric_ok(data):
    return bool(data and data.get('pass') is True and data.get('done') is True
                and data.get('settings') == SETTINGS and data.get('hardwareConcurrency') == 3
                and data.get('glError') == 0 and data.get('elapsedMs', 0) >= 20000
                and data.get('sampleFrames', 0) >= 20
                and abs(data['fps'] - data['sampleFrames'] * 1000 / data['elapsedMs']) < 1e-6)

def native_results(logs):
    unique = {}
    for line in logs.splitlines():
        match = re.search(r'GPUCHECK_BENCH (\{.*\})', line)
        if not match:
            continue
        raw = match[1]
        try:
            try:
                value = json.loads(raw)
            except json.JSONDecodeError:
                value = json.loads(json.loads('"' + raw + '"'))
            unique[json.dumps(value, sort_keys=True)] = value
        except (ValueError, TypeError):
            continue
    return list(unique.values())

def native(label, threshold, directory, experiment):
    directory = pathlib.Path(directory)
    if not (directory / 'report.json').exists():
        return {'label': label, 'threshold': threshold, 'status': 'not-run', 'directory': str(directory)}
    owner = read(directory / 'report.json')
    logs = (directory / 'guest.log').read_text() if (directory / 'guest.log').exists() else ''
    results = native_results(logs)
    data = results[0] if len(results) == 1 else None
    observed_thresholds = sorted(set(map(int, re.findall(r'PBLBC enabled \(threshold=(\d+)', logs))))
    expected = next(arm for arm in experiment['arms'] if arm['threshold'] == threshold)
    pins = owner.get('ownedProxy', {}).get('pins', {})
    identity = {'base': pins.get('/linux/initramfs-firefox.cpio.gz', {}).get('sha256') == experiment['systemArchiveSha256'],
                'extrasRaw': pins.get('/linux/desktop-extras.cpio', {}).get('sha256') == expected['extrasSha256'],
                'extrasGzip': pins.get('/linux/desktop-extras.cpio.gz', {}).get('sha256') == expected['gzipSha256'],
                'threshold': observed_thresholds == [threshold]}
    clean = owner.get('finishedNormally') is True and owner.get('remainingOwned') == [] and not owner.get('errors')
    sparse = [line for line in logs.splitlines() if re.search(r'(?:PBLIC|PBLBC|PBLJIT) (?:enabled|stats|compile #|reject #)', line)]
    samples = owner.get('samples', [])
    out = {'label': label, 'threshold': threshold, 'directory': str(directory.resolve()),
           'startedUtc': owner.get('start'), 'finishedUtc': owner.get('end'), 'elapsedMs': owner.get('elapsedMs'),
           'configuration': owner.get('configuration'), 'browserVersion': owner.get('browserVersion'),
           'quietObservation': owner.get('quietObservation'), 'identity': identity, 'observedThresholds': observed_thresholds,
           'uniqueCompletedSceneRecords': len(results), 'measurement': measurements(data),
           'ownerCleanupPassed': clean, 'ownerErrors': owner.get('errors'),
           'remainingOwned': owner.get('remainingOwned'), 'tierObservations': sparse,
           'tierObservationLimit': 'Sparse bounded log snapshots; not complete final compile/entry totals.',
           'resourceSummary': owner.get('resourceSummary'),
           'resourceSamples': len(samples), 'artifacts': [pin(directory / 'report.json')]}
    for name in ['guest.log', 'final.png', 'home-timings.json']:
        if (directory / name).exists():
            out['artifacts'].append(pin(directory / name))
    out['measurementAccepted'] = clean and all(identity.values()) and metric_ok(data)
    return out

def host(label, directory):
    directory = pathlib.Path(directory)
    if not (directory / 'result.json').exists():
        return {'label': label, 'status': 'not-run', 'directory': str(directory)}
    monitor = read(directory / 'result.json')
    selected = None
    for line in (directory / 'command.log').read_text().splitlines():
        try:
            candidate = json.loads(line)
            if candidate.get('run'):
                selected = candidate['run']
        except (ValueError, AttributeError):
            pass
    if not selected:
        return {'label': label, 'status': 'failed', 'monitor': monitor, 'reason': 'No host browser receipt'}
    path = pathlib.Path(selected) / 'result.json'
    result = read(path)
    data = result.get('page', {}).get('result')
    scene = result.get('inputs', {}).get('/linux/tests/guest-glremote/firefox-benchmark.html', {})
    valid = monitor.get('pass') is True and result.get('pass') is True and not result.get('errors')
    valid = valid and scene.get('sha256') == SCENE_SHA and result.get('page', {}).get('viewport') == [1280, 720, 1] and metric_ok(data)
    return {'label': label, 'directory': str(directory.resolve()), 'measurementAccepted': valid,
            'measurement': measurements(data), 'quietObservation': result.get('quietSceneObservation'),
            'afterQuietScene': result.get('afterQuietScene'), 'flags': result.get('flags'), 'pageIdentity': scene,
            'startedUtc': result.get('started'), 'finishedUtc': result.get('ended'),
            'ownerErrors': result.get('errors'), 'monitor': monitor, 'artifacts': [pin(path), pin(directory / 'result.json')]}

def main(args):
    experiment = read(args.experiment)
    if experiment.get('matchedExtrasSha256') != 'e5a3450e6ed15cb81e480ca51dcf1d06a90b5f9c391091283fe4dfc878a5ca39':
        raise SystemExit('This curator requires the exact matched scene extras')
    natives = [native(label, int(threshold), path, experiment) for label, threshold, path in (item.split(',', 2) for item in args.arm)]
    hosts = [host(label, path) for label, path in (item.split(',', 1) for item in args.host)]
    host_values = [row['measurement']['fps'] for row in hosts if row.get('measurementAccepted')]
    baseline = [row['measurement']['fps'] for row in natives if row.get('measurementAccepted') and row['threshold'] == 50]
    host_mean = statistics.mean(host_values) if host_values else None
    base_mean = statistics.mean(baseline) if baseline else None
    for row in natives:
        if row.get('measurementAccepted'):
            row['percentOfMatchedHostMean'] = row['measurement']['fps'] / host_mean * 100 if host_mean else None
            row['percentOfBaseline50Mean'] = row['measurement']['fps'] / base_mean * 100 if base_mean else None
    report = {'schema': 1, 'createdUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'scope': 'Off-default supported PBLBC threshold diagnostic on original native Firefox159',
              'predeclaredOrder': [50, 10, 200, 50], 'metric': 'Full native-page requestAnimationFrame callback rate; every measured interval and overrun included',
              'physicalPresentationRateMeasured': False, 'sameSceneSha256': SCENE_SHA, 'sceneSettings': SETTINGS,
              'experiment': experiment, 'nativeArms': natives, 'hostControls': hosts,
              'meanMatchedHostFps': host_mean, 'baseline50Fps': baseline, 'meanBaseline50Fps': base_mean,
              'allRequestedMeasurementsAccepted': all(row.get('measurementAccepted') for row in natives + hosts),
              'publicDefaultsChanged': False, 'broadGuardGcAcceptance': False, 'fullJitAcceptance': False,
              'limitations': ['One run per candidate threshold; baseline is bracketed, not a statistically powered throughput study.',
                             'Host is approximately display-refresh capped; physical presentation is not measured.',
                             'Outer quiet observation delays do not change the identical scene warmup/sample window.',
                             'No complete final native compile/entry counters are exposed by this build.',
                             'Existing broad native build-binding/guard/GC requirements remain unmet; no threshold promotion is authorized.']}
    if args.output.exists():
        raise SystemExit('Use a fresh report path')
    args.output.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({k: report[k] for k in ['allRequestedMeasurementsAccepted', 'meanMatchedHostFps', 'baseline50Fps']}))

if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--experiment', type=pathlib.Path, required=True)
    p.add_argument('--arm', action='append', required=True, help='LABEL,THRESHOLD,RUN_DIRECTORY')
    p.add_argument('--host', action='append', required=True, help='LABEL,BOUNDED_OWNER_DIRECTORY')
    p.add_argument('--output', type=pathlib.Path, required=True)
    main(p.parse_args())
