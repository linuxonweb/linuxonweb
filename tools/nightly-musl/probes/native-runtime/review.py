"""Read-only review of the real guest lifecycle and deliberately broken control."""
import hashlib, importlib.util, json, re, subprocess, sys
from pathlib import Path
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[4]
T=Path('/mnt/p6/build/firefox-nightly-musl-recovery-20261002')
Q=Path('/mnt/p6/build/firefox-nightly-musl-root-review-20261002')
output=Q/'native-runtime-review-run1.json'; assert not output.exists()
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def pin(p):return dict(path=str(p),bytes=p.stat().st_size,sha256=sha(p))
checks=[]
def check(label,condition):
    checks.append(dict(check=label,passed=bool(condition)));assert condition,label
positive=T/'native-runtime-link/guest-run1';negative=T/'native-runtime-link/guest-run2-negative'
builds=[T/'native-runtime-link/guest-build-run2',T/'native-runtime-link/guest-build-run3']
reports=[json.loads((p/'result.json').read_text()) for p in (positive,negative)]
check('positive 100 real exceptions and20 lifecycle checks',reports[0]['pass'] and reports[0]['unwind']['passes']==100 and reports[0]['unwind']['failures']==0 and reports[0]['unwind']['runtimePasses']==20 and reports[0]['unwind']['runtimeFailures']==0)
check('negative detects exactly four worker cleanup ordering failures',not reports[1]['pass'] and reports[1]['unwind']['exitStatus']==1 and reports[1]['unwind']['passes']==100 and reports[1]['unwind']['failures']==0 and reports[1]['unwind']['runtimePasses']==16 and reports[1]['unwind']['runtimeFailures']==4 and len(reports[1]['unwind']['failLines'])==4)
for report in reports:
    check('owned fresh browser and server cleanly stopped',report['ownedGroupEmpty'] and report['serverClosed'] and report['browserExit']['code']==0 and not report['cleanupMembersAfter'])
    check('exact host/browser/guest CPU count and kernel SMP',report['cpu']['hostNproc']==report['cpu']['requestedGuestCpus']==report['cpuSelectionAttempt']['browserHardwareConcurrency']==report['finalPhaseCpu']['hostNprocObserved']==report['finalPhaseCpu']['browserHardwareConcurrencyObserved'] and report['unwind']['configuration']['verified'] and report['unwind']['configuration']['cpus']==[report['cpu']['hostNproc']])
    check('no page runtime exceptions',not any(e['method']=='Runtime.exceptionThrown' for e in report['events']))
    for name,identity in report['inputs'].items():check('frozen actual guest input '+name,sha(Path(name))==identity)
spec=importlib.util.spec_from_file_location('package',ROOT/'tools/guest-rootfs/package-firefox-nightly.py');package=importlib.util.module_from_spec(spec);spec.loader.exec_module(package)
old=T/'native-unwind/guest-build-run5'
oldmeta=json.loads((old/'build.json').read_text())
with (old/'initramfs.cpio').open('rb') as f: original={key:(fields,body,encoded) for key,fields,body,encoded in package.cpio(f)}
metadata=[]
for build in builds:
    data=json.loads((build/'build.json').read_text());metadata.append(data)
    check('binary matches recorded hash',sha(build/'guest-unwind-test.wasm')==data['sha256'])
    check('archive matches recorded hash',sha(build/'initramfs.cpio')==data['archiveSha256'])
    check('actual adapter source matches repo',sha(build/'runtime.c')==data['adapterSha256']==sha(ROOT/'tools/nightly-musl/adapters/native-runtime/runtime.c'))
    check('actual TLS fixture matches repo',sha(build/'runtime-test.cpp')==data['sourceSha256']==sha(Path(__file__).with_name('runtime-test.cpp')))
    expected=(old/'unwind-test.cpp').read_text().replace('int main() {\n  int pass = 0, fail = 0;', 'int run_exception_fixture(int& pass, int& fail) {\n  pass = fail = 0;')
    check('all100 EH cases retained byte for byte apart from test entry point',(build/'unwind-test.cpp').read_text()==expected and sha(old/'unwind-test.cpp')==oldmeta['sourceSha256'])
    with (build/'initramfs.cpio').open('rb') as f: records={key:(fields,body,encoded) for key,fields,body,encoded in package.cpio(f)}
    check('same complete test-only archive record set',records.keys()==original.keys() and len(records)==3848)
    for key in original:
        if key!='bin/guest-unwind-test':check('unchanged complete guest record '+key,records[key]==original[key])
    check('guest executable is exact actual newly compiled artifact',records['bin/guest-unwind-test'][1]==(build/'guest-unwind-test.wasm').read_bytes())
check('control uses same adapter object and exactly one removed link wrapper',sha(builds[0]/'runtime.o')==sha(builds[1]/'runtime.o'))
commands=[next(c['argv'] for c in m['commands'] if c['label']=='guest-compile') for m in metadata]
def normalized(args,build):return [a.replace(str(build),'BUILD').replace('--wrap=exit,--wrap=__pthread_tsd_run_dtors','--wrap=exit') for a in args]
check('only intentional control compiler/link argument differs',normalized(commands[0],builds[0])==normalized(commands[1],builds[1]))
check('positive two required wrappers selected','-Wl,--wrap=exit,--wrap=__pthread_tsd_run_dtors' in commands[0])
check('control retains exit wrapper and omits thread wrapper','-Wl,--wrap=exit' in commands[1] and not any('__pthread_tsd_run_dtors' in a for a in commands[1]))
accepted=T/'native-runtime-accepted-run1'
check('browser archive uses exact guest-tested adapter object',sha(accepted/'runtime.o')==sha(builds[0]/'runtime.o'))
scope=json.loads((Q/'native-runtime-link-scope-run1/result.json').read_text())
check('four actual make/driver link rows inspected',scope['pass'] and {p['name'] for p in scope['programs']}=={'firefox','plugin-container','xpcshell','gfxtest'})
for p in scope['programs']:
    for flag in ('--wrap=exit','--wrap=__pthread_tsd_run_dtors',str(accepted/'libnightly-native-runtime.a')):
        check(p['name']+' native runtime link scope '+flag,(flag in p['linkerArgv'])==(p['name']!='gfxtest'))
policy=json.loads((T/'status/storage-policy.json').read_text())
check('reported32GiBtask cap,20GiBreserve',policy['limit_bytes']==32*1024**3 and policy['reserve_bytes']==20*1024**3 and 'reported32GiBbefore' in policy['enlargement_reason'])
out=dict(pass_=True,claim='Actual Linux/Wasm TLS destructor lifecycle,100 real EH cases, four-failure negative control and browser-only link scope',checks=checks,guestRuntimeAcceptance=True,browserAcceptance=False,jitAcceptance=False,releaseAcceptance=False,
         pins=[pin(p) for p in [positive/'result.json',negative/'result.json',accepted/'build.json',accepted/'libnightly-native-runtime.a',Q/'native-runtime-link-scope-run1/result.json',Path(__file__)]])
out['pass']=out.pop('pass_');output.write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps(dict(checks=len(checks),review=pin(output))))
