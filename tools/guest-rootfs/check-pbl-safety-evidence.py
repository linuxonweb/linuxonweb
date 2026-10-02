#!/usr/bin/env python3
"""Require real-guest compiled-loop evidence for a completed safety run."""
import argparse
import json
from pathlib import Path
import re

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('run', type=Path)
parser.add_argument('--packet', type=int, choices=(7, 8), default=8)
parser.add_argument('--arm', choices=('A', 'B'), default='B')
parser.add_argument('--log-budget', type=int, default=300)
args = parser.parse_args()
report = json.loads((args.run / 'result.json').read_text())
result = {'pass': False, 'run': str(args.run.resolve()), 'packet': args.packet,
          'arm': args.arm, 'boots': [], 'limitations': [
              'Allocation pressure does not prove a major GC occurred.',
              'This validates semantics and compilation, not throughput or interrupt delivery.']}

def events(logs):
    for line in logs.splitlines():
        if 'console.log: "PBLBENCH ' not in line:
            continue
        try:
            yield json.loads(json.loads(line[line.index('"'):])[9:])
        except (ValueError, TypeError):
            continue

if not report.get('pass'):
    result['error'] = 'underlying six-boot safety transport gate did not pass'
else:
    for boot in report['boots']:
        if boot['arm'] != args.arm:
            continue
        logs = (args.run / f"boot{boot['index']}-{args.arm}" / 'guest-logs.txt').read_text()
        metadata = next((e for e in events(logs)
                         if e.get('event') == 'safety-phase' and
                         e.get('phase') == 'warm' and
                         e.get('label') == boot['label']), None)
        requirements = [] if metadata is None else [r for r in metadata['compilationRequirements']
                                                    if r['packet'] <= args.packet and r['required']]
        warm_done_index = next((i for i, line in enumerate(logs.splitlines())
                                if any(e.get('event') == 'safety-phase' and
                                       e.get('phase') == 'warm-done' and
                                       e.get('repetitions') == 32 and
                                       e.get('label') == boot['label'] for e in events(line))), None)
        warm_logs = '' if warm_done_index is None else '\n'.join(logs.splitlines()[:warm_done_index])
        warm_compilations = [int(n) for n in re.findall(
            r'PBLJIT compile #\d+ file:///home/admin/pblbench/pblbench-' +
            re.escape(boot['label']) + r'\.html:(\d+)\s', warm_logs)]
        compiled = set(warm_compilations)
        missing = [r for r in requirements if r['sourceLine'] not in compiled]
        budget_seen = bool(re.search(r'PBLJIT enabled \(threshold=\d+, logBudget=' +
                                     str(args.log_budget) + r'\)', logs))
        adapter = report.get('mainAdapter') or {}
        adapter_ok = (adapter.get('jitLogBudget') == args.log_budget and
                      boot.get('mainAdapterSHA256') == adapter.get('sha256'))
        ready = boot.get('guestReady') or {}
        ready_ok = (report.get('guestReadinessMode') is True and
                    ready.get('event') == 'ready' and ready.get('label') == boot['label'] and
                    ready.get('url') == 'file:///home/admin/pblbench/pblready-' + boot['label'] + '.html' and
                    'Firefox/' in ready.get('ua', '') and boot.get('guestReadyMs', 0) > 0)
        gc_evictions = [{'oldEpoch': int(old), 'newEpoch': int(new)}
                        for old, new in re.findall(
                            r'PBLJIT GC evict oldEpoch=(\d+) newEpoch=(\d+)', logs)]
        compile_epochs = sorted(set(int(epoch) for epoch in re.findall(
            r'PBLJIT compile #[^\n]+ gcEpoch=(\d+)', logs)))
        rec = {'index': boot['index'], 'pass': bool(requirements) and not missing and budget_seen and adapter_ok and ready_ok,
               'required': requirements, 'compiledSourceLines': sorted(compiled), 'missing': missing,
               'compiledBeforeMutation': warm_done_index is not None,
               'warmCompilationCount': len(warm_compilations),
               'warmCompilationCountsByLine': {str(n): warm_compilations.count(n) for n in sorted(compiled)},
               'guestLogBudgetVerified': budget_seen, 'mainAdapterVerified': adapter_ok,
               'guestPageReadinessVerified': ready_ok,
               'compileGCEpochs': compile_epochs, 'gcEvictions': gc_evictions,
               'majorGCObserved': len(compile_epochs) > 1 or any(
                   e['newEpoch'] > e['oldEpoch'] for e in gc_evictions)}
        result['boots'].append(rec)
    result['pass'] = len(result['boots']) == 3 and all(b['pass'] for b in result['boots'])

destination = args.run / f'safety-evidence-{args.arm}-packet{args.packet}.json'
destination.write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result))
raise SystemExit(0 if result['pass'] else 1)
