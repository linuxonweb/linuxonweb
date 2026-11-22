#!/usr/bin/env python3
"""Pin the five genuine GNU streams and active retained kernel implementations."""
import hashlib,json,os,pathlib
T=pathlib.Path(os.environ['GLIBC_TASK']).resolve()
assert not (T/'logs/plan.json').exists()
G=pathlib.Path(os.environ['GLIBC_PRISTINE_SOURCE']).resolve()
K=pathlib.Path(os.environ['GLIBC_KERNEL_SOURCE']).resolve()
H=pathlib.Path(os.environ['GLIBC_KERNEL_HEADERS']).resolve()
P=pathlib.Path(os.environ['GLIBC_REMAINING_PLAN']).resolve()
B=pathlib.Path(os.environ['GLIBC_KERNEL_BINARY']).resolve()
C=pathlib.Path(os.environ['GLIBC_CHECKED_RUNTIME_PACKET']).resolve()
def digest(p):return {'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
assert digest(B)['sha256']=='21c15250e6f27c95fef333a16ffbc411159838f194f0ea19f8adcda3f21b0e75'
assert digest(C/'manifest.json')['sha256']=='12fbdae877de5e2f639df6152106c00c08536a0b2046dbc8d29edf50ab331c0d'
names=['capget','capset','mount_setattr','pidfd_send_signal','pivot_root']
matrix=json.loads((P/'target-matrix.json').read_text());rows=[]
for name in names:
 matches=[r for r in matrix['rows'] if r['unit']=='misc/'+name+'.o'];assert len(matches)==1
 row=matches[0]
 for key in ['source','sourceSnapshot','retainedCommands']:
  p=pathlib.Path(row[key]['path']);assert digest(p)=={k:row[key][k] for k in ['bytes','sha256']}
 assert pathlib.Path(row['source']['path']).read_bytes()==pathlib.Path(row['sourceSnapshot']['path']).read_bytes()
 assert row['streamDefines']['SYSCALL_NOERRNO']=='0' and row['streamDefines']['SYSCALL_ERRVAL']=='0'
 assert not row['streamAliases']
 rows.append(row)
binary=B.read_bytes();bodies=[]
for row in json.loads((P/'kernel-bodies.json').read_text())['entries']:
 if row['call'] not in names:continue
 selected=[f for f in row['functions'] if f['elementIndices']];assert len(selected)==1
 body=selected[0];raw=binary[body['bodyOffset']:body['bodyOffset']+body['bodySize']]
 assert len(raw)==body['bodySize'] and hashlib.sha256(raw).hexdigest()==body['bodySha256'] and raw!=bytes.fromhex('00415a0b')
 bodies.append({'call':row['call'],'selected':body,'dormantAlternatives':[f for f in row['functions'] if not f['elementIndices']]})
assert len(bodies)==5
inputs={}
for root,nameset in [(G,['sysdeps/unix/sysv/linux/syscalls.list','sysdeps/unix/sysv/linux/sys/mount.h','sysdeps/unix/sysv/linux/sys/pidfd.h','sysdeps/unix/sysv/linux/bits/types/siginfo_t.h','sysdeps/unix/sysv/linux/bits/siginfo-arch.h']),
                     (K,['kernel/capability.c','kernel/signal.c','fs/namespace.c','include/uapi/linux/capability.h','include/uapi/linux/mount.h','include/uapi/asm-generic/siginfo.h','arch/wasm/include/asm/uaccess.h']),
                     (H,['linux/capability.h','linux/mount.h','asm-generic/siginfo.h'])]:
 for name in nameset:
  p=root/name;inputs[str(p)]=digest(p)
for p in [P/'target-matrix.json',P/'kernel-bodies.json',C/'manifest.json',B]:inputs[str(p)]=digest(p)
types={'capget':'int(cap_user_header_t,cap_user_data_t)',
       'capset':'int(cap_user_header_t,const struct __user_cap_data_struct *)',
       'mount_setattr':'int(int,const char *,unsigned int,struct mount_attr *,size_t)',
       'pidfd_send_signal':'int(int,int,siginfo_t *,unsigned int)',
       'pivot_root':'int(const char *,const char *)'}
proof={'pass':True,'scope':'source and active binary plan only; no compilation or runtime acceptance',
 'rows':rows,'kernelBodies':bodies,'inputHashes':inputs,'exactTypes':types,
 'historicalExportsWithoutGNUPublicDeclaration':['capget','capset','pivot_root'],
 'runtimeLineage':str(C),'runtimeObjectsExpected':232,
 'requiredMeasurements':['capability header8/data2x12 offsets and signedness','mount_attr32/four u64 offsets','GNU/kernel siginfo header and relevant union field offsets; contiguous guards'],
 'pidfdBoundary':'NULL transport plus explicitly marshalled SI_USER/SI_QUEUE/SI_TKILL only unless broader field compatibility is independently proved',
 'runtimePlan':['capget v3 and version negotiation; isolated exact no-op capset with unchanged capability sets',
  'configured-source owned mount read-only set/clear and writes; exact size/tail/flag/input guards',
  'pidfd actual non-NULL SI_QUEUE callback payload/pid/uid and failure/errno/input preservation',
  'named pivot child alone chroots into owned mounted old root; nested second mount, pivot and reverse, saved outside dirfd restore and complete unmount cleanup',
  'native and FPCAST retain all 232-object accepted regressions, per-thread errno and public indirect calls'],
 'limitations':['no namespace support invented','no shared runner/root pivot','no capability drops','no kernel or frozen predecessor modifications','build awaits parent ABI plan review']}
(T/'logs/plan.json').write_text(json.dumps(proof,indent=2)+'\n')
print(json.dumps({'pass':True,'streams':len(rows),'activeBodies':len(bodies),'inputs':len(inputs),'planSha256':digest(T/'logs/plan.json')['sha256']}))
