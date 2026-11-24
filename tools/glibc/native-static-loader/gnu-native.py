#!/usr/bin/env python3
import sys,re
sys.dont_write_bytecode=True
from run import *
config=subprocess.check_output([str(L/'bin/llvm-config'),'--cxxflags','--ldflags','--libs','core','irreader','bitwriter','transformutils','support','--system-libs'],text=True).split()
run('gnu-adapter-build',['/usr/bin/g++',R/'caller-ir.cpp',*config,'-o',T/'objects/caller-ir'])
args=json.loads((T/'logs/gnu-compile-flags.json').read_text())['args']
run('gnu-fixture-front',[CLANG,'--target=wasm32-unknown-linux-gnu',*args,'-fwasm-exceptions','-S','-emit-llvm',R/'public-fixture.c','-MF',T/'objects/public-fixture.d','-o',T/'objects/public-fixture.ll'])
units=[r['unit'].replace('/','-') for r in json.loads((T/'logs/gnu-compile-results.json').read_text()) if r['pass']]
assert len(units)==13
run('gnu-ir-link',[L/'bin/llvm-link',*[T/'objects'/f'{u}.opt.bc' for u in units],T/'objects/public-fixture.ll','-o',T/'objects/gnu-linked.bc'])
run('gnu-linked-opt',[L/'bin/opt','-passes=default<O2>',T/'objects/gnu-linked.bc','-o',T/'objects/gnu-linked.opt.bc'])
run('gnu-linked-dis',[L/'bin/llvm-dis',T/'objects/gnu-linked.opt.bc','-o',T/'objects/gnu-linked.opt.ll'])
data=(T/'objects/gnu-linked.opt.ll').read_text()
definitions=re.findall(r'^define .*?@([A-Za-z0-9_.$]+)\(',data,re.M)
spec=T/'source/gnu-covered.modules'
spec.write_text(''.join(f'{n} {1 if n.startswith("a_") else 2 if n.startswith("b_") else 0}\n' for n in definitions))
declarations=re.findall(r'^declare .*?@([A-Za-z0-9_.$]+)\(',data,re.M)
boundaries=sorted(n for n in declarations if not n.startswith('llvm.'))
(T/'source/gnu-boundaries.txt').write_text(''.join(n+'\n' for n in boundaries))
# These boundaries are pinned in the extraction/provider report. They clear TLS
# and cannot silently create a caller token for an uncovered callback.
run('gnu-caller-adapt',[T/'objects/caller-ir',T/'objects/gnu-linked.opt.bc',T/'objects/gnu-adapted.bc',spec,'native_loader_entry',T/'source/gnu-boundaries.txt'])
run('gnu-adapted-verify',[L/'bin/opt','-passes=verify',T/'objects/gnu-adapted.bc','-disable-output'])
run('gnu-adapted-dis',[L/'bin/llvm-dis',T/'objects/gnu-adapted.bc','-o',T/'objects/gnu-adapted.ll'])
run('gnu-native-backend',[L/'bin/llc','-mattr=+atomics,+bulk-memory,+exception-handling','-exception-model=wasm','-wasm-enable-eh','-wasm-enable-sjlj','-filetype=obj',T/'objects/gnu-adapted.bc','-o',T/'objects/gnu-loader.o'])
run('gnu-native-symbols',[L/'bin/llvm-nm','--defined-only','--format=posix',T/'objects/gnu-loader.o'])
(T/'logs/gnu-native-results.json').write_text(json.dumps({'nativeObject':True,'units':units,'definitions':definitions,'boundaries':boundaries,'publicRuntime':False,'scope':'Native object compile only; explicit GNU boundaries still require provider/source pin audit and full link'},indent=2)+'\n')
