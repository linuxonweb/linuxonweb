import os,pathlib,json,hashlib
R=pathlib.Path(__file__).resolve().parent;T=pathlib.Path(os.environ['GLIBC_TASK']);P=pathlib.Path(os.environ['GLIBC_FINAL16_PLAN'])
hashes={'target-matrix.json':'ef758908f0dd1c7ce16bf041c1d9e163c6a66d1b0c586bec0bad4c80390352ab','kernel-bodies.json':'e52c00a461198435dfaa925e9d5319f58c529569cee3cd3c72dd4cf27fd9606c','source-provenance.json':'adaadc183c1db1efddd670b4ae1ff5673100eb076a2b3a7cdbfc314e8a2b6a54','readback-audit.json':'f57016621383fdd591b4fff8a3d088353534aabb023ab7d997f106b3ed65e9d6'}
for n,h in hashes.items():assert hashlib.sha256((P/n).read_bytes()).hexdigest()==h
j=json.loads((P/'target-matrix.json').read_text());rows=[r for r in j['rows']if r['selected']];assert len(rows)==16
entries=[]
for r in rows:
 typ=r['publicType'];k=r['streamDefines']['SYSCALL_NAME'];entries.append({'call':pathlib.Path(r['unit']).stem,'kernel':k,'public':typ['public'],'return':typ['returnType'],'arguments':typ['arguments'],'header':typ['header'],'noerrno':0,'ULONG_ARG_1':int(r['streamDefines']['SYSCALL_ULONG_ARG_1']),'ULONG_ARG_2':int(r['streamDefines']['SYSCALL_ULONG_ARG_2']),'planRow':r})
(R/'types.json').write_text(json.dumps({'scope':'exact GNU16 signatures and pinned source-only kernel capability plan','entries':entries},indent=2)+'\n')
s=(R/'syscall-template.S').read_text();s=s.replace('#include <sys/fanotify.h>','#include <sys/fanotify.h>\n#include <sys/utsname.h>\n#include <sys/sysinfo.h>\n#include <sys/quota.h>\n#include <fcntl.h>\n#include <sys/uio.h>')
accept='';defs=''
for r in entries:
 k=r['kernel'];accept+=f'#define WASM_ACCEPT_{k} 1\n';defs+=f'#define WASM_RETURN_{k} {r["return"]}\n#define WASM_ARGS_{k} '+(', '.join(f'{a} a{i}'for i,a in enumerate(r['arguments']))or'void')+f'\n#define WASM_NARGS_{k} {len(r["arguments"])}\n#define WASM_PUBLIC_{k} {r["public"]}\n#define WASM_NEW_{k} 1\n#define WASM_NOERRNO_{k} 0\n#define WASM_ULONG1_{k} {r["ULONG_ARG_1"]}\n#define WASM_ULONG2_{k} {r["ULONG_ARG_2"]}\n'
s=s.replace('#define WASM_ACCEPT_setxattr 1',accept+'#define WASM_ACCEPT_setxattr 1').replace('#if SYSCALL_NARGS !=',defs+'#if SYSCALL_NARGS !=')
s=s.replace('#define WASM_NR_I(name)', '#if '+ ' || '.join('SYSCALL_NAME == -1'for _ in []) +'\n#endif\n#define WASM_NR_I(name)') if False else s
# Assert ULONG annotations for precisely these new selectors, without changing old cases.
check='#define WASM_FINAL16_'+entries[0]['kernel']+' 1\n'+''.join('#define WASM_FINAL16_'+e['kernel']+' 1\n'for e in entries[1:])+'#if WASM_CAT(WASM_FINAL16_,SYSCALL_NAME)\n#if SYSCALL_ULONG_ARG_1 != WASM_CAT(WASM_ULONG1_,SYSCALL_NAME) || SYSCALL_ULONG_ARG_2 != WASM_CAT(WASM_ULONG2_,SYSCALL_NAME)\n#error "GNU ULONG transport annotation differs from pinned16 stream"\n#endif\n#endif\n'
s=s.replace('#define WASM_NR_I(name)',check+'#define WASM_NR_I(name)');(R/'syscall-template.S').write_text(s)
signatures='/* Independent genuine GNU public-header client, _ISOMAC; no internal inline substitutions. */\n'+''.join('#include <'+h+'>\n'for h in sorted({e['header']for e in entries}))+'\n#define VERIFY(name,result,...) \\\n _Static_assert(__builtin_types_compatible_p(__typeof__(&name),result (*)(__VA_ARGS__)),#name " GNU public prototype"); \\\n __typeof__(&name) volatile public_reference_##name=&name\n'
for e in entries:signatures+='VERIFY('+e['public']+','+e['return']+','+(','.join(e['arguments'])or'void')+');\n'
signatures+='_Static_assert(sizeof(size_t)==4 && sizeof(unsigned long)==4 && sizeof(ssize_t)==4,"Wasm32 scalar slots");\n';(R/'signatures.c').write_text(signatures)
(T/'logs/plan-pins.json').write_text(json.dumps({'pass':True,'planDirectory':str(P),'hashes':hashes,'selected':16},indent=2)+'\n')
