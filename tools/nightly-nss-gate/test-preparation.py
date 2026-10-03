#!/usr/bin/env python3
"""Host-only contract checks. No browser, guest, server, or target link."""
import copy
import importlib.util
import json
from pathlib import Path
import ssl
import subprocess
import sys

spec = importlib.util.spec_from_file_location('prepare', Path(__file__).with_name('prepare.py'))
prepare = importlib.util.module_from_spec(spec); spec.loader.exec_module(prepare)
directory = Path(sys.argv[1])
expected = json.loads((directory / 'expected-inventory.json').read_text())
fdir = directory / 'fixtures'
fixture = json.loads((fdir / 'fixtures.json').read_text())
checks = []
assert len(expected['records']) == 173
checks.append('173 exact source DER/policy records')
assert sum(r['origin'] == 'certdata.txt' and r['trustServer'] == 2 for r in expected['records']) == 121
checks.append('121 current TLS anchors')
actual = {'ckUlongBytes': 4, 'pointerBytes': 4, 'objects': [{'class': 0xce534354}]}
for r in expected['records']:
    actual['objects'].append({'class': 1, 'valueHex': prepare.base64.b64decode(r['derBase64']).hex(), **{k:r[k] for k in ('mozillaPolicyHex','serverDistrustHex','emailDistrustHex')}})
    actual['objects'].append({'class': 11, 'hashHex': r['sha256'], **{k:r[k] for k in ('trustServer','trustEmail','trustClient','trustCode')}})
assert prepare.compare(expected, actual)['rawInventoryMatchesSource']
checks.append('synthetic raw inventory matches exact policy; not acceptance')
mutators = [lambda a:a.update(pointerBytes=8), lambda a:a['objects'].pop(),
            lambda a:a['objects'][0].update({'class': 0xce534353}),
            lambda a:a['objects'][1].update(serverDistrustHex='00ff'),
            lambda a:a['objects'][2].update(trustServer=3),
            lambda a:a['objects'][2].update(trustEmail=3 if a['objects'][2]['trustEmail'] != 3 else 2),
            lambda a:a['objects'][2].update(hashHex='00'*32),
            lambda a:a['objects'][1].update(valueHex='00'),
            lambda a:a['objects'][2].update(trustClient=2),
            lambda a:a['objects'][2].update(trustCode=2)]
for i, mutate in enumerate(mutators):
    bad = copy.deepcopy(actual); mutate(bad)
    try: prepare.compare(expected, bad)
    except AssertionError: checks.append('reject raw inventory mutation ' + str(i))
    else: raise AssertionError('raw mismatch accepted ' + str(i))
openssl_errors = {'valid': None, 'wronghost': 62, 'expired': 10, 'untrusted': 20, 'badchain': 7}
for row in fixture['cases']:
    name = row['name']
    result = subprocess.run(['openssl', 'verify', '-attime', str(fixture['verifyTime']), '-verify_hostname', fixture['hostname'],
                             '-CAfile', str(fdir/'root.pem'), str(fdir/(name+'.pem'))], capture_output=True, text=True)
    if name == 'valid': assert result.returncode == 0, result.stderr
    else: assert result.returncode != 0 and ('error ' + str(openssl_errors[name]) + ' ') in result.stderr, result.stderr
    checks.append('OpenSSL fixed-condition ' + name + ' (host only)')
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(fdir/(name+'.pem'), fdir/(name+'.key'))
    checks.append('TLS service can load ' + name + ' certificate/key')
    assert prepare.sha((fdir/(name+'.der')).read_bytes()) == row['sha256']
    assert row['nonce'] in (fdir/(name+'.html')).read_text()
    checks.append('fixture hash/nonce ' + name)
print(json.dumps({'passPreparation': True, 'guestAcceptance': False, 'checks': checks, 'checkCount': len(checks)}, indent=2))
