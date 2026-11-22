#!/usr/bin/env python3
"""Compile real GNU unwind.c/layout with real backend64; no runtime claim."""
import sys
sys.dont_write_bytecode = True
import json, pathlib, re, shlex, shutil
from common import T, R, C, L, pin, run

PEER = T.parent/'glibc-native-frame-plan-20261002'
BRIDGE = T.parent/'glibc-cancel-native-bridge2-20261002'
PRISTINE = T.parent/'glibc-wasm-bootstrap-20261002/source/glibc-2.44'
out = T/'objects/gnu-unwind64-compile-1'; out.mkdir()
snap = T/'source/gnu-unwind64-compile-1'; snap.mkdir()
header = PEER/'jump64-layout-1/include/bits/setjmp.h'
assert pin(header)['sha256'] == 'f291b113244383ad269fcc82c3e4c4aa391d22b457a3868776d76813460fd917'
include = snap/'include'; (include/'bits').mkdir(parents=True)
shutil.copyfile(header,include/'bits/setjmp.h')
source = snap/'unwind.c'; shutil.copyfile(PRISTINE/'nptl/unwind.c',source)
assert source.read_bytes() == (PRISTINE/'nptl/unwind.c').read_bytes()
proof = json.loads((BRIDGE/'proof.json').read_text())
base = next(row for row in proof['commands'] if row['stage'] == 'native-bridge-frontend')
argv = base['argv']; cwd = pathlib.Path(base['cwd'])
flags = []
i = 1
while i < len(argv):
    arg = argv[i]
    if arg in ['-MD','-S','-emit-llvm']:
        i += 1; continue
    if arg in ['-MF','-MT','-o']:
        i += 2; continue
    if arg == str(BRIDGE/'source/native-bridge.c'):
        i += 1; continue
    if arg in ['-I','-isystem','-include']:
        value = pathlib.Path(argv[i+1]);value = value if value.is_absolute() else cwd/value
        flags += [arg,str(value.resolve())];i += 2;continue
    if arg.startswith('-I') and len(arg) > 2:
        value = pathlib.Path(arg[2:]);value = value if value.is_absolute() else cwd/value
        flags += ['-I'+str(value.resolve())];i += 1;continue
    flags.append(arg);i += 1
flags = ['-I'+str(include),'-I'+str(R),*flags]
inputs = [C, header, PRISTINE/'nptl/unwind.c', R/'gnu-jump64-layout.c',
          R/'gnu-unwind-compile.py', R/'common.py', BRIDGE/'proof.json',
          *[R/name for name in ['forced-abi.h','frame-abi.h','jmpbuf-unwind.h',
                               'jump-abi-v2.h','unwind.h','gnu-unwind.h']]]
pins = []
for i,p in enumerate(inputs):
    row = {'path':str(p),**pin(p)}
    if p.stat().st_size < 8388608:
        copy=snap/(str(i)+'-'+p.name);shutil.copyfile(p,copy);row['snapshot']=str(copy)
    pins.append(row)
plan = {'scope':'actual GNU backend64 layout and unchanged nptl/unwind.c compile-only',
        'runtimeAccepted':False,'nativeRecordsAdmitted':False,
        'flags':flags,'pins':pins,'actualUnwindSource':str(source),
        'sourceSha256':pin(source)['sha256']}
(T/'logs/gnu-unwind64-compile-1-plan.json').write_text(json.dumps(plan,indent=2)+'\n')
try:
    run('gnu-unwind64-layout-front',[C,*flags,'-MD','-MF',out/'layout.d',
        '-S','-emit-llvm',R/'gnu-jump64-layout.c','-o',out/'layout.ll'])
    initializer=re.search(r'@gnu_jump64_layout = .*?\[28 x i32\] \[(.*?)\]',(out/'layout.ll').read_text()).group(1)
    values=[int(x) for x in re.findall(r'i32 (\d+)',initializer)]
    assert len(values)==28
    run('gnu-unwind64-original-front',[C,*flags,'-MD','-MF',out/'unwind.d',
        '-S','-emit-llvm',source,'-o',out/'unwind.ll'])
    # Retain raw genuine GNU alias assembly before applying the existing
    # warning/alias metadata adapter selected by the genuine GNU bridge packet.
    metadata=next(row for row in proof['commands'] if row['stage']=='native-bridge-metadata')['argv'][0]
    run('gnu-unwind64-original-metadata',[metadata,out/'unwind.ll',out/'unwind-metadata.bc'])
    run('gnu-unwind64-original-backend',[L/'bin/llc','-mattr=+atomics,+bulk-memory,+exception-handling',
        '-exception-model=wasm','-wasm-enable-eh','-wasm-enable-sjlj','-wasm-use-legacy-eh',
        '-verify-machineinstrs','-filetype=obj',out/'unwind-metadata.bc','-o',out/'unwind.o'])
    dependencies=set()
    for dep in out.glob('*.d'):
        dependencies.update(shlex.split(dep.read_text().replace('\\\n',' ').split(':',1)[1]))
    rows=[]
    for i,p in enumerate(sorted(dependencies)):
        copy=snap/('dependency-'+str(i));shutil.copyfile(p,copy)
        rows.append({'path':p,**pin(p),'snapshot':str(copy)})
    result={'compilePass':True,'runtimeAccepted':False,'nativeRecordsAdmitted':False,
            'gnuUnwindSourceUnchanged':True,'layoutValues':values,'inputPins':pins,
            'dependencies':rows,'outputs':[{'path':str(p),**pin(p)} for p in out.iterdir()]}
    (T/'logs/gnu-unwind64-compile-1-result.json').write_text(json.dumps(result,indent=2)+'\n')
except BaseException as error:
    (T/'logs/gnu-unwind64-compile-1-result.json').write_text(json.dumps({
        'compilePass':False,'runtimeAccepted':False,'error':repr(error)},indent=2)+'\n')
    raise
