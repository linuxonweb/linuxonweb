#!/usr/bin/env python3
import copy,json
from pathlib import Path
from check import check,digest,SHA,SAMPLE,bodies
FIXTURE=Path('/mnt/p6/project/linux/linuxonweb/web/linux/tests/guest-jit-pbl-bench.html').read_bytes()
PASSED=[]
def sample(option):
 label='b-1' if option else 'a-1';base='/home/admin/nightly-jit-safety/original-bench-'+label+'/';uri='file://'+base+'pblbench-'+label+'.html'
 c={'kind':'original-body-diagnostic-contract-v1','label':label,'base':base,'documentURI':uri,'fixtureSHA256':SHA,'sourceBodies':bodies(FIXTURE),'option':option,'cpus':6,'buildID':'20261004075010'}
 env={'PBLJIT':{'exists':False,'value':None},'PBLJIT_LOG':{'exists':True,'value':'0'},'PBLJIT_OBSERVE':{'exists':True,'value':'1'}}
 proc={'kind':'actual-firefox-primary-diagnostics-v1','processID':17,'boundedComplete':True,'startup':copy.deepcopy(env),'current':copy.deepcopy(env),'commandLine':{'bytes':16,'sha256':'a'*64,'argc':2,'diagnosticArguments':[]},'environment':{'bytes':32,'sha256':'a'*64}}
 p={'kind':'actual-original-body-acquisition-v1','status':'recorded','label':label,'documentURI':uri,'fixtureSHA256':SHA,'buildID':c['buildID'],'platformBuildID':c['buildID'],'version':'159.0a1','optionContext':'original-benchmark-target-content','lexicalEvalAPI':'target-native-indirect-eval','portableBaselineOption':option,'pblWarmupThreshold':10,'restartPref':bool(option),'acquisitionEvent':'DOMContentLoaded','acquisitionDocumentReadyState':'interactive','unchangedSettleMs':15000,'windowId':'55','processID':17,'processType':0,'contentHardwareConcurrency':6,'targetPerformanceBeforeMs':25,'targetPerformanceAfterMs':60,'targetAgeBeforeCloseMs':65,'targetAgeClosedMs':70,'targetTimeOrigin':1000,'parentObservedProcessID':17,'parentObservedOSPid':-1,'parentObservedInProcess':True,'processDiagnostics':{'parent':copy.deepcopy(proc),'target':copy.deepcopy(proc)},'diagnosticEnvironment':env,'cases':[]}
 for k in ['pblEnableOwnProperty','pblWarmupOwnProperty','jitTestingFunctionsAvailable','jitCompilerOptionsGetterAvailable','getterSameJSContextAsTarget','liveCurrentGlobal','wrappedContentWindowMatches','globalLexicalCases','acquisitionEventTrusted','acquiredBeforeTimedStart','exactTabRemoved','exactWindowGlobalClosed','currentGlobalGone']:p[k]=True
 for k in ['evalCreatesReplacementFunction','debuggerAttached']:p[k]=False
 raw=f'PBLJIT_OPTION event=startup pid=17 tid=17 pthread=128 option={option} threshold=10 available=1 pref={option} safemode=0\n'.encode()
 def boundary():return {'bytes':len(raw),'sha256':digest(raw)}
 for index,name,line,value in SAMPLE:
  before=boundary()
  if option:
   entries=[('install',1,-1),('run',1,1)] if index==0 else [('reject',0,-1)]
   for event,fn,kind in entries:
    raw+=f'PBLJIT_OBS event={event} file={uri} line={line} off=22 tid=17 pthread=128 tls=0x1000 epoch=0 fn={fn} kind={kind} sp={100 if event=="run" else 0} pcDelta=0 ic=0\n'.encode()
  p['cases'].append({'index':index,'name':name,'line':line,'expected':value,'sourceURI':uri,'sourceLineExpected':line,'sourceText':c['sourceBodies'][str(index)],'referenceStable':True,'functionGlobalMatches':True,'invocationExpression':f'cases[{index}][1]()','invocations':20,'results':[value]*20,'before':before,'after':boundary()})
 p['afterCloseRaw']=boundary();start={'event':'start','label':label,'hc':6,'ua':'synthetic-host-only'};p['originalResultText']='Settling\nPBLBENCH '+json.dumps(start)
 def transcript():return ('PBLBENCH '+json.dumps(start)+'\nPBLORIGINAL '+json.dumps(p)+'\n').encode()
 raw+=transcript();console=raw;r={'kind':'actual-original-diagnostic-outer-receipt-v1','status':'recorded','synthetic':True,'firefoxExitCode':0,'targetProcessID':17,'parentProcessID':17,'hostCPUs':6,'browserCPUs':6,'guestCPUs':6,'kernelCPUs':6,'observerSHA256':digest(raw),'consoleSHA256':digest(console),'fixtureSHA256':SHA}
 for k in ['firefoxReaped','browserReaped','nativeProcessGroupsPhysicallyEmpty','hostProcessGroupsPhysicallyEmpty','observerCompleteFromStartupThroughExit','consoleCompleteFromStartupThroughExit','nativeLogAppendOnly']:r[k]=True
 for k in ['forcedCleanup','guardStop','queryTimeout']:r[k]=False
 return [c,p,FIXTURE,raw,console,r]
