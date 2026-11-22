import os,pathlib,json,hashlib,shutil
T=pathlib.Path(os.environ['GLIBC_TASK']);R=pathlib.Path(__file__).resolve().parent;A=T/'source/glibc-2.44/sysdeps/unix/sysv/linux/wasm32';P=pathlib.Path(os.environ['GLIBC_FINAL16_PLAN'])
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
assert sha(P/'target-matrix.json')=='ef758908f0dd1c7ce16bf041c1d9e163c6a66d1b0c586bec0bad4c80390352ab'
m=json.loads((P/'target-matrix.json').read_text());names=['sync','vhangup','init_module','delete_module','prctl'];rows=[r for r in m['rows']if pathlib.Path(r['unit']).stem in names];assert len(rows)==5
out=T/'source/original-gnu-streams';out.mkdir(exist_ok=True);records=[]
k=pathlib.Path('/mnt/p6/project/linux/linuxonweb/web/linux/vmlinux.wasm');data=k.read_bytes();assert sha(k)=='21c15250e6f27c95fef333a16ffbc411159838f194f0ea19f8adcda3f21b0e75'
for r in rows:
 name=pathlib.Path(r['unit']).stem
 for key in ['source','sourceSnapshot','retainedCommands']:
  q=pathlib.Path(r[key]['path']);assert sha(q)==r[key]['sha256']and q.stat().st_size==r[key]['bytes']
 assert pathlib.Path(r['source']['path']).read_bytes()==pathlib.Path(r['sourceSnapshot']['path']).read_bytes();shutil.copy2(r['source']['path'],out/(name+'.c'))
 for b in r['selectedKernelFunctions']:assert hashlib.sha256(data[b['bodyOffset']:b['bodyOffset']+b['bodySize']]).hexdigest()==b['bodySha256']
 q=R/(name+'.c');(A/q.name).write_bytes(q.read_bytes());records.append({**r,'architectureOverride':str(A/q.name),'overrideSha256':sha(q),'ownedSource':str(q),'originalStreamRetained':str(out/(name+'.c'))})
K=pathlib.Path('/mnt/p6/project/linux/.tmp-firefox-build/nix-local-store/nix/store/s6qc0any0wby0f4nnivpaanvqb9hl130-source');sources={}
for x in ['kernel/sys.c','kernel/module/main.c','fs/sync.c','fs/open.c','include/uapi/linux/prctl.h','arch/wasm/include/asm/syscall.h','security/commoncap.c','security/security.c','include/linux/security.h','kernel/futex/core.c']:
 p=K/x;q=T/'source-snapshots/kernel'/x;q.parent.mkdir(parents=True,exist_ok=True);q.write_bytes(p.read_bytes());sources[str(p)]={'snapshot':str(q),'sha256':sha(p),'bytes':p.stat().st_size}
(T/'logs/arity-source-plan.json').write_text(json.dumps({'pass':True,'wrappers':records,'kernel':{'path':str(k),'sha256':sha(k),'bytes':len(data)},'kernelSources':sources,'prctlOptions':json.loads((R/'prctl-options.json').read_text()),'historicalExportEvidence':['GNU sysdeps/unix/sysv/linux/Versions exports init_module/delete_module in GLIBC_2.0','no current GNU public header declarations; three/two operand prototypes follow selected Linux syscall declarations'],'publicGNUHeadersUnchanged':True},indent=2)+'\n')
