#!/usr/bin/env python3
"""Check completed PBL JIT gates and prepare a local promotion; default is dry-run.

Use --apply only after selecting the final accepted candidate. This tool never
deploys or stages Git files. The baseline pair is preserved in OUTPUT/baseline.
Archive and manifest replacements are individually atomic, with manifest last;
the existing boot loader verifies hashes during the interval between them.
"""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shlex
import shutil
import statistics
import subprocess

ROOT = Path(__file__).resolve().parents[2]
LIVE = ROOT / 'web/linux'
BASE_VERSION = 'b21b2cac65a3'
BASE_SHA = 'd3d9afca272947ba1b6bb743585a6f0cf33de90c54adff1cd85b5c5bf9d8002b'
VALIDATION = Path('/mnt/p6/build/guest-jit-validation-20261001')
PRECISION_INPUTS = VALIDATION / 'and-or-precision-inputs-run1'
PRECISION_DECLARATION_SHA = 'c98c3d78f85013cea3cfd5ef10e745837b76840e368b75c25d7a17477736cc2c'
PRECISION_CONTROL_SHA = '1b53911f106c11e4519aec0f2a0d838bea5c32edc81428e2a89b102b4fdf82d0'
PRECISION_CANDIDATE_SHA = 'ce0d881dec8cea0728c5f513461f66de736c631c837e0e4c847cdf315c996745'
HELD_SPEC6 = VALIDATION / 'bench-8-cached-fallback-spec6-run1/result.json'
SPEC6_CASES = {'int-loop', 'let-body', 'args-loop', 'if-else', 'mod-continue',
               'and-or', 'neg-bitnot', 'coalesce', 'native-call'}
ARR_PRECISION_INPUTS = VALIDATION / 'arr-inc-precision-inputs-run1'
ARR_PRECISION_DECLARATION_SHA = '048e44df8c1657577927f551cadd88538ca436672cd25558f78e1611e5fff0ae'
HELD_SPEC7 = VALIDATION / 'bench-8-cached-fallback-spec7-run1/result.json'
SPEC7_CASES = {'int-loop', 'arr-sum', 'arr-fill', 'arr-inc', 'dbl-arr',
               'arr-widen', 'float-acc', 'native-call'}
TRADEOFF_DECISION = Path('/mnt/p6/build/guest-jit-promotion-20261002/root-conditional-tradeoff-decision-run1.json')
TRADEOFF_DECISION_SHA = 'c8e5fe57a2727850c375f6bfd50121ffb9ea0a10629e34c0da9ca5a67273ec98'
ARR_PROMOTED_INPUTS = VALIDATION / 'arr-inc-promoted-coverage-inputs-run1'
ARR_PROMOTED_DECLARATION_SHA = '536a720e385819a90e7530a1241888a89ea6a7e49205b3185e862800a0b07a18'
ARR_PROMOTED_RESULT = VALIDATION / 'bench-8-cached-fallback-arr-inc-promoted-run1/result.json'
ARR_FAILED_PRECISION = VALIDATION / 'bench-8-cached-fallback-arr-inc-precision-run1/result.json'
CALLER_DIAGNOSTIC = VALIDATION / 'bench-8-cached-fallback-arr-inc-caller-diagnostic-run1/result.json'


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def read(path):
    return json.loads(path.read_text())


def verified_asset(path, asset):
    require(path.stat().st_size == asset['bytes'] and sha(path) == asset['sha256'],
            f'asset bytes/hash differ: {path}')


def passed(path):
    report = read(path)
    require(report.get('pass') is True, f'gate did not pass: {path}')
    return report


def has_input(report, digest):
    return digest in report.get('inputs', {}).values()


def current_loader_inputs(report):
    for filename in ('main.js', 'boot-assets.mjs', 'persistent-home.mjs'):
        path = LIVE / filename
        require(report.get('inputs', {}).get(str(path)) == sha(path),
                f'gate did not test the current loader/home adapter: {filename}')


def audited_coverage_baseline(path, baseline):
    path = path.resolve()
    require(path.is_relative_to(LIVE / 'tests/runtime-candidates'),
            'coverage baseline must be an isolated runtime-candidates directory')
    package = passed(path / 'package-report.json')
    manifest = read(path / 'boot-manifest.json')
    require(package['sourceArchiveSHA256'] == BASE_SHA,
            'coverage baseline package is not based on the current runtime')
    require(package.get('changedMembers') == ['opt/firefox/firefox'] and
            package.get('allOtherRecordsIdentical') is True and
            package.get('persistentInitPreserved') is True,
            'coverage baseline package audit does not preserve other members/home')
    asset = manifest['assets']['firefox']
    require(asset['sha256'] == package['archiveSHA256'] and
            asset['bytes'] == package['archiveBytes'],
            'coverage baseline package/manifest identity differs')
    verified_asset(path / 'initramfs-firefox.cpio.gz', asset)
    expected = json.loads(json.dumps(baseline))
    expected.pop('previous', None)
    comparison = json.loads(json.dumps(manifest))
    comparison['version'] = expected['version']
    comparison['assets']['firefox'] = expected['assets']['firefox']
    require(comparison == expected,
            'coverage baseline changed manifest fields beyond version/Firefox')
    return {'path': str(path), 'version': manifest['version'],
            'archiveSHA256': asset['sha256'], 'archiveBytes': asset['bytes'],
            'packageReportSHA256': sha(path / 'package-report.json'),
            'manifestSHA256': sha(path / 'boot-manifest.json')}


def verified_runtime_pair(gate, key, candidate_sha, coverage_shas):
    require(gate['arms']['B']['archiveSha256'] == candidate_sha,
            f'{key} candidate arm differs from selected runtime')
    if key != 'safety':
        allowed = coverage_shas if key == 'coverage benchmark' else {BASE_SHA}
        require(gate['arms']['A']['archiveSha256'] in allowed,
                f'{key} control arm differs from selected baseline')


def exact_replacements(original, changed, replacements, name):
    """Audit the complete copied source, including untouched lines and bodies."""
    for before, after in replacements:
        require(original.count(before) == 1, f'{name} transformation anchor changed')
        original = original.replace(before, after)
    require(original == changed, f'{name} has changes beyond the predeclared transformation')


