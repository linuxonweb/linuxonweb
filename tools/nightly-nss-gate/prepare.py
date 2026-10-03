#!/usr/bin/env python3
"""Owned Nightly NSS inventory and deterministic-condition TLS fixtures.

Preparation only. Never modifies a profile or starts a browser/guest.
"""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

TASK = Path('/mnt/p6/build/firefox-nightly-nss-guest-gate-prepare-20261002')
CERTDATA_SHA = 'beb7e6dfe6499926e52c075c27bcfbe4c957f8609c575b3860273ae2806f63eb'
TRUST = {'CKT_NSS_TRUSTED_DELEGATOR': 2, 'CKT_NSS_NOT_TRUSTED': 3,
         'CKT_NSS_MUST_VERIFY_TRUST': 4}
sha = lambda b: hashlib.sha256(b).hexdigest()


def owned(out):
    out = Path(out).resolve()
    assert out.is_relative_to(TASK.resolve()) and out != TASK, 'owned output required'
    for name in ('TMPDIR', 'TMP', 'TEMP'):
        scratch = Path(os.environ[name]).resolve()
        assert scratch.is_relative_to(TASK) and scratch.is_dir(), 'owned scratch required'
        assert subprocess.check_output(['stat', '-f', '-c', '%T', str(scratch)], text=True).strip() == 'ext2/ext3', 'ext4 disk required'
    stat = os.statvfs(TASK)
    assert stat.f_bavail * stat.f_frsize >= 20 * 1024**3, '20 GiB reserve required'
    assert int(subprocess.check_output(['du', '-sb', str(TASK)], text=True).split()[0]) < 2 * 1024**3, '2 GiB task limit'
    out.mkdir(exist_ok=False)
    return out


def blocks(path):
    """Parse typed source objects, preserving absent vs false vs date bytes."""
    objects, obj = [], None
    lines = iter(Path(path).read_text().splitlines())
    for line in lines:
        if not line.startswith('CKA_'):
            continue
        key, kind, value = (line.split(' ', 2) + [''])[:3]
        if key == 'CKA_CLASS':
            if obj is not None:
                objects.append(obj)
            obj = {}
        assert obj is not None, 'attribute before object'
        if kind == 'MULTILINE_OCTAL':
            chunks = []
            for chunk in lines:
                if chunk == 'END':
                    break
                assert re.fullmatch(r'(?:\\[0-7]{3})+', chunk), 'invalid octal'
                chunks += [int(x, 8) for x in re.findall(r'\\([0-7]{3})', chunk)]
            else:
                raise ValueError('unterminated octal')
            value = bytes(chunks)
        elif kind == 'UTF8':
            value = json.loads(value)
        obj[key] = value
    if obj is not None:
        objects.append(obj)
    return objects


def optional_bytes(obj, key):
    if key not in obj:
        return None
    value = obj[key]
    if value in ('CK_FALSE', 'CK_TRUE'):
        return '00' if value == 'CK_FALSE' else '01'
    assert isinstance(value, bytes), 'unexpected attribute type ' + key
    return value.hex()


