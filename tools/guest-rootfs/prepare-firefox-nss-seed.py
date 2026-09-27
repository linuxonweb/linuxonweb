#!/usr/bin/env python3
"""Prepare a CA-only seed from an owned, stopped Firefox test profile.

Never run against a user's profile. Output must be a new disk-backed directory.
Preserve authenticated trust and its password metadata, but never distribute
the test profile's SDR/password-encryption key (including SQLite free pages).
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import sqlite3

if not __debug__:
    raise RuntimeError('Run without -O: seed validation must not be disabled')


def read_db(path):
    for suffix in ('-wal', '-journal'):
        sidecar = Path(str(path) + suffix)
        if sidecar.exists() and sidecar.stat().st_size:
            raise ValueError(f'Uncheckpointed database: {path}')
    return sqlite3.connect(f'{path.resolve().as_uri()}?mode=ro', uri=True)


def prepare(original, source, output):
    with read_db(original / 'cert9.db') as db:
        roots = dict(db.execute("SELECT a3,a11 FROM nssPublic WHERE hex(a0)='00000001'"))
    assert len(roots) == 119 and all(n.startswith(b'lowland-ca-') for n in roots)
    with read_db(source / 'cert9.db') as db:
        assert db.execute('PRAGMA integrity_check').fetchone() == ('ok',)
        certs = dict(db.execute("SELECT a3,a11 FROM nssPublic WHERE hex(a0)='00000001'"))
        assert all(certs.get(n) == der for n, der in roots.items())
        trust = db.execute("SELECT * FROM nssPublic WHERE hex(a0)='CE534353' ORDER BY id").fetchall()
        hashes = {r[0] for r in db.execute("SELECT ace5363b4 FROM nssPublic WHERE hex(a0)='CE534353'")}
        assert len(trust) == 119 and hashes == {hashlib.sha1(d).digest() for d in roots.values()}
        assert {r[0] for r in db.execute('SELECT DISTINCT hex(a0) FROM nssPublic')} == {'00000001', '0000000B', 'CE534353'}
    with read_db(source / 'key4.db') as db:
        assert db.execute('PRAGMA integrity_check').fetchone() == ('ok',)
        keys = db.execute('SELECT id,hex(a0),hex(a100),hex(a102) FROM nssPrivate').fetchall()
        # The only removable key is the default SDR key identified in pk11sdr.c.
        # Any other private/secret object means this is not a suitable seed source.
        assert len(keys) <= 1
        assert all(row[1:] == ('00000004', '00000015', 'F8000000000000000000000000000001') for row in keys)
        metadata = db.execute('SELECT * FROM metaData ORDER BY id').fetchall()
        prefixes = tuple(f'sig_key_{row[0]:08x}_' for row in keys)
        retained_metadata = [r for r in metadata if not r[0].startswith(prefixes)]
        assert not any(r[0].startswith('sig_key_') for r in retained_metadata)
    output.mkdir()  # Refuse to overwrite a prior artifact or an existing profile.
    for name in ('cert9.db', 'key4.db', 'pkcs11.txt'):
        shutil.copy2(source / name, output / name)
    with sqlite3.connect(output / 'cert9.db') as db:
        db.execute('PRAGMA secure_delete=ON')
        for rowid, name in db.execute("SELECT id,a3 FROM nssPublic WHERE hex(a0)='00000001'").fetchall():
            if name not in roots:
                db.execute('DELETE FROM nssPublic WHERE id=?', (rowid,))
        db.commit()
        db.execute('VACUUM')
        assert db.execute("SELECT * FROM nssPublic WHERE hex(a0)='CE534353' ORDER BY id").fetchall() == trust
        assert dict(db.execute("SELECT a3,a11 FROM nssPublic WHERE hex(a0)='00000001'")) == roots
        assert db.execute('PRAGMA integrity_check').fetchone() == ('ok',)
    with sqlite3.connect(output / 'key4.db') as db:
        db.execute('PRAGMA secure_delete=ON')
        db.execute('DELETE FROM nssPrivate')
        for row in metadata:
            if row[0].startswith(prefixes):
                db.execute('DELETE FROM metaData WHERE id=?', (row[0],))
        db.commit()
        db.execute('VACUUM')
        assert db.execute('SELECT COUNT(*) FROM nssPrivate').fetchone() == (0,)
        assert db.execute('SELECT * FROM metaData ORDER BY id').fetchall() == retained_metadata
        assert db.execute('PRAGMA integrity_check').fetchone() == ('ok',)
    report = dict(candidateOnly=True, runtimeVerified=False, certificates=len(roots),
                  nativeTrustRecords=len(trust), removedSDRKeys=len(keys), privateObjects=0,
                  droppedIntermediates=len(certs)-len(roots), secureDeleteAndVacuum=True,
                  authenticatedTrustUnchanged=True, passwordMetadataUnchanged=True)
    report['files'] = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in output.iterdir()}
    (output / 'manifest.json').write_text(json.dumps(report, indent=2) + '\n')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--original', type=Path, required=True)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(prepare(args.original, args.source, args.output)))
