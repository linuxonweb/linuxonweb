"""Keep bundled UTF-16 Expat separate from GTK's UTF-8 static Expat."""
from pathlib import Path
import hashlib
import json
import subprocess
import time

T = Path('/mnt/p6/build/firefox-nightly-musl-recovery-20261002')
R = Path('/mnt/p6/project/linux/linuxonweb/tools/nightly-musl')
S = T / 'source/firefox-159.0a1'
groups = subprocess.check_output(['ps', '-eo', 'pgid='], text=True).split()
for path in (T / 'status').glob('*.json'):
    record = json.loads(path.read_text())
    if isinstance(record, dict) and all(k in record for k in ('phase', 'pgid', 'state')):
        assert record['state'] == 'completed' and str(record['pgid']) not in groups, path

census_path = T / 'status/expat-collisions-run1.json'
consumers_path = T / 'status/expat-consumers-run1.json'
census = json.loads(census_path.read_text())
consumers = json.loads(consumers_path.read_text())
names = census['collidingSymbols']
assert len(names) == 58 and len(set(names)) == 58
assert consumers['pass'] and not consumers['outsideBundledExpat']
assert consumers['graphObjectCount'] == 3011
for item in census['objects']:
    assert hashlib.sha256(Path(item['path']).read_bytes()).hexdigest() == item['sha256']
assert hashlib.sha256(Path(census['library']).read_bytes()).hexdigest() == census['sha256']

header = ('// Keep Firefox bundled UTF-16 Expat separate from static GTK Expat.\n'
          '#pragma once\n'
          '#if defined(__wasm__) && defined(__linux__) && !defined(__wasi__)\n'
          + ''.join('#define ' + name + ' _moz_native_static_' + name + '\n' for name in names)
          + '#endif\n')
defs = ('# Namespace only the bundled Expat compilation units.\n'
        'ifeq ($(OS_ARCH)_$(TARGET_CPU),Linux_wasm32)\n'
        'COMPUTED_CFLAGS += -include $(srcdir)/NightlyExpatStaticNames.h\n'
        'GLOBAL_DEPS += $(srcdir)/NightlyExpatStaticNames.h $(srcdir)/defs.mk\n'
        'endif\n')
source_files = [S / 'parser/expat/expat/lib' / name for name in
                ('moz_xmlparse.c', 'moz_xmltok.c', 'xmlrole.c', 'expat.h', 'moz_expat.h')]
def pin(path):
    return dict(path=str(path), bytes=path.stat().st_size,
                sha256=hashlib.sha256(path.read_bytes()).hexdigest())
original_pins = [pin(path) for path in source_files]
for path, data in [(S / 'parser/expat/NightlyExpatStaticNames.h', header),
                   (S / 'parser/expat/defs.mk', defs),
                   (R / 'adapters/NightlyExpatStaticNames.h', header),
                   (R / 'adapters/expat-static/defs.mk', defs)]:
    assert not path.exists(), path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(data)

runner = T / 'recipe/run-phase.py'
backup = T / 'static-names-preflight/run-phase-before-expat.py'
assert not backup.exists()
data = runner.read_text()
anchor = "commands={'pixman':"
assert data.count(anchor) == 1
backup.write_bytes(runner.read_bytes())
runner.write_text(data.replace(anchor,
    "commands={'expat':['build','--allow-subdirectory-build',"
    "'parser/expat/target-objects','-j'+jobs,'--verbose'],'pixman':", 1))
(R / 'recipe/run-phase.py').write_bytes(runner.read_bytes())
assert original_pins == [pin(path) for path in source_files]
out = T / 'status/native-expat-static-port-run1.json'
assert not out.exists()
out.write_text(json.dumps(dict(checked=time.time(),
    claim='Bundled Expat private compile namespace applied; actual build/link pending',
    aliases=len(names), unchangedSourcePins=original_pins,
    censusPin=pin(census_path), consumersPin=pin(consumers_path),
    addedPins=[pin(S / 'parser/expat/NightlyExpatStaticNames.h'),
               pin(S / 'parser/expat/defs.mk')], runnerBeforePin=pin(backup),
    runnerAfterPin=pin(runner), guestAcceptance=False, releaseAcceptance=False),
    indent=2) + '\n')
print(json.dumps(dict(addedSourceAdapters=2, aliases=len(names), upstreamSourcesChanged=0)))
