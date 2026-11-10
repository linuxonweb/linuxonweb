"""Read a reviewed input closure without writes or unchecked copytree traversal."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import stat


def need(ok, message):
    if not ok:
        raise ValueError(message)


def identity(st):
    return (st.st_dev, st.st_ino, st.st_mode, st.st_uid, st.st_size,
            st.st_mtime_ns, st.st_ctime_ns)


def relative(value):
    p = PurePosixPath(value)
    need(isinstance(value, str) and value and not p.is_absolute() and
         str(p) == value and '..' not in p.parts and '.' not in p.parts,
         'noncanonical closure path: ' + str(value))
    return p


def read_pinned(path, expected, *, retain=True, resolved=None):
    """Hash the opened regular file once; return the very bytes that were checked.

    Mutable packet/dependency files cannot contain path symlinks. Explicitly
    pinned immutable toolchain aliases may resolve to their recorded target.
    The descriptor and pathname must retain the same identity across the read.
    """
    path = Path(path)
    target = Path(resolved) if resolved is not None else path
    need(path.is_absolute() and target.is_absolute(), 'absolute input path required')
    need(path.resolve(strict=True) == target and target.resolve(strict=True) == target,
         'input path is a symlink or changed target: ' + str(path))
    descriptor = os.open(target, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC | os.O_NONBLOCK)
    try:
        before = os.fstat(descriptor)
        need(stat.S_ISREG(before.st_mode), 'input is not a regular file: ' + str(path))
        if expected.get('owned'):
            need(before.st_uid == os.getuid(), 'input is no longer owned: ' + str(path))
        need(before.st_size == expected['bytes'], 'input size changed: ' + str(path))
        if 'mode' in expected:
            need(stat.S_IMODE(before.st_mode) == expected['mode'], 'input mode changed: ' + str(path))
        digest = hashlib.sha256()
        chunks = [] if retain else None
        while chunk := os.read(descriptor, 1024 * 1024):
            digest.update(chunk)
            if retain:
                chunks.append(chunk)
        need(identity(before) == identity(os.fstat(descriptor)) == identity(target.lstat()),
             'input changed while reading: ' + str(path))
        need(path.resolve(strict=True) == target, 'input alias changed while reading: ' + str(path))
        need(digest.hexdigest() == expected['sha256'], 'input digest changed: ' + str(path))
        return (b''.join(chunks) if retain else None), (target, identity(before))
    finally:
        os.close(descriptor)


def inventory(root):
    """Exact regular-file and directory membership; never follow a tree symlink."""
    root = Path(root)
    need(root.resolve(strict=True) == root and stat.S_ISDIR(root.lstat().st_mode),
         'closure tree root is not a canonical directory: ' + str(root))
    files, directories = [], ['.']
    pending = [root]
    while pending:
        directory = pending.pop()
        for child in sorted(directory.iterdir()):
            mode = child.lstat().st_mode
            rel = child.relative_to(root).as_posix()
            if stat.S_ISDIR(mode):
                directories.append(rel)
                pending.append(child)
            elif stat.S_ISREG(mode):
                files.append(rel)
            else:
                raise ValueError('nonregular closure tree member: ' + str(child))
    return sorted(files), sorted(directories)


class VerifiedClosure:
    """A fixed-digest manifest is authority, never the mutable input's own claim."""
    def __init__(self, path, expected_sha, roots):
        self.path = Path(path)
        raw, manifest_identity = read_pinned(self.path, {
            'bytes': self.path.lstat().st_size, 'sha256': expected_sha})
        self.manifest = json.loads(raw)
        need(self.manifest['schema'] == 'reviewed-final159-preparation-inputs-v1', 'unknown closure schema')
        self.manifest_pin = {'path': str(self.path), 'bytes': len(raw), 'sha256': expected_sha}
        self.roots = {name: Path(root) for name, root in roots.items()}
        self.rows, self.cached, self.identities = {}, {}, {self.path: manifest_identity}
        self.aliases = {}
        self.verified = False
        for group, rows in self.manifest['files'].items():
            need(group in self.roots or group == 'external', 'unknown closure root: ' + group)
            for row in rows:
                key = (group, row['path'])
                need(key not in self.rows, 'duplicate closure input: ' + str(key))
                self.rows[key] = row
                if group == 'external':
                    need(Path(row['path']).is_absolute(), 'external closure path must be absolute')
                else:
                    relative(row['path'])

    def path_for(self, group, name):
        return Path(name) if group == 'external' else self.roots[group] / relative(name)

    def pin(self, group, name):
        row = self.rows[(group, name)]
        result = {'path': str(self.path_for(group, name)), 'bytes': row['bytes'], 'sha256': row['sha256']}
        if 'resolvedPath' in row:
            result['resolvedPath'] = row['resolvedPath']
        return result

    def check_trees(self):
        for tree in self.manifest['trees']:
            group, name = tree['root'], tree['path']
            relative(name)
            actual_files, actual_directories = inventory(self.path_for(group, name))
            expected_files = sorted(str(PurePosixPath(path).relative_to(name))
                                    for root, path in self.rows if root == group and
                                    PurePosixPath(path).is_relative_to(name))
            need(actual_files == expected_files and actual_directories == tree['directories'],
                 'closure tree membership changed: ' + group + ':' + name)

    def check_missing(self):
        for row in self.manifest['missing']:
            path = self.path_for(row['root'], row['path'])
            need(not path.exists() and not path.is_symlink(),
                 'declared missing input now exists; review a new closure: ' + str(path))

    def verify(self):
        self.check_trees()
        self.check_missing()
        for (group, name), row in self.rows.items():
            path = self.path_for(group, name)
            # Git records executable bits, not private checkout umasks. These
            # repository inputs are read-only bytes, never copied or executed;
            # their recorded mode is observational. Packet modes remain strict.
            expected = {k: v for k, v in row.items() if k != 'mode'} if group == 'repository' else row
            data, observed = read_pinned(path, expected, retain=row.get('retain', False),
                                        resolved=row.get('resolvedPath'))
            self.identities[path] = observed
            if row.get('resolvedPath'):
                self.aliases[path] = Path(row['resolvedPath'])
            if data is not None:
                self.cached[(group, name)] = data
        self.assert_unchanged()
        self.verified = True
        return self

    def assert_unchanged(self):
        for path, (target, observed) in self.identities.items():
            need(path.resolve(strict=True) == target and identity(target.lstat()) == observed,
                 'verified input changed before preparation: ' + str(path))
        self.check_trees()
        self.check_missing()

    def bytes(self, group, name):
        need(self.verified, 'closure has not been verified')
        return self.cached[(group, name)]

    def text(self, group, name):
        return self.bytes(group, name).decode('utf-8')

    def json(self, group, name):
        return json.loads(self.bytes(group, name))

    def copy_tree(self, group, name, destination):
        """Write only cached verified members; input trees are never reread."""
        need(self.verified, 'closure has not been verified')
        tree = next(t for t in self.manifest['trees'] if (t['root'], t['path']) == (group, name))
        destination = Path(destination)
        for directory in sorted(tree['directories'], key=lambda p: (len(PurePosixPath(p).parts), p)):
            (destination / directory).mkdir(mode=0o700)
        for root, path in sorted(self.rows):
            if root == group and PurePosixPath(path).is_relative_to(name):
                target = destination / PurePosixPath(path).relative_to(name)
                target.write_bytes(self.bytes(root, path))
                target.chmod(self.rows[(root, path)]['mode'])
