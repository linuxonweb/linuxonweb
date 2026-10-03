from pathlib import Path
import json,subprocess,sys
T=Path('/mnt/p6/build/firefox-nightly-musl-recovery-20261002')
groups=set(map(int,subprocess.check_output(['ps','-eo','pgid='],text=True).split()))
for p in (T/'status').glob('*.json'):
 d=json.loads(p.read_text())
 if isinstance(d,dict) and all(k in d for k in ('phase','pgid','state')):assert d['state']=='completed' and d['pgid'] not in groups,p
adapter=Path(__file__).resolve().parents[1]/'adapters/defs.mk'
dest=T/'source/firefox-159.0a1/defs.mk'
assert adapter.is_file() and not dest.exists()
if 'OS_LIBS +=' in adapter.read_text():assert (T/'native-mapping-link/libnightly-native-mapping.a').is_file()
if '--apply' in sys.argv:dest.write_bytes(adapter.read_bytes())
print('Native target-only link-path adapter; preserve all compile/generated configuration inputs')
