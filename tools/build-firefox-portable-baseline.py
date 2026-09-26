#!/usr/bin/env python3
"""Bounded, isolated PBL engine rebuild using the accepted Firefox link recipe.

Default: write a reviewable plan. --execute rebuilds every linked SpiderMonkey
object, verifies dependency coverage, archives, relinks and validates a candidate.
No source, original object, rootfs or deployed file is modified.
"""
import argparse
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import signal
import subprocess
import threading
import time

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--objects', type=Path, required=True)
parser.add_argument('--link-build', type=Path, required=True)
parser.add_argument('--libcxx-include', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--baseline-sha256', default='68b86f1dea7312483c62284fce906287afcb7f8f11b1b07697c73e6dbd49ceae')
parser.add_argument('--jobs', type=int, default=4)
parser.add_argument('--timeout', type=int, default=1800)
parser.add_argument('--plan-timeout', type=int, default=120)
parser.add_argument('--execute', action='store_true')
args = parser.parse_args()
if not 1 <= args.jobs <= 4 or not 1 <= args.timeout <= 1800 or not 1 <= args.plan_timeout <= 120:
    parser.error('bounds: jobs 1..4, timeout 1..1800, plan-timeout 1..120 seconds')
preflight_started = time.monotonic()
def plan_tick(phase=None):
    if time.monotonic() - preflight_started > min(args.plan_timeout,args.timeout):
        raise RuntimeError('preflight time budget exceeded')
    if phase: print('preflight:',phase,flush=True)
plan_tick('accepted baseline and compile database')
obj, baseline, out, libcxx = (p.resolve() for p in
    [args.objects, args.link_build, args.output, args.libcxx_include])
if obj == out or obj in out.parents or baseline == out or baseline in out.parents:
    parser.error('output must be outside preserved objects and accepted link build')
def digest(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()
if digest(baseline / 'firefox-media.wasm') != args.baseline_sha256:
    parser.error('accepted baseline hash mismatch')
if not libcxx.is_dir(): parser.error('libcxx include directory absent')
entries = json.loads((obj / 'clangd/compile_commands.json').read_text())
def entry_path(entry):
    return (Path(entry['directory']) / entry['file']).resolve()
by_source = {entry_path(entry): entry for entry in entries}
interpreter = next(entry for entry in entries if entry['file'].endswith('/vm/Interpreter.cpp'))
source_root = entry_path(interpreter).parents[3]
if source_root == out or source_root in out.parents:
    parser.error('output must be outside preserved source tree')
engine_root = obj / 'js/src'
archive_members = [Path(p).resolve() for p in
                   shlex.split((engine_root / 'build/libjs_static_a.list').read_text())]
engine_objects = sorted({p for p in archive_members if p.is_relative_to(engine_root)})
if not engine_objects or any(p.suffix != '.o' or not p.is_file() for p in archive_members):
    parser.error('missing or unexpected archive members')

# Audit every conditional PBL header rather than a hand-picked layout subset.
conditional_headers = []
plan_tick('scanning conditional headers')
for path in source_root.rglob('*'):
    plan_tick()
    if path.suffix in {'.h', '.hpp', '.inc'} and path.is_file():
        if 'ENABLE_PORTABLE_BASELINE_INTERP' in path.read_text(errors='replace'):
            conditional_headers.append(path.resolve())
if not conditional_headers: parser.error('no PBL headers found')
conditional_headers = sorted(set(conditional_headers))
conditional_set = set(conditional_headers)
conditional_names = {p.name for p in conditional_headers}
conditional_hashes = {digest(p) for p in conditional_headers}
dependency_header_cache = {}
header_aliases = set()
def is_conditional_dependency(token, directory):
    # dist/include symlinks and generated copies can hide the source spelling.
    path = Path(token)
    if path.name not in conditional_names:
        return False
    raw = directory / path
    canonical = raw.resolve()
    if canonical not in dependency_header_cache:
        matches = canonical in conditional_set
        if not matches and canonical.is_file():
            matches = (digest(canonical) in conditional_hashes or
                       'ENABLE_PORTABLE_BASELINE_INTERP' in canonical.read_text(errors='replace'))
        dependency_header_cache[canonical] = matches
    matches = dependency_header_cache[canonical]
    if matches and str(raw) != str(canonical):
        header_aliases.add((str(raw),str(canonical)))
    return matches
dependencies = {}
affected = set()
plan_tick('canonical dependency coverage')
for path in obj.rglob('*.o.pp'):
    plan_tick()
    raw_content = path.read_text(errors='replace')
    content = raw_content.replace('\\\n', ' ')
    target, _, dependency_text = content.partition(':')
    object_path = (path.parent.parent / target.strip()).resolve()
    lexer = shlex.shlex(dependency_text, posix=True)
    lexer.whitespace_split = True
    dependencies[object_path] = (path, next(lexer))
    # Only lines containing a relevant header basename can resolve to it.
    # Keep shlex for those lines so escaped spaces remain handled correctly.
    candidate_lines = [line.rstrip().removesuffix('\\') for line in raw_content.splitlines()
                       if any(name in line for name in conditional_names)]
    if any(is_conditional_dependency(token,path.parent.parent)
           for line in candidate_lines for token in shlex.split(line)):
        affected.add(object_path)
    if len(dependencies) % 500 == 0:
        plan_tick(str(len(dependencies)) + ' dependency records scanned')
outside = sorted(str(p) for p in affected if p not in engine_objects)
if outside:
    parser.error('PBL consumers outside rebuilt engine; add verified recipes first: ' + repr(outside))
if any(p not in dependencies for p in engine_objects):
    parser.error('engine dependency coverage incomplete')
link_cwd = obj / 'browser/app'
response = baseline / 'firefox-media.list'
for token in shlex.split(response.read_text()):
    if (token.endswith('.o') and (link_cwd / token).resolve().is_relative_to(engine_root)) or 'libjs_static' in token:
        parser.error('accepted response contains a duplicate original engine input')
out.mkdir(parents=True, exist_ok=True)
logs = out / 'logs'; logs.mkdir(exist_ok=True)
config = out / 'js-confdefs.h'
original_config = (engine_root / 'js-confdefs.h').read_text()
if '#define JS_CODEGEN_NONE 1' not in original_config:
    parser.error('expected interpreter-only baseline configuration')
config.write_text(original_config + '\n#define ENABLE_PORTABLE_BASELINE_INTERP 1\n'
                  '#define ENABLE_PORTABLE_BASELINE_INTERP_FORCE 1\n')

def make_command(entry, source, output):
    command = shlex.split(entry['command'])
    pos = command.index('-o') + 1
    if command[pos] != '/dev/null' or '-c' not in command:
        raise RuntimeError('unexpected compile database recipe')
    if any(flag in command for flag in ['-MD', '-MMD', '-MF', '-MJ']):
        raise RuntimeError('dependency output could modify preserved object tree')
    # Some compile-db entries put per-file flags after the input. Replacing
    # command[-1] would silently discard that flag and add a second input.
    input_indices = [i for i, token in enumerate(command[1:], 1)
                     if not token.startswith('-') and
                     Path(token).suffix in {'.c', '.cc', '.cpp', '.cxx', '.C', '.m', '.mm', '.s', '.S'}]
    expected_source = entry_path(entry)
    if (len(input_indices) != 1 or
        (Path(entry['directory']) / command[input_indices[0]]).resolve() != expected_source):
        raise RuntimeError('expected exactly one canonical translation input: ' + str(expected_source))
    command[pos] = str(output)
    command[input_indices[0]] = str(source)
    original_include = str(engine_root / 'js-confdefs.h')
    if original_include not in command:
        raise RuntimeError('compile recipe lacks expected engine config: ' + str(source))
    command[command.index(original_include)] = str(config)
    insert = command.index('-I' + str(obj / 'dist/system_wrappers')) + 1
    command[insert:insert] = ['-isystem', str(libcxx)]
    return command

tasks = []
replacement = {}
plan_tick('mapping every engine compile recipe')
for old_object in engine_objects:
    plan_tick()
    directory = old_object.parent
    first = dependencies[old_object][1]
    source = (directory / first).resolve()
    entry = by_source.get(source)
    if entry is None and source.is_file():
        # Unified units have one compile-db row per included original source.
        included = re.findall(r'^#include "([^"]+\.(?:cpp|cc|cxx|c))"', source.read_text(), re.M)
        entry = next((by_source.get((source.parent / p).resolve()) for p in included
                      if (source.parent / p).resolve() in by_source), None)
    if entry is None:
        raise RuntimeError('no compile recipe for ' + str(source))
    new_object = out / 'objects' / old_object.relative_to(obj)
    replacement[old_object] = new_object
    tasks.append({'name': str(old_object.relative_to(obj)).replace('/', '_'),
                  'source': str(source), 'output': str(new_object),
                  'cwd': str(directory), 'command': make_command(entry, source, new_object)})
pbl_source = entry_path(interpreter).with_name('PortableBaselineInterpret.cpp')
pbl_object = out / 'objects/js/src/PortableBaselineInterpret.o'
tasks.append({'name': 'PortableBaselineInterpret.o', 'source': str(pbl_source),
              'output': str(pbl_object), 'cwd': interpreter['directory'],
              'command': make_command(interpreter, pbl_source, pbl_object)})
plan = {'baselineSHA256': args.baseline_sha256, 'objects': str(obj),
        'sourceRoot': str(source_root), 'jobs': args.jobs, 'timeoutSeconds': args.timeout,
        'engineObjects': len(engine_objects), 'affectedObjects': len(affected),
        'conditionalHeaders': [str(p) for p in conditional_headers],
        'canonicalHeaderAliases': sorted(header_aliases),
        'dependencyRecords': len(dependencies),
        'preflightSeconds': round(time.monotonic()-preflight_started,2),
        'configuration': 'JS_CODEGEN_NONE + ENABLE_PORTABLE_BASELINE_INTERP + FORCE',
        'note': 'FORCE enables portable tier by default, still no native JIT', 'tasks': tasks}
(out / 'plan.json').write_text(json.dumps(plan, indent=2) + '\n')
print(json.dumps({k:v for k,v in plan.items() if k not in ['tasks','conditionalHeaders']}), flush=True)
if not args.execute:
    print('Plan only. Re-run with --execute for bounded candidate build.'); raise SystemExit(0)
if (out / 'report.json').exists():
    parser.error('use a fresh output directory for each execution attempt')
if shutil.disk_usage(out).free < 4 * 1024**3:
    parser.error('candidate requires at least 4 GiB free space')

started = preflight_started; deadline = started + args.timeout
abort = threading.Event(); active = set(); lock = threading.Lock()
def terminate_all():
    abort.set()
    with lock:
        for process in active:
            try: os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError: pass
def run(command, name, cwd, limit=300):
    if abort.is_set(): raise RuntimeError('aborted after prior failure')
    (logs / (name + '.command.txt')).write_text(shlex.join(command) + '\n')
    env = os.environ.copy(); env['TMPDIR'] = str(out)
    with (logs / (name + '.log')).open('w') as log:
        process = subprocess.Popen(command, cwd=cwd, env=env, stdout=log,
                                   stderr=subprocess.STDOUT, start_new_session=True)
        with lock: active.add(process)
        end = min(deadline, time.monotonic() + limit)
        try:
            while process.poll() is None:
                if abort.is_set() or time.monotonic() > end:
                    terminate_all(); process.wait(); raise RuntimeError(name + ' timed out/aborted')
                time.sleep(.2)
            if process.returncode:
                terminate_all(); raise RuntimeError(name + ' failed; see ' + str(logs / (name + '.log')))
        finally:
            with lock: active.discard(process)
def compile_task(task):
    Path(task['output']).parent.mkdir(parents=True, exist_ok=True)
    run(task['command'], task['name'], task['cwd'])
    return task['name']
report = {'pass': False, 'scope': 'candidate build only; guest tests required', 'compiled': []}
try:
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.jobs) as pool:
        for future in concurrent.futures.as_completed([pool.submit(compile_task,t) for t in tasks]):
            report['compiled'].append(future.result())
            print('compiled',len(report['compiled']),'/',len(tasks),flush=True)
    archive_list = out / 'libjs.list'
    archive_list.write_text('\n'.join(shlex.quote(str(replacement.get(p,p))) for p in archive_members)
                            + '\n' + shlex.quote(str(pbl_object)) + '\n')
    archive = out / 'libjs_static.a'
    run(['llvm-ar','crs',str(archive),'@'+str(archive_list)],'archive',out)
    command = shlex.split((baseline / 'link-static-media-command.txt').read_text())
    old_archive = '../../js/src/build/libjs_static.a'
    if command.count(old_archive) != 1: raise RuntimeError('unexpected accepted JS archive link')
    command[command.index(old_archive)] = str(archive)
    raw = out / 'firefox-pbl-raw.wasm'
    command[command.index('-o')+1] = str(raw)
    run(command,'link',obj / 'browser/app',limit=300)
    final = out / 'firefox-pbl.wasm'
    run(['wasm-opt','--all-features','--disable-compact-imports','--pass-arg=max-func-params@23',
         '--fpcast-emu',str(raw),'-o',str(final)],'fpcast',out,limit=600)
    run(['wasm-validate','--enable-all',str(final)],'validate',out)
    report.update({'pass':True,'candidate':str(final),'sha256':digest(final),'bytes':final.stat().st_size})
except Exception as error:
    terminate_all(); report['error'] = str(error)
finally:
    report['elapsedSeconds'] = round(time.monotonic()-started,2)
    (out / 'report.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report),flush=True)
raise SystemExit(0 if report['pass'] else 1)
