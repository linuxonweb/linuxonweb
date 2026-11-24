#!/usr/bin/env python3
"""Pin final159 evidence, inventory closure, and prepare an owned JIT overlay.

This command never configures Firefox, builds dependencies, or launches a guest.
Exit 2 means the inventory completed but native integration remains blocked.
Run under tools/guest-packages/bounded.py: hashing large retained archives is work.
"""
import argparse
import collections
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import stat
import subprocess
import sys

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
SCHEMA = 'linuxonweb-final159-rebuild-preflight-1'
NATIVE_FILES = ('PortableBaselineInterpret.cpp', 'PblIc.inc', 'PblMethod.inc',
                'PblIcOps.h', 'PblTierObserve.h', 'PblCacheObserve.h')
HOST_FIXTURE_FILES = ('emit.cpp', 'run.mjs', 'nested-fixtures.h', 'run-nested.mjs')
HOST_RUNNERS = [{'name': 'baseline', 'file': 'run.mjs'},
                {'name': 'nested', 'file': 'run-nested.mjs'}]
REQUIRED_LOCKS = ({('source', name) for name in (
    '.mozconfig', 'js/src/vm/moz.build', 'js/src/vm/Opcodes.h',
    'js/src/vm/PortableBaselineInterpret.cpp', 'js/src/vm/PblJit.cpp', 'config/gcc_hidden.h',
    'linuxonweb-build/adapters/defs.mk',
    'linuxonweb-build/adapters/native-runtime/runtime.c',
    'linuxonweb-build/adapters/native-stack/stack.c',
    'linuxonweb-build/recipe/environment.sh', 'linuxonweb-build/recipe/cargo',
    'linuxonweb-build/recipe/rustc', 'linuxonweb-build/recipe/configure-cxx-runtime.py',
    'linuxonweb-build/recipe/build-native-stack.py',
    'linuxonweb-build/recipe/rust-target/wasm32-unknown-linux-musl.json',
    'linuxonweb-build/recipe/shim/inttypes.h', 'linuxonweb-build/recipe/shim/filesystem',
    'linuxonweb-build/recipe/shim/sys/mman.h')} |
    {('build', name) for name in ('report.json', 'link.args', 'generated/manifest.json',
      'generated/overlay/host-test/mock.h', 'lib/libjs_static.a',
      'pbl/obj/PblJit.o', 'pbl/obj/PortableBaselineInterpret.o')} |
    {('build', 'pbl/src/' + name) for name in NATIVE_FILES + ('PblJit.cpp',)} |
    {('build', stem + suffix) for stem in
      ('compile-PblJit', 'compile-PortableBaselineInterpret', 'link')
      for suffix in ('.command.json', '.receipt.json')} |
    {('package', name) for name in ('package.json', 'freeze-receipt.json',
      'boot-manifest.json', 'initramfs-firefox.cpio.gz')})


def validate_lock(lock):
    require(lock['schema'] == 'linuxonweb-final159-input-lock-1', 'unexpected lock schema')
    identities = [(row['root'], row['path']) for row in lock['files']]
    require(len(set(identities)) == len(identities), 'duplicate locked input')
    require(REQUIRED_LOCKS <= set(identities), 'lock omits a required final159 input')
    for row in lock['files']:
        relative = Path(row['path'])
        require(row['root'] in ('source', 'build', 'package') and
                not relative.is_absolute() and '..' not in relative.parts,
                'lock path must remain inside its named input root')
        require(re.fullmatch('[0-9a-f]{64}', row['sha256']) is not None and
                isinstance(row['bytes'], int) and row['bytes'] >= 0, 'invalid locked identity')


ABI_ANCHOR = 'static_assert(kTagObject == uint32_t(JSVAL_TAG_OBJECT));'
ABI_GUARDS = '''
static_assert(sizeof(void*) == 4, "Guest specializer requires wasm32 pointers");
static_assert(sizeof(Value) == sizeof(uint64_t));
static_assert(uint32_t(JSVAL_TAG_CLEAR) == 0xFFFFFF80u);
static_assert(uint32_t(JSVAL_TAG_SHIFT) == 32);
#if !defined(__wasm__) || defined(__wasi__)
#  error "Native Linux/wasm only; no WASI or fake pthread ABI"
#endif'''


