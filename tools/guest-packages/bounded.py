#!/usr/bin/env python3
"""Own a finite command and sample resources without changing host CPU policy."""
import argparse
import datetime
import json
import os
import pathlib
import signal
import subprocess
import time

PROC_ROOT = pathlib.Path('/proc')


def utc():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def process_stat(pid):
    fields = (PROC_ROOT / str(pid) / 'stat').read_text().rsplit(')', 1)[1].split()
    return {'pid': pid, 'state': fields[0], 'parentPid': int(fields[1]), 'startTicks': int(fields[19]),
            'rssBytes': int(fields[21]) * os.sysconf('SC_PAGE_SIZE'),
            'cpuTicks': int(fields[11]) + int(fields[12])}


class OwnedInventoryError(RuntimeError):
    def __init__(self, items, problems):
        super().__init__('live owned process inventory could not be verified')
        self.items = items
        self.problems = problems


def thread_children(item):
    task_root = PROC_ROOT / str(item['pid']) / 'task'
    try:
        tasks = list(task_root.iterdir())
    except OSError as error:
        if still_owned(item):
            raise OSError('live process task directory unreadable') from error
        return []
    children = set()
    for task in tasks:
        if not task.name.isdecimal():
            continue
        try:
            children.update(map(int, (task / 'children').read_text().split()))
        except FileNotFoundError:
            # A task may exit between enumeration and read. If it still exists,
            # an unreadable children inventory is not evidence of no children.
            if task.exists() and still_owned(item):
                raise OSError('live task children inventory missing')
        except OSError as error:
            if still_owned(item):
                raise OSError('live task children inventory unreadable') from error
    return sorted(children)


def tree(root_pid, expected_start=None):
    result, problems = [], []
    queue = [(root_pid, None)]
    seen = set()
    while queue:
        pid, parent = queue.pop()
        if pid in seen:
            continue
        seen.add(pid)
        try:
            item = process_stat(pid)
            if item['state'] == 'Z':
                continue
            if parent is None and expected_start is not None and item['startTicks'] != expected_start:
                continue
            if parent is not None and item['parentPid'] != parent:
                problems.append({'pid': pid, 'reason': 'child_parent_changed_before_identity'})
                continue
            result.append(item)
            queue.extend((child, pid) for child in thread_children(item))
        except (FileNotFoundError, ProcessLookupError):
            continue
        except (OSError, ValueError) as error:
            problems.append({'pid': pid, 'reason': 'live_thread_inventory_unreadable', 'error': type(error).__name__})
    if problems:
        raise OwnedInventoryError(result, problems)
    return result


def cgroup_membership(pid="self"):
    rows = (PROC_ROOT / str(pid) / 'cgroup').read_text().splitlines()
    values = [line.split('::', 1)[1] for line in rows if line.startswith('0::')]
    if len(values) != 1 or not values[0].startswith('/'):
        raise ValueError('exact unified cgroup membership unavailable')
    return values[0]


def quota_ancestors(membership):
    records = []
    path = pathlib.Path('/sys/fs/cgroup') / membership.lstrip('/')
    while True:
        try:
            value = (path / 'cpu.max').read_text().strip()
            quota, period = value.split()
            if int(period) <= 0:
                raise ValueError('invalid CPU quota period')
            records.append({'path': str(path), 'cpuMax': value,
                            'cpus': None if quota == 'max' else int(quota) / int(period)})
        except (OSError, ValueError) as error:
            records.append({'path': str(path), 'cpuMax': None, 'cpus': None,
                            'readError': type(error).__name__})
        if path == pathlib.Path('/sys/fs/cgroup') or pathlib.Path('/sys/fs/cgroup') not in path.parents:
            break
        path = path.parent
    return records


def quotas(pid="self"):
    return quota_ancestors(cgroup_membership(pid))


