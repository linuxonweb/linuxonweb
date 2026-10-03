#!/usr/bin/env python3
from pathlib import Path
import difflib,json,hashlib,sys
root=Path('/mnt/p6/build/firefox-nightly-musl-recovery-20261002');src=root/'source/firefox-159.0a1';name='servo/components/style/global_style_data.rs';p=src/name;old=p.read_text()
a='#[cfg(all(unix, not(target_arch = "wasm32")))]'
b='''#[cfg(all(
    unix,
    any(
        not(target_arch = "wasm32"),
        all(target_arch = "wasm32", target_os = "linux", target_env = "musl", feature = "gecko")
    )
))]'''
assert old.count(a)==3
new=old.replace(a,b)
patch=''.join(difflib.unified_diff(old.splitlines(True),new.splitlines(True),fromfile='a/'+name,tofile='b/'+name))
(root/'patches/nightly-style-native-pthread-handles.patch').write_text(patch)
(root/'status/style-native-pthread-port.json').write_text(json.dumps({'source':name,'before_sha256':hashlib.sha256(old.encode()).hexdigest(),'after_sha256':hashlib.sha256(new.encode()).hexdigest(),'applied':'--apply' in sys.argv,'scope':'Exact native Linux/musl/Wasm Gecko uses existing Unix JoinHandleExt and RawPthread; no libc ABI change or thread pool disablement'},indent=2)+'\n')
if '--apply' in sys.argv:p.write_text(new)
print(json.dumps({'guards':3,'applied':'--apply' in sys.argv}))
