#!/usr/bin/env python3
"""Bind actual guest JIT records to exact candidate, native23 ABI and boot CPUs.

Pure evaluate() predicates can be tested on synthetic records; production CLI
requires caller-reviewed acquisition pins and rejects synthetic provenance.
"""
import argparse, hashlib, importlib.util, json, re
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from owned_paths import root_for_output, scoped_path

here = Path(__file__).resolve().parent
def module(name, filename):
    spec=importlib.util.spec_from_file_location(name,here/filename)
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
priv = module('nightly_privileged', 'check-privileged.py')
broad = module('nightly_broad', 'check.py')
digest = lambda raw: hashlib.sha256(raw).hexdigest()
LIMIT = 2*1024**2
SCOPES = ['gc-debug-coverage','incremental','slice-gc','interrupt']

def require(ok, message):
    if not ok: raise ValueError(message)

def options(raw):
    rows=[]
    require(b'PBLJIT_OPTION_EXHAUSTED' not in raw, 'native option budget exhausted')
    for line in raw.decode('utf-8',errors='strict').splitlines():
        if 'PBLJIT_OPTION' not in line: continue
        require(line.startswith('PBLJIT_OPTION '), 'native option record must be direct stderr')
        pairs=[v.split('=',1) for v in line[len('PBLJIT_OPTION '):].split()]
        require(all(len(v)==2 for v in pairs), 'malformed option observation')
        row=priv.object_pairs(pairs)
        event=row.get('event')
        require(event in {'startup','worker-context'}, 'unknown option site')
        keys={'event','pid','tid','pthread','option','threshold','available'} | ({'pref','safemode'} if event=='startup' else {'worker'})
        require(set(row)==keys, 'native option fields missing/extra')
        for key in ['pid','tid','pthread']: require(priv.decimal(row[key],1), 'invalid native '+key)
        require(row['available']=='1' and row['option'] in {'0','1'} and row['threshold']=='10', 'actual option getter/threshold missing')
        if event=='startup': require(row['pref'] in {'0','1'} and row['safemode']=='0','startup policy mismatch')
        else: require(re.fullmatch('0x[0-9a-fA-F]+',row['worker']) and 0<int(row['worker'],16)<2**32,'native Worker identity missing')
        rows.append(row)
    for event in ['startup','worker-context']:
        for pid in {r['pid'] for r in rows}:
            require(sum(r['event']==event and r['pid']==pid for r in rows)<64,'option observation budget reached')
    return rows

