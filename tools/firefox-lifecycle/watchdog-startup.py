#!/usr/bin/env python3
"""Finite lifecycle watchdog for startup owners that already monitor resources.

This deliberately does not read smaps/PSS or produce a second CPU/RSS sampler.
The existing gpt6-astra-current owner remains the sole 1s/5s resource observer.
"""
import argparse
import datetime
import importlib.util
import json
import os
import pathlib
import signal
import subprocess
import sys
import time
sys.dont_write_bytecode = True


def main(args):
    if not 20 <= args.seconds <= 600:
        raise SystemExit('Use a finite20..600s startup-owner bound')
    if args.out.exists():
        raise SystemExit('Use a fresh watchdog output directory')
    module_path = pathlib.Path(__file__).resolve().parents[1] / 'guest-packages' / 'bounded.py'
    spec = importlib.util.spec_from_file_location('owned_lifecycle', module_path)
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    command = args.command[1:] if args.command[:1] == ['--'] else args.command
    if not command:
        raise SystemExit('Owned startup command required')
    args.out.mkdir(parents=True)
    started = time.monotonic()
    started_utc = datetime.datetime.now(datetime.timezone.utc).isoformat()
    while True:
        limits = [row['cpus'] for row in helper.quotas() if row['cpus'] is not None]
        if limits and min(limits) <= 3:
            break
        if time.monotonic() - started > 8:
            raise SystemExit('Enforced three-CPU ancestor unavailable; no launch')
        time.sleep(.25)
    interrupts = []
    original = {sig: signal.getsignal(sig) for sig in (signal.SIGINT, signal.SIGTERM)}
    for sig in original:
        signal.signal(sig, lambda number, frame: interrupts.append(number))
    observed = {}
    reason = None
    cleanup_errors = []
    with (args.out / 'command.log').open('w') as log:
        child = subprocess.Popen(command, cwd=args.cwd, stdout=log, stderr=subprocess.STDOUT,
                                 env=dict(os.environ), start_new_session=True)
        identity = helper.process_stat(child.pid)
        observed[(identity['pid'], identity['startTicks'])] = identity
        try:
            while child.poll() is None:
                # Process identity inventory only; no PSS/CPU/RAM measurements.
                try:
                    current = {(row['pid'], row['startTicks']): row for row in helper.tree(child.pid, identity['startTicks'])}
                    for key, known in list(observed.items()):
                        if key not in current and helper.still_owned(known):
                            current.update({(row['pid'], row['startTicks']): row for row in helper.tree(known['pid'], known['startTicks'])})
                    observed.update(current)
                except helper.OwnedInventoryError as error:
                    observed.update({(row['pid'], row['startTicks']): row for row in error.items})
                    cleanup_errors.extend(error.problems)
                    reason = 'owned_inventory_unreadable'; break
                except (OSError, ValueError) as error:
                    cleanup_errors.append({'reason': 'owned_identity_unreadable', 'error': type(error).__name__})
                    reason = 'owned_identity_unreadable'; break
                if interrupts:
                    reason = 'owner_signal_' + str(interrupts[-1]); break
                if time.monotonic() - started >= args.seconds:
                    reason = 'finite_owner_deadline'; break
                time.sleep(.5)
        finally:
            active = []
            for row in observed.values():
                if row['pid'] == child.pid: continue
                try:
                    if helper.still_owned(row): active.append(row)
                except (OSError, ValueError) as error:
                    active.append(row)
                    cleanup_errors.append({'pid': row['pid'], 'reason': 'cleanup_identity_unreadable', 'error': type(error).__name__})
            remaining = []
            if child.poll() is None or active:
                if child.poll() is not None and active and reason is None:
                    reason = 'owned_descendants_outlived_startup_owner'
                remaining = helper.stop_owned_tree(child, identity, observed, cleanup_errors)
            for sig, action in original.items():
                signal.signal(sig, action)
    result = {'schema': 1, 'kind': 'lifecycle-only-startup-watchdog', 'startedUtc': started_utc,
              'finishedUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'durationSeconds': round(time.monotonic() - started, 3), 'argv': command,
              'exitCode': child.poll(), 'stopReason': reason, 'ownedProcessesRemaining': len(remaining),
              'remainingIdentities': remaining, 'cleanupInventoryErrors': cleanup_errors, 'resourceMonitor': 'Delegated solely to the owned startup harness: CPU/RSS/RAM1s, PSS5s',
              'watchdogSamplesPss': False, 'watchdogProducesCpuRssSamples': False,
              'pass': child.poll() == 0 and reason is None and not remaining and not cleanup_errors}
    (args.out / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result), flush=True)
    return result['pass']


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--cwd', default='.')
    p.add_argument('--out', type=pathlib.Path, required=True)
    p.add_argument('--seconds', type=int, default=220)
    p.add_argument('command', nargs=argparse.REMAINDER)
    raise SystemExit(0 if main(p.parse_args()) else 1)
