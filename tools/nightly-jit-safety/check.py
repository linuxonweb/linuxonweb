#!/usr/bin/env python3
"""Strict initial integer guest gate. Raw observer logs required; no full acceptance."""
import argparse, hashlib, json, re
from pathlib import Path

def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def number(o,key,lo,hi):
    value=o.get(key,'')
    return isinstance(value,str) and bool(re.fullmatch(r'-?\d+',value)) and lo<=int(value)<=hi
def valid_context(o):
    tls=o.get('tls','')
    return number(o,'tid',1,2**64-1) and bool(re.fullmatch(r'0x[0-9a-fA-F]+',tls)) and 0<int(tls,16)<2**32 and number(o,'epoch',0,2**64-1)
def valid_identity(o):
    return valid_context(o) and number(o,'fn',1,2**32-1)
def valid_exit(o,kind):
    return valid_identity(o) and o.get('kind')==str(kind) and number(o,'sp',1,2**32-1) and number(o,'pcDelta',-2**31,2**31-1) and number(o,'ic',0,2**32-1)
def parse(log):
    events=[];observations=[]
    for index,line in enumerate(log.splitlines()):
        m=re.search(r'PBLJIT_OBS (.*)',line)
        if m:observations.append({'index':index,**dict(re.findall(r'(\w+)=([^\s]+)',m[1]))})
        # Supports raw lines and Firefox's quoted console.log representation.
        text=line
        if 'console.log: ' in text:
            try:text=json.loads(text.split('console.log: ',1)[1])
            except ValueError:continue
        m=re.search(r'NJS (\{.*\})$',text)
        if m:
            try:events.append({'index':index,**json.loads(m[1])})
            except ValueError:pass
    return events,observations

def check(contract,log,scope='integer'):
    events,obs=parse(log);errors=[];rows=[]
    def case_window(c):
        selected=[e for e in events if e.get('label')==contract['label'] and e.get('context')==c['context'] and e.get('id')==c['id']]
        starts=[e for e in selected if e.get('event')=='case-start'];ends=[e for e in selected if e.get('event')=='case-done']
        if len(starts)!=1 or len(ends)!=1:return []
        return [o for o in obs if o.get('file')==c['url'] and o.get('line')=='1' and starts[0]['index']<o['index']<ends[0]['index']]
    thread_sets={context:set() for context in ['main','worker']}
    # A context identity must itself have a successful install and Normal run
    # for an admitted source inside that source's unique case window.
    for c in contract['cases']:
        if c['claim']!='compiled':continue
        window=case_window(c)
        installs=[o for o in window if o.get('event')=='install' and valid_identity(o) and o.get('kind')=='-1']
        for run in window:
            if run.get('event')=='run' and valid_exit(run,1) and any(i['index']<run['index'] and all(i.get(k)==run.get(k) for k in ['tid','tls','epoch','fn']) for i in installs):
                thread_sets[c['context']].add((run['tid'],run['tls']))
    for c in contract['cases']:
        selected=[e for e in events if e.get('label')==contract['label'] and e.get('context')==c['context'] and e.get('id')==c['id']]
        starts=[e for e in selected if e.get('event')=='case-start'];ends=[e for e in selected if e.get('event')=='case-done']
        semantic=len(starts)==1 and len(ends)==1 and starts[0]['index']<ends[0]['index'] and type(ends[0].get('result')) is type(c['expected']) and ends[0].get('result')==c['expected'] and ends[0].get('repetitions')==16 and ends[0].get('claim')==c['claim']
        own=[o for o in obs if o.get('file')==c['url'] and o.get('line')=='1']
        window=[o for o in own if starts and ends and starts[0]['index']<o['index']<ends[0]['index']]
        installs=[o for o in window if o.get('event')=='install' and valid_identity(o) and o.get('kind')=='-1']
        runs=[o for o in window if o.get('event')=='run' and valid_exit(o,1)]
        bails=[o for o in window if o.get('event')=='bail' and valid_exit(o,2)]
        def matching(exits):
            return any(i['index']<r['index'] and all(i.get(k)==r.get(k) for k in ['tid','tls','epoch','fn']) for i in installs for r in exits)
        if c['claim']=='compiled':proved=matching(runs)
        elif c['claim']=='bailout':proved=matching(bails)
        elif c['claim']=='excluded':proved=not any(o.get('event') in ['install','run','bail','noentry'] for o in own) and any(o.get('event')=='reject' and valid_context(o) and number(o,'fn',0,2**32-1) and o.get('kind')=='-1' and (o['tid'],o['tls']) in thread_sets[c['context']] for o in window)
        elif c['claim']=='policy-excluded':
            expected_policy={'handler':'policy-finally','throw':'policy-throw'}.get(c['id'])
            proved=bool(expected_policy) and not any(o.get('event') in ['install','run','bail','noentry'] for o in own) and any(o.get('event')==expected_policy and valid_context(o) and o.get('fn')=='0' and o.get('kind')=='-1' and (o['tid'],o['tls']) in thread_sets[c['context']] for o in window)
        else:proved=False
        required=scope=='integer' or c['id'] in ['sum','branch']
        forbidden_install=c['claim'] in ['excluded','policy-excluded'] and any(o.get('event') in ['install','run','bail','noentry'] for o in own)
        ok=semantic and not forbidden_install and (proved or not required)
        rows.append({'context':c['context'],'id':c['id'],'claim':c['claim'],'semantic':semantic,'sourceSpecificProof':proved,'forbiddenInstallation':forbidden_install,'required':required,'pass':ok})
        if not ok:errors.append(c['context']+'/'+c['id']+': missing semantics or source-specific proof')
    threads=all(thread_sets.values()) and {p[0] for p in thread_sets['main']}.isdisjoint({p[0] for p in thread_sets['worker']}) and {p[1] for p in thread_sets['main']}.isdisjoint({p[1] for p in thread_sets['worker']})
    if not threads:errors.append('missing distinct real main/Worker pthread and TLS identities')
    for context in ['main','worker']:
        done=[e for e in events if e.get('label')==contract['label'] and e.get('context')==context and e.get('event')=='done' and e.get('ok') is True]
        if len(done)!=1:errors.append('missing unique '+context+' completion')
    if any(e.get('event')=='error' for e in events):errors.append('fixture error')
    return {'kind':'guest-evidence-check','scope':scope,'pass':not errors,'fullJITAcceptance':False,'rows':rows,'distinctThreadsTLS':bool(threads),'errors':errors,'pending':['compiled build/CPU gates independent','observer compile/integration and actual policy execution','verified privileged GC/debugger/coverage/interruption','active incremental GC','native stack/TLS callback probes','browser/TLS/performance/release acceptance']}

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--fixture',type=Path,required=True);p.add_argument('--logs',type=Path,required=True);p.add_argument('--out',type=Path,required=True);p.add_argument('--scope',choices=['smoke','integer'],default='integer');a=p.parse_args()
    if not str(a.out.resolve()).startswith('/mnt/p6/build/'):p.error('disk-backed task evidence required')
    contract=json.loads((a.fixture/'contract.json').read_text())
    result=check(contract,a.logs.read_text(),a.scope)
    for name,want in contract['files'].items():
        if digest(a.fixture/name)!=want:result['errors'].append('fixture hash mismatch: '+name)
    result['pass']=not result['errors'];result['inputs']={'contractSha256':digest(a.fixture/'contract.json'),'logsSha256':digest(a.logs)}
    a.out.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result));raise SystemExit(0 if result['pass'] else 1)
if __name__=='__main__':main()