def exercise(name,modify=None,option=1,rebind=False):
 x=sample(option);original=sample(option)
 if modify:modify(x)
 if rebind:
  for row in x[1]['cases']:
   for phase in ['before','after']:
    bound=row[phase];bound['sha256']=digest(x[3][:bound['bytes']])
  bound=x[1]['afterCloseRaw'];bound['sha256']=digest(x[3][:bound['bytes']])
 # Rebind outer hashes and packet transcript to prevent trivial hash mismatch
 # from hiding the intended semantic rejection.
 start={'event':'start','label':x[0]['label'],'hc':6,'ua':'synthetic-host-only'}
 if x[3]!=original[3] and x[4]==original[4]:x[4]=x[3]
 elif x[4]!=original[4] and x[3]==original[3]:x[3]=x[4]
 old=original[4][original[1]['afterCloseRaw']['bytes']:]
 new=('PBLBENCH '+json.dumps(start)+'\nPBLORIGINAL '+json.dumps(x[1])+'\n').encode()
 x[3]=x[3].replace(old,new);x[4]=x[4].replace(old,new)
 x[5]['observerSHA256']=digest(x[3]);x[5]['consoleSHA256']=digest(x[4])
 try:result=check(*x,synthetic=True)
 except (ValueError,KeyError,TypeError):
  if not modify:raise
 else:
  if modify:raise AssertionError('negative accepted '+name)
  assert result['scopePass'] and not result['runtimeAcceptance']
 PASSED.append(name)
def packet(key,value):return lambda x:x[1].__setitem__(key,value)
exercise('enabled original body scope');exercise('disabled whole raw zero events',option=0)
for key,value in [('portableBaselineOption',True),('portableBaselineOption','1'),('pblWarmupThreshold','10'),('restartPref',1),('getterSameJSContextAsTarget',False),('globalLexicalCases',False),('exactWindowGlobalClosed',False),('targetAgeClosedMs',15000),('documentURI','about:blank'),('debuggerAttached',True),('evalCreatesReplacementFunction',True),('windowId','0'),('processType',1),('parentObservedOSPid',17),('acquisitionEventTrusted',False),('lexicalEvalAPI','window.cases'),('targetTimeOrigin',None)]:exercise('reject '+key+str(value),packet(key,value))
exercise('missing option own flag',lambda x:x[1].pop('pblEnableOwnProperty'))
exercise('source-body substitute',lambda x:x[1]['cases'][0].__setitem__('sourceText','()=>49995000'))
exercise('changed original bytes',lambda x:x.__setitem__(2,x[2]+b' '))
exercise('bounded invocation changed',lambda x:x[1]['cases'][0].__setitem__('invocations',21))
exercise('wrong semantics',lambda x:x[1]['cases'][0]['results'].__setitem__(0,0))
exercise('missing otherbody disposition',lambda x:x[1]['cases'][1].__setitem__('after',x[1]['cases'][1]['before']))
exercise('missing actual close raw',lambda x:x[1].pop('afterCloseRaw'))
exercise('raw prefix changed',lambda x:x[1]['cases'][0]['before'].__setitem__('sha256','0'*64))
exercise('exhaustion',lambda x:x.__setitem__(3,x[3]+b'PBLJIT_OBS_EXHAUSTED budget=4096\n'))
exercise('bad native TLS',lambda x:x.__setitem__(3,x[3].replace(b'tls=0x1000',b'tls=0x0000')),rebind=True)
exercise('no Normal native original int',lambda x:x.__setitem__(3,x[3].replace(b'event=run',b'event=bail')),rebind=True)
exercise('bad native pcDelta',lambda x:x.__setitem__(3,x[3].replace(b'pcDelta=0',b'pcDelta=2147483648')))
exercise('wrong native startup pid',lambda x:x.__setitem__(3,x[3].replace(b'pid=17',b'pid=18')),rebind=True)
exercise('missing full raw receipt',lambda x:x[5].__setitem__('observerCompleteFromStartupThroughExit',False))
exercise('forced cleanup',lambda x:x[5].__setitem__('forcedCleanup',True))
exercise('query timeout',lambda x:x[5].__setitem__('queryTimeout',True))
exercise('CPU mismatch',lambda x:x[5].__setitem__('kernelCPUs',2))
exercise('missing env startup/current',lambda x:x[1]['processDiagnostics']['target']['startup']['PBLJIT_LOG'].__setitem__('value','24'))
exercise('timed row',lambda x:x.__setitem__(4,x[4]+b'PBLBENCH {"event":"case"}\n'))
exercise('done row',lambda x:x.__setitem__(4,x[4]+b'PBLBENCH {"event":"done"}\n'))
exercise('partial console',lambda x:x.__setitem__(4,x[4][:-1]))
exercise('disabled native event fullraw',lambda x:x.__setitem__(3,x[3]+b'PBLJIT_OBS event=install file=other line=1 off=1 tid=17 pthread=128 tls=0x1000 epoch=0 fn=1 kind=-1 sp=0 pcDelta=0 ic=0\n'),option=0)
# Fixture type cannot silently become actual through the public checker path.
try:check(*sample(1))
except ValueError: PASSED.append('synthetic forbidden from actual check')
else:raise AssertionError('synthetic actual accepted')
print(json.dumps({'kind':'original-body-checker-host-tests-v1','passed':len(PASSED),'checks':PASSED,'syntheticHostOnly':True,'actualFirefoxPending':True,'runtimeAcceptance':False},indent=2))
