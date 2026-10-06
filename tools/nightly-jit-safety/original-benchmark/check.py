#!/usr/bin/env python3
"""Review actual original-source, options, raw spans and finite closure evidence.
This gate never accepts full JIT, Worker, performance or GPU coverage.
"""
import argparse,hashlib,json,re
from pathlib import Path
from prepare import SHA,SAMPLE,bodies,task_root
LIMIT=2097152

def digest(data):return hashlib.sha256(data).hexdigest()
def require(test,message):
 if not test:raise ValueError(message)
def integer(n,lo=0,hi=2**53-1):return type(n) is int and lo<=n<=hi
def num(row,k,lo=0,hi=2**64-1):return bool(re.fullmatch(r'-?\d+',row.get(k,''))) and lo<=int(row[k])<=hi
def parsed_line(line,prefix):
 if line.startswith('console.log: '):
  try:line=json.loads(line[len('console.log: '):])
  except ValueError:return None
 if not isinstance(line,str) or not line.startswith(prefix+' '):return None
 try:return json.loads(line[len(prefix)+1:])
 except ValueError:raise ValueError('malformed actual '+prefix+' JSON')
def native_rows(raw,prefix):
 rows=[];offset=0
 for line in raw.decode('utf-8',errors='strict').splitlines(keepends=True):
  end=offset+len(line.encode('utf-8'))
  if line.startswith(prefix+' '):
   fields=line[len(prefix)+1:].strip().split(' ')
   require(all(re.fullmatch(r'\w+=[^\s]+',f) for f in fields),'malformed native raw fields')
   row=dict(f.split('=',1) for f in fields)
   require(len(row)==len(fields),'duplicate native raw fields')
   rows.append({'offsetStart':offset,'offsetEnd':end,**row})
  offset=end
 return rows

def context(row):
 return all(num(row,k,1) for k in ['tid','pthread']) and bool(re.fullmatch('0x[0-9a-fA-F]+',row.get('tls',''))) and 0<int(row['tls'],16)<2**32 and num(row,'epoch') and num(row,'off',0,2**32-1)
def installed(row):return context(row) and num(row,'fn',1,2**32-1) and row.get('kind')=='-1'
def exit_ok(row,kind):return context(row) and num(row,'fn',1,2**32-1) and row.get('kind')==str(kind) and num(row,'sp',1,2**32-1) and num(row,'pcDelta',-2**31,2**31-1) and num(row,'ic',0,2**32-1)
def joined(install,run):return install['offsetEnd']<=run['offsetStart'] and all(install[k]==run[k] for k in ['file','line','off','tid','pthread','tls','epoch','fn'])
def process(row,pid):
 require(row.get('processID')==pid and row.get('kind')=='actual-firefox-primary-diagnostics-v1' and row.get('boundedComplete') is True,'actual complete process diagnostics missing')
 require(row.get('startup')==row.get('current') and isinstance(row.get('startup'),dict),'startup/current environment differs')
 env=row['startup'];require(set(env)=={'PBLJIT','PBLJIT_LOG','PBLJIT_OBSERVE'},'diagnostic environment keys missing')
 require(env['PBLJIT_OBSERVE']=={'exists':True,'value':'1'} and env['PBLJIT_LOG']=={'exists':True,'value':'0'} and env['PBLJIT'] in [{'exists':False,'value':None},{'exists':True,'value':'1'}],'actual diagnostic identity observer1/log0 required')
 for key in ['commandLine','environment']:
  proof=row.get(key,{});require(integer(proof.get('bytes'),1,65536) and re.fullmatch('[0-9a-f]{64}',proof.get('sha256','')),'bounded actual proc raw hash missing')
 require(integer(row['commandLine'].get('argc'),1) and row['commandLine'].get('diagnosticArguments')==[],'debugger arguments or argv proof missing')
 return env