def audited_batches(path, report, names, checksum, target='and-or', reps=None):
    """Recover every timed batch from retained guest logs; trust no verdict median."""
    require(report.get('order') == list('ABBAAB') and len(report.get('boots', [])) == 6,
            'precision evidence requires all six ABBAAB boots')
    require(report.get('inputsUnchanged') is True and report.get('changedInputs') == [] and
            report.get('checksumsIdentical') is True and report.get('serverClosed') is True and
            report.get('guestReadinessMode') is True and not report.get('error'),
            'precision evidence input/semantic/readiness/server cleanup failure')
    require(set(report.get('verdicts', {})) == names, 'precision evidence case set differs')
    adapter = report['mainAdapter']
    require(adapter.get('jitLogBudget') == 300 and
            adapter['sha256'] == sha(Path(adapter['path'])), 'precision log adapter differs')
    expected_checks = {'version', 'isolated', 'config', 'benchOk', 'cases', 'outerErrors'}
    medians = {name: {'A': [], 'B': []} for name in names}
    all_samples = {name: {'A': [], 'B': []} for name in names}
    checksums = {name: set() for name in names}
    logs = []
    for index, (arm, boot) in enumerate(zip('ABBAAB', report['boots']), 1):
        label = f'{arm.lower()}-{index}'
        require(boot.get('index') == index and boot.get('arm') == arm and
                boot.get('label') == label and boot.get('pass') is True and
                boot.get('benchOk') is True and boot.get('hardwareConcurrency') == 2 and
                boot.get('mainAdapterSHA256') == adapter['sha256'] and
                boot.get('guestReady', {}).get('label') == label and
                boot.get('guestReady', {}).get('event') == 'ready' and
                boot.get('state') == {'system': report['arms'][arm]['version'],
                                      'isolated': True, 'visibility': 'visible'} and
                set(boot.get('checks', {})) == expected_checks and
                all(value is True for value in boot['checks'].values()) and
                boot.get('browserExit') == {'code': 0, 'signal': None} and
                not boot.get('forcedTermination') and not boot.get('error') and
                all(boot.get(key) == [] for key in ('errorLines', 'fatalLines', 'outerErrors')),
                f'precision evidence boot {index} is incomplete or unclean')
        log_path = path.parent / f'boot{index}-{arm}/guest-logs.txt'
        log_source = log_path.read_text()
        require('cpus=2, ram=4 GB' in log_source and not any(
            marker in log_source for marker in ('MOZ_CRASH', 'Assertion failure', 'panicked',
                                               'Hit MOZ_', 'Segmentation fault',
                                               'RuntimeError: unreachable')),
                f'precision evidence boot {index} raw log config/fatal failure')
        events = []
        for line in log_source.splitlines():
            if 'console.log: "PBLBENCH ' in line:
                event = json.loads(json.loads(line[line.index('"'):])[9:])
                require(event.get('label') == label, 'raw log contains another benchmark attempt')
                events.append(event)
        require([event.get('event') for event in events] ==
                ['start'] + ['case'] * (3 * len(names)) + ['done'] and
                events[0].get('hc') == 2 and events[-1].get('ok') is True and
                events[-1].get('elapsedMs') == boot['benchElapsedMs'],
                f'precision evidence boot {index} raw events missing/duplicated/failed')
        if reps is not None:
            require(all(event.get('reps') == reps for event in events[1:-1]),
                    'raw benchmark repetitions differ from the declared experiment')
        fields = ('round', 'name', 'checksum', 'batchMs', 'medianBatchMs')
        raw_cases = [{key: event[key] for key in fields} for event in events[1:-1]]
        require(raw_cases == boot['cases'], 'raw guest samples differ from report samples')
        require(len(raw_cases) == 3 * len(names) and
                {(row['round'], row['name']) for row in raw_cases} ==
                {(round_, name) for round_ in range(3) for name in names},
                'missing/duplicated precision rounds or cases')
        for row in raw_cases:
            samples = row['batchMs']
            require(len(samples) == 11 and all(type(value) in (int, float) and
                    math.isfinite(value) and value >= 0 for value in samples) and
                    row['medianBatchMs'] == statistics.median(samples),
                    'precision raw sample count/value/median differs')
            checksums[row['name']].add(row['checksum'])
            if row['name'] == target:
                require(row['checksum'] == checksum, f'{target} checksum differs')
        for name in names:
            samples = [value for row in raw_cases if row['name'] == name
                       for value in row['batchMs']]
            medians[name][arm].append(statistics.median(samples))
            all_samples[name][arm].extend(samples)
        logs.append({'path': str(log_path), 'sha256': sha(log_path)})
    results = {}
    for name in names:
        a, b = medians[name]['A'], medians[name]['B']
        require(statistics.median(a) > 0 and statistics.median(b) > 0,
                'benchmark aggregate duration must be positive')
        ratio = statistics.median(b) / statistics.median(a)
        verdict = report['verdicts'][name]
        # This frozen runner divides by 100 even in the precision copy. Its
        # display units cancel in the ratio; all acceptance uses raw batch ms.
        require(len(checksums[name]) == 1 and verdict.get('checksumsIdentical') is True and
                verdict.get('baselineMsPerRep') == [round(value / 100, 5) for value in a] and
                verdict.get('pblMsPerRep') == [round(value / 100, 5) for value in b] and
                type(verdict.get('ratio')) in (int, float) and
                math.isclose(verdict['ratio'], ratio, rel_tol=0, abs_tol=0.0005000001),
                'reported benchmark verdict differs from all retained raw batches')
        results[name] = {'bootMedianBatchMs': medians[name],
                         'macroMedianBatchMs': {'A': statistics.median(a),
                                                'B': statistics.median(b)},
                         'aggregateMedianBatchMs': {
                             arm: statistics.median(samples)
                             for arm, samples in all_samples[name].items()},
                         'ratio': ratio, 'timedBatches': 198}
    return results, logs


