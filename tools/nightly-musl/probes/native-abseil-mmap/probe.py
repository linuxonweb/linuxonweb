from pathlib import Path
import hashlib, json, subprocess
T = Path('/mnt/p6/build/firefox-nightly-musl-recovery-20261002')
P = T / 'abseil-mmap-preflight'
S = T / 'source/firefox-159.0a1'
env = dict(x.split('=', 1) for x in subprocess.check_output(['bash', '-c', 'source "$1"; env -0', 'probe', str(T / 'recipe/environment.sh')]).decode().split('\0') if '=' in x)
body = r'''
static_assert(sizeof(off_t) == 8, "musl off_t64");
static_assert(sizeof(void*) == 4, "native pointer32");
static_assert(sizeof(unsigned long) == 4, "native long32");
using Mapping = void* (*)(void*, size_t, int, int, int, off_t);
static_assert(__is_same(decltype(&mmap), Mapping), "exact libc mapping signature");
static_assert(__is_same(decltype(&absl::base_internal::DirectMmap), Mapping), "untruncated forwarding signature");
extern "C" void* forward(void* p, size_t n, int prot, int flags, int fd, off_t offset) {
  return absl::base_internal::DirectMmap(p, n, prot, flags, fd, offset);
}
extern "C" int unmap(void* p, size_t n) { return absl::base_internal::DirectMunmap(p,n); }
'''
results = {}
for fixed in (False, True):
    name = 'fixed' if fixed else 'original'
    header = S / 'third_party/abseil-cpp/absl/base/internal/direct_mmap.h' if fixed else P / 'original-direct_mmap.h'
    src = P / (name + '.cpp'); obj = P / (name + '.o')
    src.write_text('#include "' + str(header) + '"\n' + body)
    argv = [env['CXX'], '-std=c++20', '-Xclang', '-fc++-abi=webassembly', '-I' + str(T / 'recipe/shim'), '-I' + str(S / 'third_party/abseil-cpp'), '-c', str(src), '-o', str(obj)]
    run = subprocess.run(argv, env=env, capture_output=True, text=True)
    (P / (name + '.log')).write_text(run.stdout+run.stderr)
    if fixed: assert run.returncode == 0 and obj.read_bytes()[:8] == b'\0asm\x01\0\0\0', run.stderr
    else: assert run.returncode != 0 and all(x in run.stderr for x in ('Platform is not 64-bit', 'SYS_mmap', 'SYS_munmap')), run.stderr
    results[name] = {'exit':run.returncode,'argv':argv,'native_object':fixed}
pins = []
for p in [Path(__file__), S/'third_party/abseil-cpp/absl/base/internal/direct_mmap.h', S/'third_party/abseil-cpp/absl/base/internal/low_level_alloc.h', S/'third_party/abseil-cpp/absl/base/internal/low_level_alloc.cc', T/'recipe/shim/sys/mman.h', T/'recipe/environment.sh', *P.iterdir()]:
    if p.is_file():
        b=p.read_bytes(); pins.append({'path':str(p),'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()})
proof={'claim':'Native C++ original/fixed header and off_t64 forwarding compile only; no mapping runtime, signal safety or final linkage acceptance', 'results':results,'pins':pins}
(P/'result.json').write_text(json.dumps(proof,indent=2)+'\n')
print(json.dumps(results))
