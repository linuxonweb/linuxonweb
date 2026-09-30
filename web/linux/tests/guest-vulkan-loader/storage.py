"""Shared disk-backed output guard; no implicit scratch directory."""
import os
from pathlib import Path

TASKS = (Path('/mnt/p6/build/guest-vulkan-a5-20260929'), Path('/mnt/p6/build/guest-vulkan-a4-20260929'), Path('/mnt/p6/build/guest-vulkan-a3-20260928'), Path('/mnt/p6/build/guest-vulkan-a1a2-20260928'), Path('/mnt/p6/build/guest-vulkan-compute-20260926'), Path('/mnt/p6/build/guest-vulkan-loader-20260926'),)

def checked_storage(output):
    output = Path(output).resolve()
    task = next((root for root in TASKS if output.is_relative_to(root) and output != root), None)
    if task is None:
        raise ValueError('output must be a new child of an explicit guest-vulkan task root')
    def filesystem(path):
        path = Path(path).resolve()
        entries = []
        for line in Path('/proc/self/mountinfo').read_text().splitlines():
            fields, fs = line.split(' - ', 1)
            mount = Path(fields.split()[4].replace('\\040', ' '))
            if path == mount or path.is_relative_to(mount):
                entries.append((len(str(mount)), str(mount), fs.split()[0]))
        if not entries:
            raise ValueError('cannot establish output filesystem')
        _, mount, kind = max(entries)
        if kind in ('tmpfs', 'ramfs'):
            raise ValueError('memory filesystem prohibited: ' + str(path))
        ancestor = path
        while not ancestor.exists():
            ancestor = ancestor.parent
        stats = os.statvfs(ancestor)
        free = stats.f_bavail * stats.f_frsize
        if free < 1024**3:
            raise ValueError('less than 1 GiB free on disk-backed output filesystem')
        return {'mount': mount, 'type': kind, 'availableBytes': free}
    scratch = {}
    for name in ('TMPDIR', 'TMP', 'TEMP'):
        value = os.environ.get(name)
        if not value:
            raise ValueError(name + ' must be exported explicitly')
        path = Path(value).resolve()
        if not path.is_relative_to(task) or not path.is_dir():
            raise ValueError(name + ' must exist under ' + str(task))
        filesystem(path)
        scratch[name] = str(path)
    return output, {'output': str(output), 'filesystem': filesystem(output), 'scratch': scratch}
