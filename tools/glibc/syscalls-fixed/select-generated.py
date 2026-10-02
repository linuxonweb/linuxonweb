#!/usr/bin/env python3
"""Extract exact genuine GNU streams, checking typed transport conventions."""
import os,pathlib,re,json,hashlib
T=pathlib.Path(os.environ['GLIBC_TASK']);R=pathlib.Path(__file__).resolve().parent
rules=T/'objects/fullmake/sysd-syscalls';body=rules.read_text();out=T/'source/selected-fixed-syscalls';out.mkdir(exist_ok=True)
report=[]
I=pathlib.Path(os.environ['GLIBC_INVENTORY_PACKET'])
original=json.loads((I/'logs/primary-failures.json').read_text())['failedUnits']
for row in json.loads((R/'types.json').read_text())['entries']:
 name=row['call'];blocks=re.findall(r'^#### CALL='+name+r' NUMBER=.*?(?=^#### CALL=|\Z)',body,re.M|re.S)
 blocks=[b for b in blocks if 'SOURCE=-' in b.splitlines()[0] and "echo '#include <syscall-template.S>'" in b]
 assert blocks,name
 streams=['\n'.join(re.findall(r"echo '([^']*)'",b))+'\n' for b in blocks];assert len(set(streams))==1
 stream=streams[0]
 assert '#define SYSCALL_NAME '+row['kernel']+'\n' in stream
 assert '#define SYSCALL_NARGS '+str(len(row['arguments']))+'\n' in stream
 assert '#define SYSCALL_NOERRNO '+str(row['noerrno'])+'\n' in stream and '#define SYSCALL_ERRVAL 0\n' in stream
 p=out/(name+'.c');data=stream.encode()
 matches=[f for f in original if f['primaryClass']=='unaudited generated syscall signature' and pathlib.Path(f['target']).stem==name]
 assert len(matches)==1,(name,'original inventory selection')
 historical=pathlib.Path(matches[0]['sourceSnapshot']);assert historical.read_bytes()==data,(name,'GNU stream differs from frozen failed unit')
 if p.exists():assert p.read_bytes()==data
 else:p.write_bytes(data)
 symbol=re.search(r'#define SYSCALL_SYMBOL (\w+)',stream).group(1)
 report.append({**row,'selectedGNU':True,'rule':blocks[0].splitlines()[0],'symbol':symbol,'stream':str(p),'historicalSourceSnapshot':str(historical),'historicalBytesEqual':True,'sha256':hashlib.sha256(data).hexdigest()})
assert len(report)==36
(T/'logs/selected-fixed-syscalls.json').write_text(json.dumps({'generator':'GNU sysdeps/unix/make-syscalls.sh','rulesSha256':hashlib.sha256(rules.read_bytes()).hexdigest(),'wrappers':report},indent=2)+'\n')