def digest(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        while data := f.read(1024 * 1024):
            h.update(data)
    return h.hexdigest()


def pin(path):
    path = Path(path)
    return {'path': str(path), 'bytes': path.stat().st_size, 'sha256': digest(path)}


def probe(path, expected=None, directory=False):
    """A denied input remains denied; never walk parents or try private aliases."""
    result = {'path': str(path)}
    try:
        p = Path(path)
        st = p.stat()
        if directory:
            if not stat.S_ISDIR(st.st_mode):
                return dict(result, status='wrong-type')
            # stat alone does not prove a directory is traversable.
            with os.scandir(p) as entries:
                next(entries, None)
        else:
            if not stat.S_ISREG(st.st_mode):
                return dict(result, status='wrong-type')
            with p.open('rb') as f:
                f.read(1)
            result['bytes'] = st.st_size
            if expected:
                result['expectedSha256'] = expected['sha256']
                result['sha256'] = digest(p)
                if (result['sha256'] != expected['sha256'] or
                        st.st_size != expected.get('bytes', st.st_size)):
                    return dict(result, status='hash-mismatch')
        return dict(result, status='available')
    except OSError as e:
        return dict(result, status='inaccessible' if e.errno in (1, 13) else
                    'missing' if e.errno in (2, 20) else 'io-error', errno=e.errno,
                    error=e.strerror)


def safe_output(path, protected):
    p = Path(path).absolute()
    if p.exists() or p.is_symlink():
        raise ValueError('output must not already exist; preserve earlier evidence')
    parent = p.parent.resolve(strict=True)
    p = parent / p.name
    for item in protected:
        item = Path(item).resolve()
        if p == item or p.is_relative_to(item) or item.is_relative_to(p):
            raise ValueError('output overlaps source, repository, or retained evidence')
    mount = json.loads(subprocess.check_output(
        ['findmnt', '-J', '-T', str(parent), '-o', 'TARGET,FSTYPE,SOURCE'],
        text=True, timeout=10))['filesystems'][0]
    if mount['fstype'] in ('tmpfs', 'ramfs', 'devtmpfs'):
        raise ValueError('output must be disk-backed, not ' + mount['fstype'])
    fs = os.statvfs(parent)
    available = fs.f_bavail * fs.f_frsize
    if available < 20 * 1024**3:
        raise ValueError('less than the required 20 GiB disk reserve')
    return p, {'mount': mount, 'freeBytes': available, 'reserveBytes': 20 * 1024**3}


def parse_environment(text):
    """Accept literal exports only. Do not source a historical shell recipe."""
    env = {}
    for line in text.splitlines():
        if not line.startswith('export '):
            if line.strip() and not line.lstrip().startswith('#'):
                raise ValueError('non-export shell statement in environment recipe')
            continue
        match = re.fullmatch(r'export ([A-Za-z_][A-Za-z_0-9]*)=(.*)', line)
        if not match:
            raise ValueError('unsupported export syntax')
        words = shlex.split(match[2])
        if len(words) != 1 or any(c in words[0] for c in ('$', '`', '\n', '\x00')):
            raise ValueError('non-literal environment value: ' + match[1])
        if match[1] in env:
            raise ValueError('duplicate environment value: ' + match[1])
        env[match[1]] = words[0]
    return env


def adapt_generator(text):
    old = '!Watchtower::watchesPropertyModification(&n)'
    new = '!Watchtower::watchesPropertyValueChange(&n)'
    if text.count(old) != 1 or new in text or text.count(ABI_ANCHOR) != 1:
        raise ValueError('canonical generator does not match the reviewed Nightly adapter anchors')
    if 'Guest specializer requires wasm32 pointers' in text:
        raise ValueError('pass the canonical generator, not an already adapted copy')
    return text.replace(old, new).replace(ABI_ANCHOR, ABI_ANCHOR + ABI_GUARDS)


def relocate(value, mappings):
    # A path prefix must end at a path boundary, never inside a similarly named dir.
    for old, new in sorted(mappings.items(), key=lambda v: len(v[0]), reverse=True):
        value = re.sub(re.escape(old) + r'(?=/|$|[\s\"\'])',
                       lambda _: new, value)
    return value


def require(test, message):
    if not test:
        raise ValueError(message)


def check_receipt_chain(build, package, report):
    """These are historical provenance checks, never current runtime acceptance."""
    for stem in ('compile-PblJit', 'compile-PortableBaselineInterpret', 'link'):
        command = json.loads((build / (stem + '.command.json')).read_text())
        receipt = json.loads((build / (stem + '.receipt.json')).read_text())
        require(receipt['returncode'] == 0 and not receipt.get('failure') and
                receipt.get('remainingGroup') == [], stem + ' did not finish cleanly')
        require(command['argv'] == receipt['argv'], stem + ' command/receipt mismatch')
    archive = report['archive']
    require(set(archive['changed']) == {'PblJit.o', 'PortableBaselineInterpret.o'} and
            set(archive['explicitlyReplaced']) == set(archive['changed']),
            'historical archive replacement boundary changed')
    args = shlex.split((build / 'link.args').read_text())
    require(args.count(archive['output']['path']) == 1,
            'linked JS archive is not the recorded final159 archive')
    for flag in ('--shared-memory', '--export-table', '--growable-table'):
        require(flag in args, 'missing native final link flag: ' + flag)
    metadata = json.loads((package / 'package.json').read_text())
    require(metadata['nativeSha256'] ==
            '26e380d20f7ad198155fcf0626bc72ab49a5caf2be89e61dcafadbf4efd16998',
            'unexpected final159 package native identity')
    require(metadata['passPackage'] and metadata['nativeOnly'] and
            metadata['changed'] == ['opt/firefox/firefox'] and
            metadata['fullO2Status'] == 'complete' and not metadata['diagnosticOnly'],
            'package is not the complete-O2 native-only final159 package')
    # The initial raw-build report records an O2 timeout; a later package completed it.
    # Never promote report.passBuild or either receipt into guest runtime acceptance.
    return {'nativeSha256': metadata['nativeSha256'],
            'packageSha256': metadata['sha256'],
            'rawBuildPass': report['passBuild'], 'packagePass': metadata['passPackage'],
            'fullO2Status': metadata['fullO2Status'], 'runtimeAcceptance': False,
            'archiveMembersToReplace': archive['explicitlyReplaced']}


def archive_members(path, names):
    """Read exact members of an ordinary ar archive without executing an archiver."""
    found = {}
    with Path(path).open('rb') as f:
        require(f.read(8) == b'!<arch>\n', 'expected an ordinary ar archive')
        string_table = b''
        archive_size = Path(path).stat().st_size
        while header := f.read(60):
            require(len(header) == 60 and header[58:] == b'`\n', 'malformed archive')
            size = int(header[48:58]); offset = f.tell()
            require(size >= 0 and offset + size + (size % 2) <= archive_size,
                    'invalid or truncated archive member size')
            raw_name = header[:16].decode('ascii').strip()
            name = raw_name.rstrip('/')
            payload_offset, payload_size = offset, size
            if raw_name == '//':
                string_table = f.read(size)
            elif raw_name.startswith('#1/'):
                n = int(raw_name[3:])
                require(0 <= n <= size, 'invalid BSD archive name size')
                name = f.read(n).rstrip(b'\0').decode()
                payload_offset += n; payload_size -= n
            elif raw_name.startswith('/') and raw_name[1:].isdigit():
                n = int(raw_name[1:])
                require(0 <= n < len(string_table), 'invalid GNU archive name offset')
                name = string_table[n:].split(b'/\n', 1)[0].decode()
            if name in names:
                require(name not in found, 'duplicate target archive member: ' + name)
                f.seek(payload_offset); data = f.read(payload_size)
                require(len(data) == payload_size, 'truncated archive member')
                found[name] = {'bytes': payload_size, 'sha256': hashlib.sha256(data).hexdigest()}
            f.seek(offset + size + (size % 2))
    require(set(found) == set(names), 'missing intended JS archive member')
    return found



def adapt_host_mock(template, opcode_header):
    """Keep current fixture semantics and derive bytecode values from locked Nightly."""
    ops = []
    pattern = r'^\s*MACRO\((\w+),\s*\w+,\s*(?:"[^"]*"|NULL),\s*(\d+),\s*(-?\d+),\s*(-?\d+),\s*([^\n]+?)\)\s*\\?$'
    for match in re.finditer(pattern, opcode_header, re.M):
        ops.append({'name': match[1], 'number': len(ops), 'length': int(match[2])})
    require(len(ops) == len(re.findall(r'^\s*MACRO\((\w+),', opcode_header, re.M)),
            'incomplete Nightly opcode parse')
    require(220 < len(ops) < 256 and len({op['name'] for op in ops}) == len(ops),
            'unexpected Nightly opcode count or duplicate name')
    require(template.count('#define PBLJIT_OPS(X)') == 1 and template.count('enum class JSOp') == 1,
            'host mock opcode anchors must be unique')
    start = template.index('#define PBLJIT_OPS(X)')
    end = template.index('enum class JSOp', start)
    macro = '#define PBLJIT_OPS(X) ' + ' \\\n  '.join(
        f"X({op['name']}, {op['number']}, {op['length']})" for op in ops) + '\n'
    return (template[:start] + macro + template[end:]).replace(
        "Firefox 128.14.0's", "the pinned Firefox Nightly 159.0a1 source's"), ops


def derive_mappings(source, build, out, report):
    pbi = json.loads((build / 'compile-PortableBaselineInterpret.command.json').read_text())
    # Derive identities from pinned receipts rather than guessing private paths.
    old_obj = next(a[2:].removesuffix('/dist/stl_wrappers') for a in pbi['argv']
                   if a.startswith('-I') and a.endswith('/dist/stl_wrappers'))
    old_source = next(a.removesuffix('/config/gcc_hidden.h') for a in pbi['argv']
                      if a.endswith('/config/gcc_hidden.h'))
    recipe = parse_environment((source / 'linuxonweb-build/recipe/environment.sh').read_text())
    old_recipe_root = str(Path(recipe['MOZCONFIG']).parents[2])
    old_build = str(Path(report['archive']['output']['path']).parents[1])
    old_nix = '/mnt/p6/project/linux/.tmp-firefox-build/nix-local-store/nix/store'
    mapping = {old_source: str(source), old_obj: str(out / 'obj'),
               str(Path(old_obj).parent): str(out / 'deps'),
               old_recipe_root + '/recipe': str(out / 'recipe'),
               old_recipe_root + '/logs': str(out / 'logs'),
               old_recipe_root + '/source/firefox-159.0a1': str(source),
               old_recipe_root + '/obj-nightly': str(out / 'obj'),
               old_recipe_root: str(out / 'deps'),
               old_build + '/pbl/src': str(out / 'native-src'),
               old_build + '/pbl/obj': str(out / 'native-obj'),
               old_build + '/pbl/deps': str(out / 'native-deps'),
               old_build: str(out / 'link'), old_nix: '/nix/store'}
    mapping[report['archive']['output']['path']] = str(out / 'lib/libjs_static.a')
    return mapping, recipe, old_obj


def environment_inputs(env):
    result = {}
    directories = ('NIX_CC', 'NIX_BINTOOLS', 'LIBCLANG_PATH', 'WASM_MUSL_SYSROOT',
                   'WASM_MUSL_CXX_RUNTIME_LIBDIR', 'LD_LIBRARY_PATH')
    for name in ('CC', 'CXX', 'HOST_CC', 'HOST_CXX', 'AR', 'RUSTC', 'CARGO', 'CONFIG_SITE'):
        if name in env:
            result[(env[name], False)] = [name]
    for name in directories:
        if name in env:
            for part in env[name].split(':'):
                result.setdefault((part, True), []).append(name)
    for name, value in env.items():
        if name in ('PATH', 'PKG_CONFIG_PATH', 'PKG_CONFIG_PATH_wasm32_unknown_linux_musl'):
            for part in value.split(':'):
                result.setdefault((part, True), []).append(name)
        if any(k in name for k in ('FLAGS', 'CXXSTDLIB')):
            words = shlex.split(value)
            for i, word in enumerate(words):
                # Synthetic prefix-map destinations describe debug paths, not inputs.
                if word.startswith(('-fmacro-prefix-map=', '-ffile-prefix-map=', '-fdebug-prefix-map=')):
                    continue
                if word.startswith(('-I/', '-L/')):
                    result.setdefault((word[2:], True), []).append(name)
                elif word.startswith('--sysroot='):
                    result.setdefault((word.split('=', 1)[1], True), []).append(name)
                elif word.startswith('/'):
                    directory = (i > 0 and words[i-1] in ('-isystem', '-I', '-L'))
                    result.setdefault((word, directory), []).append(name)
    return result


def family(path):
    if '/native-unwind/' in path or path.endswith(('libc++.a', 'libc++abi.a', 'libunwind.a')):
        return 'cxx-abi-unwind'
    if any(x in path.lower() for x in ('mesa', 'gallium', 'zink', 'glgears', 'gpu-', 'glremote', 'static-dlsym', 'libegl')):
        return 'mesa-egl-gpu'
    if any(x in path for x in ('native-mapping', 'native-stack', 'native-runtime')):
        return 'native-adapter'
    if '/obj-nightly/' in path:
        return 'configured-firefox-object'
    return 'link-input'


def write_json(path, data):
    Path(path).write_text(json.dumps(data, indent=2) + '\n')


def prepare(args):
    source, build, package = (p.resolve(strict=True) for p in
                               (args.source, args.build_receipts, args.package))
    lock = json.loads(args.lock.read_text())
    validate_lock(lock)
    candidate = args.jit_source.resolve(strict=True)
    fixtures = (args.host_fixtures or candidate.parent / 'host-test').resolve(strict=True)
    out, storage = safe_output(args.output, [source, build, package, REPO,
                                             candidate.parent, fixtures])
    roots = {'source': source, 'build': build, 'package': package}
    evidence = []
    for record in lock['files']:
        relative = Path(record['path'])
        require(not relative.is_absolute() and '..' not in relative.parts,
                'lock path must remain inside its named input root')
        checked = probe(roots[record['root']] / relative, record)
        evidence.append(dict(checked, role=record['root'] + ':' + record['path']))
    git = subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'],
                                  text=True, timeout=10).strip()
    evidence.append({'role': 'source-git-head', 'path': str(source),
                     'expected': lock['sourceGitHead'], 'observed': git,
                     'status': 'available' if git == lock['sourceGitHead'] else 'identity-mismatch'})
    bad = [r for r in evidence if r['status'] != 'available']
    out.mkdir()
    write_json(out / 'owner.json', {'schema': SCHEMA, 'output': str(out),
                'purpose': 'owned final159 rebuild preflight; no runtime deployment',
                'lock': pin(args.lock.resolve()), 'storage': storage})
    if bad:
        write_json(out / 'unavailable-inputs.json', bad)
        write_json(out / 'preflight.json', {'schema': SCHEMA, 'passEvidence': False,
                   'evidence': evidence, 'unavailableInputs': bad,
                   'nativeIntegrationReady': False, 'fullBuildReady': False})
        print(json.dumps({'output': str(out), 'passEvidence': False,
                          'unavailableInputs': len(bad)}))
        return 2
    report = json.loads((build / 'report.json').read_text())
    chain = check_receipt_chain(build, package, report)
    members = archive_members(build / 'lib/libjs_static.a', ('PblJit.o', 'PortableBaselineInterpret.o'))
    for name, record in members.items():
        expected = pin(build / 'pbl/obj' / name)
        require(record['sha256'] == expected['sha256'], 'archive object mismatch: ' + name)
    for name in NATIVE_FILES + ('PblJit.cpp',):
        actual = pin(build / 'pbl/src' / name)
        records = [r for r in report['generatedSources'] if Path(r['path']).name == name]
        require(len(records) == 1 and actual['sha256'] == records[0]['sha256'],
                'generated source does not match final159 build report: ' + name)
    for name in ('compile-PblJit', 'compile-PortableBaselineInterpret'):
        command = json.loads((build / (name + '.command.json')).read_text())
        require(command['argv'][-1].endswith('/pbl/src/' + name[8:] + '.cpp'),
                'compile does not consume the intended generated source: ' + name)
    mapping, old_env, old_obj = derive_mappings(source, build, out, report)
    for name in ('tmp', 'profiles', 'cache', 'mozbuild', 'cargo-home', 'recipe',
                 'native-src/host-test', 'native-obj', 'native-deps', 'obj', 'link',
                 'lib', 'deps', 'logs', 'link/t', 'obj/browser/app',
                 'source-overlay/js/src/vm', 'host-packet/overlay/host-test'):
        (out / name).mkdir(parents=True, exist_ok=True)
    env = {k: relocate(v, mapping) for k, v in old_env.items()}
    env.update({k: str(out / 'tmp') for k in ('TMPDIR', 'TMP', 'TEMP')})
    env.update(MOZ_OBJDIR=str(out / 'obj'), MOZCONFIG=str(out / '.mozconfig'),
               MOZBUILD_STATE_PATH=str(out / 'mozbuild'), CARGO_HOME=str(out / 'cargo-home'),
               XDG_CACHE_HOME=str(out / 'cache'))
    mozconfig = (source / '.mozconfig').read_text()
    for flag in ('--target=wasm32-unknown-linux-musl', '--disable-jit',
                 '--enable-portable-baseline-interp', '--disable-debug-symbols'):
        require(flag in mozconfig.split(), 'missing final159 configuration flag: ' + flag)
    require(mozconfig.count('mk_add_options MOZ_OBJDIR=') == 1, 'ambiguous MOZ_OBJDIR')
    mozconfig = re.sub(r'^mk_add_options MOZ_OBJDIR=.*$',
                      'mk_add_options MOZ_OBJDIR=' + shlex.quote(str(out / 'obj')),
                      mozconfig, flags=re.M)
    (out / '.mozconfig').write_text(mozconfig)
    (out / 'recipe/environment.sh').write_text('# Generated literal exports; inspect preflight.json before use.\n' +
                   '\n'.join('export ' + k + '=' + shlex.quote(v) for k, v in sorted(env.items())) + '\n')
    for name in ('rustc', 'cargo'):
        text = relocate((source / 'linuxonweb-build/recipe' / name).read_text(), mapping)
        (out / 'recipe' / name).write_text(text)
        (out / 'recipe' / name).chmod(0o755)
    # These are reviewed source shims, not synthetic Firefox configured headers.
    for record in lock['files']:
        prefix = 'linuxonweb-build/recipe/shim/'
        if record['root'] == 'source' and record['path'].startswith(prefix):
            relative = Path(record['path']).relative_to('linuxonweb-build/recipe')
            target = out / 'recipe' / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes((source / record['path']).read_bytes())
    # Copy exact source inputs of the generated tiers. Include lookup is local to PBI.
    adapted = adapt_generator(candidate.read_text())
    tiers = []
    for name in NATIVE_FILES + ('PblJit.cpp',):
        target = out / 'native-src' / name
        text = adapted if name == 'PblJit.cpp' else (build / 'pbl/src' / name).read_text()
        target.write_text(text)
        (out / 'source-overlay/js/src/vm' / name).write_text(text)
        tiers.append(dict(pin(target), source=str(candidate if name == 'PblJit.cpp' else build / 'pbl/src' / name),
                          tier={'PblJit.cpp': 'PBLJIT', 'PblIc.inc': 'PBLIC',
                                'PblMethod.inc': 'PBLBC'}.get(name, 'interpreter-or-support')))
    pbi = (out / 'native-src/PortableBaselineInterpret.cpp').read_text()
    for include in ('PblIc.inc', 'PblMethod.inc'):
        require('#include "' + include + '"' in pbi, 'tier include is not local: ' + include)
    require('pbljit::OnLoopHead' in pbi, 'missing PBLJIT loop hook')
    mock = fixtures / 'mock.h'
    opcode_header = source / 'js/src/vm/Opcodes.h'
    mock_text, host_ops = adapt_host_mock(mock.read_text(), opcode_header.read_text())
    (out / 'native-src/host-test/mock.h').write_text(mock_text)
    host = out / 'host-packet'
    (host / 'fixtures').mkdir()
    (host / 'overlay/PblJit.cpp').write_text(adapted)
    (host / 'overlay/host-test/mock.h').write_text(mock_text)
    for name in HOST_FIXTURE_FILES:
        (host / 'fixtures' / name).write_bytes((fixtures / name).read_bytes())
    for name in ('PblTierObserve.h', 'PblCacheObserve.h'):
        (host / 'overlay' / name).write_bytes((build / 'pbl/src' / name).read_bytes())
    write_json(host / 'opcode-audit.json', {'source': pin(opcode_header), 'ops': host_ops})
    host_files = [dict(pin(p), path=str(p.relative_to(host))) for p in sorted(host.rglob('*')) if p.is_file()]
    write_json(host / 'manifest.json', {'pass': True, 'coverage': 'broad', 'hostFixtures': 'fixtures',
               'hostFixtureFiles': list(HOST_FIXTURE_FILES), 'hostRunners': HOST_RUNNERS,
               'scope': 'locked final159 opcode identities with explicit candidate and fixture sources; host-only',
               'files': host_files, 'inputs': [pin(path) for path in
                   [candidate, mock, opcode_header, args.lock.resolve()] +
                   [fixtures / name for name in HOST_FIXTURE_FILES]]})
    integration = []
    for stem in ('PblJit', 'PortableBaselineInterpret'):
        command = json.loads((build / ('compile-' + stem + '.command.json')).read_text())
        argv = [relocate(a, mapping) for a in command['argv']]
        require(argv[-1] == str(out / 'native-src' / (stem + '.cpp')), 'unbound candidate compiler input')
        integration.append({'name': stem, 'argv': argv, 'cwd': relocate(command['cwd'], mapping)})
    link_args = [relocate(a, mapping) for a in shlex.split((build / 'link.args').read_text())]
    write_json(out / 'compile-commands.json', integration)
    (out / 'link/link.args').write_text('\n'.join(shlex.quote(a) for a in link_args) + '\n')
    link_command = json.loads((build / 'link.command.json').read_text())
    write_json(out / 'link-command.json', {'argv': [relocate(a, mapping) for a in link_command['argv']],
               'cwd': relocate(link_command['cwd'], mapping), 'executable': False,
               'reason': 'native dependency closure and JS archive replacement must pass first'})
    inputs = []
    for (path, directory), roles in sorted(environment_inputs(env).items()):
        checked = probe(path, directory=directory)
        inputs.append(dict(checked, family='toolchain-environment', roles=sorted(set(roles))))
    # Inspect every include/forced header actually named by the native commands.
    for command in integration:
        argv = command['argv']
        for i, argument in enumerate(argv):
            if argument.startswith('-I/'):
                inputs.append(dict(probe(argument[2:], directory=True),
                                   family='native-compile-include', requiredBy=command['name']))
            elif i and argv[i - 1] == '-include':
                inputs.append(dict(probe(argument), family='native-compile-header',
                                   requiredBy=command['name']))
        inputs.append(dict(probe(argv[0]), family='native-compiler', requiredBy=command['name']))
    # Public immutable Nix references inside the exact wrappers are independent inputs.
    for name in ('rustc', 'cargo'):
        wrapper = (out / 'recipe' / name).read_text()
        for value in sorted(set(re.findall(r'/nix/store/[^\s\"\']+', wrapper))):
            inputs.append(dict(probe(value, directory='/bin/' not in value),
                               family='rust-toolchain', requiredBy=name))
    for row in report['linkInputs']:
        path = row['path']; mapped = relocate(path, mapping)
        historical = probe(path) if mapped != path else None
        checked = probe(mapped, row)
        inputs.append(dict(checked, historicalPath=path, historicalStatus=historical,
                           family=family(path), requiredBy='final159-link'))
    configured = ('config.status', 'mozilla-config.h', 'dist/include/js/TypeDecls.h',
                  'dist/include/mozilla/Attributes.h', 'dist/include/js-config.h',
                  'dist/include/nspr/prtypes.h', 'dist/stl_wrappers', 'dist/system_wrappers')
    for name in configured:
        directory = name.endswith(('stl_wrappers', 'system_wrappers'))
        inputs.append(dict(probe(out / 'obj' / name, directory=directory),
                           family='configured-header-or-backend', requiredBy='native-integration',
                           action='generate with the exact owned-source configure/build; never synthesize'))
    # Closure for native adapter sources and their ABI-specific inputs is explicit.
    adapter_sources = [REPO / 'web/linux/firefox-shims/mmap-shim.c',
                       source / 'linuxonweb-build/adapters/native-runtime/runtime.c',
                       source / 'linuxonweb-build/adapters/native-stack/stack.c']
    for path in adapter_sources:
        inputs.append(dict(probe(path), family='native-adapter-source'))
    runtime_recipe = (source / 'linuxonweb-build/recipe/configure-cxx-runtime.py').read_text()
    llvm_match = re.search(r"SOURCE = Path\('([^']+)'\)", runtime_recipe)
    require(llvm_match is not None, 'LLVM runtime source is not declared')
    for component in ('runtimes', 'libcxx', 'libcxxabi', 'libunwind'):
        inputs.append(dict(probe(Path(llvm_match[1]) / component / 'CMakeLists.txt'),
                           family='cxx-abi-unwind-source'))
    # The native stack adapter includes musl private headers; libc alone is insufficient.
    stack_recipe = (source / 'linuxonweb-build/recipe/build-native-stack.py').read_text()
    for value in sorted(set(re.findall(r'/nix/store/[^\s\"\']+', stack_recipe))):
        if value.endswith('-source'):
            for relative, directory in (('src/include/features.h', False),
                    ('src/internal', True), ('arch/wasm32', True), ('arch/generic', True)):
                inputs.append(dict(probe(Path(value) / relative, directory=directory),
                                   family='musl-private-header', requiredBy='native-stack'))
    rust_target = source / 'linuxonweb-build/recipe/rust-target/wasm32-unknown-linux-musl.json'
    inputs.append(dict(probe(rust_target), family='rust-target'))
    if rust_target.is_file():
        (out / 'recipe/rust-target').mkdir()
        (out / 'recipe/rust-target' / rust_target.name).write_bytes(rust_target.read_bytes())
    unavail = [r for r in inputs if r['status'] != 'available']
    by_family = {}
    for name in sorted({r['family'] for r in inputs}):
        by_family[name] = dict(collections.Counter(r['status'] for r in inputs if r['family'] == name))
    # This is a preparation boundary. Even an available historical archive cannot
    # attest the candidate. Actual compile/archive/link receipts remain mandatory.
    result = {'schema': SCHEMA, 'passEvidence': True, 'output': str(out),
              'evidence': evidence, 'historicalChain': chain, 'archiveMembers': members,
              'source': str(source), 'sourceGitHead': git, 'candidate': pin(candidate),
              'candidateAdaptation': ['Nightly Watchtower API', 'native Wasm Value/pointer ABI assertions'],
              'compilerSourceBinding': tiers, 'pathMappings': mapping,
              'storage': storage, 'dependencySummary': by_family,
              'inputs': inputs, 'unavailableInputs': unavail,
              'hostPacketReady': True, 'nativeIntegrationReady': False, 'fullBuildReady': False,
              'guestRuntimeAcceptance': False, 'cacheSeeding': False, 'writeBuffering': False,
              'packedResources': False,
              'requiredNextSteps': [
                  'create a complete owned source checkout, then apply the recorded source-overlay',
                  'relocate source linuxonweb-build/adapters/defs.mk and complete dependency closure',
                  'configure/build exact Firefox generated headers and backend in owned obj',
                  'compile both recorded native-src translation units and replace exactly both archive members',
                  'link only after every input identity and completed process receipt is verified',
                  'full O2, Wasm validation, native-only package, then source-specific normal-exit guest acceptance']}
    (out / 'adapter-defs.mk').write_text(relocate((source / 'linuxonweb-build/adapters/defs.mk').read_text(), mapping))
    write_json(out / 'preflight.json', result)
    write_json(out / 'unavailable-inputs.json', unavail)
    print(json.dumps({'output': str(out), 'passEvidence': True, 'hostPacketReady': True,
                     'nativeIntegrationReady': False, 'fullBuildReady': False,
                     'unavailableInputs': len(unavail), 'dependencySummary': by_family}, indent=2))
    return 2


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--build-receipts', type=Path, required=True)
    parser.add_argument('--package', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--jit-source', type=Path, default=REPO / 'tools/pbl-jit/PblJit.cpp')
    parser.add_argument('--host-fixtures', type=Path, help='complete mock, emitter, baseline and nested fixtures; defaults beside --jit-source')
    parser.add_argument('--lock', type=Path, default=HERE / 'final159-rebuild-lock.json')
    args = parser.parse_args(argv)
    try:
        return prepare(args)
    except (OSError, ValueError, KeyError, StopIteration, subprocess.SubprocessError) as error:
        print(json.dumps({'schema': SCHEMA, 'error': str(error),
                          'nativeIntegrationReady': False, 'fullBuildReady': False}), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
