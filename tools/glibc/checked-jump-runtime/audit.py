#!/usr/bin/env python3
import os,pathlib,json,hashlib,re,subprocess
T=pathlib.Path(os.environ['GLIBC_TASK']);R=pathlib.Path(__file__).resolve().parent;P=pathlib.Path(os.environ['GLIBC_CHECKED_JUMP_PACKET']);B=pathlib.Path(os.environ['GLIBC_FINAL16_PACKET'])
def digest(p):return {'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size}
load=lambda p:json.loads(p.read_text())
a=load(T/'logs/selected-inputs.json');base=load(T/'logs/base-inputs.json');assert a['pass']and base['pass']and a['ordinaryBodyPreserved']and a['checkedBodyPreserved']
assert len(a['objects'])==232 and len(a['selected'])==2
formats={}
for row in a['objects']:
 p=pathlib.Path(row['path']);assert digest(p)=={k:row[k]for k in ['sha256','bytes']};formats[row['format']]=formats.get(row['format'],0)+1
assert formats=={'Wasm-v1':211,'LLVM-bitcode':21};assert not (T/'objects/guest/jump-helpers.o').exists()
for row in a['selected']:assert digest(pathlib.Path(row['original']))==digest(pathlib.Path(row['path']))
for row in a['makeAttempts']:
 assert digest(pathlib.Path(row['sourceSnapshot']))['sha256']==row['sourceSha256']==digest(pathlib.Path(row['source']))['sha256'];assert digest(pathlib.Path(row['driverSnapshot']))['sha256']==row['driverSha256'];assert digest(pathlib.Path(row['output']))['sha256']==row['objectSha256'];assert all(x['exit']==0 for x in row['stages'])
abi=(T/'logs/abi.log').read_text();imports=re.findall(r'^ - func\[\d+\].*? <- (.+)$',abi,re.M);assert sorted(imports)==['linux.copy_siginfo','linux.get_thread_area','linux.syscall']
functions=re.findall(r'^ - func\[\d+\] sig=\d+ <([^>]+)>',abi,re.M);assert '__longjmp' in functions and '____longjmp_chk' in functions;assert not set(['__wrap_abort','__internal_syscall_cancel','__new_sem_wait','sem_wait'])&set(functions)
runs={}
for mode in ['native','fpcast']:
 d=T/(mode+'-run1');b=load(d/'result.json');g=load(d/'final16-result.json');j=load(d/'jumps-result.json');assert b['pass']and g['pass']and j['pass']and b['jit']['failures']==0 and b['serverClosed']and b['browserExit']['code']==0;assert not pathlib.Path('/proc/'+str(b['browserPid'])).exists();assert j['diagnostics']==3 and j['runs']==6 and all(x['pass']for x in j['negative'])
 runs[mode]={'passes':b['jit']['passes'],'failures':0,'priorFinal16Gate':g,'checkedJumpGate':j,'allocatorLocks':b['allocatorLocks'],'browserPid':b['browserPid'],'browserExit':b['browserExit'],'serverClosed':True}
supervision={}
for p in (T/'logs/supervision').glob('*.json'):
 j=load(p);assert j['exit']==0 and not j['terminalMembers'];supervision[p.stem]=j
assert 'AssertionError' in (T/'logs/build1-console.log').read_text() and (T/'source-snapshots/failed-selection-bootstrap/select.py').is_file()
result={'pass':True,'phase':'prepared for root freeze review','runs':runs,'linkObjects':232,'formats':formats,'objects':a['objects'],'selectedProviders':a['selected'],'providerSelection':a,'baseInputs':base,'imports':imports,'supervision':supervision,'retainedFailure':'Preparation build1 failed before supervision startup: select.py shadowed Python stdlib select; failed source/log preserved, renamed provider-select.py and corrected duplicate-success attempt selection. No failed guest run or altered frozen input.','taskKiB':int(subprocess.check_output(['du','-sk',str(T)]).split()[0]),'limits':['genuine GNUmake selection of owned native Wasm architecture jump providers, not upstream GNU-authored Wasm jump algorithms','no new jump ABI or cancellation/forced unwind/C++','all full libc/sysroot/Nightly/JIT/GPU acceptance remains pending','single-arena manually reserved startup policy inherited']}
(T/'prepared-acceptance.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'pass':True,'runs':runs,'objects':232,'formats':formats,'taskKiB':result['taskKiB']}))
