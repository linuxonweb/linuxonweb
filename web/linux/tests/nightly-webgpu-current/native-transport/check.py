#!/usr/bin/env python3
"""Read-only admission of retained real current golden native transport arms."""
from pathlib import Path
import json,hashlib,re,sys
TASK=Path('/mnt/p6/project/build/nightly-current-native-gpu-transport-20261003');ROOT=Path(__file__).resolve().parents[5];BASE='/linux/tests/nightly-webgpu-current/native-transport/'
sha=lambda b:hashlib.sha256(b).hexdigest()
def cpu_list(value):
 if not isinstance(value,str) or not value:raise ValueError('missing CPU affinity')
 cpus=[]
 for part in value.split(','):
  match=re.fullmatch(r'([0-9]+)(?:-([0-9]+))?',part)
  if not match:raise ValueError('invalid CPU affinity')
  first=int(match[1]);last=int(match[2] or match[1])
  if last<first or last>4095 or (cpus and first<=cpus[-1]):raise ValueError('unsupported or unordered CPU affinity')
  cpus.extend(range(first,last+1))
 return cpus
def check(r):
 checks=[]
 def need(v,label):
  if not v:raise ValueError(label)
  checks.append(label)
 need(r['pass'] is True and r['inputsUnchanged'] is True,'real passing unchanged arm')
 need(r['groupEmpty'] is True and r['remainingGroup']==[] and r['browserExit']=={'code':0,'signal':None} and r['serverClosed'] is True and r['guardError'] is None and all(e=={'url':'/favicon.ico','error':'Error: unsupported route'} for e in r['httpErrors']),'finite teardown')
 need(r['firefoxGpuAcceptance'] is False and r['releaseAcceptance'] is False,'scope')
 x=r['result'];g=x['guest']
 need((r['mode'],x['backend']) in [('hardware','auto'),('software','auto'),('hardware','webgl')],'supported mode/backend pair')
 gl=x['backend']=='webgl';runs=1 if gl else 2
 need(g['pass'] is True and g['done'] is True and g['exitStatus']==0 and g['errors']==[] and g['isolated'] is True,'guest success')
 for kind in (['copy']if gl else['copy','compute']):need(g['logs'].count('CURRENT_GPU_COMPLETE kind='+kind+' values=16 failures=0 queue_callbacks=1 map_callbacks=1 map_response_bytes=37 mapped_bytes=64')==1,'native '+kind+' checks/callbacks')
 need('protocol_rejected=1 closed_rejected=1 stale_device_rejected=1 poisoned_rejected=1 unsupported_destroy_device_rejected=1' in g['logs'] and 'CURRENT_GPU_INIT_EXIT status=0' in g['logs'],'native failure controls')
 for obj,keys in [(r['affinity'],{'hostAllocationStable','browserCountMatchesHost','actualBrowserAffinity'}),(x['cpu'],{'hostAllocationStable','hostCpuSelection','guestCpuCountMatchesHost'})]:
  need(set(obj['checks'])==keys and all(v is True for v in obj['checks'].values()),'exact CPU predicates')
 affinity=r['affinity'];cpu=x['cpu'];count=affinity['hostNproc']
 need(type(count) is int and 1<=count<=64,'reviewed host CPU count')
 counts=[affinity[k] for k in ['launchHostNproc','browserHardwareConcurrency']]+[cpu[k] for k in ['hostNproc','browserHardwareConcurrency','hostCores','expectedHostCores','requestedGuestCpus','hostNprocObserved','browserHardwareConcurrencyAtBoot','selectedGuestCpus','guestBootCpus']]+[g['configuration']['cpus']]
 need(all(type(value) is int and value==count for value in counts),'exact observed browser/host/guest CPU counts')
 assigned=affinity['assignedCpus'];allowed=cpu_list(affinity['runnerCpuList'])
 need(type(assigned) is list and all(type(value) is int for value in assigned) and len(allowed)>=count and assigned==allowed[:count],'exact assigned host CPU list')
 need(cpu_list(affinity['browserCpuList'])==assigned,'exact actual browser CPU affinity')
 smpLines=[line for line in g['bootLogs'].split('\n') if re.search(r'smp: Brought up [0-9]+ nodes?, [0-9]+ CPUs?\b',line)]
 need(bool(smpLines) and cpu['smpLines']==smpLines and all(int(re.search(r', ([0-9]+) CPUs?\b',line)[1])==count for line in smpLines),'raw kernel SMP CPU identities')
 metadata=json.loads((TASK/'package/package.json').read_text());packageBytes=(TASK/'package/package.json').read_bytes();archive=(TASK/'package/initramfs.cpio').read_bytes()
 need(sha(packageBytes)==r['packageSha256']==x['packageSha256'] and sha(archive)==metadata['archiveSha256']==r['archiveSha256']==x['archiveSha256'] and len(archive)==metadata['bytes'],'package identity')
 need(metadata['actualFirefoxClientSerializer'] is False,'explicit golden serializer scope')
 for row in metadata['inputs']+metadata['currentPins']['files']:
  b=Path(row['path']).read_bytes();need(sha(b)==row['sha256'] and len(b)==row['bytes'],'input '+row['path'])
 expectedSources=[ROOT/'web/linux/tests/nightly-webgpu-current/native-transport'/n for n in ['run.mjs','browser-session.mjs','guest.html','owner.mjs','guest.cpp','package.py','fixtures.mjs','run-bounded.py']]+[ROOT/'tools/guest-rootfs'/n for n in ['firefox-host-cpus.mjs','firefox-browser-affinity.mjs','check-firefox-nightly-benchmark.mjs']]
 need(set(r['runnerSources'])==set(map(str,expectedSources)),'complete runner/helper pins')
 for source,h in r['runnerSources'].items():need(sha(Path(source).read_bytes())==h,'runner '+source)
 requests=r['requests'];need(bool(requests),'requests required')
 required=[BASE+'guest.html',BASE+'owner.mjs',BASE+'candidate/package.json',BASE+'candidate/initramfs.cpio',BASE+'candidate/nightly_webgpu_current.js',BASE+'candidate/nightly_webgpu_current_bg.wasm','/linux/vmlinux.wasm','/linux/dist/index.js','/linux/dist/worker.js','/linux/dist/guest-gpu-hostcall.js']
 for url in required:need(any(q['url']==url for q in requests),'required request '+url)
 for q in requests:
  if q['url'].startswith(BASE+'candidate/'):
   b=(TASK/'package'/q['url'].split('/')[-1]).read_bytes()
  else:b=(ROOT/'web'/q['url'].lstrip('/')).read_bytes()
  need(sha(b)==q['sha256'] and len(b)==q['bytes'],'served/requested identity '+q['url'])
 for source,h in r['inputs'].items():need(sha(Path(source).read_bytes())==h,'runtime '+source)
 complete=[o for o in x['owner']if o['kind']=='completed'];mapped=[o for o in complete if o['mappedBytes']]
 need(len(mapped)==runs and all(o['mappedBytes']==[64] and o['replyBytes']==[37] for o in mapped),'completed current readback replies')
 need(all(o['backend']==('Gl'if gl else'BrowserWebGpu') and o['capabilities']['bufferCopyReadMap'] is True and o['capabilities']['wgslComputeStorage'] is (not gl) and o['capabilities']['texturesRender'] is False for o in complete),'genuine backend/capability scope')
 cleanup=[o for o in x['owner']if o['kind']=='cleanup'];last=cleanup[-1]
 need(len(cleanup)==(3 if gl else 4) and all(o['count']==0 for o in cleanup) and last['liveSessions']==0,'owner sessions cleared')
 need(last['stats']['opened']==last['stats']['closed']==len(cleanup) and last['stats']['maps']==last['stats']['completedQueue']==runs and last['stats']['resourcesAfter']==[0]*len(cleanup) and last['stats']['resourcesBefore'][0]>0,'owned resources zero')
 rejected=[o for o in x['owner']if o['kind']=='rejected'];need(len(rejected)==6 and any('operation outside current bounded remote profile'in o['error'] for o in rejected) and any('closed/stale/failed session'in o['error']for o in rejected),'failclosed unsupported and poison controls')
 need(all(o['adapter']['deviceType']==('Cpu'if r['mode']=='software'else'Other')for o in complete),'real Rust adapter classification')
 if not gl:
  need(x['apiIdentity']['vendor']==('google'if r['mode']=='software'else'nvidia'),'observed host API identity')
 return len(checks)
if __name__=='__main__':
 rows=[]
 for name in sys.argv[1:]:
  p=TASK/name/'result.json';r=json.loads(p.read_text());rows.append({'report':str(p),'checks':check(r),'sha256':sha(p.read_bytes())})
 print(json.dumps({'pass':bool(rows),'arms':rows}));assert rows
