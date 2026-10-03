#!/usr/bin/env python3
from pathlib import Path
import json,hashlib,sys
root=Path('/mnt/p6/build/firefox-nightly-musl-recovery-20261002');crate=root/'source/firefox-159.0a1/third_party/rust/authenticator'
p=crate/'src/transport/linux/hidwrapper.rs';old=p.read_text();append='\n#[cfg(all(target_arch = "wasm32", target_os = "linux", target_env = "musl"))]\ninclude!("ioctl_wasm32.rs");\n'
assert 'ioctl_wasm32.rs' not in old
out=crate/'src/transport/linux/ioctl_wasm32.rs';assert not out.exists()
if '--apply' in sys.argv:
 p.write_text(old+append);out.write_text('// Native wasm32 Linux UAPI values verified against the configured sysroot.\npub type __u32 = ::std::os::raw::c_uint;\npub const _HIDIOCGRDESCSIZE: __u32 = 2147764225;\npub const _HIDIOCGRDESC: __u32 = 2416199682;\n')
 checksum=crate/'.cargo-checksum.json';data=json.loads(checksum.read_text())
 for name in ['src/transport/linux/hidwrapper.rs','src/transport/linux/ioctl_wasm32.rs']:data['files'][name]=hashlib.sha256((crate/name).read_bytes()).hexdigest()
 checksum.write_text(json.dumps(data,separators=(',',':')))
print(json.dumps({'applied':'--apply' in sys.argv,'constants':'Verified native sysroot HID UAPI, no architecture alias'}))