def check(contract,packet,fixture,raw,console,receipt,synthetic=False):
 require(len(fixture)==3175 and digest(fixture)==SHA,'original full fixture hash differs')
 source_bodies=bodies(fixture);label=contract.get('label');require(bool(re.fullmatch('[ab]-[1-6]',label or '')),'owned label required')
 base='/home/admin/nightly-jit-safety/original-bench-'+label+'/'
 uri='file://'+base+'pblbench-'+label+'.html';option=contract.get('option');cpus=contract.get('cpus')
 require(contract.get('kind')=='original-body-diagnostic-contract-v1' and contract.get('base')==base and contract.get('documentURI')==uri and contract.get('fixtureSHA256')==SHA and contract.get('sourceBodies')==source_bodies,'original fixture/install contract invalid')
 require(integer(option,0,1) and integer(cpus,1) and re.fullmatch(r'\d{14}',contract.get('buildID','')),'numeric option/CPU/BuildID required')
 require(packet.get('kind')=='actual-original-body-acquisition-v1' and packet.get('status')=='recorded' and packet.get('label')==label and packet.get('documentURI')==uri and packet.get('fixtureSHA256')==SHA,'actual original acquisition missing')
 require(packet.get('buildID')==contract['buildID']==packet.get('platformBuildID') and packet.get('version')=='159.0a1','actual Nightly build stamp mismatch')
 require(packet.get('optionContext')=='original-benchmark-target-content' and packet.get('lexicalEvalAPI')=='target-native-indirect-eval','actual original target eval/context missing')
 for k in ['pblEnableOwnProperty','pblWarmupOwnProperty','jitTestingFunctionsAvailable','jitCompilerOptionsGetterAvailable','getterSameJSContextAsTarget','liveCurrentGlobal','wrappedContentWindowMatches','globalLexicalCases','acquisitionEventTrusted','acquiredBeforeTimedStart','exactTabRemoved','exactWindowGlobalClosed','currentGlobalGone']:require(packet.get(k) is True,'missing actual proof '+k)
 for k in ['evalCreatesReplacementFunction','debuggerAttached']:require(packet.get(k) is False,'forbidden/missing '+k)
 require(integer(packet.get('portableBaselineOption'),0,1) and packet['portableBaselineOption']==option and integer(packet.get('pblWarmupThreshold')) and packet['pblWarmupThreshold']==10 and type(packet.get('restartPref')) is bool and packet['restartPref']==bool(option),'strict actual getter/pref missing or mismatched')
 require(packet.get('acquisitionEvent')=='DOMContentLoaded' and packet.get('acquisitionDocumentReadyState')=='interactive' and packet.get('unchangedSettleMs')==15000,'original settle event changed')
 require(re.fullmatch('[1-9][0-9]*',packet.get('windowId','')) and integer(packet.get('processID'),1) and packet.get('processType') in [0,2] and packet.get('contentHardwareConcurrency')==cpus,'actual target window/process/CPU missing')
 times=[packet.get(k) for k in ['targetPerformanceBeforeMs','targetPerformanceAfterMs','targetAgeBeforeCloseMs','targetAgeClosedMs']]
 require(all(type(v) in [int,float] and 0<=v<15000 for v in times) and times==sorted(times),'original target close was late or unproved')
 require(type(packet.get('targetTimeOrigin')) in [int,float] and packet['targetTimeOrigin']>0,'target clock identity missing')
 parent=packet.get('parentObservedProcessID');require(integer(parent,1),'actual parent PID missing')
 if packet['processType']==0:require(packet.get('parentObservedInProcess') is True and packet.get('parentObservedOSPid')==-1 and parent==packet['processID'],'in-process OsPid identity mismatch')
 else:require(packet.get('parentObservedInProcess') is False and packet.get('parentObservedOSPid')==packet['processID'],'remote content PID identity mismatch')
 diag=packet.get('processDiagnostics',{});process(diag.get('parent',{}),parent);env=process(diag.get('target',{}),packet['processID']);require(env==packet.get('diagnosticEnvironment'),'target current environment mismatch')
 require(type(raw) is bytes and len(raw)<=LIMIT and (not raw or raw.endswith(b'\n')),'raw native stderr incomplete/oversized')
 require(type(console) is bytes and raw==console,'native and console must be identical complete combined bytes')
 require(b'EXHAUSTED' not in raw and b'PBLJIT_OBS_EXHAUSTED' not in console,'observer exhausted')
 obs=native_rows(raw,'PBLJIT_OBS');opts=native_rows(raw,'PBLJIT_OPTION')
 require(len(obs)<4096 and not any(r.get('event')=='invalid-kind' for r in obs),'observer budget or invalid native return')
 for r in obs:
  require(set(r)=={'offsetStart','offsetEnd','event','file','line','off','tid','pthread','tls','epoch','fn','kind','sp','pcDelta','ic'},'complete exact native observer fields required')
  require(context(r) and num(r,'line',1,2**32-1) and num(r,'fn',0,2**32-1) and num(r,'sp',0,2**32-1) and num(r,'pcDelta',-2**31,2**31-1) and num(r,'ic',0,2**32-1),'malformed complete native observer ABI')
  event=r['event']
  require(event in ['install','run','bail','reject','noentry'],'unexpected native original-body state')
  if event=='install':require(installed(r) and r['sp']=='0' and r['pcDelta']=='0' and r['ic']=='0','malformed native install ABI')
  elif event=='reject':require(r['fn']=='0' and r['kind']=='-1' and r['sp']=='0' and r['pcDelta']=='0' and r['ic']=='0','malformed native reject ABI')
  elif event=='run':require(exit_ok(r,1),'malformed native Normal ABI')
  elif event=='bail':require(exit_ok(r,2),'malformed native Bail ABI')
  else:require(num(r,'fn',1,2**32-1) and r['kind']=='0' and r['sp']=='0' and r['pcDelta']=='0' and r['ic']=='0','malformed native NoEntry ABI')
 startup=[r for r in opts if r.get('event')=='startup' and r.get('pid')==str(packet['processID'])]
 require(startup and all(r.get('available')=='1' and r.get('option')==str(option) and r.get('threshold')=='10' and r.get('pref')==str(option) and r.get('safemode')=='0' and num(r,'tid',1) and num(r,'pthread',1) for r in startup),'actual startup option PID/thread bridge missing')
 threads={(r['tid'],r['pthread']) for r in startup}
 result_rows=[];cases=packet.get('cases');require(type(cases) is list and len(cases)==3,'three original closures required')
 last=0;all_spans=[]
 for actual,(index,name,line,value) in zip(cases,SAMPLE):
  require(actual.get('index')==index and actual.get('name')==name and actual.get('line')==line and actual.get('expected')==value and actual.get('sourceURI')==uri and actual.get('sourceLineExpected')==line and actual.get('sourceText')==source_bodies[str(index)],'actual original closure identity differs')
  require(actual.get('referenceStable') is True and actual.get('functionGlobalMatches') is True and actual.get('invocationExpression')=='cases['+str(index)+'][1]()' and actual.get('invocations')==20 and actual.get('results')==[value]*20 and all(type(v) is int for v in actual['results']),'actual original closure invocation/semantics missing')
  bounds=[]
  for phase in ['before','after']:
   bound=actual.get(phase,{});n=bound.get('bytes');require(integer(n,0,len(raw)) and (n==0 or raw[n-1:n]==b'\n') and digest(raw[:n])==bound.get('sha256'),'actual raw append-only prefix binding missing');bounds.append(n)
  require(last<=bounds[0]<=bounds[1],'raw spans reordered/overlap');last=bounds[1];all_spans.append(bounds)
  own=[r for r in obs if r.get('file')==uri and r.get('line')==str(line)];span=[r for r in own if bounds[0]<=r['offsetStart'] and r['offsetEnd']<=bounds[1]]
  require(all(r in span for r in own),'original source native events outside acquisition span')
  require(all(context(r) and (r['tid'],r['pthread']) in threads and num(r,'fn',0,2**32-1) for r in span),'native target PID/thread/TLS join malformed')
  installs=[r for r in span if r.get('event')=='install' and installed(r)];normal=[r for r in span if r.get('event')=='run' and exit_ok(r,1)];bail=[r for r in span if r.get('event')=='bail' and exit_ok(r,2)]
  require(not any(r['event']=='reject' for r in span) or not any(r['event'] in ['install','run','bail','noentry','interrupt'] for r in span),'rejected original body also emitted installation/execution')
  require(all(any(joined(i,r) for i in installs) for r in span if r['event'] in ['run','bail','noentry']),'native exit lacks exact preceding original installation')
  if option==0:require(not any(r.get('event') in ['install','run','bail','noentry','interrupt'] for r in obs),'disabled runtime emitted native installation/execution')
  elif index==0:require(any(joined(i,r) for i in installs for r in normal),'genuine original let-local loop install/Normal missing')
  else:
   rejects=[r for r in span if r.get('event')=='reject' and r.get('fn')=='0' and r.get('kind')=='-1']
   successful=any(joined(i,r) for i in installs for r in normal+bail)
   require(successful or (rejects and not installs and not any(r.get('event') in ['run','bail','noentry','interrupt'] for r in own)),'other original body lacks native disposition')
  require(all(r.get('event') in ['install','run','bail','reject','noentry'] for r in span),'unexpected native original-body state')
  require(all(exit_ok(r,1) for r in span if r.get('event')=='run') and all(exit_ok(r,2) for r in span if r.get('event')=='bail'),'malformed native output storage')
  result_rows.append({'name':name,'actualSourceURI':uri,'actualNativeLines':sorted({r['line'] for r in span}),'observations':len(span),'installs':len(installs),'normalRuns':len(normal),'bailouts':len(bail),'nativeLoopOffsets':sorted({int(r['off']) for r in span}),'scopePass':True})
 require(all(r.get('file')==uri and r.get('line') in ['19','24','25'] for r in obs),'unrelated/misattributed native observation in isolated scope')
 close=packet.get('afterCloseRaw',{});n=close.get('bytes');require(integer(n,last,len(raw)) and digest(raw[:n])==close.get('sha256'),'after-close raw prefix missing')
 # Complete raw stdout through process exit, never just target DOM text or one
 # console snapshot, proves no original timed row was emitted anywhere.
 require(type(console) is bytes and len(console)<=LIMIT and console.endswith(b'\n'),'complete bounded console scope required')
 console_lines=console.decode('utf-8',errors='strict').splitlines();bench=[row for l in console_lines if (row:=parsed_line(l,'PBLBENCH')) is not None]
 require(len(bench)==1 and bench[0].get('event')=='start' and bench[0].get('label')==label and bench[0].get('hc')==cpus,'actual original timed/error/done rows or missing unique start')
 doc=packet.get('originalResultText');require(type(doc) is str and doc.startswith('Settling\n') and [parsed_line(l,'PBLBENCH') for l in doc.splitlines() if l.startswith('PBLBENCH ')]==bench,'original DOM start differs from complete console')
 acquisitions=[row for l in console_lines if (row:=parsed_line(l,'PBLORIGINAL')) is not None];require(acquisitions==[packet],'raw console/acquisition packet differs or missing')
 require(not re.search(r'MOZ_CRASH|Assertion failure|panicked|Segmentation fault|RuntimeError:|SIGSEGV|SIGABRT|PBLORIGINALFAIL',console.decode()),'fatal or failed acquisition raw console')
 require(receipt.get('kind')=='actual-original-diagnostic-outer-receipt-v1' and receipt.get('status')=='recorded','actual outer receipt missing')
 require(synthetic or receipt.get('synthetic') is False,'synthetic receipt cannot prove actual execution')
 for k in ['firefoxReaped','browserReaped','nativeProcessGroupsPhysicallyEmpty','hostProcessGroupsPhysicallyEmpty','observerCompleteFromStartupThroughExit','consoleCompleteFromStartupThroughExit','nativeLogAppendOnly']:require(receipt.get(k) is True,'complete natural scope missing '+k)
 for k in ['forcedCleanup','guardStop','queryTimeout']:require(receipt.get(k) is False,'failure/missing '+k)
 require(receipt.get('firefoxExitCode')==0 and receipt.get('targetProcessID')==packet['processID'] and receipt.get('parentProcessID')==parent,'actual terminal process identity missing')
 require(all(integer(receipt.get(k),1) and receipt[k]==cpus for k in ['hostCPUs','browserCPUs','guestCPUs','kernelCPUs']),'actual equal CPU acquisition missing')
 require(receipt.get('observerSHA256')==digest(raw) and receipt.get('consoleSHA256')==digest(console) and receipt.get('fixtureSHA256')==SHA,'outer complete raw scope hashes differ')
 return {'kind':'original-body-raw-review-v1','scopePass':True,'runtimeAcceptance':False,'fullJITAcceptance':False,'gpuAcceptance':False,'workerAcceptance':False,'originalFixtureHasWorker':False,'performanceAcceptance':False,'syntheticHostOnly':synthetic,'option':option,'label':label,'originalFixtureSHA256':SHA,'observerSHA256':digest(raw),'consoleSHA256':digest(console),'nativeInstalls':sum(r.get('event')=='install' for r in obs),'nativeNormalRuns':sum(r.get('event')=='run' for r in obs),'rawObservationComplete':True,'observerExhaustion':False,'originalIntLoopInstallNormal':option==1,'rows':result_rows,'pending':['independent actual source/raw review and admitted whole gate joins','separate broad main/Worker/GC/debug/interrupt/TLS gates','unchanged diagnostics-off eight-case ABBAAB performance']}

