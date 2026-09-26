#!/usr/bin/env python3
"""Build an isolated, hash-guarded Aurora readiness guest test archive."""
import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path

TASK = Path('/mnt/p6/build/aurora-ready-20260926')
HELPER_SHA = '2c54b0b87a88366086672b3e199f886863082951a54c34ef01c2dcc6a015a2c3'
SOURCE_SHA = '6c7fad946e53f977bc6d55a80323f7ec6a9fa84858d1a245fe0916e2f6d17e65'
WM_LINE = b"  /bin/su -s /bin/sh -c 'export HOME=/home/admin USER=admin LOGNAME=admin DISPLAY=:0; exec /bin/aurora-wm --compositor=no' admin\n"
# All diagnostics stay on the console; no guest test files or home mutations.
# Run the whole diagnostic block as admin so $! names the helper itself.
DIAGNOSTIC = b'''  # Isolated readiness test: production Firefox sleep remains untouched.
  /bin/su -s /bin/sh -c '
    export HOME=/home/admin USER=admin LOGNAME=admin DISPLAY=:0
    qa_stamp() {
      read qa_uptime qa_rest < /proc/uptime
      echo "AURORA_QA $* uptime=$qa_uptime" >&2
    }
    qa_stamp BEGIN self
    /bin/wait-for-aurora --self-test-timeout
    qa_status=$?
    qa_stamp END self status=$qa_status
    [ "$qa_status" -eq 0 ] || exit 81
    qa_stamp BEGIN missing
    DISPLAY=:99 /bin/wait-for-aurora
    qa_status=$?
    qa_stamp END missing status=$qa_status
    [ "$qa_status" -eq 0 ] || exit 82
    qa_stamp BEGIN before
    DISPLAY=:0 /bin/wait-for-aurora &
    qa_helper_pid=$!
    qa_stamp HELPER_STARTED pid=$qa_helper_pid
    sleep 1
    if ! kill -0 "$qa_helper_pid" 2>/dev/null; then
      qa_stamp FAIL helper_exited_before_aurora
      exit 83
    fi
    qa_stamp HELPER_PENDING pid=$qa_helper_pid
    qa_stamp AURORA_LAUNCH
    /bin/aurora-wm --compositor=no &
    qa_wm_pid=$!
    wait "$qa_helper_pid"
    qa_status=$?
    qa_stamp END before status=$qa_status
    [ "$qa_status" -eq 0 ] || exit 84
    qa_stamp BEGIN ready
    DISPLAY=:0 /bin/wait-for-aurora
    qa_status=$?
    qa_stamp END ready status=$qa_status
    [ "$qa_status" -eq 0 ] || exit 85
    qa_stamp DONE
    wait "$qa_wm_pid"
  ' admin
'''


def digest(data):
    return hashlib.sha256(data).hexdigest()


def records(data):
    offset = 0
    while True:
        start = offset
        header = data[offset:offset + 110]
        if len(header) != 110 or header[:6] != b'070701':
            raise ValueError('invalid newc header')
        size, namesize = int(header[54:62], 16), int(header[94:102], 16)
        if not 1 <= namesize <= 4096:
            raise ValueError('invalid newc name length')
        offset += 110
        name = data[offset:offset + namesize]
        offset += namesize
        offset += (-offset) % 4
        body = data[offset:offset + size]
        offset += size + (-size) % 4
        if len(body) != size or not name.endswith(b'\0') or offset > len(data):
            raise ValueError('truncated newc record')
        key = name[:-1].decode().removeprefix('./').lstrip('/')
        yield key, header, name, body, data[start:offset]
        if key == 'TRAILER!!!':
            return


def record(header, name, body):
    header = header[:54] + f'{len(body):08x}'.encode() + header[62:94] + f'{len(name):08x}'.encode() + header[102:]
    return header + name + b'\0' * (-(110 + len(name)) % 4) + body + b'\0' * (-len(body) % 4)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--helper', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    out = args.output.resolve()
    scratch = Path(os.environ.get('TMPDIR', '/nonexistent')).resolve()
    if not out.is_relative_to(TASK) or out == TASK or out.exists():
        parser.error('output must be fresh and below ' + str(TASK))
    if not scratch.is_relative_to(TASK) or not scratch.is_dir():
        parser.error('export TMPDIR to an existing task scratch directory')
    source, helper = args.source.read_bytes(), args.helper.read_bytes()
    if digest(source) != SOURCE_SHA or digest(helper) != HELPER_SHA:
        parser.error('accepted archive or pinned helper hash mismatch')
    raw = gzip.decompress(source)
    original = list(records(raw))
    tail = raw[sum(len(r[4]) for r in original):]
    chunks, init_before, init_after = [], None, None
    for key, header, name, body, encoded in original:
        if key == 'init':
            if init_before is not None or body.count(WM_LINE) != 1:
                raise ValueError('init or Aurora launch anchor not unique')
            init_before = body
            init_after = body.replace(WM_LINE, DIAGNOSTIC)
            if init_after.replace(DIAGNOSTIC, WM_LINE) != body:
                raise ValueError('unintended init change')
            chunks.append(record(header, name, init_after))
        elif key == 'TRAILER!!!':
            helper_name = b'bin/wait-for-aurora\0'
            fields = [0x7ffffffe, 0o100755, 0, 0, 1, 0, len(helper), 0, 0, 0, 0, len(helper_name), 0]
            helper_header = b'070701' + b''.join(f'{n:08x}'.encode() for n in fields)
            chunks.extend([record(helper_header, helper_name, helper), encoded])
        else:
            chunks.append(encoded)
    if init_before is None:
        raise ValueError('missing init')
    candidate = b''.join(chunks) + tail
    after = list(records(candidate))
    old, new = ({r[0]: r[4] for r in entries} for entries in (original, after))
    if len(old) != len(original) or len(new) != len(after):
        raise ValueError('duplicate archive path')
    if set(new) - set(old) != {'bin/wait-for-aurora'} or set(old) - set(new):
        raise ValueError('unexpected archive paths')
    if [k for k in old if old[k] != new[k]] != ['init']:
        raise ValueError('unexpected changed record')
    if [r[0] for r in after if r[0] != 'bin/wait-for-aurora'] != [r[0] for r in original]:
        raise ValueError('original record order changed')
    encoded = gzip.compress(candidate, compresslevel=6, mtime=0)
    report = dict(passPackage=True, testOnly=True, sourceSha256=SOURCE_SHA, helperSha256=HELPER_SHA,
                  archiveSha256=digest(encoded), bytes=len(encoded), uncompressedBytes=len(candidate),
                  unchangedOriginalRecords=len(original)-1, modified=['init'], added=['bin/wait-for-aurora'],
                  originalOrderPreserved=True, tailPreserved=True, initOutsideSubstitutionPreserved=True,
                  productionSleepUnchanged=True, source=str(args.source.resolve()), helper=str(args.helper.resolve()))
    out.mkdir(parents=True)
    (out / 'initramfs-firefox.cpio.gz').write_bytes(encoded)
    (out / 'init.before.sh').write_bytes(init_before)
    (out / 'init.after.sh').write_bytes(init_after)
    (out / 'package.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report))


if __name__ == '__main__':
    main()