def inventory(source):
    source = Path(source)
    paths = [source / 'security/nss/lib/ckfw/builtins/certdata.txt',
             source / 'security/manager/ssl/trust_anchors/bundled_intermediates.txt']
    assert sha(paths[0].read_bytes()) == CERTDATA_SHA, 'unreviewed certdata'
    records = []
    for path in paths:
        objs = blocks(path)
        certs = [x for x in objs if x['CKA_CLASS'] == 'CKO_CERTIFICATE']
        trusts = [x for x in objs if x['CKA_CLASS'] == 'CKO_NSS_TRUST']
        for c in certs:
            matching = [t for t in trusts if (t['CKA_ISSUER'], t['CKA_SERIAL_NUMBER']) == (c['CKA_ISSUER'], c['CKA_SERIAL_NUMBER'])]
            assert len(matching) == 1, 'unique issuer/serial trust required'
            t = matching[0]
            der = c['CKA_VALUE']
            records.append({'sha256': sha(der), 'derBase64': base64.b64encode(der).decode(),
                'label': c['CKA_LABEL'], 'origin': path.name,
                'trustServer': TRUST[t['CKA_TRUST_SERVER_AUTH']],
                'trustEmail': TRUST[t['CKA_TRUST_EMAIL_PROTECTION']],
                'trustClient': 4, 'trustCode': 4,
                'mozillaPolicyHex': optional_bytes(c, 'CKA_NSS_MOZILLA_CA_POLICY'),
                'serverDistrustHex': optional_bytes(c, 'CKA_NSS_SERVER_DISTRUST_AFTER'),
                'emailDistrustHex': optional_bytes(c, 'CKA_NSS_EMAIL_DISTRUST_AFTER')})
    assert len(records) == len({x['sha256'] for x in records}), 'duplicate certificate DER'
    assert sum(x['origin'] == 'certdata.txt' for x in records) == 172
    assert sum(x['origin'] == 'certdata.txt' and x['trustServer'] == 2 for x in records) == 121
    assert len(records) == 173, 'bundled intermediate inventory changed'
    return {'schema': 1, 'guestAcceptance': False, 'sourceFiles': {str(p): sha(p.read_bytes()) for p in paths},
            'records': sorted(records, key=lambda x: x['sha256'])}


def openssl(*args):
    result = subprocess.run(['openssl', *map(str, args)], capture_output=True, check=True)
    return result.stdout


def fixtures(out):
    def key(name):
        openssl('genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:2048', '-out', out / (name + '.key'))
        (out / (name + '.key')).chmod(0o600)

    def csr(name, cn):
        openssl('req', '-new', '-key', out / (name + '.key'), '-subj', '/CN=' + cn, '-out', out / (name + '.csr'))

    def sign(name, authority, start, end, root=False, wrong=False):
        config = out / (name + '.cnf')
        config.write_text('[ca]\ndefault_ca=local\n[local]\n' +
            f'database={out}/index\nserial={out}/serial\nnew_certs_dir={out}/issued\n' +
            f'private_key={out}/{authority}.key\ncertificate={out}/{authority}.pem\n' +
            'default_md=sha256\npolicy=policy\nx509_extensions=ext\nunique_subject=no\n' +
            '[policy]\ncommonName=supplied\n[ext]\n' +
            ('basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\n' if root else
             'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid\nsubjectAltName=DNS:' + ('wrong-nightly-nss-fixture.test' if wrong else 'nightly-nss-fixture.test') + '\n'))
        openssl('ca', '-batch', '-notext', '-config', config, *(['-selfsign'] if root else []),
                '-startdate', start, '-enddate', end, '-in', out / (name + '.csr'), '-out', out / (name + '.pem'))

    (out / 'issued').mkdir()
    (out / 'index').write_text('')
    (out / 'serial').write_text('1000\n')
    for name in ('root', 'unknown-root'):
        key(name)
        csr(name, 'Nightly dedicated fixture ' + name)
        # ca requires a bootstrap certificate; replace it with explicit-date self-sign.
        openssl('req', '-x509', '-new', '-key', out / (name + '.key'), '-subj', '/CN=Nightly dedicated fixture ' + name, '-days', '1', '-out', out / (name + '.pem'))
        sign(name, name, '20200101000000Z', '20350101000000Z', root=True)
    errors = {'valid': 0, 'wronghost': -12276, 'expired': -8181, 'untrusted': -8179, 'badchain': -8182}
    rows = []
    for name, error in errors.items():
        key(name)
        csr(name, 'Nightly fixture ' + name)
        sign(name, 'unknown-root' if name == 'untrusted' else 'root',
             '20200101000000Z' if name == 'expired' else '20261001000000Z',
             '20210101000000Z' if name == 'expired' else '20271001000000Z', wrong=name == 'wronghost')
        der = openssl('x509', '-in', out / (name + '.pem'), '-outform', 'DER')
        if name == 'badchain':
            der = der[:-1] + bytes([der[-1] ^ 1])
            (out / 'badchain.der').write_bytes(der)
            (out / 'badchain.pem').write_bytes(openssl('x509', '-inform', 'DER', '-in', out / 'badchain.der', '-outform', 'PEM'))
        (out / (name + '.der')).write_bytes(der)
        nonce = 'nightly-nss-' + name + '-' + sha(der)[:24]
        (out / (name + '.html')).write_text('<!doctype html><meta charset="utf-8"><title>' + nonce + '</title><h1>' + nonce + '</h1>')
        rows.append({'name': name, 'sha256': sha(der), 'derBase64': base64.b64encode(der).decode(), 'expectedPRError': error, 'nonce': nonce})
    root_der = openssl('x509', '-in', out / 'root.pem', '-outform', 'DER')
    return {'schema': 1, 'guestAcceptance': False, 'purpose': 'dedicated-profile-only', 'verifyTime': 1790899200,
            'hostname': 'nightly-nss-fixture.test', 'generation': 'fixed scenarios, serials and validity; random RSA keys retained and hashed',
            'rootBase64': base64.b64encode(root_der).decode(), 'rootSHA256': sha(root_der), 'cases': rows,
            'files': {p.name: sha(p.read_bytes()) for p in out.iterdir() if p.is_file()}}


