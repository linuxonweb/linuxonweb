#!/usr/bin/env python3
"""Adversarial pure host fixtures, explicitly synthetic; no guest evidence."""
import copy
import importlib.util
import json
import sys
import subprocess
from pathlib import Path
spec=importlib.util.spec_from_file_location('privileged_checker',Path(__file__).with_name('check-privileged.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
checks=[]
def assertion(name,value):
    assert value,name
    checks.append(name)
def fixture(scope='incremental'):
    label='synthetic_privileged'
    meta={'scope':scope,'label':label,'runId':'{00000000-0000-4000-8000-000000000001}','windowId':'77','version':'159.0a1','applicationBuildID':'20261002211853','platformBuildID':'20261002211853','observerLogPath':'/home/admin/nightly-jit-safety/'+label+'/observer.log','fixtureNames':['sum','debugFresh','coverage','infinite']}
    source=lambda n:'file:///home/admin/nightly-jit-safety/'+label+'/'+label+'-main-'+n+'.js'
    lines=[];events=[]
    def obs(event,name='sum',epoch=5,fn=None,**change):
        fn=fn if fn is not None else (8 if event in {'install','run','gc-evict','interrupt'} else 0)
        row={'event':event,'file':source(name),'line':1,'off':4,'tid':1,'pthread':33,'tls':'0x100','epoch':epoch,'fn':fn,'kind':{'run':1,'interrupt':3}.get(event,-1),'sp':4096 if event in {'run','interrupt'} else 0,'pcDelta':18 if event in {'run','interrupt'} else 0,'ic':1 if event in {'run','interrupt'} else 0,**change}
        lines.append('PBLJIT_OBS '+' '.join(k+'='+str(v) for k,v in row.items())+'\n')
    size=lambda:len(''.join(lines).encode())
    def emit(event,**row):events.append({'label':label,'runId':meta['runId'],'windowId':'77','event':event,**row})
    emit('identity',**{k:meta[k] for k in ['scope','version','applicationBuildID','platformBuildID','observerLogPath']},initialState='NotActive')
    obs('install');obs('run')
    def start(event,source_name='sum',**rest):
        lo=size();emit(event,source=source(source_name),beforeBytes=lo,**rest);return lo
    def done(event,lo,source_name='sum',**rest):emit(event,source=source(source_name),beforeBytes=lo,afterBytes=size(),observerLogPath=meta['observerLogPath'],**rest)
    if scope=='incremental':
        lo=start('incremental-start',api='Cu.getJSTestingFunctions().startgc',workBudget=1,initialState='NotActive')
        obs('skip-incremental')
        emit('incremental-loop-done',beforeState='Mark',afterState='Mark',result=8386560)
        emit('incremental-cleanup',state='NotActive',ownedGCcleanup=True)
        done('incremental-done',lo,beforeState='Mark',afterState='Mark',result=8386560)
    elif scope=='slice-gc':
        lo=start('slice-start',api='Cu.getJSTestingFunctions().startgc/gcslice/finishgc',workBudget=1,initialState='NotActive')
        emit('slice-state',state='Mark',sliceWorkBudget=1)
        emit('slice-cleanup',state='NotActive',ownedGCcleanup=True)
        obs('gc-evict',epoch=6);obs('install',epoch=6,fn=9);obs('run',epoch=6,fn=9)
        done('slice-done',lo,results=[8386560]*16)
    elif scope=='gc-debug-coverage':
        lo=start('gc-start',api='Components.utils.forceGC')
        obs('gc-evict',epoch=6);obs('install',epoch=6,fn=9);obs('run',epoch=6,fn=9)
        emit('gc-cleanup',state='NotActive');done('gc-done',lo,results=[8386560]*16)
        for name in ['sum','debugFresh']:
            lo=start('debug-start',name,name=name,offset=0);obs('skip-debuggee',name,epoch=6)
            emit('debug-cleanup',name=name,breakpointCount=0,debuggeeCount=0)
            done('debug-done',lo,name,name=name,result=8386560,breaks=1,steps=64,locals=[{'i':2,'s':1},{'i':2,'s':3}])
        lo=start('coverage-start','coverage',collectCoverageInfo=True);obs('skip-debuggee','coverage',epoch=6);obs('skip-coverage','coverage',epoch=6)
        emit('coverage-cleanup',debuggeeCount=0,collectCoverageInfo=False)
        done('coverage-done',lo,'coverage',result=8386560,offsets=[{'offset':4,'count':4096,'lineNumber':1,'columnNumber':1}])
    else:
        lo=start('interrupt-start','infinite',timeoutSeconds=1,globalStopScript=False)
        obs('install','infinite',fn=10);obs('interrupt','infinite',fn=10);obs('interrupt-callback-abort','infinite')
        obs('run','sum')
        emit('interrupt-cleanup',prefsRestored=True)
        done('interrupt-done',lo,'infinite',result=8386560,elapsedMs=1200,recoveryWindowId='77')
    emit('driver-done',scope=scope,ok=True)
    return meta,events,''.join(lines).encode()
def encoded(events,quoted=False):
    lines=['NJS_PRIV '+json.dumps(e) for e in events]
    return ('\n'.join('console.log: '+json.dumps(l) if quoted else l for l in lines)+'\n').encode()
def evaluate(f):return m.check_records(f[0],encoded(f[1]),f[2])
def bad(name,scope,mutate):
    f=fixture(scope);mutate(f);assertion(name,not evaluate(f)['pass'])
for scope in m.SEQUENCES:
    f=fixture(scope)
    assertion('synthetic complete '+scope,evaluate(f)['pass'])
    assertion('no guest/full JIT claim '+scope,not evaluate(f)['guestAcceptance'] and not evaluate(f)['fullJITAcceptance'])
    assertion('quoted Firefox console '+scope,m.check_records(f[0],encoded(f[1],True),f[2])['pass'])
    for i in range(len(f[1])):
        bad(scope+' missing operation '+str(i),scope,lambda f,i=i:f[1].pop(i))
    bad(scope+' duplicated identity',scope,lambda f:f[1].insert(0,copy.deepcopy(f[1][0])))
    bad(scope+' out-of-order cleanup',scope,lambda f:f[1].reverse())
    for k,v in [('label','wrong'),('runId','{wrong}'),('windowId','88')]:
        bad(scope+' drift '+k,scope,lambda f,k=k,v=v:f[1][2].update({k:v}))
    for k in ['version','applicationBuildID','platformBuildID','observerLogPath']:
        bad(scope+' wrong '+k,scope,lambda f,k=k:f[1][0].update({k:'wrong'}))
# tuple fixture mutation helper for raw logs
for scope in m.SEQUENCES:
    meta,events,raw=fixture(scope)
    for failure in [b'PBLJIT_OBS_EXHAUSTED budget=4096\n',b'PBLJIT_OPTION_EXHAUSTED event=startup budget=64 pid=1\n',raw.splitlines(keepends=True)[0].replace(b'event=install',b'event=invalid-kind')]:
        assertion(scope+' exhausted/invalid-kind rejected '+str(failure),not m.check_records(meta,encoded(events),raw+failure)['pass'])
    for name,broken in [('fatal',raw+b'MOZ_CRASH fatal\n'),('quoted observer',raw.replace(b'PBLJIT_OBS ',b'console.log: PBLJIT_OBS ',1)),('duplicate raw field',raw.replace(b'tid=1',b'tid=1 tid=1',1)),('missing raw field',raw.replace(b'pthread=33 ',b'',1)),('no raw records',b''),('wrong source',raw.replace(b'-main-sum.js',b'-main-wrong.js')),('TLS zero',raw.replace(b'tls=0x100',b'tls=0x0')),('zero TID',raw.replace(b'tid=1',b'tid=0')),('bad epoch',raw.replace(b'epoch=5',b'epoch=-1')),('bad native fn',raw.replace(b'fn=8',b'fn=0')),('zero output stack',raw.replace(b'sp=4096',b'sp=0'))]:
        assertion(scope+' '+name,not m.check_records(meta,encoded(events),broken)['pass'])
    for start in [i for i,e in enumerate(events) if e['event'].endswith('-start')]:
        for name,value in [('negative',-1),('split',1),('bool',True),('pastEOF',len(raw)+1)]:
            bad(scope+' '+str(start)+' invalid byte window '+name,scope,lambda f,start=start,value=value:f[1][start].update(beforeBytes=value))
for field,value in [('beforeState','NotActive'),('afterState','NotActive'),('result',0)]:
    bad('incremental '+field,'incremental',lambda f,field=field,value=value:f[1][2].update({field:value}))
for event,field,value in [('incremental-cleanup','ownedGCcleanup',False),('incremental-cleanup','state','Mark'),('incremental-start','workBudget',0)]:
    bad(event+' '+field,'incremental',lambda f,event=event,field=field,value=value:next(e for e in f[1] if e['event']==event).update({field:value}))
for scope,reason in [('incremental','skip-incremental'),('gc-debug-coverage','skip-debuggee'),('gc-debug-coverage','skip-coverage')]:
    meta,events,raw=fixture(scope)
    for replacement in ['reject','install','run','bail','noentry','interrupt']:
        assertion(scope+' missing skip replaced '+replacement,not m.check_records(meta,encoded(events),raw.replace(('event='+reason).encode(),('event='+replacement).encode()))['pass'])
for scope in ['slice-gc','gc-debug-coverage']:
    meta,events,raw=fixture(scope)
    for name,broken in [('no eviction',raw.replace(b'event=gc-evict',b'event=reject')),('same epoch',raw.replace(b'epoch=6',b'epoch=5')),('new epoch goes backwards',raw.replace(b'epoch=6',b'epoch=4')),('wrong evicted function',raw.replace(b'event=gc-evict',b'event=gc-evict').replace(b'epoch=6 fn=8',b'epoch=6 fn=7')),('new run wrong fn',raw.replace(b'fn=9 kind=1',b'fn=10 kind=1'))]:
        assertion(scope+' '+name,not m.check_records(meta,encoded(events),broken)['pass'])
for event,field,value in [('debug-done','locals',[]),('debug-done','locals',[{'i':2,'s':9}]),('debug-done','breaks',0),('debug-done','steps',0),('debug-cleanup','debuggeeCount',1),('debug-cleanup','breakpointCount',1),('coverage-cleanup','collectCoverageInfo',True),('coverage-done','offsets',[]),('coverage-done','offsets',[{'offset':1,'lineNumber':1,'columnNumber':1,'count':0}])]:
    bad(event+' '+field+' invalid '+str(value),'gc-debug-coverage',lambda f,event=event,field=field,value=value:next(e for e in f[1] if e['event']==event).update({field:value}))
meta,events,raw=fixture('interrupt')
assertion('recovery only cannot prove actual interruption',not m.check_records(meta,encoded(events),raw.replace(b'event=interrupt-callback-abort',b'event=interrupt-callback-continue'))['pass'])
for event,field,value in [('interrupt-cleanup','prefsRestored',False),('interrupt-done','recoveryWindowId','88'),('interrupt-done','elapsedMs',16000),('interrupt-start','globalStopScript',True)]:
    bad(event+' '+field,'interrupt',lambda f,event=event,field=field,value=value:next(e for e in f[1] if e['event']==event).update({field:value}))
for malformed in [b'NJS_PRIV {bad}\n',b'NJS_PRIV {"event":"identity","event":"identity"}\n']:
    assertion('malformed/duplicate JSON '+str(malformed),not m.check_records(meta,malformed,raw)['pass'])
if len(sys.argv)>1:
    scratch=Path(sys.argv[1]);scratch.mkdir(parents=True,exist_ok=True)
    p=scratch/'synthetic-acquisition.json';p.write_text(json.dumps({'kind':'synthetic-host-fixture'}))
    for pin in [m.sha(p.read_bytes()),'0'*64]:
        try:m.check_production(p,pin)
        except m.Rejected:assertion('production refuses synthetic/pin '+pin,True)
        else:assertion('production refuses synthetic',False)
if len(sys.argv)>1:
    driver_test=scratch/'mocked-driver.cjs'
    driver_test.write_text(r"""
const fs=require('fs'),vm=require('vm');
const driver=fs.readFileSync(process.argv[2],'utf8');const names=[];
function ok(name,value){if(!value)throw Error(name);names.push(name);}
function mock(options={}){
 const logs=[],calls=[],prefs=new Map([['dom.max_script_run_time',5],['dom.always_stop_slow_scripts',false],['dom.global_stop_script',true]]),users=new Set(['dom.max_script_run_time']);let state=options.initialState||'NotActive',raw='retained raw prefix\n', finishes=0;
 const label='mocked_driver',prefix='file:///home/admin/nightly-jit-safety/'+label+'/'+label+'-main-';
 raw='PBLJIT_OBS event=install file='+prefix+'sum.js line=1 off=4 tid=1 pthread=33 tls=0x100 epoch=5 fn=8 kind=-1 sp=0 pcDelta=0 ic=0\nPBLJIT_OBS event=run file='+prefix+'sum.js line=1 off=4 tid=1 pthread=33 tls=0x100 epoch=5 fn=8 kind=1 sp=4096 pcDelta=18 ic=1\n';
 const target={nightlySafetyMainDone:true,nightlySafetyLabel:label,windowGlobalChild:{innerWindowId:77,isInProcess:true,isCurrentGlobal:true,isClosed:false},njs_sum(){calls.push('sum');raw+='raw operation append\n';if(options.wrongResult)return 1;return 8386560;},njs_infinite(){},document:{createElement(){return {remove(){}};},documentElement:{appendChild(){target.nightlyInterruptRecovered=8386560;raw+='mocked recovery append\n';}}}};
 target.windowGlobalChild.contentWindow=target;
 const testing={gcstate(){return state;},startgc(b){calls.push('startgc:'+b);state=options.inactiveStart?'NotActive':'Mark';},gcslice(b,o){calls.push('gcslice:'+b+':'+o.dontStart);},finishgc(){finishes++;state='NotActive';calls.push('finishgc');}};
 class Debugger {constructor(){this.debuggees=[];this.collectCoverageInfo=false;this.script=null;}addDebuggee(){this.debuggees=[target];return {getOwnPropertyDescriptor:(name)=>({value:{script:this.script={url:prefix+name.slice(4)+'.js',getPossibleBreakpoints:()=>[{offset:0}],setBreakpoint:(off,handler)=>{this.handler=handler;},clearAllBreakpoints:()=>{this.handler=null;},getBreakpoints:()=>this.handler?[0]:[],getOffsetsCoverage:()=>[{offset:4,lineNumber:1,columnNumber:1,count:4096}]}}}),executeInGlobal:()=>{raw+='mocked debugger append\n';if(this.handler){const frame={environment:{getVariable:n=>n==='i'?2:1}};this.handler.hit(frame);frame.onStep.call(frame);}if(options.debugThrow)throw Error('mocked debug execution');return {return:8386560};}};}removeAllDebuggees(){this.debuggees=[];calls.push('removeDebuggees');}getDebuggees(){return this.debuggees;}}
 const context={Services:{appinfo:{appBuildID:'20261002211853',platformBuildID:'20261002211853',version:'159.0a1'},uuid:{generateUUID:()=>'{00000000-0000-4000-8000-000000000001}'},prefs:{prefHasUserValue:n=>users.has(n),getIntPref:n=>prefs.get(n),getBoolPref:n=>prefs.get(n),setIntPref(n,v){prefs.set(n,v);users.add(n);},setBoolPref(n,v){prefs.set(n,v);users.add(n);},clearUserPref(n){users.delete(n);prefs.set(n,n==='dom.max_script_run_time'?5:n==='dom.global_stop_script');}}},Components:{utils:{waiveXrays:v=>v,importGlobalProperties(){},getJSTestingFunctions:()=>options.missingApi?{}:testing,forceGC(){calls.push('forceGC');}}},IOUtils:{async read(){return new TextEncoder().encode(raw);}},ChromeUtils:{importESModule:()=>({addDebuggerToGlobal(){}})},Debugger,console:{log:l=>logs.push(JSON.parse(l.slice(9)))},TextEncoder,TextDecoder,setTimeout,Date,Map,Set};
 vm.createContext(context);vm.runInContext(driver,context);return {api:context.NightlySafetyDriver,target,logs,calls,finishes:()=>finishes,state:()=>state,prefs,users,path:'/home/admin/nightly-jit-safety/'+label+'/observer.log'};
}
(async()=>{
 for(const [method,scope] of [['run','gc-debug-coverage'],['incremental','incremental'],['sliceGC','slice-gc'],['interrupt','interrupt']]){const x=mock();await x.api[method](x.target,x.path);ok(method+' complete scope',x.logs.at(-1).event==='driver-done'&&x.logs.at(-1).scope===scope);ok(method+' actual window/run binding',x.logs.every(e=>e.windowId==='77'&&e.runId===x.logs[0].runId));ok(method+' bounded byte windows',x.logs.filter(e=>e.afterBytes!==undefined).every(e=>e.afterBytes>e.beforeBytes));}
 for(const options of [{inactiveStart:true},{wrongResult:true}]){const x=mock(options);try{await x.api.incremental(x.target,x.path);throw Error('unexpected pass');}catch(e){ok('incremental error owns finish '+JSON.stringify(options),x.finishes()===1&&x.state()==='NotActive'&&x.logs.some(e=>e.event==='incremental-cleanup'));}}
 const x=mock();await x.api.sliceGC(x.target,x.path);ok('slice bounded exact calls',x.calls.includes('startgc:1')&&x.calls.includes('gcslice:1:true')&&x.finishes()===1);
 const d=mock({debugThrow:true});try{await d.api.run(d.target,d.path);}catch(e){ok('debug error removes debuggee',d.calls.includes('removeDebuggees')&&d.logs.some(e=>e.event==='debug-cleanup'&&e.debuggeeCount===0));}
 const i=mock();await i.api.interrupt(i.target,i.path);ok('interrupt restores pref values and user bits',i.prefs.get('dom.max_script_run_time')===5&&i.prefs.get('dom.always_stop_slow_scripts')===false&&i.prefs.get('dom.global_stop_script')===true&&i.users.size===1);ok('mocked recovery never claims native callback',i.logs.every(e=>e.actualSpecializerInterrupt!==true&&!e.callbackAbort));
 for(const [name,options,path] of [['active initial',{initialState:'Mark'},null],['missing testing API',{missingApi:true},null],['path traversal',{},'/home/admin/nightly-jit-safety/mocked_driver/../bad'],['missing actual window',{},null]]){const y=mock(options);if(name==='missing actual window')y.target.windowGlobalChild=null;let refused=false;try{await y.api.incremental(y.target,path||y.path);}catch(e){refused=true;}ok(name+' rejected before starting GC',refused&&!y.calls.some(c=>c.startsWith('startgc')));}
 process.stdout.write(JSON.stringify({kind:'mocked-driver-preparation',pass:true,checks:names.length,names,guestAcceptance:false})+'\n');
})().catch(e=>{process.stderr.write(String(e)+'\n');process.exitCode=1;});
""")
    done=subprocess.run(['node',str(driver_test),str(Path(__file__).with_name('privileged-driver.js').resolve())],capture_output=True,text=True,check=True)
    mocked=json.loads(done.stdout)
    (scratch/'mocked-driver-result.json').write_text(json.dumps(mocked,indent=2)+'\n')
    checks.extend(mocked['names'])
print(json.dumps({'kind':'synthetic-privileged-checker-fixtures','pass':True,'checks':len(checks),'names':checks,'guestAcceptance':False,'fullJITAcceptance':False}))
