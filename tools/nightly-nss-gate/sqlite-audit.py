#!/usr/bin/env python3
"""Read stopped, privately exported NSS SQLite files; retain logical row hashes.

The full database bytes stay in the owned evidence directory. Reports contain
hashes, schema and row counts, never plaintext key/authentication material.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sqlite3
import shutil
import tempfile


def digest(body):
    return hashlib.sha256(body).hexdigest()


def cell(value):
    if isinstance(value, bytes):
        return ['blob', len(value), digest(value)]
    return [type(value).__name__, value]


def audit(directory):
    directory = Path(directory).resolve()
    report = {'schema': 1, 'guestAcceptance': False, 'databases': {}, 'files': {}}
    for name in ['cert9.db', 'key4.db', 'pkcs11.txt', 'cert_override.txt']:
        for suffix in ['', '-wal', '-shm', '-journal'] if name.endswith('.db') else ['']:
            p = directory / (name + suffix)
            if p.exists() or p.is_symlink():
                assert p.is_file() and not p.is_symlink(), 'ordinary exported file required'
                body = p.read_bytes()
                report['files'][p.name] = {'bytes': len(body), 'sha256': digest(body)}
    # SQLite mode=ro may still create or modify SHM while reading a WAL.
    # Analyze private copies, preserving WAL contents and original evidence.
    with tempfile.TemporaryDirectory(prefix='.sqlite-audit-', dir=directory) as scratch:
        for name in report['files']:
            shutil.copy2(directory / name, Path(scratch) / name)
        for name in ['cert9.db', 'key4.db']:
            p = Path(scratch) / name
            assert p.exists(), 'NSS-created database missing: ' + name
            with sqlite3.connect(p.as_uri() + '?mode=ro', uri=True) as connection:
                connection.execute('PRAGMA query_only=ON')
                integrity = [r[0] for r in connection.execute('PRAGMA integrity_check')]
                assert integrity == ['ok'], 'database integrity failed: ' + name
                schema = list(connection.execute("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name"))
                tables = {}
                for kind, table, _, _ in schema:
                    if kind != 'table':
                        continue
                    quoted = '"' + table.replace('"', '""') + '"'
                    rows = [json.dumps([cell(v) for v in row], separators=(',', ':'))
                            for row in connection.execute('SELECT * FROM ' + quoted)]
                    hashes = sorted(digest(row.encode()) for row in rows)
                    tables[table] = {'rows': len(rows), 'rowSHA256': hashes,
                                     'logicalSHA256': digest(json.dumps(hashes, separators=(',', ':')).encode())}
                report['databases'][name] = {'integrity': integrity, 'schema': schema, 'tables': tables,
                                            'logicalSHA256': digest(json.dumps([schema, tables], separators=(',', ':')).encode())}
    override = directory / 'cert_override.txt'
    assert not override.exists() or override.stat().st_size == 0, 'certificate exceptions forbidden'
    for name, evidence in report['files'].items():
        body = (directory / name).read_bytes()
        assert evidence == {'bytes': len(body), 'sha256': digest(body)}, 'export changed during audit: ' + name
    return report


def compare(before, after, allow_missing_cert=False):
    for name in ['key4.db'] + ([] if allow_missing_cert else ['cert9.db']):
        assert before['databases'][name] == after['databases'][name], 'logical NSS trust/key/auth records changed: ' + name
    assert before['files'].get('pkcs11.txt') == after['files'].get('pkcs11.txt'), 'module configuration changed'
    return {'logicalKeyAuthenticationPreserved': True,
            'logicalTrustPreserved': not allow_missing_cert, 'guestAcceptance': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--before')
    missing = parser.add_mutually_exclusive_group()
    missing.add_argument('--missing-cert', action='store_true')
    missing.add_argument('--missing-module', action='store_true')
    args = parser.parse_args()
    result = audit(args.directory)
    if args.before:
        before = json.loads(Path(args.before).read_text())
        if args.missing_module:
            before['files'].pop('pkcs11.txt', None)
            result_for_compare = json.loads(json.dumps(result))
            result_for_compare['files'].pop('pkcs11.txt', None)
        else:
            result_for_compare = result
        result['preservation'] = compare(before, result_for_compare, args.missing_cert)
    Path(args.out).write_text(json.dumps(result, indent=2) + '\n')


if __name__ == '__main__':
    main()
