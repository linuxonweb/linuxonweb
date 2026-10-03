"""Keep Nightly's actual inference code in the native Wasm static graph."""
from pathlib import Path
import difflib, hashlib, json, shutil, subprocess, sys

T = Path('/mnt/p6/build/firefox-nightly-musl-recovery-20261002')
S = T / 'source/firefox-159.0a1'
R = Path('/mnt/p6/project/linux/linuxonweb/tools/nightly-musl')
P = T / 'static-inference-preflight'
groups = set(map(int, subprocess.check_output(['ps', '-eo', 'pgid='], text=True).split()))
for p in (T / 'status').glob('*.json'):
    d = json.loads(p.read_text())
    if isinstance(d, dict) and all(k in d for k in ('phase', 'pgid', 'state')):
        assert d['state'] == 'completed' and d['pgid'] not in groups, p
assert not P.exists()
P.mkdir()
changes = {}
native = 'defined(__linux__) && defined(__wasm__) && !defined(__wasi__)'
def replace(name, old, new):
    text = changes.get(name, (S / name).read_text())
    assert text.count(old) == 1, name
    changes[name] = text.replace(old, new, 1)

replace('config/external/mozinference/moz.build',
        'GeckoSharedLibrary("mozinference")\nSHARED_LIBRARY_NAME = "mozinference"\n\n# Export only the symbols we need for dynamic linking\nSYMBOLS_FILE = "mozinference.symbols"',
        'if CONFIG["OS_ARCH"] == "Linux" and CONFIG["TARGET_CPU"] == "wasm32":\n'
        '    Library("mozinference")\nelse:\n'
        '    GeckoSharedLibrary("mozinference")\n'
        '    SHARED_LIBRARY_NAME = "mozinference"\n'
        '    # Export only the symbols we need for dynamic linking\n'
        '    SYMBOLS_FILE = "mozinference.symbols"')
changes['toolkit/library/moz.build'] += '\nif CONFIG["OS_ARCH"] == "Linux" and CONFIG["TARGET_CPU"] == "wasm32":\n    USE_LIBS += ["mozinference"]\n'
name = 'toolkit/components/ml/backends/llama/LlamaRuntimeLinker.cpp'
replace(name, '#include "prlink.h"\n', '#include "prlink.h"\n#include "NightlyStaticInference.h"\n')
replace(name, 'static PRLibrary* LoadLlamaLib(nsIFile* aFile) {\n',
        'static PRLibrary* LoadLlamaLib(nsIFile* aFile) {\n#if ' + native + '\n'
        '  return NightlyLoadStaticInference();\n#else\n')
replace(name, '  return lib;\n}', '  return lib;\n#endif\n}')
replace(name, '  // Get the path to the current executable/library\n',
        '#if ' + native + '\n  sLlamaLib.mLlamaLib = LoadLlamaLib(nullptr);\n#else\n'
        '  // Get the path to the current executable/library\n')
replace(name, '  sLlamaLib.mLlamaLib = LoadLlamaLib(libFile);\n',
        '  sLlamaLib.mLlamaLib = LoadLlamaLib(libFile);\n#endif\n')

rows = []
patch = ''
for name, new in changes.items():
    p = S / name
    old = p.read_text()
    backup = P / name
    backup.parent.mkdir(parents=True, exist_ok=True)
    backup.write_text(old)
    patch += ''.join(difflib.unified_diff(old.splitlines(True), new.splitlines(True),
                                        fromfile='a/' + name, tofile='b/' + name))
    rows.append(dict(path=str(p), backup=str(backup),
                     original_sha256=hashlib.sha256(old.encode()).hexdigest(),
                     updated_sha256=hashlib.sha256(new.encode()).hexdigest()))
adapter = R / 'adapters/NightlyStaticInference.h'
dest = S / 'toolkit/components/ml/backends/llama/NightlyStaticInference.h'
assert not dest.exists()
if '--apply' in sys.argv:
    for name, new in changes.items():
        (S / name).write_text(new)
    shutil.copyfile(adapter, dest)
(T / 'patches/nightly-native-static-inference.patch').write_text(patch)
(T / 'status/native-static-inference-port.json').write_text(json.dumps(dict(
    claim='Native static graph and NSPR binding adapter; acceptance requires actual component compilation and linking',
    changes=rows, adapter_sha256=hashlib.sha256(adapter.read_bytes()).hexdigest(),
    adapter_destination=str(dest), applied='--apply' in sys.argv,
    owned_groups_empty_before_apply=True, guestAcceptance=False, releaseAcceptance=False), indent=2) + '\n')
print(json.dumps(rows))
