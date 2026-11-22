#!/usr/bin/env python3
"""Bounded real native normal-path gates; synthetic TP fixture, no GNU runtime claim."""
import argparse, json, os, resource, signal, subprocess, time, re, shutil
from pathlib import Path
from evidence import T, R, P, L, G, H, sha, budget, group

def main():
    parser=argparse.ArgumentParser(); parser.add_argument('--packet',required=True); args=parser.parse_args()
    C=T/args.packet/'objects/compiler/clang'; assert C.exists()
    N=1
    while (T/f'records-controls-{N}').exists(): N+=1
    D=T/f'records-controls-{N}'; D.mkdir(); (D/'logs').mkdir(); (D/'sources').mkdir()
    resource.setrlimit(resource.RLIMIT_CORE,(0,0))
    os.environ.update(TMPDIR=str(T/'tmp'),TMP=str(T/'tmp'),TEMP=str(T/'tmp'),XDG_CACHE_HOME=str(T/'cache'),PYTHONDONTWRITEBYTECODE='1')
    stages=[]; pins={str(C):sha(C)}
    for f in ['records-controls.c','records-runtime.c','frame-abi.h','records-bridge.c','records-stack.S','records-native.mjs','test-module4-normal.py']:
        p=R/f; shutil.copyfile(p,D/'sources'/f); pins[str(p)]=sha(p)
    def run(name,argv,expect=0):
        budget(True)
        with (D/'logs'/(name+'.log')).open('wb') as log:
            started=time.monotonic()
            row={'name':name,'argv':[str(x) for x in argv],'cwd':str(D),'status':'launching'}
            p=subprocess.Popen([str(x) for x in argv],cwd=D,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
            try:
                row.update(pid=p.pid,pgid=p.pid,status='running')
                stages.append(row); (D/'commands.json').write_text(json.dumps(stages,indent=2)+'\n'); print(json.dumps(row),flush=True)
                while p.poll() is None:
                    budget()
                    if time.monotonic()-started>60: raise TimeoutError('bounded native stage timeout')
                    try: p.wait(timeout=1)
                    except subprocess.TimeoutExpired:pass
                code=p.returncode
            finally:
                if p.poll() is None or group(p.pid):
                    try:os.killpg(p.pid,signal.SIGTERM)
                    except ProcessLookupError:pass
                    deadline=time.monotonic()+2
                    while group(p.pid) and time.monotonic()<deadline:time.sleep(.05)
                    if group(p.pid):
                        try:os.killpg(p.pid,signal.SIGKILL)
                        except ProcessLookupError:pass
                p.wait(timeout=10)
                deadline=time.monotonic()+10
                while group(p.pid) and time.monotonic()<deadline:time.sleep(.05)
                row.update(status='terminal',exit=p.returncode,seconds=time.monotonic()-started,members=group(p.pid))
                (D/'commands.json').write_text(json.dumps(stages,indent=2)+'\n')
        assert not row['members'] and ((code==0) if expect==0 else (code!=0)), row
        return (D/'logs'/(name+'.log')).read_text(errors='replace')
    common=['--target=wasm32-unknown-linux-gnu','-ffreestanding','-nostdinc','-fno-builtin','-fno-stack-protector','-fexceptions','-fwasm-exceptions','-matomics','-mbulk-memory']
    inc=['-I'+str(D/'sources'),'-I'+str(G/'sysdeps/generic'),'-I'+str(H/'sysdeps/wasm32'),'-I'+str(H/'sysdeps/wordsize-32')]
    mode=['-mllvm','-wasm-gnu-cancel-prerequisite','-mllvm','-wasm-gnu-frame-records','-mllvm','-verify-machineinstrs']
    outputs=[]
    try:
        for opt in [0,2,3]:
            O=D/f'O{opt}'; O.mkdir(); source=D/'sources/records-controls.c'
            run(f'controls-O{opt}',[C,*common,f'-O{opt}',*mode,'-MD','-MF',O/'controls.d','-c',source,'-o',O/'controls.o'])
            run(f'assembly-O{opt}',[C,*common,f'-O{opt}',*mode,'-S',source,'-o',O/'controls.s'])
            symbols=run(f'symbols-O{opt}',[L/'bin/llvm-nm',O/'controls.o'])
            manifests=re.findall(r'\b[DR] (__wasm_gnu_frame_records_module_v1\.[0-9a-f]+)',symbols); assert len(manifests)==1, symbols
            assert '__wasm_gnu_caller_sp_v1' not in symbols and '__wasm_gnu_frame_commit_sp_v1' not in symbols, symbols
            manifest=manifests[0]
            bridgeflags=['-DCOMPILER_MODULE="'+manifest+'"']
            for name in ['records-runtime','records-bridge']:
                run(f'{name}-O{opt}',[C,*common,*inc,'-O2',*bridgeflags,'-MD','-MF',O/(name+'.d'),'-c',D/'sources'/(name+'.c'),'-o',O/(name+'.o')])
                run(f'{name}-assembly-O{opt}',[C,*common,*inc,'-O2',*bridgeflags,'-S',D/'sources'/(name+'.c'),'-o',O/(name+'.s')])
                assembly=(O/(name+'.s')).read_text()
                assert not re.search(r'global\.set\s+__stack_pointer',assembly), 'bridge/provider allocates linear stack: '+name
            run(f'stack-O{opt}',[L/'bin/llvm-mc','-triple=wasm32-unknown-linux-gnu','-mattr=+atomics,+bulk-memory,+exception-handling','-filetype=obj',D/'sources/records-stack.S','-o',O/'stack.o'])
            module=O/'records.wasm'
            run(f'link-O{opt}',[L/'bin/wasm-ld','--no-entry','--export-all','--export-memory','--shared-memory','-z','stack-size=131072','--initial-memory=393216','--max-memory=393216',O/'controls.o',O/'records-runtime.o',O/'records-bridge.o',O/'stack.o','-o',module])
            run(f'native-disassembly-O{opt}',[L/'bin/llvm-objdump','-d',module])
            outputs.append(module)
            for compiler,label in [(C,'new'),(P/'objects/compiler/clang','basis')]:
                run(f'flags-off-{label}-O{opt}',[compiler,*common,f'-O{opt}','-c',source,'-o',O/(label+'-off.o')])
            assert (O/'new-off.o').read_bytes()==(O/'basis-off.o').read_bytes(), 'flags-off identity'
        result=run('native-runtime',['node',D/'sources/records-native.mjs',*outputs]); native=json.loads(result)
        rejects={'no-early':([], 'unsigned f(unsigned n){return n+1;}'), 'variadic':(mode,'unsigned f(unsigned n,...){return n;}'), 'inline-asm':(mode,'unsigned f(unsigned n){__asm__("");return n;}'), 'source-marker':(mode,'unsigned __wasm_gnu_caller_sp_v1(void){return 9;}'), 'source-provider':(mode,'void __wasm_gnu_frame_leave_v1(void *p){}'), 'source-poll':(mode,'void __wasm_gnu_cancel_poll_v1(unsigned a,unsigned b){}'), 'cleanup':(mode,'extern void cleanup(int*);extern void maythrow(void);void f(void){int x __attribute__((cleanup(cleanup)))=0;maythrow();}')}
        for name,(flags,text) in rejects.items():
            source=D/'sources'/('reject-'+name+'.c');source.write_text(text+'\n')
            if name=='no-early': flags=['-mllvm','-wasm-gnu-frame-records']
            run('reject-'+name,[C,*common,*flags,'-O2','-c',source,'-o',D/('reject-'+name+'.o')],expect=1)
        for name,extra in [('wrong-target',['--target=wasm32-unknown-unknown']),('disabled-cleanup',['-fno-exceptions'])]:
            run('reject-'+name,[C,*common,*mode,*extra,'-O2','-c',D/'sources/records-controls.c','-o',D/('reject-'+name+'.o')],expect=1)
        for p in D.rglob('*'):
            if p.is_file() and p.name!='results.json': pins[str(p)]=sha(p)
        assert all(sha(p)==h for p,h in pins.items())
        proof={'pass':True,'packet':args.packet,'compilerSha256':sha(C),'pins':pins,'stages':stages,'native':native,'forcedUnwind':False,'gnuRuntime':False,'storage':budget()}
    except Exception as exc:
        proof={'pass':False,'error':str(exc),'packet':args.packet,'pins':pins,'stages':stages,'forcedUnwind':False,'gnuRuntime':False,'storage':budget()}
        (D/'results.json').write_text(json.dumps(proof,indent=2)+'\n'); raise
    (D/'results.json').write_text(json.dumps(proof,indent=2)+'\n'); print(json.dumps({'result':str(D/'results.json'),'sha256':sha(D/'results.json'),'pass':True}),flush=True)
if __name__=='__main__': main()
