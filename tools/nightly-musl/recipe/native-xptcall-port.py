"""Install the metadata-driven native Wasm XPTCall adapter on the pinned Nightly."""
from pathlib import Path
import difflib
import hashlib
import json
import shutil
import subprocess
import time

T = Path('/mnt/p6/build/firefox-nightly-musl-recovery-20261002')
R = Path('/mnt/p6/project/linux/linuxonweb/tools/nightly-musl')
S = T / 'source/firefox-159.0a1'
groups = set(subprocess.check_output(['ps', '-eo', 'pgid='], text=True).split())
for p in (T / 'status').glob('*.json'):
    d = json.loads(p.read_text())
    if isinstance(d, dict) and all(k in d for k in ('phase', 'pgid', 'state')):
        assert d['state'] == 'completed' and str(d['pgid']) not in groups, p
B = T / 'native-xptcall/pre-port'
assert not B.exists()
B.mkdir(parents=True)
def pin(p):
    return dict(path=str(p), bytes=p.stat().st_size,
                sha256=hashlib.sha256(p.read_bytes()).hexdigest())
changes = {
 'xpcom/reflect/xptcall/md/unix/moz.build': [
  ('FINAL_LIBRARY = "xul"', 'if CONFIG["TARGET_CPU"] == "wasm32" and CONFIG["OS_ARCH"] == "Linux":\n    SOURCES += ["xptcall_wasm32.cpp"]\n\nFINAL_LIBRARY = "xul"')],
 'xpcom/reflect/xptcall/xptcprivate.h': [
  ('  ~nsXPTCStubBase() = default;', '''#if defined(__wasm__) && defined(__linux__) && !defined(__wasi__)
  uintptr_t* mWasmVTable = nullptr;
  ~nsXPTCStubBase() { delete[] mWasmVTable; }
#else
  ~nsXPTCStubBase() = default;
#endif'''),
  ('#if defined(__clang__) || defined(__GNUC__)', '''#if defined(__wasm__) && defined(__linux__) && !defined(__wasi__)
nsresult WasmInitXPTCStub(nsXPTCStubBase* aStub);
#endif

#if defined(__clang__) || defined(__GNUC__)''')],
 'xpcom/reflect/xptcall/xptcall.cpp': [
  ('  *aResult = new nsXPTCStubBase(aOuter, iie);', '''#if defined(__wasm__) && defined(__linux__) && !defined(__wasi__)
  *aResult = nullptr;
  auto* stub = new nsXPTCStubBase(aOuter, iie);
  nsresult rv = WasmInitXPTCStub(stub);
  if (NS_FAILED(rv)) {
    delete stub;
    return rv;
  }
  *aResult = stub;
#else
  *aResult = new nsXPTCStubBase(aOuter, iie);
#endif'''),
  ('  return aMallocSizeOf(aStub);', '''#if defined(__wasm__) && defined(__linux__) && !defined(__wasi__)
  return aMallocSizeOf(aStub) +
         aMallocSizeOf(static_cast<const nsXPTCStubBase*>(aStub)->mWasmVTable);
#else
  return aMallocSizeOf(aStub);
#endif''')]
}
patch = ''; before = []; after = []
for name, edits in changes.items():
    p = S / name; original = p.read_text(); data = original
    before.append(pin(p)); shutil.copyfile(p, B / p.name)
    for old, new in edits:
        assert data.count(old) == 1, (name, old)
        data = data.replace(old, new, 1)
    patch += ''.join(difflib.unified_diff(original.splitlines(True), data.splitlines(True),
                 fromfile='a/' + name, tofile='b/' + name))
    p.write_text(data); after.append(pin(p))
new = S / 'xpcom/reflect/xptcall/md/unix/xptcall_wasm32.cpp'
assert not new.exists()
shutil.copyfile(R / 'adapters/xptcall/xptcall_wasm32.cpp', new)
patch_path = R / 'patches/nightly-native-xptcall.patch'
patch_path.write_text(patch)
runner = T / 'recipe/run-phase.py'; old = runner.read_text()
assert "commands={'expat':" in old
shutil.copyfile(runner, B / 'run-phase.py')
runner.write_text(old.replace("commands={'expat':", "commands={'xptcall':['build','--allow-subdirectory-build','xpcom/reflect/xptcall','-j'+jobs,'--verbose'],'expat':", 1))
(R / 'recipe/run-phase.py').write_bytes(runner.read_bytes())
report = T / 'status/native-xptcall-port-run1.json'
assert not report.exists()
report.write_text(json.dumps(dict(claim='Native current-metadata XPTCall adapter applied; actual compilation and execution pending',
 checked=time.time(), before=before, after=after, added=pin(new), adapter=pin(R / 'adapters/xptcall/xptcall_wasm32.cpp'),
 patch=pin(patch_path), browserAcceptance=False, guestAcceptance=False, jitAcceptance=False), indent=2)+'\n')
print(json.dumps(dict(upstreamHookFiles=len(changes), newAdapterFiles=1, report=str(report))))
