#!/usr/bin/env python3
"""Reject false broad compilation evidence; synthetic logs only, never a guest gate."""
import copy
import importlib.util
import json
import sys
from pathlib import Path

spec=importlib.util.spec_from_file_location('checker',Path(__file__).with_name('check.py'))
checker=importlib.util.module_from_spec(spec);spec.loader.exec_module(checker)
contract=json.loads((Path(sys.argv[1])/'contract.json').read_text())
checks=[]
def require(name,value):
    assert value,name
    checks.append(name)

def fake():
    lines=[]
    for c in contract['cases']:
        event={'label':contract['label'],'context':c['context'],'id':c['id'],'claim':c['claim']}
        lines.append('NJS '+json.dumps({**event,'event':'case-start'}))
        base=f"file={c['url']} line=1 off=4 tid={'1' if c['context']=='main' else '2'} tls={'0x100' if c['context']=='main' else '0x200'} epoch=5 fn=8"
        if c['claim'] in ('compiled','bailout'):
            lines.append('PBLJIT_OBS event=install '+base+' kind=-1 sp=0 pcDelta=0 ic=0')
            lines.append('PBLJIT_OBS event='+('run' if c['claim']=='compiled' else 'bail')+' '+base+' kind='+('1' if c['claim']=='compiled' else '2')+' sp=4096 pcDelta=18 ic=1')
        else:
            event_name={'excluded':'reject','policy-excluded':'policy-finally' if c['id']=='handler' else 'policy-throw'}[c['claim']]
            lines.append('PBLJIT_OBS event='+event_name+' '+base.replace('fn=8','fn=0')+' kind=-1 sp=0 pcDelta=0 ic=0')
        lines.append('NJS '+json.dumps({**event,'event':'case-done','result':c['expected'],'repetitions':16}))
    for context in ('main','worker'):
        lines.append('NJS '+json.dumps({'label':contract['label'],'context':context,'event':'done','ok':True}))
    return lines

lines=fake()
def result(lines=lines,contract=contract,scope='broad'):
    return checker.check(contract,'\n'.join(lines),scope)
require('complete synthetic broad evidence accepted',result()['pass'])
require('synthetic evidence never full JIT acceptance',not result()['fullJITAcceptance'])
require('broad fixture cannot pass integer scope',not result(scope='integer')['pass'])
old=copy.deepcopy(contract);old.pop('coverage')
require('untagged integer fixture cannot pass broad scope',not result(contract=old)['pass'])
require('semantics alone cannot establish broad coverage',not result([l for l in lines if 'PBLJIT_OBS' not in l])['pass'])
for failure in ['PBLJIT_OBS_EXHAUSTED budget=4096','PBLJIT_OPTION_EXHAUSTED event=startup budget=64 pid=1',next(l.replace('event=install','event=invalid-kind') for l in lines if 'event=install' in l)]:
    require('explicit runtime failure rejected '+failure.split(' ')[0],not result(lines+[failure])['pass'])
for context in ('main','worker'):
    for id,claim in checker.BROAD_CLAIMS.items():
        filename=f'-{context}-{id}.js'
        if claim=='compiled':
            without_run=[l for l in lines if not (filename in l and 'event=run' in l)]
            without_install=[l for l in lines if not (filename in l and 'event=install' in l)]
            require(context+'/'+id+' needs actual run',not result(without_run)['pass'])
            require(context+'/'+id+' needs prior install',not result(without_install)['pass'])
            reject=[l.replace('event=run','event=reject').replace('kind=1','kind=-1') if filename in l else l for l in without_install]
            require(context+'/'+id+' rejection cannot prove compilation',not result(reject)['pass'])
        elif claim=='bailout':
            require(context+'/'+id+' needs actual bail',not result([l for l in lines if not (filename in l and 'event=bail' in l)])['pass'])
        else:
            changed=[l.replace('event=reject','event=install').replace('event=policy-finally','event=install').replace('event=policy-throw','event=install') if filename in l else l for l in lines]
            require(context+'/'+id+' forbidden installation fails',not result(changed)['pass'])
for field,value in [('tid=1','tid=0'),('tls=0x100','tls=0x0'),('epoch=5','epoch=-1'),('fn=8','fn=0'),('sp=4096','sp=0'),('ic=1','ic=-1')]:
    require('invalid '+field+' fails',not result([l.replace(field,value) for l in lines])['pass'])
require('main and worker must have distinct pthread/TLS',not result([l.replace('tid=2 tls=0x200','tid=1 tls=0x100') for l in lines])['pass'])
missing=copy.deepcopy(contract);missing['cases']=[c for c in missing['cases'] if c['id']!='arraywrite']
require('dropped admission case fails',not result(contract=missing)['pass'])
duplicate=copy.deepcopy(contract);duplicate['cases'].append(copy.deepcopy(duplicate['cases'][0]))
require('duplicate admission case fails',not result(contract=duplicate)['pass'])
lowered=copy.deepcopy(contract)
for c in lowered['cases']:
    if c['id']=='arraywrite':c['claim']='excluded'
require('lowered admission requirement fails',not result(contract=lowered)['pass'])
print(json.dumps({'kind':'synthetic-broad-preparation-contract','pass':True,'checks':len(checks),'guestAcceptance':False,'fullJITAcceptance':False}))