def compare(expected, actual):
    """Compare raw PKCS#11 output, never promoting source-only evidence."""
    objects = actual['objects']
    assert actual['ckUlongBytes'] == actual['pointerBytes'] == 4, 'native wasm32 ILP32 evidence required'
    certs = [o for o in objects if o['class'] == 1]
    trusts = [o for o in objects if o['class'] == 11]
    assert len(objects) == 1 + 2 * len(expected['records']), 'unexpected object inventory'
    assert sum(o['class'] == 0xce534354 for o in objects) == 1, 'one genuine root-list class required'
    assert len(certs) == len(trusts) == len(expected['records'])
    by_der = {sha(bytes.fromhex(c['valueHex'])): c for c in certs}
    by_hash = {t['hashHex']: t for t in trusts}
    assert len(by_der) == len(certs) and len(by_hash) == len(trusts), 'duplicate raw object'
    assert set(by_der) == set(by_hash) == {r['sha256'] for r in expected['records']}, 'DER/hash inventory differs'
    for r in expected['records']:
        c, t = by_der[r['sha256']], by_hash[r['sha256']]
        for k in ('mozillaPolicyHex', 'serverDistrustHex', 'emailDistrustHex'):
            assert c[k] == r[k], r['label'] + ' attribute differs: ' + k
        for k in ('trustServer', 'trustEmail', 'trustClient', 'trustCode'):
            assert t[k] == r[k], r['label'] + ' purpose differs: ' + k
    return {'rawInventoryMatchesSource': True, 'guestAcceptance': False,
            'limitation': 'caller must prove genuine guest execution and binding to final browser trust-anchor objects'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='mode', required=True)
    p = sub.add_parser('prepare'); p.add_argument('--source', required=True); p.add_argument('--out', required=True)
    p = sub.add_parser('compare'); p.add_argument('--expected', required=True); p.add_argument('--actual', required=True)
    args = parser.parse_args()
    if args.mode == 'prepare':
        out = owned(args.out)
        (out / 'expected-inventory.json').write_text(json.dumps(inventory(args.source), indent=2) + '\n')
        f = out / 'fixtures'; f.mkdir()
        (f / 'fixtures.json').write_text(json.dumps(fixtures(f), indent=2) + '\n')
        print(json.dumps({'prepared': True, 'guestAcceptance': False, 'out': str(out)}))
    else:
        print(json.dumps(compare(json.loads(Path(args.expected).read_text()), json.loads(Path(args.actual).read_text())), indent=2))


if __name__ == '__main__':
    main()
