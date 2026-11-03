#!/usr/bin/env python3
"""Build Firefox JIT and watchdog objects, preserve other inputs, and package.

This is an incremental source rebuild against explicitly retained musl build
inputs. It is not a pristine-tree Firefox build or a runtime acceptance test.
"""
import argparse
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import resource
import shlex
import shutil
import signal
import subprocess
import sys
import time

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
NIGHTLY = Path('/mnt/p6/build/firefox-nightly-musl-jit-full-20261002')
RECOVERY = Path('/mnt/p6/build/firefox-nightly-musl-recovery-20261002/source/firefox-159.0a1')
BASE_NATIVE = Path('/mnt/p3/codex-build/gpt6-jit20-observe-native')
BASE_PACKAGE = Path('/mnt/p3/codex-build/gpt6-jit12/loop-gc-package/candidate')
TOOLCHAIN = Path('/mnt/p6/project/linux/.tmp-firefox-build/nix-local-store/nix/store/xwpycnlb71djqs4gyxhbkxhzb3pw1ib4-llvm-toolchain-22.1.8/bin')
PBI_BASE_SHA = '68ad285afe873cef8afdc4739350ded8854dbc5257f621a1788922253e47eef5'
XPC_KIND = 'Unified_cpp_js_xpconnect_src0'
XPC_BASE_SHA = '3625183bec9f084f115b7136bc1d102d3d69c016910975de956c359266c090ca'
XPC_UNIFIED = NIGHTLY/'obj-nightly/js/xpconnect/src'/f'{XPC_KIND}.cpp'
XPC_UNIFIED_SHA = 'baf47ec8f63af74e8dd72a7ca916c074dae58eaea618e46cda976d72fe4c49b5'
XPC_OBJECT_SHA = '6b13c9f12e4d78959866a2f00f921c7384e3a6b518b904647e751ac980bf8974'
GIB = 1024**3