def collected_precision(case, original_path, precision_path, declaration_path,
                        candidate_sha, coverage_shas):
    # These two frozen experiments are the entire allowed scope. There is no
    # caller-configurable fixture, runtime, transformation or acceptance bound.
    experiments = {
        'and-or': (HELD_SPEC6, PRECISION_INPUTS, PRECISION_DECLARATION_SHA,
                   'guest-jit-spec6-bench.html', 2500, SPEC6_CASES, 9790000, 244750000),
        'arr-inc': (HELD_SPEC7, ARR_PRECISION_INPUTS, ARR_PRECISION_DECLARATION_SHA,
                    'guest-jit-spec7b-bench.html', 1000, SPEC7_CASES, -840074848, 189186112),
    }
    require(case in experiments, 'precision case is not a frozen predeclared experiment')
    (held, inputs, declaration_sha, fixture_name, reps, names,
     original_checksum, precision_checksum) = experiments[case]
    require(original_path.resolve() == held and
            candidate_sha == PRECISION_CANDIDATE_SHA and
            PRECISION_CONTROL_SHA in coverage_shas,
            'precision override is limited to the selected held coverage/7c/final candidate')
    require(declaration_path.resolve() == inputs / 'predeclared-inputs.json' and
            sha(declaration_path) == declaration_sha,
            'precision declaration differs from the frozen predeclared inputs')
    declaration = read(declaration_path)
    for filename, digest in declaration['hashes'].items():
        require(sha(Path(filename)) == digest, f'predeclared input changed: {filename}')
    fixture = ROOT / 'web/linux/tests' / fixture_name
    runner = ROOT / 'tools/guest-rootfs/test-firefox-pbl-bench.mjs'
    precision_fixture = inputs / f'fixture-{case}-precision.html'
    precision_runner = inputs / f'runner-{case}-precision.mjs'
    require(fixture.read_bytes() == (inputs / 'fixture-base.html').read_bytes() and
            runner.read_bytes() == (inputs / 'runner-base.mjs').read_bytes(),
            'predeclared base copies differ from the original fixture/runner')
    exact_replacements(fixture.read_text(), precision_fixture.read_text(), [
        ('const REPS=100,WARMUPS=8,SAMPLES=11,ROUNDS=3,SETTLE_MS=15000;',
         f'const REPS={reps},WARMUPS=8,SAMPLES=11,ROUNDS=3,SETTLE_MS=15000;'),
        ('for(const [name,fn,expected] of cases){',
         "for(const [name,fn,expected] of cases.filter(x=>x[0]==='" + case + "')){")], 'fixture')
    exact_replacements(runner.read_text(), precision_runner.read_text(), [
        ("const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');",
         f'const repo = {str(ROOT)!r};'),
        ("const expectedCases = 3 * (fixture.match(/^ \\['[^']+',/gm) || []).length;",
         'const expectedCases = 3; // Predeclared single-case precision confirmation.')], 'runner')
    original, precision = passed(original_path), passed(precision_path)
    declared_arms = read(VALIDATION / 'arms-8-cached-fallback-7c-run1.json')
    expected_arms = {arm: {key: value[key] for key in ('name', 'version', 'archiveSha256')}
                     for arm, value in declared_arms.items()}
    require(original['arms'] == precision['arms'] == expected_arms and
            expected_arms['A']['archiveSha256'] == PRECISION_CONTROL_SHA and
            expected_arms['B']['archiveSha256'] == candidate_sha,
            'precision/original/predeclared runtime arms differ')
    expected_sources = [runner, fixture]
    changed_sources = [precision_runner, precision_fixture]
    shared = [ROOT / 'web/desktop/dev-server.mjs'] + [LIVE / name for name in (
        'main.js', 'persistent-home.mjs', 'boot-assets.mjs', 'vmlinux.wasm', 'initramfs.cpio')]
    shared += [Path(arm['dir']) / name for arm in declared_arms.values()
               for name in ('boot-manifest.json', 'initramfs-firefox.cpio.gz')]
    for path, report, sources in ((original_path, original, expected_sources),
                                  (precision_path, precision, changed_sources)):
        adapter_path = Path(report['mainAdapter']['path'])
        expected_inputs = {str(path): sha(path) for path in sources + shared + [adapter_path]}
        require(report.get('inputs') == expected_inputs,
                'precision/original report inputs differ from the exact frozen source/artifacts')
        current_loader_inputs(report)
        require((path.parent / 'runner.mjs').read_bytes() == sources[0].read_bytes() and
            (path.parent / 'fixture.html').read_bytes() == sources[1].read_bytes(),
            'retained run source differs from the declared runner/fixture')
    require(original['mainAdapter']['sha256'] == precision['mainAdapter']['sha256'],
            'precision changed the test loader adapter')
    original_results, original_logs = audited_batches(original_path, original, names,
                                                     original_checksum, case)
    precision_results, precision_logs = audited_batches(precision_path, precision, {case},
                                                       precision_checksum, case)
    for name, result in original_results.items():
        if name != case:
            require(result['ratio'] <= 1, f'{name} raw ratio exceeds the unchanged coverage bound')
    confirmation = precision_results[case]
    confirmation['trueMsPerRep'] = {arm: value / reps for arm, value in
                                  confirmation['macroMedianBatchMs'].items()}
    return {'case': case, 'scope': f'only held {fixture_name} coverage versus audited JIT7c',
            'original': {'path': str(original_path.resolve()), 'sha256': sha(original_path),
                         'verdict': original['verdicts'][case],
                         'recomputed': original_results[case], 'rawLogs': original_logs},
            'confirmation': {'path': str(precision_path.resolve()), 'sha256': sha(precision_path),
                             'recomputed': confirmation, 'rawLogs': precision_logs},
            'declaration': {'path': str(declaration_path.resolve()),
                            'sha256': declaration_sha},
            'bounds': {'ratioAtMost': 1.05, 'eachArmMedianBatchAtLeastMs': 75},
            'originalEightCaseBoundUnchanged': 1}


def audited_precision(case, original_path, precision_path, declaration_path,
                      candidate_sha, coverage_shas):
    audit = collected_precision(case, original_path, precision_path, declaration_path,
                                candidate_sha, coverage_shas)
    confirmation = audit['confirmation']['recomputed']
    require(confirmation['ratio'] <= 1.05 and
            all(value >= 75 for value in confirmation['aggregateMedianBatchMs'].values()),
            f'{case} precision exceeds its predeclared ratio/duration bound')
    return audit


def audited_and_or_precision(original_path, precision_path, declaration_path,
                             candidate_sha, coverage_shas):
    return audited_precision('and-or', original_path, precision_path, declaration_path,
                             candidate_sha, coverage_shas)


def audited_arr_inc_precision(original_path, precision_path, declaration_path,
                              candidate_sha, coverage_shas):
    return audited_precision('arr-inc', original_path, precision_path, declaration_path,
                             candidate_sha, coverage_shas)


