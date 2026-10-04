#!/usr/bin/env python3
"""Select coherent native C++ archives for cc-rs wasm32/Linux consumers.

Only the pinned cc-rs branch changes. Unset override retains its original path;
the sysroot supplying headers/libc is not changed. Preserve vendor bytes and
update Cargo's local vendored checksum for the intentional source modification.
"""
import difflib
import hashlib
import json
import shutil
from pathlib import Path

TASK = Path('/mnt/p6/project/build/nightly-baseline-guest-20261003')
BUILD = Path('/mnt/p6/build/firefox-nightly-musl-recovery-20261002')
REPO = Path(__file__).resolve().parents[3]
SOURCE = BUILD / 'source/firefox-159.0a1'
VENDOR = SOURCE / 'third_party/rust/cc'
OLD = '''                    let musl_sysroot = self.wasm_musl_sysroot().unwrap();
                    self.cargo_output.print_metadata(&format_args!(
                        "cargo:rustc-flags=-L {}/lib -lstatic=c++ -lstatic=c++abi",
                        Path::new(&musl_sysroot).display(),
                    ));'''
NEW = '''                    // Native Linux C++ ABI archives may differ from the header/libc sysroot.
                    let runtime_libdir = self
                        .get_env("WASM_MUSL_CXX_RUNTIME_LIBDIR")
                        .map(PathBuf::from)
                        .unwrap_or_else(|| {
                            Path::new(&self.wasm_musl_sysroot().unwrap()).join("lib")
                        });
                    self.cargo_output.print_metadata(&format_args!(
                        "cargo:rustc-flags=-L {} -lstatic=c++ -lstatic=c++abi",
                        runtime_libdir.display(),
                    ));'''

def pin(path):
    data = path.read_bytes()
    return dict(path=str(path), bytes=len(data), sha256=hashlib.sha256(data).hexdigest())

def main():
    backup = TASK / 'native-cargo-cxx-runtime-pre-port'
    assert not backup.exists(), 'one-time source mutation already recorded'
    paths = [VENDOR/'src/lib.rs', VENDOR/'.cargo-checksum.json',
             BUILD/'recipe/environment.sh', REPO/'tools/nightly-musl/recipe/environment.sh']
    original = paths[0].read_text()
    assert original.count(OLD) == 1
    checksum = json.loads(paths[1].read_text())
    prior_checksum = checksum['files']['src/lib.rs']
    before = [pin(p) for p in paths]
    assert paths[2].read_bytes() == paths[3].read_bytes()
    backup.mkdir()
    for i, path in enumerate(paths):
        shutil.copyfile(path, backup / (str(i)+'-'+path.name))
    changed = original.replace(OLD, NEW, 1)
    paths[0].write_text(changed)
    checksum['files']['src/lib.rs'] = pin(paths[0])['sha256']
    paths[1].write_text(json.dumps(checksum, separators=(',', ':'))+'\n')
    extra = ("\n# cc-rs must bundle the same native C++ ABI runtime selected by Clang.\n"
             "export WASM_MUSL_CXX_RUNTIME_LIBDIR="+str(BUILD/'native-unwind/runtimes-build/lib')+"\n"
             "export CXXSTDLIB_wasm32_unknown_linux_musl=c++\n")
    for path in paths[2:]:
        assert 'WASM_MUSL_CXX_RUNTIME_LIBDIR' not in path.read_text()
        path.write_text(path.read_text()+extra)
    patch = REPO/'tools/nightly-musl/patches/nightly-native-cargo-cxx-runtime.patch'
    patch.write_text(''.join(difflib.unified_diff(original.splitlines(True), changed.splitlines(True),
                     fromfile='a/third_party/rust/cc/src/lib.rs', tofile='b/third_party/rust/cc/src/lib.rs')))
    report = dict(before=before, after=[pin(p) for p in paths], patch=pin(patch),
                  priorRecordedVendorChecksum=prior_checksum,
                  priorVendorChecksumMatched=prior_checksum == before[0]['sha256'],
                  preserved=[pin(p) for p in sorted(backup.iterdir())],
                  cargoPackageChecksumUnchanged=checksum['package'],
                  browserAcceptance=False, guestAcceptance=False)
    (TASK/'native-cargo-cxx-runtime-port.json').write_text(json.dumps(report, indent=2)+'\n')
    print(json.dumps(report))

if __name__ == '__main__':
    main()
