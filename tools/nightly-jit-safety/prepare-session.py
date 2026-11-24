#!/usr/bin/env python3
"""Prepare small guest files; an unbuilt candidate always remains pending."""
import argparse, hashlib, json, os, shutil, subprocess
from pathlib import Path
from owned_paths import task_root, scoped_path

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--task-root', type=Path, default=Path('/mnt/p6/project/build/nightly-jit-guest-gates-prep-20261004'))
p.add_argument('--out', type=Path, required=True)
p.add_argument('--label', required=True)
p.add_argument('--arm', choices=['disabled','enabled'], required=True)
p.add_argument('--build-binding', type=Path, help='Independent reviewed full-JIT identity/ABI/package binding')
a = p.parse_args()
import re
if not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', a.label): p.error('invalid label')
try:
    root = task_root(a.task_root)
    scoped_path(root, a.out, fresh=True)
except (ValueError, OSError) as error: p.error(str(error))
if shutil.disk_usage(root).free < 20*1024**3: p.error('20GiB reserve required')
if sum(f.stat().st_size for f in root.rglob('*') if f.is_file()) > 256*1024**2: p.error('256MiB task cap')
here = Path(__file__).resolve().parent
subprocess.run(['node', str(here/'generate.mjs'), str(a.out), a.label, 'broad'], check=True, timeout=30)
pins = {}
for name in ['privileged-driver.js','guest-content.sys.mjs','guest-entry.sys.mjs','NightlyJitSafetyChild.sys.mjs','NightlyJitSafetyParent.sys.mjs']:
    shutil.copyfile(here/name, a.out/name)
    pins[name] = hashlib.sha256((a.out/name).read_bytes()).hexdigest()
binding = json.loads(a.build_binding.read_text()) if a.build_binding else None
digest = lambda value: isinstance(value, str) and bool(re.fullmatch('[a-f0-9]{64}',value))
if binding:
    assert binding.get('kind') == 'caller-reviewed-full-nightly-jit-build-binding-v1' and binding.get('pass') is True
    assert binding.get('target') == 'wasm32-linux-musl' and binding.get('version') == '159.0a1'
    assert binding.get('environmentSlotCount') == 23 and binding.get('broadCoverage') is True
    assert binding.get('restartOnlyPref') == 'javascript.options.portable_baseline'
    assert re.fullmatch(r'\d{14}',binding['localBuildID'])
    for key in ['finalBinarySHA256','archiveSHA256','runtimeManifestSHA256','kernelSHA256','buildReviewSHA256','observerPblSha256','observerInterpreterSha256','optionObserverWorkerSha256','optionObserverStartupSha256']:
        assert digest(binding.get(key)), 'missing actual binding '+key
    shutil.copyfile(a.build_binding, a.out/'build-binding.json')
count = int(subprocess.check_output(['nproc'], text=True).strip())
assert 1 <= count <= 64
session = {'schema':1, 'kind':'nightly-jit-guest-session-preparation-v1', 'label':a.label,
           'version':'159.0a1', 'localBuildID':binding['localBuildID'] if binding else None,
           'buildIdentityBound':bool(binding), 'buildBinding':binding,
           'buildBindingSHA256':hashlib.sha256(a.build_binding.read_bytes()).hexdigest() if binding else None,
           'portableBaseline':a.arm == 'enabled', 'requestedGuestCpus':count,
           'cpuObservationPurpose':'Preparation only. Reread nproc at each launch/boot; exact host/browser/guest/kernel equality mandatory.',
           'nativeEnvironmentSlotCount':23, 'files':pins, 'fixtureContract':json.loads((a.out/'contract.json').read_text()), 'guestAcceptance':False,
           'status':'prepared' if binding else 'pending', 'pending':[] if binding else ['Fresh full-JIT build/ABI/package reviewed binding unavailable'],
           'outerWallDeadlineSeconds':150, 'scopeWallDeadlineSeconds':30,
           'observerLimitBytes':2097152, 'fixtureClaims':{'compiled':14,'bailout':7,'excluded':2,'policy-excluded':2},
           'performanceCases':['int-loop','recursion','throw-flat','throw-deep','throw-error','property','Math','JSON']}
(a.out/'session.json').write_text(json.dumps(session,indent=2)+'\n')
(a.out/'user.js.fragment').write_text('user_pref("javascript.options.portable_baseline",'+str(session['portableBaseline']).lower()+');\nuser_pref("devtools.chrome.enabled",true);\nuser_pref("devtools.console.stdout.chrome",true);\nuser_pref("devtools.console.stdout.content",true);\n')
(a.out/'browser-console-expression.txt').write_text('ChromeUtils.importESModule("file:///home/admin/nightly-jit-safety/'+a.label+'/guest-entry.sys.mjs").run("/home/admin/nightly-jit-safety/'+a.label+'/session.json");\n')
print(json.dumps({'kind':'guest-driver-preparation','out':str(a.out),'status':session['status'],'buildIdentityBound':bool(binding),'guestAcceptance':False}))