def audited_caller_diagnostic():
    """Retain the bounded AB matrix as functional evidence, never acceptance."""
    path = CALLER_DIAGNOSTIC
    report = read(path)
    declaration = read(VALIDATION / 'arr-inc-caller-diagnostic-inputs-run1/inputs-declaration.json')
    for filename, digest in declaration['files'].items():
        require(sha(Path(filename)) == digest, 'caller diagnostic frozen input changed')
    expected_arms = {arm: {key: value[key] for key in ('name', 'version', 'archiveSha256')}
                     for arm, value in declaration['arms'].items()}
    require(report.get('diagnostic') is True and report.get('timingAcceptance') is False and
            report.get('diagnosticFunctionalPass') is True and report.get('pass') is False and
            report.get('instrumentation') == 'none' and report.get('order') == ['A', 'B'] and
            report.get('arms') == expected_arms and len(report.get('boots', [])) == 2 and
            report.get('inputsUnchanged') is True and report.get('changedInputs') == [] and
            report.get('serverClosed') is True and report.get('guestReadinessMode') is True and
            not report.get('error'), 'caller diagnostic scope/functional/cleanup failure')
    require(expected_arms['A']['archiveSha256'] == PRECISION_CONTROL_SHA and
            expected_arms['B']['archiveSha256'] == PRECISION_CANDIDATE_SHA,
            'caller diagnostic runtime identities differ')
    current_loader_inputs(report)
    for filename, digest in report['inputs'].items():
        require(sha(Path(filename)) == digest, 'caller diagnostic report input changed')
    adapter = report['mainAdapter']
    require(adapter.get('jitLogBudget') == 300 and
            adapter['sha256'] == sha(Path(adapter['path'])), 'caller diagnostic adapter changed')
    for filename, source in [('fixture.html', 'fixture-caller-matrix.html'),
                             ('runner.mjs', 'runner-caller-diagnostic.mjs')]:
        require((path.parent / filename).read_bytes() ==
                (VALIDATION / 'arr-inc-caller-diagnostic-inputs-run1' / source).read_bytes(),
                'caller diagnostic retained source changed')
    logs, medians, count = [], {}, 0
    for index, (arm, boot) in enumerate(zip('AB', report['boots']), 1):
        label = f'{arm.lower()}-{index}'
        require(boot.get('index') == index and boot.get('arm') == arm and
                boot.get('label') == label and boot.get('pass') is True and
                boot.get('benchOk') is True and boot.get('hardwareConcurrency') == 2 and
                boot.get('mainAdapterSHA256') == adapter['sha256'] and
                boot.get('guestReady', {}).get('label') == label and
                boot.get('guestReady', {}).get('event') == 'ready' and
                boot.get('state') == {'system': report['arms'][arm]['version'],
                                      'isolated': True, 'visibility': 'visible'} and
                set(boot.get('checks', {})) ==
                {'version', 'isolated', 'config', 'benchOk', 'cases', 'outerErrors'} and
                all(value is True for value in boot['checks'].values()) and
                boot.get('browserExit') == {'code': 0, 'signal': None} and
                not boot.get('forcedTermination') and not boot.get('error') and
                all(boot.get(key) == [] for key in ('errorLines', 'fatalLines', 'outerErrors')),
                'caller diagnostic boot is incomplete or unclean')
        log = path.parent / f'boot{index}-{arm}/guest-logs.txt'
        source = log.read_text()
        require('cpus=2, ram=4 GB' in source and not any(marker in source for marker in
                ('MOZ_CRASH', 'Assertion failure', 'panicked', 'Hit MOZ_',
                 'Segmentation fault', 'RuntimeError: unreachable')), 'caller raw fatal/config failure')
        events = [json.loads(json.loads(line[line.index('"'):])[9:])
                  for line in source.splitlines() if 'console.log: "PBLBENCH ' in line]
        require([event.get('event') for event in events] ==
                ['start'] + ['diagnostic-mode', 'case'] * 12 + ['done'] and
                all(event.get('label') == label for event in events) and
                events[0].get('hc') == 2 and events[-1].get('ok') is True and
                events[-1].get('elapsedMs') == boot['benchElapsedMs'],
                'caller diagnostic raw event sequence differs')
        case_events = events[2:-1:2]
        require(all(event.get('reps') == 1000 for event in case_events),
                'caller diagnostic repetitions differ')
        rows = [{key: event[key] for key in ('round', 'name', 'checksum', 'batchMs', 'medianBatchMs')}
                for event in case_events]
        modes = declaration['modes']
        require(rows == boot['cases'] and
                [(row['round'], row['name']) for row in rows] ==
                [(round_, mode) for round_ in range(3) for mode in modes],
                'caller diagnostic raw rounds/cases differ')
        for mode_event, row in zip(events[1:-1:2], rows):
            require(mode_event.get('round') == row['round'] and mode_event.get('name') == row['name'] and
                    mode_event.get('calleeName') == 'arr-inc' and mode_event.get('calleeSourceLine') == 25 and
                    mode_event.get('actualArgc') == (1 if row['name'].endswith('1') else 0) and
                    mode_event.get('useHelper') is row['name'].startswith('helper'),
                    'caller diagnostic mode metadata differs')
        for row in rows:
            samples = row['batchMs']
            require(len(samples) == 11 and row['checksum'] == 189186112 and
                    all(type(value) in (int, float) and math.isfinite(value) and value >= 0
                        for value in samples) and row['medianBatchMs'] == statistics.median(samples),
                    'caller diagnostic sample/checksum/median differs')
            count += len(samples)
        medians[arm] = {mode: statistics.median([value for row in rows if row['name'] == mode
                                                for value in row['batchMs']]) for mode in modes}
        logs.append({'path': str(log), 'sha256': sha(log)})
    require(count == 264, 'caller diagnostic missing raw samples')
    return {'path': str(path), 'sha256': sha(path), 'rawLogs': logs, 'timedBatches': count,
            'functionalPass': True, 'timingAcceptance': False, 'bootMedianBatchMs': medians,
            'interpretation': 'No causal attribution; does not overturn failed 7c comparison'}