def digest(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def artifact(path):
    path = Path(path).resolve(strict=True)
    before = path.stat()
    result = dict(path=str(path), bytes=before.st_size, sha256=digest(path))
    after = path.stat()
    if (before.st_size, before.st_mtime_ns, before.st_ino) != (after.st_size, after.st_mtime_ns, after.st_ino):
        raise RuntimeError('Input changed during hashing: ' + str(path))
    return result


def save(path, value):
    Path(path).write_text(json.dumps(value, indent=2) + '\n')


def process_identity(pid):
    try:
        fields = (Path('/proc') / str(pid) / 'stat').read_text().rsplit(')', 1)[1].split()
        return dict(pid=pid, start=fields[19], group=int(fields[2]), session=int(fields[3]))
    except (OSError, ValueError):
        return None


def group_members(pgid):
    found = []
    for entry in Path('/proc').iterdir():
        if entry.name.isdigit():
            value = process_identity(int(entry.name))
            if value and value['group'] == pgid:
                found.append(value)
    return found


def cpu_limit():
    affinity = sorted(os.sched_getaffinity(0))
    limit = float(len(affinity))
    evidence = []
    for row in Path('/proc/self/cgroup').read_text().splitlines():
        if row.startswith('0::'):
            folder = Path('/sys/fs/cgroup') / row[3:].lstrip('/')
            for directory in [folder, *folder.parents]:
                if not directory.is_relative_to('/sys/fs/cgroup'):
                    break
                path = directory / 'cpu.max'
                if path.exists():
                    quota, period = path.read_text().split()
                    evidence.append(dict(path=str(path), value=f'{quota} {period}'))
                    if quota != 'max':
                        limit = min(limit, int(quota) / int(period))
    return dict(affinity=affinity, effective=limit, quotas=evidence)


def memory_available():
    available = int(next(row.split()[1] for row in Path('/proc/meminfo').read_text().splitlines()
                         if row.startswith('MemAvailable:'))) * 1024
    for row in Path('/proc/self/cgroup').read_text().splitlines():
        if row.startswith('0::'):
            folder = Path('/sys/fs/cgroup') / row[3:].lstrip('/')
            for directory in [folder, *folder.parents]:
                if not directory.is_relative_to('/sys/fs/cgroup'):
                    break
                maximum, current = directory / 'memory.max', directory / 'memory.current'
                if maximum.exists() and current.exists():
                    value = maximum.read_text().strip()
                    if value != 'max':
                        available = min(available, int(value) - int(current.read_text()))
    return available


def load_protected_process_pins(path):
    """Verify an explicit nonempty PID/start manifest using only process stat."""
    if not path:
        raise ValueError('LINUXWEB_PROTECTED_PROCESS_PINS must name a JSON file')
    path = Path(path).resolve(strict=True)
    source = artifact(path)
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != source['sha256']:
        raise ValueError('Protected process pin file changed during reading')
    def unique_pairs(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError('Duplicate protected process PID')
            result[key] = value
        return result
    pins = json.loads(data, object_pairs_hook=unique_pairs)
    if not isinstance(pins, dict) or not pins:
        raise ValueError('Protected process pins must be a nonempty PID/start object')
    protected = {}
    for key, start in pins.items():
        if not isinstance(key, str) or not re.fullmatch(r'[1-9][0-9]*', key) or int(key) > 2147483647:
            raise ValueError('Protected process PID must be a positive decimal PID string')
        if not isinstance(start, str) or not re.fullmatch(r'0|[1-9][0-9]*', start):
            raise ValueError('Protected process start must be a decimal stat start-time string')
        actual = process_identity(int(key))
        if actual is None or actual['start'] != start:
            raise ValueError('Protected process identity is missing or stale: '+key)
        protected[key] = actual
    return protected, source


class Owner:
    def __init__(self, out, cpus, *, work_seconds=560, outer_seconds=600, optimizer_observer=None):
        self.out, self.started = out, time.monotonic()
        if (work_seconds, outer_seconds) not in ((560, 600), (1860, 1900)):
            raise ValueError("Unsupported owner deadline profile")
        self.work_seconds, self.outer_seconds = work_seconds, outer_seconds
        self.optimizer_observer = optimizer_observer
        self.cpu = cpu_limit()
        count = min(cpus, max(1, math.floor(self.cpu['effective'])))
        os.sched_setaffinity(0, self.cpu['affinity'][:count])
        self.cpu['selectedAffinity'] = sorted(os.sched_getaffinity(0))
        self.environment = os.environ.copy()
        self.environment.update(TMPDIR=str(out/'t'), TMP=str(out/'t'), TEMP=str(out/'t'),
                                XDG_CACHE_HOME=str(out/'t/cache'), CLANG_MODULE_CACHE_PATH=str(out/'t/modules'),
                                CCACHE_DISABLE='1', SCCACHE_DISABLE='1', PYTHONDONTWRITEBYTECODE='1',
                                BINARYEN_CORES=str(count))
        self.commands = []
        self.resources = []
        self.last_size_check = 0
        self.size = 0
        self.phase = 'prepare'
        self.protected = {}
        self.protected_pin_source = None
        pin_path = os.environ.get('LINUXWEB_PROTECTED_PROCESS_PINS')
        if pin_path is not None:
            self.protected, self.protected_pin_source = load_protected_process_pins(pin_path)
        else:
            # Observe persistent browser/display/preview identities without claiming
            # ownership of unrelated short-lived processes.
            for entry in Path('/proc').iterdir():
                if not entry.name.isdigit():
                    continue
                try:
                    command = (entry/'cmdline').read_bytes().replace(b'\0', b' ').decode(errors='replace')
                    if any(word in command for word in ['Xvfb :11', 'Xephyr :13', 'web/desktop/serve.mjs',
                                                        'dev-server.mjs', 'cloudflared', 'fxdev7']):
                        ident = process_identity(int(entry.name))
                        if ident and ident['pid'] != os.getpid():
                            self.protected[entry.name] = ident
                except OSError:
                    pass
        save(out/'owner.json', dict(identity=process_identity(os.getpid()), cpu=self.cpu,
                                   cgroup=Path('/proc/self/cgroup').read_text(),
                                   workSeconds=self.work_seconds, outerSeconds=self.outer_seconds, perChildAddressSpaceBytes=16*GIB,
                                   availableMemoryFloorBytes=GIB, diskReserveBytes=20*GIB,
                                   artifactLimitBytes=8*GIB, sampledMemoryProtection=True,
                                   protected=self.protected, protectedPinSource=self.protected_pin_source))
        self.guard()

    def guard(self):
        elapsed = time.monotonic() - self.started
        free = shutil.disk_usage(self.out).free
        memory = memory_available()
        if elapsed - self.last_size_check >= 2:
            self.size = sum(path.stat().st_size for path in self.out.rglob('*') if path.is_file())
            self.last_size_check = elapsed
        if elapsed > self.work_seconds or free < 20*GIB or memory < GIB or self.size > 8*GIB:
            raise RuntimeError(f'Resource bound: elapsed={elapsed:.2f}, free={free}, memory={memory}, artifacts={self.size}')
        row = dict(elapsed=elapsed, phase=self.phase, availableMemoryBytes=memory,
                   freeDiskBytes=free, artifactBytes=self.size)
        self.resources.append(row)
        return row

    def run(self, name, argv, cwd=None, seconds=450, env=None):
        self.phase = name
        self.guard()
        command = [str(value) for value in argv]
        record = dict(name=name, argv=command, cwd=str(cwd or self.out), maximumSeconds=seconds)
        save(self.out/(name+'.command.json'), record)
        started, failure, process = time.monotonic(), None, None
        known = {}
        def limits():
            resource.setrlimit(resource.RLIMIT_AS, (16*GIB, 16*GIB))
            resource.setrlimit(resource.RLIMIT_FSIZE, (2*GIB, 2*GIB))
            resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        try:
            with (self.out/(name+'.stdout.log')).open('wb') as stdout, (self.out/(name+'.stderr.log')).open('wb') as stderr:
                process = subprocess.Popen(command, cwd=cwd or self.out,
                                           env=env or self.environment, stdout=stdout, stderr=stderr,
                                           start_new_session=True, preexec_fn=limits)
                owned = process_identity(process.pid)
                if owned is None or owned['group'] != process.pid:
                    raise RuntimeError('Could not identify child process group')
                record['identity'] = owned
                known[process.pid] = owned
                while process.poll() is None:
                    if name == 'optimize' and self.optimizer_observer is not None:
                        self.optimizer_observer(owned, time.monotonic()-started)
                    for member in group_members(process.pid):
                        known[member['pid']] = member
                    if time.monotonic() - started > seconds:
                        raise TimeoutError(name + ' exceeded its phase deadline')
                    self.guard()
                    time.sleep(.25)
                if process.returncode:
                    raise RuntimeError(f'{name} exited {process.returncode}; see {name}.stderr.log')
                if group_members(process.pid):
                    raise RuntimeError(name + ' left a child process alive')
        except BaseException as error:
            failure = repr(error)
            raise
        finally:
            if process is not None:
                members = group_members(process.pid)
                if members:
                    anchors = [member for member in members if known.get(member['pid']) == member]
                    if not anchors:
                        raise RuntimeError('Refusing cleanup without an owned process identity')
                    os.killpg(process.pid, signal.SIGTERM)
                    until = time.monotonic() + 5
                    while group_members(process.pid) and time.monotonic() < until:
                        process.poll()
                        time.sleep(.05)
                    members = group_members(process.pid)
                    if members:
                        if not any(known.get(member['pid']) == member for member in members):
                            raise RuntimeError('Owned process identity changed before forced cleanup')
                        os.killpg(process.pid, signal.SIGKILL)
                process.wait(timeout=5)
                record.update(returncode=process.returncode, remainingGroup=group_members(process.pid))
            record.update(elapsedSeconds=time.monotonic()-started, failure=failure)
            self.commands.append(record)
            save(self.out/(name+'.receipt.json'), record)
            save(self.out/'commands.json', self.commands)


def archive_members(path):
    data = Path(path).read_bytes()
    if data[:8] != b'!<arch>\n':
        raise ValueError('Expected a regular static archive')
    position, strings, result = 8, b'', []
    while position < len(data):
        header = data[position:position+60]
        if len(header) != 60 or header[58:] != b'`\n':
            raise ValueError('Invalid archive member header')
        size = int(header[48:58])
        body = data[position+60:position+60+size]
        if len(body) != size:
            raise ValueError('Truncated archive member')
        name = header[:16].decode().strip()
        if name == '//':
            strings = body
        elif name not in ('/', '/SYM64/'):
            if name.startswith('/'):
                offset = int(name[1:])
                end = strings.find(b'/\n', offset)
                if end < 0:
                    raise ValueError('Invalid archive long name')
                name = strings[offset:end].decode()
            elif name.startswith('#1/'):
                raise ValueError('BSD archives are not supported')
            else:
                name = name.rstrip('/')
            result.append(dict(name=name, bytes=size, sha256=hashlib.sha256(body).hexdigest()))
        position += 60 + size + size % 2
    if position != len(data):
        raise ValueError('Archive end mismatch')
    return result


def link_inputs(tokens, cwd, seen=None):
    seen = set() if seen is None else seen
    paths = set()
    skip = False
    for token in tokens:
        if skip:
            skip = False
        elif token in ('-m', '-o', '-z'):
            skip = True
        elif token.startswith('@'):
            path = (cwd/token[1:]).resolve()
            if path in seen:
                raise ValueError('Recursive linker response file')
            paths.add(path)
            paths.update(link_inputs(shlex.split(path.read_text()), cwd, seen | {path}))
        elif token.startswith('-l'):
            raise ValueError('Implicit library input needs an explicit path: '+token)
        elif not token.startswith('-'):
            path = (cwd/token).resolve(strict=True)
            if not path.is_file():
                raise ValueError('Missing linker input: '+token)
            paths.add(path)
    return paths


def prepare_xpc(repo, out, prepared):
    """Adapt only the retained XPC source and preserve the other unified inputs."""
    original, unified = artifact(prepared), artifact(XPC_UNIFIED)
    if original['sha256'] != XPC_BASE_SHA or unified['sha256'] != XPC_UNIFIED_SHA:
        raise ValueError('Retained XPC source or unified translation unit changed')
    adapter = repo/'tools/nightly-jit-prep/extension_document_budget.py'
    spec = importlib.util.spec_from_file_location('extension_document_budget', adapter)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    adapted = out/'pbl/src/XPCJSContext.cpp'
    adapted.write_text(module.adapt_xpc(prepared.read_text()))
    text = XPC_UNIFIED.read_text()
    includes = re.findall(r'^#include "([^"]+)"$', text, re.M)
    if len(includes) != 16 or sum(Path(value).name == 'XPCJSContext.cpp' for value in includes) != 1:
        raise ValueError('Unexpected XPC unified source include inventory')
    original_xpc = (NIGHTLY/'source/firefox-159.0a1/js/xpconnect/src/XPCJSContext.cpp').resolve(strict=True)
    inputs, replacements = [], {}
    for value in includes:
        source = (XPC_UNIFIED.parent/value).resolve(strict=True)
        inputs.append(artifact(source))
        replacements[value] = str(adapted if source == original_xpc else source)
    text = re.sub(r'^#include "([^"]+)"$', lambda match: '#include "'+replacements[match[1]]+'"', text, flags=re.M)
    destination = out/'pbl/src'/XPC_UNIFIED.name
    destination.write_text(text)
    return dict(scope='Linux/Wasm extension documents with AddonPolicy', defaultSeconds=60,
                preference=module.PREFERENCE, adapter=artifact(adapter), preparedSource=original,
                unifiedSource=unified, includedSources=inputs, adaptedSource=artifact(adapted),
                adaptedUnifiedSource=artifact(destination), redirectedIncludeCount=1,
                unchangedIncludeCount=len(includes)-1)


def replace_xpc_response(tokens, cwd, out, obj):
    """Replace exactly one XPC object in an owned copy of the flat response file."""
    indices = [index for index, token in enumerate(tokens) if token.startswith('@')]
    if len(indices) != 1:
        raise ValueError('Expected one explicit Firefox object response file')
    response_path = (cwd/tokens[indices[0]][1:]).resolve(strict=True)
    before = shlex.split(response_path.read_text())
    if any(token.startswith('@') for token in before):
        raise ValueError('Nested object responses are not part of the retained base')
    original_obj = XPC_UNIFIED.with_suffix('.o').resolve(strict=True)
    original_artifact = artifact(original_obj)
    if original_artifact['sha256'] != XPC_OBJECT_SHA:
        raise ValueError('Retained XPC object changed')
    matches = [index for index, token in enumerate(before)
               if not token.startswith('-') and (cwd/token).resolve() == original_obj]
    if len(matches) != 1:
        raise ValueError('Expected one retained XPC object response token')
    after = list(before)
    after[matches[0]] = str(obj)
    destination = out/'firefox-objects.list'
    destination.write_text('\n'.join(shlex.quote(token) for token in after)+'\n')
    if shlex.split(destination.read_text()) != after or any(old != new for index,(old,new) in enumerate(zip(before,after)) if index != matches[0]):
        raise ValueError('A non-XPC object response token changed')
    tokens[indices[0]] = '@'+str(destination)
    return dict(originalResponse=artifact(response_path), outputResponse=artifact(destination),
                originalObject=original_artifact, outputObject=artifact(obj),
                replacedTokenIndex=matches[0], tokenCount=len(before),
                otherTokensIdentical=True)


def compile_argv(kind, out, repo):
    optimization = '-O2' if kind == XPC_KIND else '-O3'
    if kind in ('PblJit', XPC_KIND):
        provenance = NIGHTLY/('evidence/compile-preflight-run2/xpc-argv.stdout' if kind == XPC_KIND
                              else 'evidence/compile-preflight/vm-argv.stdout')
        matches = [shlex.split(line) for line in provenance.read_text().splitlines()
                   if 'clang++ -std=' in line and f' -o {kind}.o ' in line]
        if len(matches) != 1:
            raise ValueError('Expected one original '+kind+' compiler command')
        args = matches[0]
        args[args.index('-MF')+1] = str(out/f'pbl/deps/{kind}.o.pp')
    elif kind == 'PortableBaselineInterpret':
        provenance = repo/'tools/nightly-musl/pbl-jit/compile-ic.sh'
        lines = [line for line in provenance.read_text().splitlines() if 'clang++ -std=' in line]
        if len(lines) != 1:
            raise ValueError('Expected one original PBI compiler command')
        line = re.sub(r'\$\{PBL_BUILD:-[^}]+\}', str(out/'pbl'), lines[0])
        args = shlex.split(line)
        args[-1:-1] = ['-MD', '-MP', '-MF', str(out/'pbl/deps/PortableBaselineInterpret.o.pp')]
    else:
        raise ValueError('Unknown explicitly compiled translation unit: '+kind)
    args[args.index('-o')+1] = str(out/f'pbl/obj/{kind}.o')
    args[-1] = str(out/f'pbl/src/{kind}.cpp')
    if [token for token in args if re.fullmatch(r'-O(?:[0-3sgz]|fast)', token)] != [optimization] or '-DNDEBUG=1' not in args or any(re.fullmatch(r'-g(?:\d|gdb.*|dwarf.*)?', token) for token in args):
        raise ValueError('Compiler command must retain original release '+optimization+' and no debug information')
    return args, artifact(provenance)


def run_build(args, owner, state):
    out, repo = owner.out, args.source_root.resolve(strict=True)
    prepared_pbi = args.prepared_pbi.resolve(strict=True)
    prepared_xpc = args.prepared_xpc.resolve(strict=True)
    if digest(prepared_pbi) != PBI_BASE_SHA:
        raise ValueError('Prepared PBI baseline changed; this recipe binds the historical observer baseline')
    generator = repo/'tools/nightly-jit-prep/prepare.py'
    raw_files = [generator, repo/'tools/pbl-jit/PblJit.cpp', repo/'tools/pbl-jit/PblCacheObserve.h',
                 repo/'tools/pbl-jit/host-test/mock.h', prepared_pbi]
    pbl_names = ['PortableBaselineInterpret.patch','PblIc.inc','PblIcOps.h','PblMethod.inc','PblTierObserve.h']
    raw_files += [repo/'tools/nightly-musl/pbl-jit'/name for name in pbl_names]
    state['sourceInputs'] = [artifact(path) for path in raw_files]
    state['sourceBoundary'] = 'Canonical JIT generator and extension-document watchdog adapter plus exact retained prepared/observed PBI and XPC baselines; not pristine upstream'
    owner.run('generate', [sys.executable, '-B', generator, '--source', args.upstream_source,
                           '--output', out/'generated', '--coverage', 'broad'], seconds=60)
    for directory in ['pbl/src','pbl/obj','pbl/deps','lib','obj']:
        (out/directory).mkdir(parents=True, exist_ok=True)
    xpc = prepare_xpc(repo, out, prepared_xpc)
    state['xpcIntegration'] = xpc
    xpc_inputs = [xpc['adapter'], xpc['preparedSource'], xpc['unifiedSource'], *xpc['includedSources']]
    state['sourceInputs'] = list({item['path']: item for item in state['sourceInputs']+xpc_inputs}.values())
    for name in ['PblJit.cpp', 'PblCacheObserve.h']:
        shutil.copyfile(out/'generated/overlay'/name, out/'pbl/src'/name)
    shutil.copyfile(prepared_pbi, out/'pbl/src/PortableBaselineInterpret.cpp')
    for name in pbl_names[1:]:
        shutil.copyfile(repo/'tools/nightly-musl/pbl-jit'/name, out/'pbl/src'/name)
    owner.run('patch-pbi', ['patch','--batch','--fuzz=0',out/'pbl/src/PortableBaselineInterpret.cpp',
                            repo/'tools/nightly-musl/pbl-jit/PortableBaselineInterpret.patch'], seconds=30)
    patch_log = (out/'patch-pbi.stdout.log').read_text() + (out/'patch-pbi.stderr.log').read_text()
    if re.search(r'offset|fuzz|FAILED|Reversed', patch_log):
        raise ValueError('PBI patch did not apply at its exact original anchors')
    state['generatedSources'] = [artifact(path) for path in sorted((out/'pbl/src').iterdir())]
    state['generatorManifest'] = artifact(out/'generated/manifest.json')
    # Diagnose a missing header or incompatible raw input before any native job.
    pbl = (out/'pbl/src/PblJit.cpp').read_text()
    if 'void ObserveSkip(' not in pbl or 'void ObservePolicy(' not in pbl:
        raise ValueError('PBI calls require the integrated observed PblJit source; no inherited object is used')
    if args.stage == 'sources':
        return
    environment = REPO/'tools/nightly-musl/recipe/environment.sh'
    names = re.findall(r'^export ([A-Za-z_][A-Za-z0-9_]*)=', environment.read_text(), re.M)
    expression = 'import json,os,sys; print(json.dumps({k:os.environ[k] for k in sys.argv[1:] if k in os.environ}))'
    owner.run('compiler-environment', ['bash','-c','source "$1"; shift; python3 -B -c '+shlex.quote(expression)+' "$@"','release',environment,*names], seconds=30)
    env = owner.environment.copy()
    env.update(json.loads((out/'compiler-environment.stdout.log').read_text()))
    # Keep the environment file's musl/toolchain flags; restore task-owned caches.
    for name in ['TMPDIR','TMP','TEMP','XDG_CACHE_HOME','CLANG_MODULE_CACHE_PATH','CCACHE_DISABLE',
                 'SCCACHE_DISABLE','PYTHONDONTWRITEBYTECODE','BINARYEN_CORES']:
        env[name] = owner.environment[name]
    state['compilerEnvironment'] = artifact(environment)
    state['objects'] = {}
    state['compileCommands'] = {}
    for kind in ['PblJit', 'PortableBaselineInterpret', XPC_KIND]:
        command, provenance = compile_argv(kind, out, repo)
        compile_cwd = XPC_UNIFIED.parent if kind == XPC_KIND else out/'t'
        owner.run('compile-'+kind, command, cwd=compile_cwd, env=env)
        obj = out/f'pbl/obj/{kind}.o'
        owner.run('object-'+kind, ['/usr/bin/wasm-objdump','-h',obj], seconds=30)
        headers = (out/('object-'+kind+'.stdout.log')).read_text()
        if re.search(r'\.z?debug', headers) or 'linking' not in headers:
            raise ValueError('Object contains debug information or is not relocatable Wasm')
        state['objects'][kind] = artifact(obj)
        state['compileCommands'][kind] = dict(argv=command, cwd=str(compile_cwd), provenance=provenance, compiler=artifact(command[0]))
    if args.stage == 'objects':
        return
    base = args.base_native.resolve(strict=True)
    archive = out/'lib/libjs_static.a'
    base_archive = base/'lib/libjs_static.a'
    before = archive_members(base_archive)
    shutil.copyfile(base_archive, archive)
    owner.run('archive', [TOOLCHAIN/'llvm-ar', 'r', archive, out/'pbl/obj/PblJit.o', out/'pbl/obj/PortableBaselineInterpret.o'], seconds=90)
    after = archive_members(archive)
    if [row['name'] for row in before] != [row['name'] for row in after]:
        raise ValueError('Archive member names or order changed')
    changed = [new['name'] for old,new in zip(before,after) if old != new]
    if set(changed) - {'PblJit.o','PortableBaselineInterpret.o'}:
        raise ValueError('Unexpected static archive member changed: '+str(changed))
    for kind in ['PblJit', 'PortableBaselineInterpret']:
        obj = state['objects'][kind]
        rows = [row for row in after if row['name'] == kind+'.o']
        if len(rows) != 1 or rows[0]['sha256'] != obj['sha256']:
            raise ValueError('Archive does not contain the explicitly compiled '+kind)
    state['archive'] = dict(base=artifact(base_archive), output=artifact(archive), memberCount=len(after),
                            changed=changed, explicitlyReplaced=['PblJit.o','PortableBaselineInterpret.o'])
    save(out/'archive-members.json', dict(before=before,after=after))
    original = shlex.split((base/'link.args').read_text())
    tokens = list(original)
    if tokens.count(str(base_archive)) != 1 or tokens.count('-o') != 1:
        raise ValueError('Expected one selected JIT archive and one link output')
    tokens[tokens.index(str(base_archive))] = str(archive)
    tokens[tokens.index('-o')+1] = str(out/'obj/firefox.preoptimizer.wasm')
    maps = [index for index, token in enumerate(tokens) if token.startswith('-Map=')]
    if len(maps) != 1:
        raise ValueError('Expected one linker map')
    tokens[maps[0]] = '-Map='+str(out/'obj/firefox.map')
    cwd = NIGHTLY/'obj-nightly/browser/app'
    inputs = link_inputs(original,cwd)
    state['linkInputs'] = [artifact(path) for path in sorted(inputs)]
    replacement = replace_xpc_response(tokens, cwd, out, out/f'pbl/obj/{XPC_KIND}.o')
    state['xpcIntegration']['link'] = replacement
    removed = {base_archive, Path(replacement['originalResponse']['path']), Path(replacement['originalObject']['path'])}
    added = {archive, Path(replacement['outputResponse']['path']), Path(replacement['outputObject']['path'])}
    if link_inputs(tokens,cwd) != (inputs-removed)|added:
        raise ValueError('A linker input outside the explicit JIT archive and XPC object substitutions changed')
    (out/'link.args').write_text('\n'.join(shlex.quote(token) for token in tokens)+'\n')
    state['linker'] = artifact(TOOLCHAIN/'wasm-ld')
    state['baseLinkArguments'] = artifact(base/'link.args')
    owner.run('link',[TOOLCHAIN/'wasm-ld','@'+str(out/'link.args')],cwd=cwd)
    raw = out/'obj/firefox.preoptimizer.wasm'
    owner.run('validate-raw',['/usr/bin/wasm-validate','--enable-all',raw],seconds=60)
    state['raw'] = artifact(raw)
    owner.run('inspect-raw',[sys.executable,'-B',HERE/'release-artifacts.py','inspect',raw,out/'raw-abi'],seconds=90)
    transform_input = raw
    state['optimization'] = dict(mode=args.optimizer, optimizedArtifact=None, tool=artifact('/usr/bin/wasm-opt'))
    if args.optimizer == 'O2':
        transform_input = out/'obj/firefox.optimized.wasm'
        owner.run('optimize',['/usr/bin/wasm-opt',raw,'-O2','-o',transform_input])
        state['optimization']['optimizedArtifact'] = artifact(transform_input)
    final = out/'obj/firefox.fpcast.wasm'
    owner.run('fpcast',['/usr/bin/wasm-opt','--all-features','--disable-compact-imports',
                         '--pass-arg=max-func-params@23','--fpcast-emu',transform_input,'-o',final])
    owner.run('validate-final',['/usr/bin/wasm-validate','--enable-all',final],seconds=60)
    owner.run('inspect-final',[sys.executable,'-B',HERE/'release-artifacts.py','inspect',final,out/'final-abi',
                               '--fpcast','--compare',out/'raw-abi/result.json'],seconds=90)
    state['final'] = artifact(final)
    state['abiReport'] = artifact(out/'final-abi/result.json')
    if args.stage == 'wasm':
        return
    owner.run('package',[sys.executable,'-B',HERE/'release-artifacts.py','package',args.base_package,
                         final,out/'package','--optimizer',args.optimizer],seconds=150)
    state['package'] = artifact(out/'package/package.json')
    state['manifest'] = artifact(out/'package/boot-manifest.json')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output',type=Path)
    parser.add_argument('--source-root',type=Path,default=REPO)
    parser.add_argument('--upstream-source',type=Path,default=RECOVERY)
    parser.add_argument('--prepared-pbi',type=Path,default=NIGHTLY/'source/firefox-159.0a1/js/src/vm/PortableBaselineInterpret.cpp')
    parser.add_argument('--prepared-xpc',type=Path,default=NIGHTLY/'source/firefox-159.0a1/js/xpconnect/src/XPCJSContext.cpp')
    parser.add_argument('--base-native',type=Path,default=BASE_NATIVE)
    parser.add_argument('--base-package',type=Path,default=BASE_PACKAGE)
    parser.add_argument('--optimizer',choices=['compat','O2'],default='compat',help='compat: original fpcast compatibility pass only; O2 explicitly adds the original optimizer first')
    parser.add_argument('--stage',choices=['sources','objects','wasm','package'],default='package')
    parser.add_argument('--cpus',type=int,default=2)
    args = parser.parse_args()
    if not 1 <= args.cpus <= 8:
        parser.error('--cpus must be in 1..8')
    out = args.output.resolve(strict=True)
    if set(path.name for path in out.iterdir()) != {'t'} or not (out/'t/cache').is_dir():
        parser.error('Use the shell wrapper with a fresh output directory')
    for name in ['TMPDIR','TMP','TEMP']:
        if Path(os.environ.get(name,'/')).resolve() != out/'t':
            parser.error('Task-owned disk scratch is required')
    def interrupted(signum, frame):
        raise InterruptedError('Build owner received signal '+str(signum))
    for value in (signal.SIGTERM,signal.SIGINT,signal.SIGALRM):
        signal.signal(value,interrupted)
    signal.alarm(560)
    owner, error = None, None
    state = dict(schema='linuxonweb-jit-build-2',stage=args.stage,runtimeAcceptance=False,
                 releaseAcceptance=False,compilerOptimization='original PblJit/PBI -O3 and XPC -O2, all -DNDEBUG=1, no debug information')
    try:
        owner = Owner(out,args.cpus)
        run_build(args,owner,state)
        owner.guard()
        state['passBuild'] = True
    except BaseException as caught:
        error = repr(caught)
        state.update(passBuild=False,error=error)
    finally:
        signal.alarm(0)
        if owner:
            state['elapsedSeconds'] = time.monotonic()-owner.started
            state['commands'] = owner.commands
            state['protectedReview'] = [dict(before=value,after=process_identity(int(pid)),
                                            unchanged=process_identity(int(pid))==value)
                                        for pid,value in owner.protected.items()]
            if not all(row['unchanged'] for row in state['protectedReview']):
                state['passBuild'] = False
                state['lifecycleWarning'] = 'A previously running protected service changed; investigate separately'
            save(out/'resources.json',owner.resources)
        save(out/'build-state.json',state)
        # Report exactly the artifacts that exist; skipped O2 never creates an
        # optimized artifact entry or a performance acceptance claim.
        from importlib.util import spec_from_file_location,module_from_spec
        spec=spec_from_file_location('release_report',HERE/'release-report.py')
        module=module_from_spec(spec);spec.loader.exec_module(module)
        module.write_report(out,state)
    print(json.dumps(dict(passBuild=state.get('passBuild',False),stage=args.stage,
                          elapsedSeconds=state.get('elapsedSeconds'),error=error,
                          report=str(out/'report.json'),runtimeAcceptance=False)))
    return 0 if state.get('passBuild') else 1


if __name__ == '__main__':
    raise SystemExit(main())
