#!/usr/bin/env python3
"""Synthetic checker contract regressions only; no guest/browser execution."""
import importlib.util,json,re,sys
from pathlib import Path
spec=importlib.util.spec_from_file_location('checker',Path(__file__).with_name('check.py'));mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
contract=json.loads((Path(sys.argv[1])/'contract.json').read_text());checks=[]
def assert_case(name,predicate):
    assert predicate,name
    checks.append(name)
def fake_log(with_policy=False):
    lines=[]
    for c in contract['cases']:
        event={'label':contract['label'],'context':c['context'],'id':c['id'],'claim':c['claim']}
        lines.append('NJS '+json.dumps({**event,'event':'case-start'}))
        base=f"file={c['url']} line=1 off=4 tid={'1' if c['context']=='main' else '2'} tls={'0x100' if c['context']=='main' else '0x200'} epoch=5 fn=8"
        if c['claim'] in ['compiled','bailout']:
            lines.append('PBLJIT_OBS event=install '+base+' kind=-1 sp=0 pcDelta=0 ic=0')
            lines.append('PBLJIT_OBS event='+('run' if c['claim']=='compiled' else 'bail')+' '+base+' kind='+('1' if c['claim']=='compiled' else '2')+' sp=4096 pcDelta=18 ic=1')
        elif c['claim']=='excluded':lines.append('PBLJIT_OBS event=reject '+base.replace('fn=8','fn=0')+' kind=-1 sp=0 pcDelta=0 ic=0')
        elif c['claim']=='policy-excluded' and with_policy:
            reason='policy-finally' if c['id']=='handler' else 'policy-throw'
            lines.append('PBLJIT_OBS event='+reason+' '+base.replace('fn=8','fn=0')+' kind=-1 sp=0 pcDelta=0 ic=0')
        lines.append('NJS '+json.dumps({**event,'event':'case-done','result':c['expected'],'repetitions':16}))
    for context in ['main','worker']:lines.append('NJS '+json.dumps({'label':contract['label'],'context':context,'event':'done','ok':True}))
    return '\n'.join(lines)
log=fake_log()
assert_case('synthetic smoke accepted as bounded gate',mod.check(contract,log,'smoke')['pass'])
assert_case('never full JIT acceptance',not mod.check(contract,log,'smoke')['fullJITAcceptance'])
assert_case('missing actual policy events prevent integer pass',not mod.check(contract,log)['pass'])
assert_case('missing actual observer records fail',not mod.check(contract,'\n'.join(l for l in log.splitlines() if 'PBLJIT_OBS' not in l),'smoke')['pass'])
assert_case('install without run fails',not mod.check(contract,log.replace('event=run','event=other'),'smoke')['pass'])
assert_case('wrong emitted result fails',not mod.check(contract,log.replace('8386560','1'),'smoke')['pass'])
assert_case('shared pthread/TLS identity fails',not mod.check(contract,log.replace('tid=2 tls=0x200','tid=1 tls=0x100'),'smoke')['pass'])
assert_case('same pthread distinct TLS fails',not mod.check(contract,log.replace('tid=2','tid=1'),'smoke')['pass'])
assert_case('same TLS distinct pthread fails',not mod.check(contract,log.replace('tls=0x200','tls=0x100'),'smoke')['pass'])
for field in ['tid=1','epoch=5','fn=8','pcDelta=18','ic=1']:
    assert_case('missing '+field+' fails',not mod.check(contract,log.replace(field,''),'smoke')['pass'])
for field in ['tid=0','tls=0x0','epoch=-1','fn=0','pcDelta=2147483648','ic=-1']:
    original={'tid=0':'tid=1','tls=0x0':'tls=0x100','epoch=-1':'epoch=5','fn=0':'fn=8','pcDelta=2147483648':'pcDelta=18','ic=-1':'ic=1'}[field]
    assert_case('invalid '+field+' fails',not mod.check(contract,log.replace(original,field),'smoke')['pass'])
assert_case('wrong filename fails',not mod.check(contract,log.replace('file:///home/admin/nightly-jit-safety/','file:///wrong/'),'smoke')['pass'])
assert_case('wrong kind fails',not mod.check(contract,log.replace('kind=1','kind=0'),'smoke')['pass'])
assert_case('missing TLS evidence fails',not mod.check(contract,log.replace('tls=0x100',''),'smoke')['pass'])
assert_case('zero output stack pointer fails',not mod.check(contract,log.replace('sp=4096','sp=0'),'smoke')['pass'])
assert_case('missing completion fails',not mod.check(contract,log.rsplit('\n',1)[0],'smoke')['pass'])
assert_case('compilation after case completion fails',not mod.check(contract,'\n'.join(l for l in log.splitlines() if not l.startswith('PBLJIT_OBS'))+'\n'+'\n'.join(l for l in log.splitlines() if l.startswith('PBLJIT_OBS')),'smoke')['pass'])
assert_case('wrong label fails',not mod.check(contract,log.replace(contract['label'],'wrong'),'smoke')['pass'])
quoted='\n'.join('console.log: '+json.dumps(l) if l.startswith('NJS ') else l for l in log.splitlines())
assert_case('actual Firefox quoted format parsed',mod.check(contract,quoted,'smoke')['pass'])
assert_case('excluded opcode installation never coverage',not next(r for r in mod.check(contract,log.replace('event=reject','event=install'))['rows'] if r['id']=='array')['sourceSpecificProof'])
assert_case('excluded installation also fails smoke',not mod.check(contract,log.replace('event=reject','event=install'),'smoke')['pass'])
def rewrite_rejects(transform):
    return '\n'.join(transform(line) if 'event=reject' in line else line for line in log.splitlines())
