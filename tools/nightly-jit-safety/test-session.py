#!/usr/bin/env python3
"""Adversarial host-only session predicates; never actual browser evidence."""
import copy, importlib.util, json, sys
from pathlib import Path
spec=importlib.util.spec_from_file_location('session_checker',Path(__file__).with_name('check-session.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
fixture=json.loads((Path(sys.argv[1])/'contract.json').read_text())
label=fixture['label'];checks=[]
binding={'kind':'caller-reviewed-full-nightly-jit-build-binding-v1','pass':True,'target':'wasm32-linux-musl','version':'159.0a1','localBuildID':'20261002211853','environmentSlotCount':23,'broadCoverage':True,'restartOnlyPref':'javascript.options.portable_baseline'}
for key in ['finalBinarySHA256','archiveSHA256','runtimeManifestSHA256','kernelSHA256','buildReviewSHA256','observerPblSha256','observerInterpreterSha256','optionObserverWorkerSha256','optionObserverStartupSha256']:binding[key]='a'*64
contract={'buildIdentityBound':True,'buildBinding':binding,'label':label,'localBuildID':binding['localBuildID'],'nativeEnvironmentSlotCount':23,'fixtureClaims':{'compiled':14,'bailout':7,'excluded':2,'policy-excluded':2},'portableBaseline':False,'requestedGuestCpus':6,'fixtureContract':fixture}
result={'kind':'actual-firefox-jit-gate-session','label':label,'portableBaseline':False,'status':'recorded','operations':[],
 'identity':{'status':'recorded','fixture':{'mainDone':True,'workerDone':True,'error':None},'identity':{'version':'159.0a1','applicationBuildID':binding['localBuildID'],'platformBuildID':binding['localBuildID'],'startupPref':False,'actualJitOptions':{'pbl.enable':0,'pbl.warmup.threshold':10},'contentHardwareConcurrency':6,'processID':10,'windowId':'77'}}}
startup=b'smp: Brought up 1 node, 6 CPUs\n'
cpu={key:6 for key in ['hostNproc','hostNprocObserved','browserHardwareConcurrencyAtBoot','selectedGuestCpus','requestedGuestCpus','guestBootCpus']};cpu['smpLines']=[startup.decode().strip()]
observer=b'PBLJIT_OPTION event=startup pid=10 tid=10 pthread=33 option=0 threshold=10 available=1 pref=0 safemode=0\nPBLJIT_OPTION event=worker-context pid=10 tid=11 pthread=34 option=0 threshold=10 available=1 worker=0x100\n'
lines=[]
for c in fixture['cases']:
 e={'label':label,'context':c['context'],'id':c['id'],'claim':c['claim']}
 lines += ['NJS '+json.dumps({**e,'event':'case-start'}),'NJS '+json.dumps({**e,'event':'case-done','result':c['expected'],'repetitions':16})]
for context in ['main','worker']:lines+=['NJS '+json.dumps({'label':label,'context':context,'event':'done','ok':True})]
combined=observer+('\n'.join(lines)+'\n').encode()
values=[contract,result,binding,cpu,startup,combined,observer,{}]
def check(name,ok):assert ok,name;checks.append(name)
def evaluate(values=values):return m.evaluate(*values)
check('complete synthetic disabled contract accepted as pure predicates',evaluate()['pass'])
check('pure evaluation never full JIT/GPU/guest acceptance',not any(evaluate()[k] for k in ['guestAcceptance','fullJITAcceptance','gpuAcceptance']))
def reject(name,mutate):
 v=copy.deepcopy(values);mutate(v);check(name,not evaluate(v)['pass'])
for key in ['hostNprocObserved','browserHardwareConcurrencyAtBoot','selectedGuestCpus','requestedGuestCpus','guestBootCpus']:
 reject('CPU mismatch '+key,lambda v,key=key:v[3].update({key:2}))
reject('unbuilt candidate cannot pass',lambda v:v[0].update(buildIdentityBound=False))
reject('legacy22 ABI cannot pass',lambda v:v[2].update(environmentSlotCount=22))
reject('wrong actual BuildID fails',lambda v:v[1]['identity']['identity'].update(applicationBuildID='20261003042618'))
reject('wrong actual tier option fails',lambda v:v[1]['identity']['identity']['actualJitOptions'].update({'pbl.enable':1}))
reject('lowered broad claims fail',lambda v:v[0]['fixtureClaims'].update(compiled=2))
reject('kernel CPU mismatch fails',lambda v:v.__setitem__(4,startup.replace(b'6 CPUs',b'2 CPUs')))
reject('Worker native initialization missing',lambda v:v.__setitem__(6,observer.splitlines(keepends=True)[0]))
reject('native option getter unavailable',lambda v:v.__setitem__(6,observer.replace(b'available=1',b'available=0')))
reject('native duplicate fields fail',lambda v:v.__setitem__(6,observer.replace(b'pid=10',b'pid=10 pid=10')))
reject('native observation exhausted',lambda v:v.__setitem__(6,observer+b'PBLJIT_OBS_EXHAUSTED budget=4096\n'))
reject('option observation exhausted',lambda v:v.__setitem__(6,observer+b'PBLJIT_OPTION_EXHAUSTED event=startup budget=64 pid=10\n'))
reject('native observer and combined transcript differ',lambda v:v.__setitem__(5,combined.replace(b'pthread=34',b'pthread=99')))
reject('disabled wrong exact semantic result fails',lambda v:v.__setitem__(5,combined.replace(b'8386560',b'0')))
reject('disabled missing one semantic case fails',lambda v:v.__setitem__(5,b'\n'.join(line for line in combined.splitlines() if b'arraywrite' not in line)+b'\n'))
reject('enabled cannot pass disabled evidence',lambda v:(v[0].update(portableBaseline=True),v[1].update(portableBaseline=True)))
v=copy.deepcopy(values);v[1].update(status='pending',error='actual privileged API unavailable');pending=evaluate(v)
check('unavailable privileged API remains pending',pending['status']=='pending' and not pending['pass'])
for bad in [b'console.log: '+observer,b'PBLJIT_OPTION event=worker-context pid=0 tid=1 pthread=1 option=0 threshold=10 available=1 worker=0x1\n',observer+b'PBLJIT_OPTION_EXHAUSTED event=startup budget=64 pid=10\n',observer.splitlines(keepends=True)[0]*64]:
 try:m.options(bad)
 except ValueError:check('bad raw option record rejected '+str(len(bad)),True)
 else:raise AssertionError('bad option accepted')
print(json.dumps({'kind':'host-only-synthetic-session-contract-tests','pass':True,'checks':len(checks),'guestAcceptance':False,'fullJITAcceptance':False}))