def owned_quota_snapshot(items, previous_memberships=None):
    previous_memberships = previous_memberships or {}
    groups, violations, memberships = {}, [], {}
    for item in items:
        identity = (item['pid'], item['startTicks'])
        try:
            before = process_stat(item['pid'])
            if before['startTicks'] != item['startTicks'] or before['state'] == 'Z':
                continue
            membership = cgroup_membership(item['pid'])
            affinity = len(os.sched_getaffinity(item['pid']))
            if membership not in groups:
                ancestors = quota_ancestors(membership)
                limits = [entry['cpus'] for entry in ancestors if entry['cpus'] is not None and entry['cpus'] > 0]
                groups[membership] = {'membership': membership, 'ancestors': ancestors,
                                      'ancestorCpuLimit': min(limits) if limits else None, 'processes': []}
            after = process_stat(item['pid'])
            if after['startTicks'] != item['startTicks'] or after['state'] == 'Z':
                continue
            final_membership = cgroup_membership(item['pid'])
            if final_membership != membership:
                violations.append({'pid': item['pid'], 'startTicks': item['startTicks'], 'reason': 'membership_changed_during_sample'})
            if identity in previous_memberships and previous_memberships[identity] != membership:
                violations.append({'pid': item['pid'], 'startTicks': item['startTicks'], 'reason': 'owned_process_changed_cgroup'})
            memberships[identity] = membership
            groups[membership]['processes'].append({'pid': item['pid'], 'startTicks': item['startTicks'], 'affinityCpus': affinity})
        except (OSError, ValueError) as error:
            try:
                remains_owned = still_owned(item)
            except OSError:
                remains_owned = True
            if remains_owned:
                violations.append({'pid': item['pid'], 'startTicks': item['startTicks'],
                                   'reason': 'owned_process_quota_unreadable', 'error': type(error).__name__})
    active_groups = [group for group in groups.values() if group['processes']]
    shared = None
    for group in active_groups:
        bounded_paths = {entry['path'] for entry in group['ancestors'] if entry['cpus'] is not None and 0 < entry['cpus'] <= 3}
        shared = bounded_paths if shared is None else shared & bounded_paths
        if group['ancestorCpuLimit'] is None or group['ancestorCpuLimit'] > 3:
            violations.append({'membership': group['membership'], 'reason': 'missing_or_excessive_three_cpu_ancestor'})
    if not active_groups:
        violations.append({'reason': 'no_live_owned_processes_observed'})
    elif not shared:
        violations.append({'reason': 'no_common_shared_three_cpu_ancestor'})
    common = [{'path': path, 'maximumObservedCpuLimit': max(entry['cpus'] for group in active_groups for entry in group['ancestors'] if entry['path'] == path)} for path in sorted(shared or [])]
    return {'valid': not violations, 'groups': active_groups, 'commonSharedAncestors': common,
            'violations': violations, 'memberships': memberships}


def still_owned(item):
    try:
        current = process_stat(item['pid'])
        return current['startTicks'] == item['startTicks'] and current['state'] != 'Z'
    except (FileNotFoundError, ProcessLookupError):
        return False


def stop_owned_tree(p, root_identity, observed, cleanup_errors):
    # Nested finite owners can create their own process groups. Group-only
    # termination misses them. Freeze our exact root briefly, inventory every
    # descendant, and signal only PID/start-time identities we actually owned.
    identities = dict(observed)
    unknown = {}
    def verified_live(item):
        try:
            return still_owned(item)
        except OSError as error:
            identity = (item['pid'], item['startTicks'])
            unknown[identity] = item
            problem = {'pid': item['pid'], 'reason': 'cleanup_identity_unreadable', 'error': type(error).__name__}
            if problem not in cleanup_errors:
                cleanup_errors.append(problem)
            return False
    if verified_live(root_identity):
        os.kill(p.pid, signal.SIGSTOP)
        try:
            final_items = tree(p.pid, root_identity['startTicks'])
        except OwnedInventoryError as error:
            final_items = error.items
            cleanup_errors.extend(error.problems)
        for item in final_items:
            identities[(item['pid'], item['startTicks'])] = item
    for item in reversed(list(identities.values())):
        if verified_live(item):
            try:
                os.kill(item['pid'], signal.SIGTERM)
                if item['pid'] == p.pid:
                    os.kill(item['pid'], signal.SIGCONT)
            except ProcessLookupError:
                pass
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline and any(verified_live(item) for item in identities.values()):
        p.poll()
        time.sleep(0.1)
    for item in identities.values():
        if verified_live(item):
            try:
                os.kill(item['pid'], signal.SIGKILL)
            except ProcessLookupError:
                pass
    try:
        p.wait(timeout=2)
    except subprocess.TimeoutExpired:
        pass
    remaining = {(item['pid'], item['startTicks']): item for item in identities.values() if verified_live(item)}
    remaining.update(unknown)
    return list(remaining.values())