def evaluate(contract, result, binding, cpu, startup, combined, observer, privileged):
    report={'kind':'nightly-in-firefox-session-evaluation','status':'failed','pass':False,
            'guestAcceptance':False,'fullJITAcceptance':False,'gpuAcceptance':False,'errors':[],
            'remaining':['Actual array bounds/type and object shape/GC mutation guards','native two-thread stack/TLS/syscall callback probes','baseline/update/NSS/TLS/UI','all eight same-binary ABBAAB performance cases and v10 comparison']}
    try:
        require(contract.get('buildIdentityBound') is True,'fresh full-JIT build binding unavailable')
        require(binding.get('kind')=='caller-reviewed-full-nightly-jit-build-binding-v1' and binding.get('pass') is True,'actual reviewed full-JIT binding required')
        require(contract.get('buildBinding')==binding,'session/build binding differs')
        require(binding.get('target')=='wasm32-linux-musl' and binding.get('version')=='159.0a1' and binding.get('environmentSlotCount')==23 and binding.get('broadCoverage') is True,'current native159/23slot broad configuration missing')
        require(contract.get('nativeEnvironmentSlotCount')==23 and binding.get('restartOnlyPref')=='javascript.options.portable_baseline','native slots/startup pref contract differs')
        require(contract.get('fixtureClaims')=={'compiled':14,'bailout':7,'excluded':2,'policy-excluded':2},'broad requirements lowered')
        for key in ['finalBinarySHA256','archiveSHA256','runtimeManifestSHA256','kernelSHA256','buildReviewSHA256','observerPblSha256','observerInterpreterSha256','optionObserverWorkerSha256','optionObserverStartupSha256']:
            require(re.fullmatch('[a-f0-9]{64}',binding.get(key,'')),'missing actual candidate pin '+key)
        require(result.get('kind')=='actual-firefox-jit-gate-session' and result.get('label')==contract['label'] and result.get('portableBaseline') is contract['portableBaseline'],'actual guest session differs')
        if result.get('status')=='pending':
            report.update(status='pending',errors=[result.get('error','privileged execution pending')]);return report
        require(result.get('status')=='recorded','actual guest driver failed')
        identity=result['identity']['identity']
        require(result['identity']['status']=='recorded' and result['identity']['fixture']=={'mainDone':True,'workerDone':True,'error':None},'actual main/Worker completion missing')
        for key in ['applicationBuildID','platformBuildID']:
            require(identity.get(key)==binding['localBuildID'],'actual compiled '+key+' differs')
        require(identity.get('version')=='159.0a1' and contract['localBuildID']==binding['localBuildID'],'actual Nightly version/BuildID differs')
        expected=int(contract['portableBaseline'])
        require(identity.get('startupPref') is contract['portableBaseline'] and identity.get('actualJitOptions',{}).get('pbl.enable')==expected and identity['actualJitOptions'].get('pbl.warmup.threshold')==10,'actual content portable-tier option differs')
        count=cpu['hostNproc'];require(type(count) is int and 1<=count<=64,'invalid actual host CPU count')
        for key in ['hostNprocObserved','browserHardwareConcurrencyAtBoot','selectedGuestCpus','requestedGuestCpus','guestBootCpus']:
            require(type(cpu.get(key)) is int and cpu[key]==count,'actual host/browser/guest CPU mismatch: '+key)
        require(identity.get('contentHardwareConcurrency')==count and contract['requestedGuestCpus']==count,'actual Firefox CPU mismatch')
        smp=[line for line in startup.decode('utf-8').splitlines() if re.search(r'smp: Brought up \d+ nodes?, \d+ CPUs?\b',line)]
        require(smp and int(re.search(r', (\d+) CPUs?\b',smp[-1])[1])==count and cpu.get('smpLines')==smp,'raw actual kernel SMP evidence missing/differs')
        require(not priv.FATAL.search(combined.decode('utf-8')),'fatal actual Firefox logs')
        native=priv.parse_observer(observer)
        opts=options(observer)
        without_offsets=lambda rows:[{k:v for k,v in row.items() if not k.startswith('_')} for row in rows]
        require(without_offsets(native)==without_offsets(priv.parse_observer(combined)) and opts==options(combined),'combined and direct observer records differ')
        pid=str(identity['processID'])
        startups=[r for r in opts if r['event']=='startup' and r['pid']==pid and int(r['option'])==expected and int(r['pref'])==expected]
        workers=[r for r in opts if r['event']=='worker-context' and r['pid']==pid and int(r['option'])==expected]
        require(startups and workers and any(w['tid']!=s['tid'] for w in workers for s in startups),'actual content startup/Worker inherited option evidence missing')
        prefix='file:///home/admin/nightly-jit-safety/'+contract['label']+'/'
        require(not any(o['event']=='install' for o in native) if not expected else True,'disabled arm has actual installs')
        if expected:
            fixture=contract['fixtureContract']
            admission=broad.check(fixture,combined.decode('utf-8'),'broad')
            require(admission['pass'],'broad admission: '+str(admission['errors']))
            worker_native=[o for o in native if o['file'].startswith(prefix+contract['label']+'-worker-') and o['event']=='run']
            require(any(w['tid']==o['tid'] and w['pthread']==o['pthread'] for w in workers for o in worker_native),'actual Worker native identity/option trace differs')
            require([o.get('scope') for o in result['operations']]==SCOPES,'mandatory privileged scopes missing/reordered')
            for operation in result['operations']:
                scope=operation['scope'];require(operation.get('status')=='recorded','privileged scope pending/failed: '+scope)
                console=privileged[scope]
                events=priv.parse_console(console);require(events,'privileged raw transcript missing: '+scope)
                first=events[0]
                expected_contract={**first,'version':binding['version'],'applicationBuildID':binding['localBuildID'],'platformBuildID':binding['localBuildID'],
                  'scope':scope,'label':contract['label'],'windowId':identity['windowId'],
                  'observerLogPath':'/home/admin/nightly-jit-safety/'+contract['label']+'/observer.stderr',
                  'fixtureNames':sorted({c['id'] for c in fixture['cases']}|{'debugFresh','coverage','infinite'})}
                checked=priv.check_records(expected_contract,console,observer)
                require(checked['pass'],scope+': '+str(checked['errors']))
        else:
            require(result.get('operations')==[],'disabled arm invoked enabled-only privileged operations')
            semantics=broad.check(contract['fixtureContract'],combined.decode('utf-8'),'broad')
            require(len(semantics['rows'])==50 and all(row['semantic'] and not row['forbiddenInstallation'] for row in semantics['rows']),'disabled arm exact broad semantics missing')
            events,_=broad.parse(combined.decode('utf-8'))
            require(not any(e.get('event')=='error' for e in events),'disabled fixture error')
            require(all(sum(e.get('label')==contract['label'] and e.get('context')==context and e.get('event')=='done' and e.get('ok') is True for e in events)==1 for context in ['main','worker']),'actual disabled semantic main/Worker completion missing')
        report.update({'status':'recorded','pass':True,'cpuCount':count,'portableBaseline':bool(expected),'broadCaseRows':50 if expected else 0,'privilegedScopes':SCOPES if expected else []})
    except (ValueError, KeyError, TypeError, UnicodeError) as error: report['errors'].append(str(error))
    return report

