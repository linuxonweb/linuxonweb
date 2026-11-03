#!/usr/bin/env python3
"""Curate only allow-listed Android evidence; never publish raw phone receipts."""
import argparse
import hashlib
import json
import pathlib
import statistics


def cadence(rows):
    times = [float(row['ms']) for row in rows if isinstance(row.get('ms'), (int, float))]
    gaps = [right - left for left, right in zip(times, times[1:])]
    durations = [float(row['sampleDurationMs']) for row in rows if isinstance(row.get('sampleDurationMs'), (int, float))]
    return {'samples': len(rows), 'actualStartIntervalMs': {'min': min(gaps), 'median': statistics.median(gaps), 'max': max(gaps)} if gaps else None,
            'maxSampleDurationMs': max(durations) if durations else None,
            'firstUtc': rows[0].get('utc') if rows else None, 'lastUtc': rows[-1].get('utc') if rows else None}


def peak(rows, field):
    values = [row[field] for row in rows if isinstance(row.get(field), (int, float))]
    return max(values) if values else None


def attempt(root, number):
    private = root / 'out/pkp3/android-private'
    raw = json.loads((private / ('persistence' + str(number)) / 'result.json').read_text())
    owner = json.loads((private / ('owner' + str(number)) / 'result.json').read_text())
    gate = raw.get('nativeGate', {})
    persistence = gate.get('persistence', {})
    browser = raw.get('device', {}).get('browser', {})
    steps = []
    for step in gate.get('steps', []):
        public = {key: step[key] for key in ['command', 'action', 'elapsedMs', 'boundMs', 'pass', 'ackToTapCompletedMs', 'ackToStoppedMs'] if key in step}
        public['nativeMarkers'] = [line for line in step.get('output', []) if line.startswith(('APK_PERSIST_', 'MOBILE_PYTHON_OK ', 'MOBILE_RESTORED_PYTHON_OK ', 'Python 3.', 'MOBILE_HOME_ACK'))]
        steps.append(public)
    final_state = raw.get('page', {}).get('state', {})
    replay = [line for line in final_state.get('lines', []) if line.startswith('APK_PERSIST_RESTORED ')]
    host_checks = raw.get('hostQuotaChecks', [])
    return {
        'attempt': number, 'accepted': gate.get('pass') is True and owner.get('pass') is True and not raw.get('errors') and raw.get('ownedTargetClosed') is True and raw.get('ownedForwardRemoved') is True,
        'startedUtc': owner.get('startedUtc'), 'finishedUtc': owner.get('finishedUtc'), 'durationSeconds': owner.get('durationSeconds'),
        'device': {'model': raw.get('device', {}).get('model'), 'android': raw.get('device', {}).get('android'), 'browserApp': browser.get('Android-Package'), 'browserProtocolVersion': browser.get('Browser')},
        'guest': {'cpus': final_state.get('cpus'), 'memoryBytes': final_state.get('guestMemoryBytes'), 'imageSha256': final_state.get('imageSha256')},
        'runtimeBundleAudit': [{key: row[key] for key in ['kind', 'urlPath', 'bytes', 'sha256', 'status'] if key in row} for row in raw.get('runtimeBundleAudit', [])],
        'steps': steps, 'boots': gate.get('boots'), 'gatePass': gate.get('pass', False), 'errors': raw.get('errors', []),
        'savedGeneration': persistence.get('generation'), 'beforeHashes': persistence.get('beforeHashes'), 'afterHashes': persistence.get('afterHashes'),
        'restart': {key: persistence.get('restart', {})[key] for key in ['usablePromptMs', 'replay'] if key in persistence.get('restart', {})},
        'retainedFinalReplayAcknowledgments': replay,
        'offlineScope': 'Native helper APK replay disables networking and precedes guest network interface configuration. The phone browser network remains available.',
        'nativeCleanup': {key: gate.get('cleanup', {})[key] for key in ['phase', 'created', 'revoked', 'exactOwnedUrl', 'workerFetches', 'expectedBoots'] if key in gate.get('cleanup', {})},
        'ownedWorkerTeardown': [{'label': row.get('label'), 'elapsedMs': row.get('elapsedMs'), 'samples': row.get('samples'), 'remainingCount': len(row.get('remaining', []))} for row in raw.get('workerTeardown', [])],
        'cleanup': {'ownedTabClosed': raw.get('ownedTargetClosed'), 'ownedForwardRemoved': raw.get('ownedForwardRemoved'), 'ownedHostProcessesRemaining': owner.get('ownedProcessesRemaining'), 'hostCleanupErrors': owner.get('cleanupInventoryErrors')},
        'host': {'quotaPolicy': owner.get('quotaPolicy'), 'quotaFailure': owner.get('quotaFailure'), 'preflightChecks': len(host_checks), 'resourceSamples': owner.get('resourceSamples'), 'pssSamples': owner.get('pssSamples'), 'peakRssBytes': owner.get('ownedTreePeakRssBytes'), 'peakPssBytes': owner.get('ownedTreePeakPssBytes')},
        'phoneResources': {'scope': 'CPU and available RAM cover the device; RSS/PSS cover all Brave app processes, including unrelated existing tabs. No app force-stop. RSS can count shared pages repeatedly; sampled PSS peak is a lower bound.', 'cpuRssRamRequestedCadenceSeconds': 1, 'pssRequestedCadenceSeconds': 5,
                           'cpuRssRamCadence': cadence(raw.get('resources', [])), 'pssCadence': cadence(raw.get('pssResources', [])), 'minimumAvailableBytes': raw.get('minimumAvailableBytes'), 'peakBrowserRssBytes': raw.get('peakBrowserRssBytes'), 'peakBrowserPssBytes': raw.get('peakBrowserPssBytes'), 'peakDeviceCpuBusyPercent': peak(raw.get('resources', []), 'cpuBusyPercent')},
        'privateEvidenceDirectory': 'out/pkp3/android-private/persistence' + str(number),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--attempts', nargs='+', type=int, required=True)
    parser.add_argument('--out', type=pathlib.Path, required=True)
    args = parser.parse_args()
    root = pathlib.Path(__file__).resolve().parents[2]
    rows = [attempt(root, number) for number in args.attempts]
    prompt = root / 'web/linux/packages/v1/package-prompt.mjs'
    result = {'schema': 1, 'task': 'Linuxonweb Firefox lifecycle packages 20261103', 'scoreContext': '43/100 confirmed before final acceptance review; no automatic score increment from this receipt',
              'candidateOnly': True, 'published': False, 'attempts': rows,
              'knownFailureInterpretations': {'1': 'Harness invoked a missing bare sha256sum alias. Native BusyBox exposes the applet; corrected harness explicitly invokes /bin/busybox sha256sum. Signed Python install/import had passed; persistence was not attempted.',
                                              '2': 'Frontend prompt detector accepted APK progress ending # as interactive readiness. Retained output contains the exact offline replay acknowledgment after the premature readiness decision, but restored hashes/imports/world/userdata were not checked. This remains a failed complete gate.'},
              'promptFix': {'path': str(prompt.relative_to(root)), 'sha256': hashlib.sha256(prompt.read_bytes()).hexdigest(), 'focusedTests': 3, 'sourceReview': 'Firefox lifecycle agent approved exact pinned native PS1 matching; actual device gate is separate.'},
              'limits': ['Python install uses a 180-second test bound; previous 45-second timeout is not a measured baseline.', 'A console pass does not establish full Firefox usability on Android.', 'iOS acceptance has not passed.', 'Private raw evidence, CDP URLs, tab identifiers, grants, cookies, device serials and screenshots are excluded from public/source archives.']}
    args.out.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'attempts': len(rows), 'passedCompleteGate': [row['attempt'] for row in rows if row['accepted']], 'out': str(args.out)}))


if __name__ == '__main__':
    main()