def audited_arr_inc_tradeoff(decision_path, promoted_path, candidate_sha, coverage_shas):
    """One hash-bound engineering decision; prior precision remains FAIL."""
    require(decision_path.resolve() == TRADEOFF_DECISION and
            sha(decision_path) == TRADEOFF_DECISION_SHA,
            'tradeoff requires the exact frozen root decision')
    require(candidate_sha == PRECISION_CANDIDATE_SHA and
            coverage_shas == {PRECISION_CONTROL_SHA} and
            promoted_path.resolve() == ARR_PROMOTED_RESULT,
            'tradeoff is limited to the selected arr-inc candidate/control/result')
    decision = read(decision_path)
    require(decision.get('schema') == 1 and decision.get('author') == 'root' and
            decision.get('kind') == 'conditionalEngineeringTradeoffDecision' and
            decision.get('scope') == 'HELD_SPEC7.arr-inc.ce0d881dec8cea07.only' and
            decision.get('candidateArchiveSHA256') == candidate_sha and
            decision.get('intermediateControlArchiveSHA256') == PRECISION_CONTROL_SHA and
            decision.get('livePromotedControlArchiveSHA256') == BASE_SHA and
            decision.get('failureStatusMustRemainFail') is True and
            decision.get('genericOverrideAllowed') is False,
            'root decision schema/scope differs')
    bound = decision['requiredPromotedArrayEvidence']
    for asset in decision['frozenPriorEvidence'] + [bound[key] for key in ('declaration', 'fixture', 'runner')]:
        verified_asset(Path(asset['path']), asset)
    prior = collected_precision('arr-inc', HELD_SPEC7, ARR_FAILED_PRECISION,
                                ARR_PRECISION_INPUTS / 'predeclared-inputs.json',
                                candidate_sha, coverage_shas)
    require(prior['original']['recomputed']['ratio'] == 13 / 12 and
            prior['confirmation']['recomputed']['ratio'] == 71 / 62 and
            all(value >= 75 for value in
                prior['confirmation']['recomputed']['aggregateMedianBatchMs'].values()),
            'preserved failed original/precision measurements differ')
    prior['original']['performancePass'] = False
    prior['original']['status'] = 'FAIL'
    prior['confirmation']['performancePass'] = False
    prior['confirmation']['status'] = 'FAIL'
    diagnostic = audited_caller_diagnostic()
    declaration_path = ARR_PROMOTED_INPUTS / 'predeclared-inputs.json'
    require(sha(declaration_path) == ARR_PROMOTED_DECLARATION_SHA and
            bound['expectedResultPath'] == str(promoted_path.resolve()) and
            bound['macroCandidateOverControlAtMost'] == 1 and bound['rawBatches'] == 198 and
            bound['REPS'] == 100 and bound['rowChecksum'] == -840074848 and
            bound['order'] == 'ABBAAB' and bound['exclusions'] is False and bound['retry'] is False,
            'promoted arr-inc decision/declaration differs')
    declaration = read(declaration_path)
    for filename, digest in declaration['hashes'].items():
        require(sha(Path(filename)) == digest, 'promoted arr-inc predeclared input changed')
    fixture = ROOT / 'web/linux/tests/guest-jit-spec7b-bench.html'
    runner = ROOT / 'tools/guest-rootfs/test-firefox-pbl-bench.mjs'
    changed_fixture = ARR_PROMOTED_INPUTS / 'fixture-arr-inc-promoted.html'
    changed_runner = ARR_PROMOTED_INPUTS / 'runner-arr-inc-promoted.mjs'
    require(fixture.read_bytes() == (ARR_PROMOTED_INPUTS / 'fixture-base.html').read_bytes() and
            runner.read_bytes() == (ARR_PROMOTED_INPUTS / 'runner-base.mjs').read_bytes(),
            'promoted arr-inc frozen base differs')
    exact_replacements(fixture.read_text(), changed_fixture.read_text(), [
        ('for(const [name,fn,expected] of cases){',
         "for(const [name,fn,expected] of cases.filter(x=>x[0]==='arr-inc')){")], 'promoted fixture')
    require(changed_runner.read_bytes() == (ARR_PRECISION_INPUTS / 'runner-arr-inc-precision.mjs').read_bytes(),
            'promoted runner differs from the exact frozen runner transformation')
    report = passed(promoted_path)
    expected_arms = {arm: {key: value[key] for key in ('name', 'version', 'archiveSha256')}
                     for arm, value in declaration['arms'].items()}
    require(report['arms'] == expected_arms and expected_arms['A']['archiveSha256'] == BASE_SHA and
            expected_arms['B']['archiveSha256'] == candidate_sha,
            'promoted comparison arms differ')
    shared = [ROOT / 'web/desktop/dev-server.mjs'] + [LIVE / name for name in
              ('main.js', 'persistent-home.mjs', 'boot-assets.mjs', 'vmlinux.wasm', 'initramfs.cpio')]
    shared += [Path(arm['dir']) / name for arm in declaration['arms'].values()
               for name in ('boot-manifest.json', 'initramfs-firefox.cpio.gz')]
    inputs = [changed_runner, changed_fixture] + shared + [Path(report['mainAdapter']['path'])]
    require(report.get('inputs') == {str(path): sha(path) for path in inputs} and
            report['mainAdapter']['sha256'] == read(HELD_SPEC7)['mainAdapter']['sha256'],
            'promoted comparison frozen artifacts/loader differ')
    current_loader_inputs(report)
    require((promoted_path.parent / 'runner.mjs').read_bytes() == changed_runner.read_bytes() and
            (promoted_path.parent / 'fixture.html').read_bytes() == changed_fixture.read_bytes(),
            'promoted comparison retained source differs')
    results, logs = audited_batches(promoted_path, report, {'arr-inc'}, -840074848, 'arr-inc', reps=100)
    for boot in report['boots']:
        require(boot.get('navAttempts') == 1, 'promoted arr-inc proof requires one navigation per boot')
        if boot['arm'] == 'B':
            source = (promoted_path.parent / f"boot{boot['index']}-B/guest-logs.txt").read_text()
            compiled = {(int(offset), int(size)) for offset, size in re.findall(
                r'PBLJIT compile #[0-9]+ file:///home/admin/pblbench/pblbench-' +
                re.escape(boot['label']) + r'\.html:25 off=([0-9]+) [^\n]*?wasm=([0-9]+) ', source)}
            require({(56, 928), (131, 1379), (220, 1085)} <= compiled,
                    'promoted arr-inc proof lacks actual three-loop candidate compilations')
    require(results['arr-inc']['ratio'] <= 1, 'arr-inc did not beat/match live promoted baseline')
    return {'case': 'arr-inc', 'original': prior['original'], 'failedPrecision': prior,
            'callerDiagnostic': diagnostic, 'acceptedEngineeringTradeoff': True,
            'releaseDisposition': 'accepted engineering tradeoff; intermediate performance FAIL retained',
            'rootDecision': {'path': str(decision_path), 'sha256': sha(decision_path), 'decision': decision},
            'promotedComparison': {'path': str(promoted_path), 'sha256': sha(promoted_path),
                                   'recomputed': results['arr-inc'], 'rawLogs': logs, 'performancePass': True},
            'declaration': {'path': str(declaration_path), 'sha256': sha(declaration_path)},
            'originalEightCaseBoundUnchanged': 1, 'otherSpec7CaseBoundUnchanged': 1}


def verified_case_ratio(key, path, name, ratio, precision_audit, tradeoff_audit=None):
    if tradeoff_audit is not None and key == 'coverage benchmark' and name == 'arr-inc' and path.resolve() == HELD_SPEC7:
        require(tradeoff_audit.get('acceptedEngineeringTradeoff') is True and
                tradeoff_audit['rootDecision']['sha256'] == TRADEOFF_DECISION_SHA and
                tradeoff_audit['failedPrecision']['confirmation']['performancePass'] is False and
                tradeoff_audit['failedPrecision']['confirmation']['status'] == 'FAIL' and
                tradeoff_audit['failedPrecision']['confirmation']['recomputed']['ratio'] == 71 / 62 and
                tradeoff_audit['promotedComparison']['performancePass'] is True and
                tradeoff_audit['promotedComparison']['recomputed']['ratio'] <= 1 and
                sha(path) == tradeoff_audit['original']['sha256'] and
                ratio == tradeoff_audit['original']['verdict']['ratio'],
                'held arr-inc engineering disposition changed after its audit')
        return
    if (precision_audit is not None and key == 'coverage benchmark' and
            name == precision_audit['case'] and
            path.resolve() == {'and-or': HELD_SPEC6, 'arr-inc': HELD_SPEC7}.get(name)):
        require(sha(path) == precision_audit['original']['sha256'],
                'held coverage report changed after its precision audit')
        return  # Only this ratio has independently audited supplemental evidence.
    require(type(ratio) in (int, float) and math.isfinite(ratio) and 0 < ratio <= 1,
            f'{name} did not beat/match its selected control runtime (ratio={ratio})')


