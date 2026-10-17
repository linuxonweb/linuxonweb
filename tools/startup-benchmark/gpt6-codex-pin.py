import hashlib
import os
from pathlib import Path


def stable_stat(value):
    fields = ['st_size', 'st_mtime_ns', 'st_ctime_ns', 'st_ino', 'st_dev',
              'st_mode', 'st_uid', 'st_gid', 'st_nlink']
    return {field: getattr(value, field) for field in fields}


def pin(filename):
    filename = Path(filename)
    before = stable_stat(filename.stat())
    with filename.open('rb') as stream:
        opened = stable_stat(os.fstat(stream.fileno()))
        assert opened == before, {'path': str(filename), 'before': before, 'opened': opened}
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
        finished = stable_stat(os.fstat(stream.fileno()))
    after = stable_stat(filename.stat())
    assert before == finished == after, {'path': str(filename), 'before': before, 'finished': finished, 'after': after}
    return {'sha256': digest, 'bytes': after['st_size'], 'mtimeNs': after['st_mtime_ns'],
            'ctimeNs': after['st_ctime_ns'], 'inode': after['st_ino'], 'device': after['st_dev']}
