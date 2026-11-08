"""Owned disk paths for preparation and reviewed native launch (no acceptance)."""
import os
from pathlib import Path
import stat
import subprocess
import sys

# The existing acquisition/supervision assertions must never disappear under -O.
if sys.flags.optimize:
    raise RuntimeError("native route requires Python assertions enabled")

BUILD_PARENTS = tuple(Path(p) for p in (
    '/mnt/p6/project/build', '/mnt/p6/build', '/mnt/p3/codex-build'))
_MEMORY_FILESYSTEMS = {'1021994', '858458f6'}  # tmpfs, ramfs


def owned_directory(value, device=None):
    p = Path(value)
    if not p.is_absolute() or p.resolve(strict=True) != p:
        raise ValueError('canonical absolute owned directory required')
    before = p.lstat()
    if not stat.S_ISDIR(before.st_mode) or before.st_uid != os.getuid() or before.st_mode & 0o022:
        raise ValueError('directory must be owned by actual UID and not group/world writable')
    if device is not None and before.st_dev != device:
        raise ValueError('owned path must stay on task filesystem')
    filesystem = subprocess.check_output(['stat', '-f', '-c', '%t', '--', str(p)], text=True, timeout=5).strip().lower()
    if filesystem in _MEMORY_FILESYSTEMS:
        raise ValueError('disk-backed directory required')
    after = p.lstat()
    if p.resolve(strict=True) != p or (before.st_dev, before.st_ino, before.st_uid, before.st_mode) != (after.st_dev, after.st_ino, after.st_uid, after.st_mode):
        raise ValueError('owned directory identity changed during validation')
    return p


def task_root(value):
    p = Path(value)
    if p.parent not in BUILD_PARENTS or not p.name:
        raise ValueError('task root must be a direct child of an approved disk build parent')
    parent = owned_directory(p.parent)
    return owned_directory(p, parent.stat().st_dev)


def scoped_path(root, value, *, fresh=False, directory=False):
    root = task_root(root)
    p = Path(value)
    if not p.is_absolute() or p == root or not p.is_relative_to(root) or p.resolve() != p:
        raise ValueError('canonical contained task path required')
    device = root.stat().st_dev
    parent = p.parent
    while parent != root:
        owned_directory(parent, device)
        parent = parent.parent
    try:
        existing = p.lstat()
    except FileNotFoundError:
        existing = None
    if fresh and existing is not None:
        raise ValueError('fresh task output must not already exist, including symlinks')
    if directory:
        owned_directory(p, device)
    elif existing is not None and (existing.st_uid != os.getuid() or existing.st_dev != device or stat.S_ISLNK(existing.st_mode)):
        raise ValueError('existing task path identity/ownership mismatch')
    return p


def root_for_output(value):
    p = Path(value)
    for parent in BUILD_PARENTS:
        if p.is_relative_to(parent):
            parts = p.relative_to(parent).parts
            if len(parts) >= 2:
                return task_root(parent / parts[0])
    raise ValueError('output must be inside an owned disk task root')
