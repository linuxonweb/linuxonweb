#!/usr/bin/env python3
"""Finite process-group supervisor for this mutable preparation packet."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import time


def members(pgid):
    found = []
    for path in Path('/proc').glob('[0-9]*/stat'):
        try:
            fields = path.read_text().rsplit(')', 1)[1].split()
            if int(fields[2]) == pgid:
                found.append({'pid': int(path.parent.name), 'state': fields[0]})
        except (FileNotFoundError, ProcessLookupError, PermissionError):
            pass
    return found


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--task', type=Path, required=True)
    ap.add_argument('--label', required=True)
    ap.add_argument('--seconds', type=int, default=30)
    ap.add_argument('command', nargs=argparse.REMAINDER)
    args = ap.parse_args()
    task = args.task.resolve()
    assert str(task).startswith('/mnt/p6/build/')
    assert re.fullmatch('[A-Za-z0-9_-]+', args.label)
    assert 1 <= args.seconds <= 600 and args.command
    assert subprocess.check_output(['findmnt', '-T', str(task), '-no', 'FSTYPE'], text=True).strip() == 'ext4'
    for key in ('TMPDIR', 'TMP', 'TEMP'):
        assert Path(os.environ[key]).resolve().is_relative_to(task)
    assert shutil.disk_usage(task).free >= 8 * 1024**3
    output = task / 'supervision' / args.label
    output.mkdir(parents=True)
    source = Path(__file__).resolve()
    (output / source.name).write_bytes(source.read_bytes())
    start = time.monotonic()
    timed_out = False
    with (output / 'output.log').open('wb') as stream:
        p = subprocess.Popen(args.command, stdout=stream, stderr=subprocess.STDOUT,
                             start_new_session=True)
        (output / 'live.json').write_text(json.dumps({'pid': p.pid, 'pgid': p.pid, 'argv': args.command}) + '\n')
        try:
            code = p.wait(timeout=args.seconds)
        except subprocess.TimeoutExpired:
            timed_out = True
            os.killpg(p.pid, signal.SIGTERM)
            try:
                code = p.wait(timeout=2)
            except subprocess.TimeoutExpired:
                os.killpg(p.pid, signal.SIGKILL)
                code = p.wait(timeout=2)
        if members(p.pid):
            os.killpg(p.pid, signal.SIGKILL)
            time.sleep(0.05)
    result = {'argv': args.command, 'cwd': os.getcwd(), 'exit': code, 'pid': p.pid,
              'pgid': p.pid, 'timedOut': timed_out, 'seconds': time.monotonic() - start,
              'terminalMembers': members(p.pid), 'freeBytes': shutil.disk_usage(task).free,
              'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest()}
    (output / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result))
    assert not result['terminalMembers'] and result['freeBytes'] > 5 * 1024**3
    raise SystemExit(code)


if __name__ == '__main__':
    main()
