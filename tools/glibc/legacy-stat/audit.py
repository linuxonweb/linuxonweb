#!/usr/bin/env python3
"""Audit GNU source selection, exact adapters, dependency bytes and host tests."""
import hashlib,json,os,pathlib,re,shlex,subprocess
T=pathlib.Path(os.environ['GLIBC_TASK']);S=T/'source/glibc-2.44';R=pathlib.Path(__file__).resolve().parent;L=pathlib.Path(os.environ['GLIBC_TOOLCHAIN'])/'bin'
dest=T/'logs/legacy-audit.json';assert not dest.exists()
def digest(p):return {'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
overlay=json.loads((T/'logs/legacy-overlay.json').read_text());assert overlay['pass']
original=pathlib.Path(overlay['GNUoriginal']);selected=pathlib.Path(overlay['selectedSource']);pristine=pathlib.Path(os.environ['GNU_RELEASE_ARCHIVE']).parent.parent/'source/glibc-2.44'
assert original.read_bytes()==(pristine/original.relative_to(S)).read_bytes()
body=selected.read_text();guard='#if _STAT_VER_KERNEL != _STAT_VER_LINUX\n'
assert body.count(guard)==3
# Remove only the exact added preprocessor guards. No GNU body rewrite.
restored=body.replace(guard+'    case _STAT_VER_KERNEL:\n#endif\n','    case _STAT_VER_KERNEL:\n')
restored=restored.replace(guard+'    case _STAT_VER_KERNEL:\n','    case _STAT_VER_KERNEL:\n').replace('      break;\n#endif\n\n    case _STAT_VER_LINUX:','      break;\n\n    case _STAT_VER_LINUX:')
assert restored==original.read_text()
header=pathlib.Path(overlay['header']);base=(T/'source-snapshots/kernel_stat-before.h').read_bytes();fields=(R/'kernel-stat-fields.h').read_bytes()
assert header.read_bytes()==base[:-len(b'#endif\n')]+fields+b'\n#endif\n'
version=S/'sysdeps/unix/sysv/linux/xstatver.h';assert version.read_bytes()==(pristine/version.relative_to(S)).read_bytes()
units=[];headers={};drivers={};records=[];fixtureAttempt=None;configureAttempts=[]
for p in sorted((T/'logs/c-attempts').glob('*/attempt.json')):
 j=json.loads(p.read_text())
 if pathlib.Path(j['source']).name=='conftest.c':
  snap=pathlib.Path(j['sourceSnapshot']);d=pathlib.Path(j['driverSnapshot'])
  assert digest(snap)['sha256']==j['sourceSha256'] and digest(d)['sha256']==j['driverSha256']
  configureAttempts.append({'proof':str(p),'sourceSnapshot':str(snap),'sourceHash':digest(snap),'driverSnapshot':str(d),'driverHash':digest(d),'pass':j['pass']})
  continue
 assert j['pass'] and all(s['exit']==0 for s in j['stages'])
 source=pathlib.Path(j['source']);snap=pathlib.Path(j['sourceSnapshot']);assert digest(source)['sha256']==digest(snap)['sha256']==j['sourceSha256']
 d=pathlib.Path(j['driverSnapshot']);assert digest(d)['sha256']==j['driverSha256'];drivers[str(d)]=digest(d)
 obj=pathlib.Path(j['output']);assert obj.read_bytes()[:8]==b'\0asm\1\0\0\0';assert digest(obj)=={'bytes':j['objectBytes'],'sha256':j['objectSha256']}
 dep=pathlib.Path(next(s for s in j['stages'] if s['stage']=='frontend')['argv'][next(s for s in j['stages'] if s['stage']=='frontend')['argv'].index('-MF')+1])
 for word in shlex.split(dep.read_text().replace('\\\n',' ').split(':',1)[1]):
  q=pathlib.Path(word.removesuffix(':'))
  if not q.is_absolute():q=pathlib.Path(j['cwd'])/q
  if q.is_file():headers[str(q.resolve())]=digest(q)
 record={'proof':str(p),'source':str(source),'snapshot':str(snap),'sourceHash':digest(source),'object':str(obj),'objectHash':digest(obj)};records.append(record)
 if source==selected:record['GNUderivedWithThreeExactGuards']=True;units.append(record)
 elif str(source).startswith(str(S)+'/'):
  q=pristine/source.relative_to(S);assert q.read_bytes()==source.read_bytes();record['unchangedGNU']=True;units.append(record)
 else:assert source.name=='fixture.c';fixtureAttempt=j
assert len(units)==6 and len(records)==7 and fixtureAttempt
assert (T/'source-snapshots/fixture.c').read_bytes()==(R/'fixture.c').read_bytes()
host=json.loads((T/'logs/host-result.json').read_text());assert host['pass'] and len(host['results'])==2
for row in host['results']:
 assert row['passed']==24612 and row['failed']==0 and not row['imports'];assert digest(pathlib.Path(row['file']))=={k:row[k] for k in ['bytes','sha256']}
link=json.loads((T/'logs/host-link-inputs.json').read_text());assert len(link['inputs'])==7
for name,h in link['inputs'].items():assert digest(pathlib.Path(name))==h
# Capture a real target-layout diagnostic from the same successful frontend
# arguments without touching its object/IR/depfile or repeating runtime tests.
stage=next(s for s in fixtureAttempt['stages'] if s['stage']=='frontend');argv=stage['argv'].copy()
for flag in ['-o','-MF','-MT']:
 i=argv.index(flag);del argv[i:i+2]
for flag in ['-MD','-MP','-S','-emit-llvm']:
 if flag in argv:argv.remove(flag)
argv+=['-fsyntax-only','-Xclang','-fdump-record-layouts-complete']
layout=subprocess.run(argv,cwd=stage['cwd'],capture_output=True,text=True)
(T/'logs/target-layouts.txt').write_text(layout.stdout+layout.stderr)
(T/'logs/target-layouts-command.json').write_text(json.dumps({'argv':argv,'cwd':stage['cwd'],'exit':layout.returncode},indent=2)+'\n');assert layout.returncode==0
for tag,size in [('kernel_stat',104),('__kernel_uapi_stat64',104),('stat',128),('stat64',128)]:
 blocks=[b for b in layout.stdout.split('*** Dumping AST Record Layout') if re.search(r'\| struct '+tag+r'\n',b)]
 assert len(blocks)==1 and f'[sizeof={size}, align=8]' in blocks[0],tag
proof={'pass':True,'scope':host['scope'],'GNUunits':units,'attempts':records,'configureAttempts':configureAttempts,'drivers':drivers,'headers':headers,
 'originalGNUConverter':{'path':str(original),'hash':digest(original)},'selectedGNUConverter':{'path':str(selected),'hash':digest(selected)},
 'publicVersionHeader':{'path':str(version),'hash':digest(version)},'publicVersions':[0,0],'raw104BytePublicCopySupported':False,
 'kernelLayout':{'bytes':104,'alignment':8,'offsetComparisonFields':20,'diagnostic':str(T/'logs/target-layouts.txt')},
 'publicLayout':{'bytes':128,'alignment':8,'GNUZeroedPads':['__pad1','__pad2'],'GNUUntouchedReservedAndTimePadding':[84,100,116,120,124]},
 'nativeAndFPCAST':host['results'],'hostLinkInputs':link['inputs'],'limitations':['synthetic inputs only','no kernel syscall or guest acceptance','not a full archive/sysroot']}
dest.write_text(json.dumps(proof,indent=2)+'\n');print(json.dumps({'pass':True,'GNUunits':len(units),'attempts':len(records),'headers':len(headers),'checksPerMode':24612}))