def production(acquisition, reviewed_hash):
    raw=acquisition.read_bytes();require(digest(raw)==reviewed_hash,'caller-reviewed acquisition pin differs')
    require(not re.search(r'synthetic|mocked|host-fixture',raw.decode('utf-8'),re.I),'synthetic provenance rejected')
    a=priv.load_json(raw);require(a.get('kind')=='caller-reviewed-actual-nightly-jit-session-acquisition-v1','actual acquisition review required')
    blobs={}
    for role,record in a['artifacts'].items():
        path=Path(record['path']);require(path.is_absolute() and path.is_file() and path.stat().st_size<=LIMIT,'bounded retained artifact required: '+role)
        data=path.read_bytes();require(digest(data)==record['sha256'],'retained artifact drift: '+role);blobs[role]=data
    require({'contract','result','binding','cpu','startup','combined','observer'}<=set(blobs),'mandatory acquisition artifacts missing')
    contract=priv.load_json(blobs['contract'])
    require(contract['buildBindingSHA256']==digest(blobs['binding']),'reviewed binding hash differs')
    for name,want in {**contract['files'],**contract['fixtureContract']['files']}.items():
        require(Path(name).name==name and name not in {'.','..'},'unsafe guest file inventory')
        require('file:'+name in blobs and digest(blobs['file:'+name])==want,'actual installed source pin missing/drift: '+name)
    for name in ['privileged-driver.js','guest-content.sys.mjs','guest-entry.sys.mjs','NightlyJitSafetyChild.sys.mjs','NightlyJitSafetyParent.sys.mjs']:
        require(blobs['file:'+name]==(here/name).read_bytes(),'guest driver differs from reviewed checker companion: '+name)
    result=evaluate(contract,priv.load_json(blobs['result']),priv.load_json(blobs['binding']),priv.load_json(blobs['cpu']),blobs['startup'],blobs['combined'],blobs['observer'],{scope:blobs.get(scope,b'') for scope in SCOPES})
    result['inputs']={role:digest(blob) for role,blob in blobs.items()};result['acquisitionSHA256']=digest(raw)
    result['trustBoundary']='Caller independently reviewed actual capture/build provenance. Digests establish retention, not execution.'
    return result

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--acquisition',type=Path,required=True);p.add_argument('--review-sha256',required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args()
    scoped_path(root_for_output(a.out), a.out, fresh=True)
    try: result=production(a.acquisition,a.review_sha256)
    except (ValueError,KeyError,TypeError,OSError,UnicodeError) as error: result={'pass':False,'status':'failed','guestAcceptance':False,'fullJITAcceptance':False,'errors':[str(error)]}
    with a.out.open('x') as output: output.write(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result));raise SystemExit(0 if result['pass'] else 1)