def run(argv, cwd, out, seconds=270):
    out = pathlib.Path(out)
    out.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ)
    tmp = out / 'tmp'
    tmp.mkdir(exist_ok=True)
    for key in ('TMPDIR', 'TMP', 'TEMP'):
        env[key] = str(tmp.resolve())
    started = time.monotonic()
    stamp = utc()
    # The terminal service is moved into its enforced ancestor cgroup shortly
    # after spawn. Wait for that observed policy before starting any CPU work.
    quota_deadline = time.monotonic() + 8
    while True:
        ready_caps = [entry['cpus'] for entry in quotas() if entry['cpus'] is not None]
        if ready_caps and min(ready_caps) <= 3:
            break
        if time.monotonic() >= quota_deadline:
            rec = {'startedUtc': stamp, 'finishedUtc': utc(), 'durationSeconds': round(time.monotonic() - started, 3),
                   'pass': False, 'stopReason': 'enforced_three_cpu_ancestor_not_observed', 'argv': argv}
            (out / 'result.json').write_text(json.dumps(rec, indent=2) + '\n')
            print(json.dumps(rec), flush=True)
            return rec
        time.sleep(0.25)
    quota_ready_seconds = round(time.monotonic() - started, 3)
    ticks_per_second = os.sysconf('SC_CLK_TCK')
    reason = None
    peak = group_peak = pss_peak = count = pss_count = 0
    previous = {}
    memberships = {}
    observed = {}
    quota_failure = None
    cleanup_errors = []
    requested_signals = []
    old_handlers = {sig: signal.getsignal(sig) for sig in (signal.SIGINT, signal.SIGTERM)}
    for sig in old_handlers:
        signal.signal(sig, lambda number, frame: requested_signals.append(number))
    previous_time = started
    next_pss = started
    with (out / 'command.log').open('w') as stream, (out / 'resources.jsonl').open('w') as mon:
        p = subprocess.Popen(argv, cwd=cwd, env=env, stdout=stream, stderr=subprocess.STDOUT, start_new_session=True)
        root_identity = process_stat(p.pid)
        start_ticks = root_identity['startTicks']
        observed[(p.pid, start_ticks)] = root_identity
        try:
            while p.poll() is None:
                sample_start = time.monotonic()
                mem = {line.split(':')[0]: int(line.split()[1]) * 1024
                       for line in pathlib.Path('/proc/meminfo').read_text().splitlines()
                       if line.startswith(('MemTotal:', 'MemAvailable:'))}
                try:
                    current = {(item['pid'], item['startTicks']): item for item in tree(p.pid, start_ticks)}
                    for identity, known in list(observed.items()):
                        if identity not in current and still_owned(known):
                            current.update({(item['pid'], item['startTicks']): item for item in tree(known['pid'], known['startTicks'])})
                except OwnedInventoryError as error:
                    observed.update({(item['pid'], item['startTicks']): item for item in error.items})
                    reason = 'owned_process_inventory_unreadable'
                    quota_failure = {'valid': False, 'violations': error.problems}
                    mon.write(json.dumps({'utc': utc(), 'ownedQuota': quota_failure}) + '\n')
                    mon.flush()
                    break
                except OSError as error:
                    reason = 'owned_process_identity_unreadable'
                    quota_failure = {'valid': False, 'violations': [{'reason': type(error).__name__}]}
                    break
                items = list(current.values())
                observed.update(current)
                group_rss = sum(item['rssBytes'] for item in items)
                group_ticks = sum(item['cpuTicks'] for item in items)
                owner = next((item for item in items if item['pid'] == p.pid), None)
                rss = owner['rssBytes'] if owner else 0
                now_ticks = {(item['pid'], item['startTicks']): item['cpuTicks'] for item in items}
                # Only surviving process identities contribute a delta; exited children
                # can do work between their last sample and exit, so CPU is a lower bound.
                delta = sum(max(0, ticks - previous[key]) for key, ticks in now_ticks.items() if key in previous)
                interval = sample_start - previous_time
                cpu = 100 * delta / ticks_per_second / interval if previous and interval > 0 else None
                previous, previous_time = now_ticks, sample_start
                quota_started = time.monotonic()
                checked = owned_quota_snapshot(items, memberships)
                memberships.update(checked.pop('memberships'))
                if not checked['groups'] and p.poll() is not None:
                    break
                owner_group = next((group for group in checked['groups'] if any(row['pid'] == p.pid for row in group['processes'])), None)
                q = owner_group['ancestors'] if owner_group else []
                caps = [entry['cpus'] for entry in q if entry['cpus'] is not None]
                affinity = next((row['affinityCpus'] for group in checked['groups'] for row in group['processes'] if row['pid'] == p.pid), 0)
                sample = {'utc': utc(), 'elapsedSeconds': round(sample_start - started, 3),
                          'pid': p.pid, 'ownerStartTicks': start_ticks, 'ownerRssBytes': rss,
                          'ownerCpuTicks': owner['cpuTicks'] if owner else 0,
                          'ownedTreeRssBytes': group_rss, 'ownedTreeCpuTicks': group_ticks,
                          'ownedTreeCpuPercent': cpu, 'ownedProcesses': len(items),
                          'cpuQuotaAncestors': q, 'affinityCpus': affinity,
                          'effectiveCpuLimit': min([affinity] + caps) if affinity else None,
                          'ownedQuota': checked, 'quotaScanSeconds': round(time.monotonic() - quota_started, 6), **mem}
                if sample_start >= next_pss:
                    scan = time.monotonic()
                    pss = 0
                    read_count = 0
                    for item in items:
                        try:
                            if process_stat(item['pid'])['startTicks'] != item['startTicks']:
                                continue
                            lines = (PROC_ROOT / str(item['pid']) / 'smaps_rollup').read_text().splitlines()
                            pss += next(int(line.split()[1]) * 1024 for line in lines if line.startswith('Pss:'))
                            read_count += 1
                        except (OSError, StopIteration):
                            pass
                    sample.update(ownedTreePssBytes=pss, pssReadProcesses=read_count,
                                  pssScanSeconds=round(time.monotonic() - scan, 6))
                    pss_peak = max(pss_peak, pss)
                    pss_count += 1
                    next_pss = sample_start + 5
                peak, group_peak = max(peak, rss), max(group_peak, group_rss)
                count += 1
                sample['sampleSeconds'] = round(time.monotonic() - sample_start, 6)
                mon.write(json.dumps(sample) + '\n')
                mon.flush()
                if not checked['valid']:
                    reason = 'owned_process_shared_cpu_quota_policy_failed'
                    quota_failure = checked
                    break
                if requested_signals:
                    reason = 'signal_' + str(requested_signals[-1])
                    break
                if time.monotonic() - started > seconds:
                    reason = 'deadline'
                    break
                if mem['MemAvailable'] < 1024**3:
                    reason = 'host_available_memory_floor'
                    break
                time.sleep(max(0, 1 - (time.monotonic() - sample_start)))
        finally:
            live_children = []
            for item in observed.values():
                if item['pid'] == p.pid:
                    continue
                try:
                    if still_owned(item):
                        live_children.append(item)
                except OSError as error:
                    live_children.append(item)
                    cleanup_errors.append({'pid': item['pid'], 'reason': 'final_owned_identity_unreadable', 'error': type(error).__name__})
            remaining = []
            if p.poll() is None or live_children:
                if p.poll() is not None and live_children and reason is None:
                    reason = 'owned_descendants_outlived_owner'
                remaining = stop_owned_tree(p, root_identity, observed, cleanup_errors)
            for sig, handler in old_handlers.items():
                signal.signal(sig, handler)
    rec = {'startedUtc': stamp, 'finishedUtc': utc(),
           'durationSeconds': round(time.monotonic() - started, 3), 'argv': argv, 'cwd': str(cwd),
           'exitCode': p.returncode, 'stopReason': reason, 'ownedProcessesRemaining': len(remaining), 'cleanupInventoryErrors': cleanup_errors, 'ownerPeakRssBytes': peak,
           'ownedTreePeakRssBytes': group_peak, 'ownedTreePeakPssBytes': pss_peak,
           'resourceSamples': count, 'pssSamples': pss_count, 'quotaReadySeconds': quota_ready_seconds,
           'quotaPolicy': 'all observed live owned processes must retain one common shared ancestor capped at most three CPUs; membership changes fail closed',
           'quotaFailure': quota_failure,
           'resourceScope': 'owned descendant tree; RSS may count shared pages repeatedly; CPU deltas omit work after an exited process last sample',
           'sampling': {'cpuRssAvailableRamQuotaSeconds': 1, 'pssSeconds': 5, 'pssPeakIsSampledLowerBound': True},
           'pass': p.returncode == 0 and reason is None and not remaining and not cleanup_errors}
    (out / 'result.json').write_text(json.dumps(rec, indent=2) + '\n')
    print(json.dumps({key: rec[key] for key in ['startedUtc', 'durationSeconds', 'exitCode', 'stopReason', 'ownedTreePeakRssBytes', 'ownedTreePeakPssBytes', 'resourceSamples', 'pass']}), flush=True)
    return rec


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--cwd')
    parser.add_argument('--out')
    parser.add_argument('--check-tree', type=int)
    parser.add_argument('--seconds', type=int, default=270)
    parser.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if args.check_tree is not None:
        if args.check_tree <= 0:
            parser.error('positive owned process root required')
        try:
            inventory = tree(args.check_tree)
            snapshot = owned_quota_snapshot(inventory)
        except OwnedInventoryError as error:
            snapshot = owned_quota_snapshot(error.items)
            snapshot['valid'] = False
            snapshot['violations'].extend(error.problems)
        snapshot.pop('memberships')
        print(json.dumps(snapshot), flush=True)
        raise SystemExit(0 if snapshot['valid'] else 1)
    if not args.cwd or not args.out or not args.command:
        parser.error('--cwd, --out and an owned command are required')
    command = args.command[1:] if args.command[:1] == ['--'] else args.command
    raise SystemExit(0 if run(command, args.cwd, args.out, args.seconds)['pass'] else 1)
