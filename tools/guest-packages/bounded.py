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


def utc():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def process_stat(pid):
    fields = (pathlib.Path('/proc') / str(pid) / 'stat').read_text().rsplit(')', 1)[1].split()
    return {'pid': pid, 'state': fields[0], 'startTicks': int(fields[19]),
            'rssBytes': int(fields[21]) * os.sysconf('SC_PAGE_SIZE'),
            'cpuTicks': int(fields[11]) + int(fields[12])}


def tree(root_pid):
    result = []
    queue = [root_pid]
    seen = set()
    while queue:
        pid = queue.pop()
        if pid in seen:
            continue
        seen.add(pid)
        try:
            item = process_stat(pid)
            result.append(item)
            children = pathlib.Path('/proc') / str(pid) / 'task' / str(pid) / 'children'
            queue.extend(map(int, children.read_text().split()))
        except (FileNotFoundError, ProcessLookupError, PermissionError):
            pass
    return result


def quotas(pid="self"):
    records = []
    for entry in (pathlib.Path("/proc") / str(pid) / "cgroup").read_text().splitlines():
        if not entry.startswith('0::'):
            continue
        path = pathlib.Path('/sys/fs/cgroup') / entry.split('::', 1)[1].lstrip('/')
        while True:
            try:
                value = (path / 'cpu.max').read_text().strip()
                quota, period = value.split()
                records.append({'path': str(path), 'cpuMax': value,
                                'cpus': None if quota == 'max' else int(quota) / int(period)})
            except (OSError, ValueError):
                pass
            if path == pathlib.Path('/sys/fs/cgroup'):
                break
            if pathlib.Path('/sys/fs/cgroup') not in path.parents:
                break
            path = path.parent
    return records


def still_owned(item):
    try:
        current = process_stat(item['pid'])
        return current['startTicks'] == item['startTicks'] and current['state'] != 'Z'
    except (FileNotFoundError, ProcessLookupError):
        return False


def stop_owned_tree(p, root_identity, observed):
    # Nested finite owners can create their own process groups. Group-only
    # termination misses them. Freeze our exact root briefly, inventory every
    # descendant, and signal only PID/start-time identities we actually owned.
    identities = dict(observed)
    if still_owned(root_identity):
        os.kill(p.pid, signal.SIGSTOP)
        for item in tree(p.pid):
            identities[(item['pid'], item['startTicks'])] = item
    for item in reversed(list(identities.values())):
        if still_owned(item):
            try:
                os.kill(item['pid'], signal.SIGTERM)
                if item['pid'] == p.pid:
                    os.kill(item['pid'], signal.SIGCONT)
            except ProcessLookupError:
                pass
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline and any(still_owned(item) for item in identities.values()):
        p.poll()
        time.sleep(0.1)
    for item in identities.values():
        if still_owned(item):
            try:
                os.kill(item['pid'], signal.SIGKILL)
            except ProcessLookupError:
                pass
    try:
        p.wait(timeout=2)
    except subprocess.TimeoutExpired:
        pass
    return [item for item in identities.values() if still_owned(item)]


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
    observed = {}
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
                items = tree(p.pid)
                observed.update({(item['pid'], item['startTicks']): item for item in items})
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
                q = quotas(p.pid) if owner else quotas()
                caps = [item['cpus'] for item in q if item['cpus'] is not None]
                affinity = len(os.sched_getaffinity(p.pid)) if owner else len(os.sched_getaffinity(0))
                sample = {'utc': utc(), 'elapsedSeconds': round(sample_start - started, 3),
                          'pid': p.pid, 'ownerStartTicks': start_ticks, 'ownerRssBytes': rss,
                          'ownerCpuTicks': owner['cpuTicks'] if owner else 0,
                          'ownedTreeRssBytes': group_rss, 'ownedTreeCpuTicks': group_ticks,
                          'ownedTreeCpuPercent': cpu, 'ownedProcesses': len(items),
                          'cpuQuotaAncestors': q, 'affinityCpus': affinity,
                          'effectiveCpuLimit': min([affinity] + caps), **mem}
                if sample_start >= next_pss:
                    scan = time.monotonic()
                    pss = 0
                    read_count = 0
                    for item in items:
                        try:
                            if process_stat(item['pid'])['startTicks'] != item['startTicks']:
                                continue
                            lines = (pathlib.Path('/proc') / str(item['pid']) / 'smaps_rollup').read_text().splitlines()
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
            live_children = [item for item in observed.values() if item['pid'] != p.pid and still_owned(item)]
            remaining = []
            if p.poll() is None or live_children:
                if p.poll() is not None and live_children and reason is None:
                    reason = 'owned_descendants_outlived_owner'
                remaining = stop_owned_tree(p, root_identity, observed)
            for sig, handler in old_handlers.items():
                signal.signal(sig, handler)
    rec = {'startedUtc': stamp, 'finishedUtc': utc(),
           'durationSeconds': round(time.monotonic() - started, 3), 'argv': argv, 'cwd': str(cwd),
           'exitCode': p.returncode, 'stopReason': reason, 'ownedProcessesRemaining': len(remaining), 'ownerPeakRssBytes': peak,
           'ownedTreePeakRssBytes': group_peak, 'ownedTreePeakPssBytes': pss_peak,
           'resourceSamples': count, 'pssSamples': pss_count, 'quotaReadySeconds': quota_ready_seconds,
           'resourceScope': 'owned descendant tree; RSS may count shared pages repeatedly; CPU deltas omit work after an exited process last sample',
           'sampling': {'cpuRssAvailableRamQuotaSeconds': 1, 'pssSeconds': 5, 'pssPeakIsSampledLowerBound': True},
           'pass': p.returncode == 0 and reason is None and not remaining}
    (out / 'result.json').write_text(json.dumps(rec, indent=2) + '\n')
    print(json.dumps({key: rec[key] for key in ['startedUtc', 'durationSeconds', 'exitCode', 'stopReason', 'ownedTreePeakRssBytes', 'ownedTreePeakPssBytes', 'resourceSamples', 'pass']}), flush=True)
    return rec


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--cwd', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--seconds', type=int, default=270)
    parser.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ['--'] else args.command
    raise SystemExit(0 if run(command, args.cwd, args.out, args.seconds)['pass'] else 1)
