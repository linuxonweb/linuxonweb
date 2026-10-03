"""Configure unchanged LLVM22 runtimes for Nightly's WebAssembly C++ ABI."""
from pathlib import Path
import json, os, subprocess

T = Path('/mnt/p6/build/firefox-nightly-musl-recovery-20261002')
SOURCE = Path('/nix/store/jkx0x4a4nlmnjm0kz9fiss33b7wh8z9k-source')
OUTPUT = T / 'native-unwind/runtimes-build'
assert not OUTPUT.exists(), 'preserve completed or failed build evidence'
groups = set(map(int, subprocess.check_output(['ps', '-eo', 'pgid='], text=True).split()))
for p in (T / 'status').glob('*.json'):
    d = json.loads(p.read_text())
    if isinstance(d, dict) and all(k in d for k in ('phase', 'pgid', 'state')):
        assert d['state'] == 'completed' and d['pgid'] not in groups, p
env = dict(x.split('=', 1) for x in subprocess.check_output([
    'bash', '-c', 'source "$1"; env -0', 'cxx-runtime', str(T / 'recipe/environment.sh')
]).decode().split('\0') if '=' in x)
assert all(Path(env[k]).is_relative_to(T) for k in ('TMPDIR', 'TMP', 'TEMP'))
env['NIX_CXXSTDLIB_COMPILE_wasm32_unknown_linux_musl'] = ''
env['NIX_CXXSTDLIB_LINK_wasm32_unknown_linux_musl'] = ''
argv = ['cmake', '-S', str(SOURCE / 'runtimes'), '-B', str(OUTPUT), '-G', 'Ninja',
        '-DCMAKE_BUILD_TYPE=Release', '-DCMAKE_SYSTEM_NAME=Linux',
        '-DCMAKE_SYSTEM_PROCESSOR=wasm32', '-DCMAKE_C_COMPILER=' + env['CC'],
        '-DCMAKE_CXX_COMPILER=' + env['CXX'], '-DCMAKE_AR=' + env['AR'],
        '-DCMAKE_C_COMPILER_TARGET=wasm32-unknown-linux-musl',
        '-DCMAKE_CXX_COMPILER_TARGET=wasm32-unknown-linux-musl',
        '-DCMAKE_TRY_COMPILE_TARGET_TYPE=STATIC_LIBRARY',
        '-DCMAKE_C_FLAGS=-pthread -fwasm-exceptions',
        '-DCMAKE_CXX_FLAGS=-pthread -fwasm-exceptions -Xclang -fc++-abi=webassembly',
        '-DLLVM_ENABLE_RUNTIMES=libcxx;libcxxabi;libunwind',
        '-DLLVM_INCLUDE_TESTS=OFF', '-DCMAKE_EXPORT_COMPILE_COMMANDS=ON',
        '-DLIBCXX_ENABLE_SHARED=OFF', '-DLIBCXXABI_ENABLE_SHARED=OFF',
        '-DLIBUNWIND_ENABLE_SHARED=OFF', '-DLIBCXX_INCLUDE_TESTS=OFF',
        '-DLIBCXXABI_INCLUDE_TESTS=OFF', '-DLIBUNWIND_INCLUDE_TESTS=OFF',
        '-DLIBCXX_HAS_MUSL_LIBC=ON', '-DLIBCXX_HAS_PTHREAD_API=OFF',
        '-DLIBCXXABI_ENABLE_STATIC_UNWINDER=ON', '-DLIBUNWIND_ENABLE_THREADS=ON',
        '-DLIBCXXABI_USE_COMPILER_RT=ON', '-DLIBUNWIND_USE_COMPILER_RT=ON',
        '-DLIBUNWIND_HIDE_SYMBOLS=ON']
log = T / 'native-unwind/runtimes-configure-replay.log'
assert not log.exists()
with log.open('w') as f:
    subprocess.run(argv, env=env, stdout=f, stderr=subprocess.STDOUT,
                   check=True, timeout=120)
print(json.dumps({'output': str(OUTPUT), 'argv': argv}))