def array_proof(modified,context='main'):
    return next(row for row in mod.check(contract,modified)['rows'] if row['id']=='array' and row['context']==context)['sourceSpecificProof']
assert_case('actual reject fn zero accepted with proven context',array_proof(log))
for field in ['tid','tls','epoch']:
    changed=rewrite_rejects(lambda line:re.sub(r'\b'+field+r'=\S+\s*','',line))
    assert_case('reject missing '+field+' lacks source proof',not array_proof(changed))
    assert_case('Worker reject missing '+field+' lacks source proof',not array_proof(changed,'worker'))
wrong_context=rewrite_rejects(lambda line:line.replace('tid=1 tls=0x100','tid=2 tls=0x200') if '-main-' in line else line.replace('tid=2 tls=0x200','tid=1 tls=0x100'))
assert_case('main reject from Worker context lacks proof',not array_proof(wrong_context))
assert_case('Worker reject from main context lacks proof',not array_proof(wrong_context,'worker'))
unproven_context=rewrite_rejects(lambda line:line.replace('tid=1 tls=0x100','tid=3 tls=0x300'))
assert_case('reject unproven positive context lacks proof',not array_proof(unproven_context))
policy_log=fake_log(True)
assert_case('all synthetic actual event families permit bounded integer pass',mod.check(contract,policy_log)['pass'])
assert_case('integer pass never full JIT acceptance',not mod.check(contract,policy_log)['fullJITAcceptance'])
def policy_proof(modified,context='main',id='handler'):
    return next(row for row in mod.check(contract,modified)['rows'] if row['id']==id and row['context']==context)['sourceSpecificProof']
def rewrite_policy(transform):
    return '\n'.join(transform(line) if 'event=policy-' in line else line for line in policy_log.splitlines())
for field in ['tid','tls','epoch']:
    changed=rewrite_policy(lambda line:re.sub(r'\b'+field+r'=\S+\s*','',line))
    assert_case('main policy missing '+field+' lacks proof',not policy_proof(changed))
    assert_case('Worker policy missing '+field+' lacks proof',not policy_proof(changed,'worker'))
assert_case('wrong Finally policy reason lacks proof',not policy_proof(policy_log.replace('event=policy-finally','event=policy-catch')))
assert_case('generic reject cannot prove policy',not policy_proof(policy_log.replace('event=policy-finally','event=reject')))
assert_case('wrong Throw policy reason lacks proof',not policy_proof(policy_log.replace('event=policy-throw','event=policy-throw-stack'),id='throw'))
for context in ['main','worker']:
    other='worker' if context=='main' else 'main'
    wrong=rewrite_policy(lambda line:line.replace('tid=1 tls=0x100','tid=2 tls=0x200') if context=='main' and '-main-' in line else line.replace('tid=2 tls=0x200','tid=1 tls=0x100') if context=='worker' and '-worker-' in line else line)
    assert_case(context+' policy from '+other+' context lacks proof',not policy_proof(wrong,context))
assert_case('installed policy source fails integer',not mod.check(contract,policy_log.replace('event=policy-finally','event=install'))['pass'])
assert_case('policy nonzero fn lacks proof',not policy_proof(rewrite_policy(lambda line:line.replace('fn=0','fn=8'))))
assert_case('policy malformed epoch lacks proof',not policy_proof(rewrite_policy(lambda line:line.replace('epoch=5','epoch=bad'))))
assert_case('policy wrong source filename lacks proof',not policy_proof(rewrite_policy(lambda line:line.replace('-main-handler.js','-main-other.js'))))
outside='\n'.join(line for line in policy_log.splitlines() if 'event=policy-' not in line)+'\n'+'\n'.join(line for line in policy_log.splitlines() if 'event=policy-' in line)
assert_case('policy outside case window lacks proof',not policy_proof(outside))
print(json.dumps({'kind':'synthetic-preparation-contract','pass':True,'checks':len(checks),'names':checks,'guestAcceptance':False}))
