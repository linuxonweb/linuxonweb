#!/usr/bin/env python3
"""Independently bind final primitive reports to exact sources and payloads."""
import hashlib,json,struct,sys
from pathlib import Path
TASK=Path('/mnt/p6/project/build/nightly-webgpu-current-abi-20261003')
ROOT=Path(__file__).resolve().parents[4]
checks=0
def require(v,msg):
 global checks
 checks+=1
 if not v:raise AssertionError(msg)
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def cpus(value):
 result=set()
 for part in value.split(','):
  lo,hi=(map(int,part.split('-')) if '-' in part else (int(part),int(part)))
  result.update(range(lo,hi+1))
 return result
def ident(n):return struct.pack('<III',0,n,1)
def reply(tag,n,tail=b''):return struct.pack('<I',tag)+ident(n)+tail
pins=json.loads((TASK/'source-pins.json').read_text())
require(len(pins['files'])==86,'exact selected source pin count')
for row in pins['files']:require(sha(row['path'])==row['sha256'],'source pin '+row['path'])
require(sha(TASK/'schema.rs')==pins['schemaSha256'],'whole extracted schema')
native=json.loads((TASK/'layout-result.json').read_text())
require(native['pass'] and native['layout']==[4,8,8,12,4,4,8,8,4,4,24,8,8,16,20,0,1,0],'native pointer32 time64 layout')
for row in native['rows']:
 for c in row['callbacks']:require(c['actual']==c['expected']==c['input']+11,'actual native callback')
for name in ['native-layout5','native-link2','fpcast','native-validate','inspect-layout','native-execute3','release5','bindgen3']:
 j=json.loads((TASK/(name+'.json')).read_text());require(j['exit']==0 and not j['error'] and not j['remainingGroup'],'bounded command '+name)
paths=sys.argv[1:] or ['browser-hardware6','browser-software5']
for name in paths:
 j=json.loads((TASK/name/'result.json').read_text());r=j['result']
 require(j['pass'] and r['pass'] and j['currentPinsUnchanged'] and j['inputsUnchanged'],'report pass/pins')
 require(j['groupEmpty'] and j['serverClosed'] and not j['remainingGroup'] and not j['guardError'],'finite ownership cleanup')
 require(j['endpointOwnership']['verified'] and j['admissionState']['alive'] and j['admissionState']['ownedProfileArgument'],'fresh owned browser admission')
 a=j['affinity'];assigned=a['assignedCpus'];requiredCpuChecks={'hostAllocationStable','browserCountMatchesHost','actualBrowserAffinity'}
 require(set(a['checks'])==requiredCpuChecks and all(a['checks'][k] is True for k in requiredCpuChecks),'actual CPU affinity required checks')
 require(type(a['hostNproc']) is int and a['hostNproc']>0 and a['hostNproc']==a['launchHostNproc']==a['browserHardwareConcurrency']==len(assigned) and all(type(c) is int and c>=0 for c in assigned) and len(set(assigned))==len(assigned),'actual CPU affinity numeric identity/unique allocation')
 require(cpus(a['browserCpuList'])==set(assigned) and set(assigned)<=cpus(a['runnerCpuList']),'actual CPU affinity observed CPU lists')
 require(not j['guestAcceptance'] and not j['firefoxGpuAcceptance'] and not j['releaseAcceptance'],'no integration claims')
 expectedSources={str(ROOT/'web/linux/tests/nightly-webgpu-current'/p) for p in ['src/lib.rs','Cargo.toml','Cargo.lock','probe.html','run.mjs','browser-session.mjs','prepare.py','layout.cpp','inspect-layout.py','run-bounded.py']}|{str(ROOT/'tools/guest-rootfs'/p) for p in ['firefox-browser-affinity.mjs','check-firefox-nightly-benchmark.mjs']}
 require(set(j['runnerSources'])==expectedSources,'complete runner/helper source set')
 for p,h in j['runnerSources'].items():require(sha(p)==h,'runner source '+p)
 routes={'/probe.html':ROOT/'web/linux/tests/nightly-webgpu-current/probe.html','/native.json':TASK/'layout-result.json','/candidate/nightly_webgpu_current.js':TASK/'candidate/nightly_webgpu_current.js','/candidate/nightly_webgpu_current_bg.wasm':TASK/'candidate/nightly_webgpu_current_bg.wasm'}
 for url,p in routes.items():require(any(x['url']==url and x['sha256']==sha(p) and x['bytes']==p.stat().st_size for x in j['requests']),'actual request '+url)
 require(r['protocol']==f"Nightly159:{pins['revision']}:{pins['schemaSha256']}",'exact current protocol revision/schema')
 require(r['schemaRejected'] and r['staleScopeRejected'],'schema and stale empty scope rejection')
 g=r['golden'];require(all(g[k] for k in ['decoded','truncatedRejected','trailingRejected','wrongCountRejected']),'codec controls')
 require(g['nativeIdBytes']==8 and g['wireIdBytes']==12 and bytes(g['map'])==struct.pack('<I',9)+ident(1)+ident(2)+struct.pack('<IQQ',1,8,16),'independent whole golden bytes')
 require(bytes(g['response'])==reply(6,2,struct.pack('<IBQQ',0,0,8,16)),'independent whole successful response bytes')
 ffi=native['layout'].copy();ffi[1]=None;require(g['ffiLayout']==ffi,'Rust/native layout with time_t native-only')
 require(len(r['runs'])==3,'exact modes')
 for run,mode in zip(r['runs'],[('auto',False,'BrowserWebGpu'),('auto',True,'BrowserWebGpu'),('webgl',False,'Gl')]):
  out=run['output'];require((run['backend'],run['compute'],out['backend'])==mode,'actual Rust backend')
  values=[(i*11+2)*(3 if run['compute'] else 1)+(7 if run['compute'] else 0) for i in range(16)]
  require(run['actual']==values and list(struct.unpack('<16I',bytes(out['mapped'][0])))==values,'all independently computed values')
  require(run['resourcesBeforeClose']>0 and run['resourcesAfterClose']==run['cleaned']==0,'measured registries cleanup')
  require(all(run[k] for k in ['staleSessionRejected','truncatedRejected','staleIdRejected','closedRejected']),'negative controls')
  replies=list(map(bytes,out['replies']))
  require(reply(7,3) in replies,'completed queue-work-done response')
  require(reply(2,2,struct.pack('<IQ',0,0)) in replies and reply(2,2,struct.pack('<IQ',1,0)) in replies,'whole no-error and empty-scope responses')
  require(replies[-1]==reply(6,5,struct.pack('<IBQQ',0,0,0,64)),'whole completed map response')
  require(out['capabilities']['wgslComputeStorage']==(mode[2]!='Gl') and not out['capabilities']['texturesRender'] and not out['capabilities']['optionalFeatures'],'honest capability profile')
 if j['mode']=='software':
  require(r['apiIdentity'] and 'swiftshader' in json.dumps(r['apiIdentity']).lower(),'browser API actual software identity')
  require(all(run['output']['adapter']['deviceType']=='Cpu' for run in r['runs'][:2]),'actual Rust CPU adapters')
 else:
  require(r['apiIdentity']['vendor']=='nvidia' and all(run['output']['adapter']['deviceType']!='Cpu' for run in r['runs'][:2]),'actual hardware API/Rust adapter selection')
result={'pass':True,'checks':checks,'reports':paths,'guestAcceptance':False,'firefoxGpuAcceptance':False,'releaseAcceptance':False}
(TASK/'final-check-result.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
