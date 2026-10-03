from pathlib import Path
import hashlib, json, subprocess

T = Path('/mnt/p6/build/firefox-nightly-musl-recovery-20261002')
P = T / 'tagged-mmap-preflight'
assert (P / 'original-TaggedAnonymousMemory.h').is_file()
assert not (P / 'result.json').exists()
env = dict(x.split('=', 1) for x in subprocess.check_output(['bash', '-c', 'source "$1"; env -0', 'probe', str(T / 'recipe/environment.sh')]).decode().split('\0') if '=' in x)
fixed = T / 'source/firefox-159.0a1/mfbt/TaggedAnonymousMemory.h'
body = '''
#ifdef __cplusplus
static_assert(sizeof(off_t) == 8, "musl time64 off_t");
static_assert(sizeof(void*) == 4, "native ILP32 pointer");
using Mmap = void* (*)(void*, size_t, int, int, int, off_t);
static_assert(__is_same(decltype(&mmap), Mmap), "exact native mmap signature");
#else
_Static_assert(sizeof(off_t) == 8, "musl time64 off_t");
_Static_assert(sizeof(void*) == 4, "native ILP32 pointer");
typedef void* (*Mmap)(void*, size_t, int, int, int, off_t);
_Static_assert(__builtin_types_compatible_p(__typeof__(&mmap), Mmap), "exact native mmap signature");
#endif
void* native_mmap(void* addr, size_t length, int prot, int flags, int fd, off_t offset) {
  return MozTaggedAnonymousMmap(addr, length, prot, flags, fd, offset, "native-probe");
}
'''
results = {}
commands = {}
for language in ('c', 'c++'):
    for corrected in (False, True):
        name = language.replace('+', 'x') + ('-fixed' if corrected else '-original')
        header = fixed if corrected else P / 'original-TaggedAnonymousMemory.h'
        source = P / (name + ('.cpp' if language == 'c++' else '.c'))
        # Original caller already obtained off_t transitively; fixed arm includes the header directly.
        source.write_text(('' if corrected else '#include <sys/types.h>\n') + '#include "' + str(header) + '"\n' + body)
        obj = P / (name + '.o')
        argv = [env['CXX' if language == 'c++' else 'CC'], '-I' + str(T / 'recipe/shim'), '-I' + str(T / 'obj-nightly/dist/include'), '-DXP_LINUX', '-c', str(source), '-o', str(obj)]
        argv += ['-std=c++20', '-Xclang', '-fc++-abi=webassembly'] if language == 'c++' else ['-std=c11']
        run = subprocess.run(argv, env=env, capture_output=True, text=True)
        (P / (name + '.log')).write_text(run.stdout + run.stderr)
        if corrected:
            assert run.returncode == 0, run.stderr
            assert obj.read_bytes()[:8] == b'\0asm\x01\0\0\0'
        else:
            assert run.returncode != 0 and 'mmap' in run.stderr, run.stderr
        results[name] = {'exit': run.returncode, 'expected_success': corrected, 'native_object': corrected}
        commands[name] = argv
pins = []
for p in [fixed, T / 'recipe/shim/sys/mman.h', T / 'recipe/environment.sh', Path(__file__), *P.iterdir()]:
    if p.is_file():
        data = p.read_bytes()
        pins.append({'path': str(p), 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
proof = {'claim': 'Native C/C++ direct-header and exact mmap/off_t ILP32 compile checks only; original missing declaration failures retained; no mmap runtime or guest acceptance', 'results': results, 'commands': commands, 'pins': pins}
(P / 'result.json').write_text(json.dumps(proof, indent=2) + '\n')
print(json.dumps(results))