def fsync_dir(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def copy_synced(source, destination, mode):
    shutil.copyfile(source, destination)
    os.chmod(destination, mode)
    with destination.open('rb') as stream:
        os.fsync(stream.fileno())


def verified_evidence_freshness(evidence):
    """Recheck recorded reports, raw logs, and their complete pinned input maps."""
    pending, visited, digests = [evidence], set(), {}
    while pending:
        item = pending.pop()
        if isinstance(item, list):
            pending.extend(item)
            continue
        if not isinstance(item, dict):
            continue
        pending.extend(value for value in item.values() if isinstance(value, (dict, list)))
        if 'path' in item and 'sha256' in item:
            path, digest = Path(item['path']), item['sha256']
            require(path.is_absolute(), 'freshness evidence path must be absolute')
            require(str(path) not in digests or digests[str(path)] == digest,
                    'freshness evidence contains conflicting input hashes')
            first = str(path) not in digests
            digests[str(path)] = digest
            if first:
                require(sha(path) == digest, f'evidence changed before final replacement: {path}')
            if path.suffix == '.json' and str(path) not in visited:
                visited.add(str(path))
                pending.append(read(path))
        for field in ('inputs', 'hashes', 'files'):
            mapping = item.get(field)
            if isinstance(mapping, dict):
                for filename, digest in mapping.items():
                    require(isinstance(filename, str) and
                            isinstance(digest, str) and re.fullmatch('[0-9a-f]{64}', digest),
                            'freshness pinned input map has invalid path/hash')
                    path = pinned_input_path(field, filename)
                    pending.append({'path': str(path), 'sha256': digest})
    return {'verifiedFiles': len(digests)}


def pinned_input_path(field, filename):
    path = Path(filename)
    if path.is_absolute():
        return path
    # The two frozen candidate-identity files use repository-relative sources
    # in `files`; all report `inputs` and declaration `hashes` stay absolute.
    require(field == 'files' and filename.split('/')[0] in ('tools', 'web') and
            '\\' not in filename and all(part not in ('', '.', '..') for part in filename.split('/')),
            'freshness relative source is outside the known repository files schema')
    resolved = (ROOT / path).resolve(strict=True)
    require(resolved.is_relative_to(ROOT.resolve(strict=True)),
            'freshness relative source escapes the repository through a symlink')
    return resolved


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--candidate', type=Path, required=True)
    parser.add_argument('--build-report', type=Path, required=True)
    parser.add_argument('--jit-source', type=Path, required=True,
                        help='preserved source snapshot matching pblJitSourceSHA256')
    parser.add_argument('--host-log', type=Path, required=True,
                        help='host emitter stdout ending with pass/checks/failures JSON')
    for key in ('startup', 'update', 'benchmark', 'safety', 'safety-evidence'):
        parser.add_argument('--' + key, type=Path, required=True)
    parser.add_argument('--coverage-benchmark', type=Path, action='append', default=[],
                        help='additional completed benchmark result (repeat for packets 6/7)')
    parser.add_argument('--coverage-baseline', type=Path, action='append', default=[],
                        help='audited candidate allowed as coverage control (repeat for multiple; '
                             'default: promoted baseline; original benchmark still uses promoted)')
    parser.add_argument('--and-or-precision', type=Path,
                        help='complete predeclared and-or confirmation; applies only to held spec6')
    parser.add_argument('--and-or-precision-declaration', type=Path,
                        help='frozen predeclared-inputs.json paired with --and-or-precision')
    parser.add_argument('--arr-inc-precision', type=Path,
                        help='complete predeclared arr-inc confirmation; applies only to held spec7')
    parser.add_argument('--arr-inc-precision-declaration', type=Path,
                        help='frozen predeclared-inputs.json paired with --arr-inc-precision')
    parser.add_argument('--arr-inc-engineering-decision', type=Path,
                        help='exact frozen root conditional tradeoff decision; failed precision stays FAIL')
    parser.add_argument('--arr-inc-promoted-comparison', type=Path,
                        help='complete strict arr-inc comparison against live promoted runtime')
    parser.add_argument('--output', type=Path, required=True,
                        help='fresh run directory under /mnt/p6/build/guest-jit-promotion-20261002')
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    used_gate_snapshots = [{'path': str(path.resolve()), 'sha256': sha(path)} for path in
                           [getattr(args, key) for key in ('startup', 'update', 'benchmark',
                                                          'safety', 'safety_evidence')] +
                           args.coverage_benchmark] if args.arr_inc_engineering_decision else []
    task = Path('/mnt/p6/build/guest-jit-promotion-20261002').resolve()
    out, candidate = args.output.resolve(), args.candidate.resolve()
    require(out.is_relative_to(task) and out != task and not out.exists(),
            'output must be a fresh promotion task subdirectory')
    require(candidate.is_relative_to(LIVE / 'tests/runtime-candidates'),
            'candidate must be an isolated runtime-candidates directory')
    for key in ('TMPDIR', 'TMP', 'TEMP'):
        scratch = Path(os.environ.get(key, '/missing')).resolve(strict=True)
        require(scratch.is_relative_to(task), f'{key} must use task-owned scratch')
        kind = subprocess.check_output(['findmnt', '-T', str(scratch), '-n', '-o', 'FSTYPE'],
                                       text=True).strip()
        require(kind not in ('tmpfs', 'ramfs'), f'{key} is not disk-backed')
    require(task.stat().st_dev == LIVE.stat().st_dev,
            'task and production directory must share a filesystem for atomic rename')
    require(shutil.disk_usage(task).free > 1024 ** 3, 'need 1 GiB free for preserved/staged pairs')

    baseline_path, archive_path = LIVE / 'boot-manifest.json', LIVE / 'initramfs-firefox.cpio.gz'
    baseline = read(baseline_path)
    baseline_manifest_sha = sha(baseline_path)
    require(baseline['version'] == BASE_VERSION and baseline['assets']['firefox']['sha256'] == BASE_SHA,
            'production baseline changed; reevaluate promotion')
    for key, filename in (('kernel', 'vmlinux.wasm'), ('plain', 'initramfs.cpio'),
                          ('firefox', 'initramfs-firefox.cpio.gz')):
        verified_asset(LIVE / filename, baseline['assets'][key])

    package = passed(candidate / 'package-report.json')
    manifest = read(candidate / 'boot-manifest.json')
    archive = candidate / 'initramfs-firefox.cpio.gz'
    require(package['sourceArchiveSHA256'] == BASE_SHA, 'package is not based on the current runtime')
    require(package.get('changedMembers') == ['opt/firefox/firefox'] and
            package.get('allOtherRecordsIdentical') is True and
            package.get('persistentInitPreserved') is True, 'package audit does not preserve other members/home')
    require(manifest['assets']['firefox']['sha256'] == package['archiveSHA256'] and
            manifest['assets']['firefox']['bytes'] == package['archiveBytes'], 'package/manifest identity differs')
    verified_asset(archive, manifest['assets']['firefox'])
    candidate_sha, candidate_version = package['archiveSHA256'], manifest['version']
    expected = json.loads(json.dumps(baseline))
    expected.pop('previous', None)
    comparison = json.loads(json.dumps(manifest))
    comparison['version'] = expected['version']
    comparison['assets']['firefox'] = expected['assets']['firefox']
    require(comparison == expected, 'candidate changed manifest fields beyond version/Firefox')

    coverage_baselines = [audited_coverage_baseline(path, baseline)
                          for path in args.coverage_baseline]
    coverage_shas = {entry['archiveSHA256'] for entry in coverage_baselines} or {BASE_SHA}
    require(bool(args.arr_inc_engineering_decision) == bool(args.arr_inc_promoted_comparison),
            'arr-inc engineering decision and promoted comparison must be supplied together')
    require(not args.arr_inc_engineering_decision or
            not (args.arr_inc_precision or args.arr_inc_precision_declaration),
            'engineering disposition cannot present failed arr-inc precision as a passing supplement')
    tradeoff_audit = None
    if args.arr_inc_engineering_decision:
        paths = [path.resolve() for path in args.coverage_benchmark]
        require(paths.count(HELD_SPEC6) == paths.count(HELD_SPEC7) == 1,
                'engineering tradeoff requires both exact held coverage runs')
        tradeoff_audit = audited_arr_inc_tradeoff(args.arr_inc_engineering_decision,
                                                args.arr_inc_promoted_comparison,
                                                candidate_sha, coverage_shas)
    precision_audits = {}
    for case in ('and-or', 'arr-inc'):
        field = case.replace('-', '_') + '_precision'
        report_path = getattr(args, field)
        declaration_path = getattr(args, field + '_declaration')
        require(bool(report_path) == bool(declaration_path),
                f'{case} precision report and declaration must be supplied together')
        if not report_path:
            continue
        coverage_paths = [path.resolve() for path in args.coverage_benchmark]
        require(coverage_paths.count(HELD_SPEC6) == coverage_paths.count(HELD_SPEC7) == 1 and
                report_path.resolve() == VALIDATION /
                f'bench-8-cached-fallback-{case}-precision-run1/result.json',
                'precision supplement requires the exact held spec6/spec7 and confirmation runs')
        precision_audits[case] = audited_precision(
            case, {'and-or': HELD_SPEC6, 'arr-inc': HELD_SPEC7}[case],
            report_path, declaration_path,
            candidate_sha, coverage_shas)
    require(candidate_sha not in coverage_shas,
            'coverage control must differ from the selected candidate')

    build = passed(args.build_report)
    require(build['sha256'] == package['candidateSHA256'], 'packaged wasm differs from build')
    wasm = Path(build['candidate'])
    verified_asset(wasm, build)
    with wasm.open('rb') as stream:
        require(stream.read(8) == b'\0asm\x01\0\0\0', 'Firefox is not native Wasm')
    require(build.get('tableSplice', {}).get('newSection', '').startswith('0406017000'),
            'build does not report the growable native-Wasm function table')
    require(sha(args.jit_source) == build['pblJitSourceSHA256'], 'adapter source snapshot differs from build')
    require(sha(args.build_report.parent / 'PortableBaselineInterpret.cpp') == build['hookSourceSHA256'],
            'PBL hook source differs from build')
    if build.get('cacheInterpreterRejections'):
        hooks = build.get('cachedRejectionHooks', {})
        require(build.get('interpretHandlers') or build.get('interpretThrows'),
                'cached interpreter rejection lacks an eligibility policy')
        require(hooks.get('archiveMemberReplacementCount') == 1,
                'cached rejection did not replace exactly one JIT entry unit')
        for field in ('jitOriginalSource', 'jitCopiedSource', 'unifiedOriginalSource',
                      'unifiedCopiedSource', 'compiledObject'):
            path = Path(hooks[field])
            require(sha(path) == hooks[field + 'SHA256'],
                    f'cached rejection input changed: {field}')
        for field in ('jitCopiedSource', 'unifiedCopiedSource', 'compiledObject'):
            require(Path(hooks[field]).resolve().parent == args.build_report.parent.resolve(),
                    f'cached rejection input is outside the selected build: {field}')
        members = shlex.split((args.build_report.parent / 'libjs.list').read_text())
        require(members.count(hooks['compiledObject']) == 1 and
                hooks['originalArchiveMember'] not in members,
                'cached rejection archive membership differs from the report')
    if build.get('linkCommand'):
        require(sha(Path(build['linkCommand'])) == build['linkCommandSHA256'], 'link inputs changed')
    host_lines = args.host_log.read_text().splitlines()
    host = json.loads(next(line for line in reversed(host_lines) if line.startswith('{') and '"checks"' in line))
    require(host.get('pass') is True and host.get('failures') == 0 and host.get('checks', 0) > 0,
            'host emitter check did not pass')

    for key, labels in (('startup', ['cold', 'warm']), ('update', ['baseline', 'update'])):
        gate = passed(getattr(args, key))
        require([p['label'] for p in gate['phases']] == labels and
                all(p.get('pass') is True for p in gate['phases']), f'{key} phases incomplete')
        require(has_input(gate, candidate_sha) and has_input(gate, BASE_SHA), f'{key} tested different archive')
        current_loader_inputs(gate)
        require(gate['publicAssets']['manifest']['version'] == candidate_version and
                gate['publicAssets']['manifest']['assets']['firefox']['sha256'] == candidate_sha,
                f'{key} served different candidate')
        require(gate.get('serverClosed') is True and gate.get('browserExit', {}).get('code') == 0,
                f'{key} cleanup did not pass')
        if key == 'update':
            require(gate.get('priorDownloadPreserved') is True, 'update did not preserve previous download')

    runs = [('benchmark', args.benchmark), ('safety', args.safety)]
    runs += [('coverage benchmark', path) for path in args.coverage_benchmark]
    for key, path in runs:
        gate = passed(path)
        require(gate['order'] == list('ABBAAB') and len(gate['boots']) == 6 and
                all(b.get('pass') is True for b in gate['boots']), f'{key} is not a complete six-boot run')
        verified_runtime_pair(gate, key, candidate_sha, coverage_shas)
        current_loader_inputs(gate)
        require(gate.get('inputsUnchanged') is True and gate.get('checksumsIdentical') is True,
                f'{key} input/checksum gate failed')
        if key != 'safety':
            require(bool(gate.get('verdicts')), 'no benchmark case results')
            if key == 'benchmark':
                require(set(gate['verdicts']) == {'int-loop', 'call-recursion', 'throw-flat',
                                                'throw-deep', 'throw-error', 'prop-mono',
                                                'native-call', 'json'},
                        'original eight-case performance fixture is incomplete')
                if tradeoff_audit is not None:
                    raw_results, raw_logs = audited_batches(path, gate, set(gate['verdicts']),
                                                            None, target=None, reps=100)
                    require(all(result['ratio'] <= 1 for result in raw_results.values()),
                            'original eight-case raw ratio exceeds unchanged release bound')
                    tradeoff_audit['originalEightCaseComparison'] = {
                        'path': str(path.resolve()), 'sha256': sha(path),
                        'recomputed': raw_results, 'rawLogs': raw_logs}
            for name, verdict in gate['verdicts'].items():
                verified_case_ratio(key, path, name, verdict['ratio'], precision_audits.get(name),
                                    tradeoff_audit)
    compiled = passed(args.safety_evidence)
    require(Path(compiled['run']).resolve() == args.safety.parent.resolve() and
            compiled.get('packet') == 8 and compiled.get('arm') == 'B' and
            len(compiled['boots']) == 3 and all(b.get('pass') is True for b in compiled['boots']),
            'safety evidence is not for the selected completed packet 8 run')
    for boot in compiled['boots']:
        required = boot.get('required', [])
        require({r['packet'] for r in required if r.get('required')} >= {7, 8} and
                all(r['sourceLine'] in boot['compiledSourceLines'] for r in required) and
                not boot.get('missing'), 'safety lacks positive packet 7/8 compilation in a candidate boot')

    promoted = json.loads(json.dumps(baseline))
    promoted['version'] = candidate_sha[:12]
    promoted.pop('previous', None)
    promoted['assets']['firefox'].update(bytes=package['archiveBytes'], sha256=candidate_sha)
    for precision_audit in precision_audits.values():
        for key in ('original', 'confirmation', 'declaration'):
            source = precision_audit[key]
            require(sha(Path(source['path'])) == source['sha256'],
                    f'precision {key} evidence changed after its audit')
    if tradeoff_audit is not None:
        sources = [tradeoff_audit[key] for key in ('rootDecision', 'promotedComparison', 'declaration')]
        sources += [tradeoff_audit['failedPrecision'][key] for key in ('original', 'confirmation', 'declaration')]
        sources += [tradeoff_audit['callerDiagnostic']]
        sources += [tradeoff_audit['originalEightCaseComparison']]
        for source in list(sources):
            sources += source.get('rawLogs', [])
        for source in sources:
            require(sha(Path(source['path'])) == source['sha256'],
                    'engineering tradeoff evidence changed after its audit')
    out.mkdir()
    (out / 'baseline').mkdir()
    for filename in ('boot-manifest.json', 'initramfs-firefox.cpio.gz'):
        source = LIVE / filename
        copy_synced(source, out / 'baseline' / filename, source.stat().st_mode & 0o777)
    copy_synced(archive, out / 'initramfs-firefox.cpio.gz', archive_path.stat().st_mode & 0o777)
    (out / 'boot-manifest.json').write_text(json.dumps(promoted, indent=2) + '\n')
    with (out / 'boot-manifest.json').open('rb') as stream:
        os.fsync(stream.fileno())
    verified_asset(out / 'baseline/initramfs-firefox.cpio.gz', baseline['assets']['firefox'])
    verified_asset(out / 'initramfs-firefox.cpio.gz', promoted['assets']['firefox'])
    require(sha(out / 'baseline/boot-manifest.json') == baseline_manifest_sha, 'baseline manifest copy differs')
    evidence = {key: {'path': str(getattr(args, key).resolve()), 'sha256': sha(getattr(args, key))}
                for key in ('build_report', 'jit_source', 'host_log', 'startup', 'update',
                            'benchmark', 'safety', 'safety_evidence')}
    evidence['coverage_benchmarks'] = [{'path': str(path.resolve()), 'sha256': sha(path)}
                                      for path in args.coverage_benchmark]
    evidence['coverage_baselines'] = coverage_baselines
    for case, precision_audit in precision_audits.items():
        evidence[case.replace('-', '_') + '_precision'] = precision_audit
    if tradeoff_audit is not None:
        evidence['usedGateSnapshots'] = used_gate_snapshots
        evidence['acceptedEngineeringTradeoff'] = tradeoff_audit
        verified_evidence_freshness(evidence)
    result = {'pass': True, 'applied': False, 'candidate': str(candidate),
              'baselineVersion': BASE_VERSION, 'baselineArchiveSHA256': BASE_SHA,
              'version': promoted['version'], 'archiveSHA256': candidate_sha,
              'archiveBytes': package['archiveBytes'], 'evidence': evidence,
              'baselineBackup': str(out / 'baseline'), 'scope': 'local only; no Sites deployment'}
    rollback_code = '\n'.join([
        'import os, shutil',
        f'from pathlib import Path; saved=Path({str(out / "baseline")!r}); live=Path({str(LIVE)!r})',
        f'staging=Path({str(out)!r})',
        "for name in ('initramfs-firefox.cpio.gz', 'boot-manifest.json'):",
        "    temporary=staging / ('rollback-' + name)",
        "    shutil.copy2(saved / name, temporary)",
        "    with temporary.open('rb') as stream: os.fsync(stream.fileno())",
        "    os.replace(temporary, live / name)",
        "fd=os.open(live, os.O_RDONLY | os.O_DIRECTORY)",
        'os.fsync(fd); os.close(fd)',
    ])
    result['rollbackCommand'] = ['python3', '-c', rollback_code]
    if args.apply:
        require(sha(baseline_path) == baseline_manifest_sha and sha(archive_path) == BASE_SHA,
                'production changed during preparation')
        require(sha(archive) == candidate_sha, 'candidate changed during preparation')
        if tradeoff_audit is not None:
            result['finalEvidenceFreshness'] = verified_evidence_freshness(evidence)
        try:
            os.replace(out / 'initramfs-firefox.cpio.gz', archive_path)
            fsync_dir(LIVE)
            os.replace(out / 'boot-manifest.json', baseline_path)
            fsync_dir(LIVE)
        except BaseException:
            for filename in ('initramfs-firefox.cpio.gz', 'boot-manifest.json'):
                copy_synced(out / 'baseline' / filename, out / ('restore-' + filename),
                            (out / 'baseline' / filename).stat().st_mode & 0o777)
                os.replace(out / ('restore-' + filename), LIVE / filename)
            fsync_dir(LIVE)
            raise
        result['applied'] = True
        verified_asset(archive_path, read(baseline_path)['assets']['firefox'])
    (out / 'promotion-report.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result))


if __name__ == '__main__':
    main()
