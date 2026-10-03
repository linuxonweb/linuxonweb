#!/usr/bin/env python3
"""Align native Linux/Wasm core Vulkan selection with the compiled HAL."""
import difflib
import hashlib
import json
import sys
from pathlib import Path
TASK = Path("/mnt/p6/build/firefox-nightly-musl-recovery-20261002")
CRATE = TASK / "source/firefox-159.0a1/third_party/rust/wgpu-core"
path = CRATE / "build.rs"
before = path.read_text()
old = '            all(windows_linux_android, feature = "vulkan"), // Regular Vulkan'
new = '            all(\n                windows_linux_android,\n                feature = "vulkan",\n                not(all(target_arch = "wasm32", target_os = "linux", target_env = "musl"))\n            ), // Regular Vulkan'
assert before.count(old) == 1, "Latest core Vulkan selector changed or adapter already applied"
after = before.replace(old, new)
patch = "".join(difflib.unified_diff(before.splitlines(True), after.splitlines(True), fromfile="a/third_party/rust/wgpu-core/build.rs", tofile="b/third_party/rust/wgpu-core/build.rs"))
(TASK / "patches/nightly-wgpu-core-native-backend-cfg.patch").write_text(patch)
if "--apply" in sys.argv:
    checksum_path = CRATE / ".cargo-checksum.json"
    checksum = json.loads(checksum_path.read_text())
    path.write_text(after)
    checksum["files"]["build.rs"] = hashlib.sha256(path.read_bytes()).hexdigest()
    checksum_path.write_text(json.dumps(checksum, separators=(",", ":")))
print(json.dumps({"applied": "--apply" in sys.argv, "path": str(path), "scope": "Native target backend selector only; WebGPU DOM/features and other targets unchanged"}))
