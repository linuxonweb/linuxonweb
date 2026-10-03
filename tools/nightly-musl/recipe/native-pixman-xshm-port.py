"""Namespace bundled Pixman and preserve XShm interposition in static Wasm."""
from pathlib import Path
import difflib
import hashlib
import json
import subprocess
import time

T = Path('/mnt/p6/build/firefox-nightly-musl-recovery-20261002')
R = Path('/mnt/p6/project/linux/linuxonweb/tools/nightly-musl')
S = T / 'source/firefox-159.0a1'
groups = subprocess.check_output(['ps', '-eo', 'pgid='], text=True).split()
for p in (T / 'status').glob('*.json'):
    d = json.loads(p.read_text())
    if isinstance(d, dict) and all(k in d for k in ('phase', 'pgid', 'state')):
        assert d['state'] == 'completed' and str(d['pgid']) not in groups, p

census_path = T / 'native-unwind/static-collisions-pixman-run1.json'
census = json.loads(census_path.read_text())
names = census['collidingSymbols']
assert len(names) == 81 and len(set(names)) == 81
header = ('// Separate Firefox bundled Pixman from GTK static Pixman.\n'
          '#pragma once\n'
          '#if defined(__wasm__) && defined(__linux__) && !defined(__wasi__)\n'
          + ''.join('#define ' + n + ' _moz_native_static_' + n + '\n' for n in names)
          + '#endif\n')
changes = {}

def replace(p, old, new):
    data = (S / p).read_text()
    assert data.count(old) == 1, (p, old)
    changes[p] = data.replace(old, new, 1)

replace('gfx/pixman/pixman/pixman/pixman.h', '#include <pixman-version.h>',
        '#if defined(__wasm__) && defined(__linux__) && !defined(__wasi__)\n'
        '#include "NightlyPixmanStaticNames.h"\n#endif\n\n#include <pixman-version.h>')
replace('gfx/pixman/pixman/pixman/moz.build', "SOURCES += [\n    'pixman-access-accessors.c',",
        'if CONFIG["OS_ARCH"] == "Linux" and CONFIG["TARGET_CPU"] == "wasm32":\n'
        '    EXPORTS += ["NightlyPixmanStaticNames.h"]\n\n'
        "SOURCES += [\n    'pixman-access-accessors.c',")
replace('widget/gtk/mozgtk/mozgtk.c',
        'MOZ_EXPORT Bool XShmQueryExtension(Display* aDisplay) { return False; }',
        '#if defined(__wasm__) && defined(__linux__) && !defined(__wasi__)\n'
        '// Static linking needs a wrapper in place of ELF load-order interposition.\n'
        'MOZ_EXPORT Bool __wrap_XShmQueryExtension(Display* aDisplay) { return False; }\n'
        '#else\n'
        'MOZ_EXPORT Bool XShmQueryExtension(Display* aDisplay) { return False; }\n'
        '#endif')
defs = (S / 'defs.mk').read_text()
assert defs.endswith('endif\n')
changes['defs.mk'] = defs[:-6] + (
    'ifneq ($(filter firefox plugin-container xpcshell,$(notdir $(PROGRAM))),)\n'
    'override LDFLAGS += -Wl$(NIGHTLY_WASM_COMMA)--wrap=XShmQueryExtension\n'
    'endif\nendif\n')
backup = T / 'pixman-xshm-preflight'
assert not backup.exists()
added = S / 'gfx/pixman/pixman/pixman/NightlyPixmanStaticNames.h'
assert not added.exists()
patch = ''.join(''.join(difflib.unified_diff((S / p).read_text().splitlines(True),
                                          data.splitlines(True), fromfile='a/' + p,
                                          tofile='b/' + p)) for p, data in changes.items())
backup.mkdir()
for p, data in changes.items():
    b = backup / p
    b.parent.mkdir(parents=True, exist_ok=True)
    b.write_bytes((S / p).read_bytes())
    (S / p).write_text(data)
added.write_text(header)
(R / 'adapters/NightlyPixmanStaticNames.h').write_text(header)
(R / 'adapters/defs.mk').write_text(changes['defs.mk'])
(R / 'patches/nightly-native-pixman-xshm.patch').write_text(patch)

def pin(p):
    return dict(path=str(p), bytes=p.stat().st_size,
                sha256=hashlib.sha256(p.read_bytes()).hexdigest())

out = T / 'status/native-pixman-xshm-port-run1.json'
assert not out.exists()
out.write_text(json.dumps(dict(checked=time.time(),
    claim='Static namespace and XShm wrap applied; build and guest acceptance pending',
    originalPins=[pin(backup / p) for p in changes],
    updatedPins=[pin(S / p) for p in changes] + [pin(added)],
    censusPin=pin(census_path), patchPin=pin(R / 'patches/nightly-native-pixman-xshm.patch'),
    guestAcceptance=False, releaseAcceptance=False), indent=2) + '\n')
print(json.dumps(dict(changed=len(changes), added=1, pixmanAliases=len(names))))