def main():
 p=argparse.ArgumentParser();p.add_argument('--task-root',type=Path,required=True);p.add_argument('--install',type=Path,required=True);p.add_argument('--acquisition',type=Path,required=True);p.add_argument('--native',type=Path,required=True);p.add_argument('--console',type=Path,required=True);p.add_argument('--receipt',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args()
 root=task_root(a.task_root)
 require(a.out.resolve()!=root and a.out.resolve().is_relative_to(root),'owned review output required')
 try:
  require(all(x.stat().st_size<=LIMIT for x in [a.acquisition,a.native,a.console,a.receipt]),'bounded evidence files required')
  c=json.loads((a.install/'contract.json').read_text());manifest=json.loads((a.install/'install-manifest.json').read_text())
  for row in manifest['files']:
   name=Path(row['path']).name;f=a.install/name;require(f.stat().st_size==row['bytes'] and digest(f.read_bytes())==row['sha256'],'install actual pin differs '+name)
  fixture=(a.install/('pblbench-'+c['label']+'.html')).read_bytes();result=check(c,json.loads(a.acquisition.read_text()),fixture,a.native.read_bytes(),a.console.read_bytes(),json.loads(a.receipt.read_text()))
  result['acquisitionSHA256']=digest(a.acquisition.read_bytes());result['receiptSHA256']=digest(a.receipt.read_bytes())
 except (ValueError,KeyError,TypeError,OSError) as e:result={'kind':'original-body-raw-review-v1','scopePass':False,'errors':[str(e)],'runtimeAcceptance':False}
 a.out.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result));raise SystemExit(0 if result['scopePass'] else 1)
if __name__=='__main__':main()
