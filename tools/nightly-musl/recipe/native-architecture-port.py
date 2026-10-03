#!/usr/bin/env python3
from pathlib import Path
import re,sys,json,difflib,hashlib
root=Path('/mnt/p6/build/firefox-nightly-musl-recovery-20261002');src=root/'source/firefox-159.0a1';changes={}
def edit(name,func):
 p=src/name;old=p.read_text();new=func(old)
 if new==old:raise RuntimeError('No change: '+name)
 changes[name]=(old,new)
def guards(t):
 t=t.replace('#elif defined(__wasi__)','#elif defined(__wasi__) || defined(__wasm__)')
 t=t.replace('#ifdef __wasi__','#if defined(__wasi__) || defined(__wasm__)')
 t=t.replace('#  ifdef __wasi__','#  if defined(__wasi__) || defined(__wasm__)')
 t=t.replace('#ifndef __wasi__','#if !defined(__wasi__) && !defined(__wasm__)')
 t=t.replace('#  ifndef __wasi__','#  if !defined(__wasi__) && !defined(__wasm__)')
 t=t.replace('&& !defined(__wasi__)','&& !defined(__wasi__) && !defined(__wasm__)')
 t=t.replace('#if !defined(__wasi__)\n','#if !defined(__wasi__) && !defined(__wasm__)\n')
 # Avoid duplicate condition where a negative directive was just expanded.
 t=t.replace(' && !defined(__wasm__) && !defined(__wasm__)',' && !defined(__wasm__)')
 return t
edit('intl/icu/source/common/umapfile.h',guards)
edit('intl/icu/source/common/putilimp.h',lambda t:t.replace('#   define U_HAVE_MMAP 0\n#else','#   define U_HAVE_MMAP 0\n#elif defined(__wasm__)\n#   define U_HAVE_MMAP 0\n#else',1))
for name in ['config/external/icu/data/icu_data.S','js/src/vm/ArrayBufferObject.cpp','mfbt/Poison.cpp','mfbt/TaggedAnonymousMemory.h','mozglue/misc/MmapFaultHandler.h','mozglue/misc/MmapFaultHandler.cpp','js/src/vm/SharedArrayObject.cpp']:
 edit(name,guards)
edit('mfbt/Assertions.h',lambda t:t.replace('    !defined(__wasi__)','    !defined(__wasi__) && !defined(__wasm__)',1))
for name in ['mfbt/TaggedAnonymousMemory.h','mfbt/TaggedAnonymousMemory.cpp']:
 if name in changes:
  old,t=changes[name];changes[name]=(old,t.replace('#  ifdef XP_LINUX','#  if defined(XP_LINUX) && !defined(__wasm__)',1))
 else:edit(name,lambda t:t.replace('#ifdef XP_LINUX','#if defined(XP_LINUX) && !defined(__wasm__)',1))
edit('js/src/jit/ProcessExecutableMemory.cpp',lambda t:guards(t).replace('#if defined(JS_CODEGEN_WASM32)\n  return true;','#if defined(JS_CODEGEN_WASM32) || defined(__wasm__)\n  return true;',1).replace('  MOZ_CRASH("NYI FOR WASI.");','  // Native Wasm pages are not host executable instruction memory.\n  return true;',1))
for name in ['js/src/vm/JSONPrinter.h','js/src/vm/JSONPrinter.cpp']:
 edit(name,lambda t:t.replace('|| defined(__wasi__)','|| defined(__wasi__) || defined(__wasm__)',1))
edit('js/src/vm/BytecodeUtil.cpp',lambda t:t.replace('json.property("id", offset);','json.property("id", static_cast<uint32_t>(offset));',1))
# Native Linux clock stays std-backed; browser-hosted Wasm retains JS clock.
edit('third_party/rust/mls-rs-core/src/time.rs',lambda t:t.replace('not(target_arch = "wasm32")','any(not(target_arch = "wasm32"), target_os = "linux")').replace('target_arch = "wasm32", not(target_os = "emscripten")','target_arch = "wasm32", not(any(target_os = "emscripten", target_os = "linux"))').replace('#[cfg(target_arch = "wasm32")]','#[cfg(all(target_arch = "wasm32", not(target_os = "linux")))]'))
patch=''.join(''.join(difflib.unified_diff(a.splitlines(True),b.splitlines(True),fromfile='a/'+n,tofile='b/'+n)) for n,(a,b) in sorted(changes.items()))
(root/'patches/nightly-native-architecture-memory-ilp32.patch').write_text(patch)
(root/'status/native-architecture-port-draft.json').write_text(json.dumps({'files':list(changes),'source_before_sha256':{n:hashlib.sha256(a.encode()).hexdigest() for n,(a,b) in changes.items()},'applied':'--apply' in sys.argv,'scope':'Existing Wasm allocation/section paths, native ILP32 overloads, Linux std clock; no WASI target relabeling and no JS shell/process API removal'},indent=2)+'\n')
if '--apply' in sys.argv:
 for n,(a,b) in changes.items():
  p=src/n;assert p.read_text()==a;p.write_text(b)
 p=src/'third_party/rust/mls-rs-core/.cargo-checksum.json';data=json.loads(p.read_text());data['files']['src/time.rs']=hashlib.sha256((p.parent/'src/time.rs').read_bytes()).hexdigest();p.write_text(json.dumps(data,separators=(',',':')))
print(json.dumps({'files':len(changes),'applied':'--apply' in sys.argv}))
