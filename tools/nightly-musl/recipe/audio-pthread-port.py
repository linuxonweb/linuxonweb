#!/usr/bin/env python3
"""Preserve musl pthread_t ABI while serializing wasm32 opaque pointers."""
import difflib
import hashlib
import json
import sys
from pathlib import Path
TASK = Path("/mnt/p6/build/firefox-nightly-musl-recovery-20261002")
CRATE = TASK / 'source/firefox-159.0a1/third_party/rust/audio_thread_priority'
CFG = 'all(target_arch = "wasm32", target_env = "musl")'
changes = []
for name in ('rt_linux.rs', 'rt_linux_native.rs'):
    path = CRATE / 'src' / name
    before = path.read_text()
    after = before
    old = '        let pthread_id = self.pthread_id.to_ne_bytes();'
    new = f'''        // Native wasm32 musl pthread_t is an opaque pointer of usize width.
        #[cfg({CFG})]
        let pthread_id = (self.pthread_id as usize).to_ne_bytes();
        #[cfg(not({CFG}))]
        let pthread_id = self.pthread_id.to_ne_bytes();'''
    assert after.count(old) == 1, name
    after = after.replace(old, new)
    old = '            pthread_id: libc::pthread_t::from_ne_bytes(take(&mut src)),'
    new = f'''            pthread_id: {{
                #[cfg({CFG})]
                {{ usize::from_ne_bytes(take(&mut src)) as libc::pthread_t }}
                #[cfg(not({CFG}))]
                {{ libc::pthread_t::from_ne_bytes(take(&mut src)) }}
            }},'''
    assert after.count(old) == 1, name
    after = after.replace(old, new)
    changes.append((path, before, after))
patch = ''.join(''.join(difflib.unified_diff(before.splitlines(True), after.splitlines(True), fromfile='a/third_party/rust/audio_thread_priority/src/'+path.name, tofile='b/third_party/rust/audio_thread_priority/src/'+path.name)) for path, before, after in changes)
(TASK / 'patches/nightly-audio-thread-pthread-pointer.patch').write_text(patch)
if '--apply' in sys.argv:
    checksum_path = CRATE / '.cargo-checksum.json'
    checksum = json.loads(checksum_path.read_text())
    for path, before, after in changes:
        path.write_text(after)
        checksum['files']['src/'+path.name] = hashlib.sha256(path.read_bytes()).hexdigest()
    checksum_path.write_text(json.dumps(checksum, separators=(',', ':')))
print(json.dumps({'applied': '--apply' in sys.argv, 'files': [str(p) for p, _, _ in changes]}))
