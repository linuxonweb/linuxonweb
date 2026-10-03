#!/usr/bin/env python3
"""Exercise generated-goal admission and real inherited full-build guards."""
import argparse
import ast
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import resource
import signal
import subprocess
import sys
import time

parser = argparse.ArgumentParser()
parser.add_argument('--task', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
repo = Path(__file__).resolve().parents[4]
recipe = repo / 'tools/nightly-musl/recipe'
out = args.output.resolve()
out.mkdir(parents=True, exist_ok=True)
assert not (out / 'result.json').exists()
spec = importlib.util.spec_from_file_location('object_goals', recipe / 'object_goals.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
checks = []


def check(name, condition):
    checks.append({'name': name, 'pass': bool(condition)})
    assert condition, name


for phase, value, expected in [('build', None, False), ('build', '0', False),
                               ('build', '1', True), ('build', 'yes', None),
                               ('build', '', None), ('configure', '1', None),
                               ('configure', '0', None), ('pixman', '1', None)]:
    try:
        actual = module.objects_only_mode(phase, {} if value is None else {'NIGHTLY_OBJECTS_ONLY': value})
    except ValueError:
        actual = None
    check('mode admission ' + repr((phase, value)), actual == expected)

admission = module.admit_object_goals(args.task / 'obj-nightly', args.task / 'source/firefox-159.0a1')
check('actual graph has complete object goal set', admission['goal_count'] > 500)
check('actual closure excludes every link target', all(not n.endswith('/target') for n in admission['closure']))
argv = ['bash', '-c', 'set -eu; source "$1"; cd "$2"; exec "$3" "${@:4}"',
        'object-only-probe', str(args.task / 'recipe/environment.sh'), str(args.task / 'obj-nightly'),
        '/nix/store/5hndr36f8c9d9z305r27z6dxkhysng95-gnumake-4.4.1/bin/make',
        '-n', '-j4', 'RECURSE_TRACE_ONLY=1', *admission['goals']]
result = subprocess.run(argv, capture_output=True, text=True, timeout=90)
(out / 'actual-make-trace.log').write_text(result.stdout + result.stderr)
check('actual generated GNUmake traversal exits zero', result.returncode == 0)
actual_closure = {line.removeprefix('echo ') for line in result.stdout.splitlines() if line.startswith('echo ')}
check('actual generated GNUmake traversal equals admitted closure', actual_closure == set(admission['closure']))

fixture = out / 'fixture'
obj, source = fixture / 'obj', fixture / 'source'
obj.mkdir(parents=True)
(source / 'config').mkdir(parents=True)
rule = 'target-objects: $(OBJS) $(PROGOBJS) $(filter-out $(MOZBUILD_NON_DEFAULT_TARGETS),$(RUST_LIBRARY_FILE))\n'


def fixture_case(name, root, deps='', rules=rule, passes=False):
    (obj / 'root.mk').write_text(root)
    (obj / 'root-deps.mk').write_text(deps)
    (source / 'config/rules.mk').write_text(rules)
    (source / 'config/recurse.mk').write_text('# fixture\n')
    try:
        module.admit_object_goals(obj, source)
        actual = True
    except ValueError:
        actual = False
    check(name, actual == passes)


valid = 'compile_targets := foo/target-objects browser/app/target\npre_compile_targets := foo/pre-compile\n'
fixture_case('valid object closure allows preparation', valid, 'foo/target-objects: foo/pre-compile\n', passes=True)
fixture_case('browser link introduced by dependency rejected', valid, 'foo/target-objects: browser/app/target\n')
fixture_case('helper link introduced by dependency rejected', valid, 'foo/target-objects: toolkit/xre/gfxtest/target\n')
fixture_case('arbitrary dependency rejected', valid, 'foo/target-objects: arbitrary-command\n')
fixture_case('unexpanded dependency rejected', valid, 'foo/target-objects: $(OTHER_TARGETS)\n')
fixture_case('path escape rejected', valid.replace('foo/target-objects', '../foo/target-objects'))
fixture_case('duplicate goals rejected', valid.replace('foo/target-objects', 'foo/target-objects foo/target-objects'))
fixture_case('empty object goals rejected', 'compile_targets := browser/app/target\npre_compile_targets :=\n')
fixture_case('changed upstream target rule rejected', valid, rules=rule.replace('$(PROGOBJS)', '$(PROGRAM)'))

runner = recipe / 'run-phase.py'
tree = ast.parse(runner.read_text())
functions = [n for n in tree.body if isinstance(n, ast.FunctionDef)]
namespace = {'Path': Path, 'os': os, 'resource': resource, 'signal': signal,
             'time': time, 'subprocess': subprocess,
             'memory_limit': 48 * 1024**3, 'address_space_limit': 64 * 1024**3}
exec(compile(ast.Module(body=functions, type_ignores=[]), str(runner), 'exec'), namespace)
old_functions = [n for n in ast.parse((args.task / 'recipe/run-phase.py').read_text()).body if isinstance(n, ast.FunctionDef)]
check('existing memory/disk/process cleanup guard functions unchanged',
      ast.dump(ast.Module(body=functions, type_ignores=[])) == ast.dump(ast.Module(body=old_functions, type_ignores=[])))
child = '''import json,mmap,resource
from pathlib import Path
limit=64*1024**3
assert resource.getrlimit(resource.RLIMIT_AS)==(limit,limit)
assert resource.getrlimit(resource.RLIMIT_CORE)==(0,0)
assert Path('/proc/self/oom_score_adj').read_text().strip()=='1000'
try: mmap.mmap(-1,limit+1024**3,prot=0)
except (OSError,MemoryError): pass
else: raise AssertionError('Oversize mapping accepted')
print(json.dumps({'AS_GiB':64,'core':0,'oom_score_adj':1000,'oversized_mapping_rejected':True}))
'''
result = subprocess.run([sys.executable, '-B', '-c', child], preexec_fn=namespace['prepare_child'],
                        capture_output=True, text=True, timeout=10)
check('real object-mode child inherits full-build AS/core/OOM guards', result.returncode == 0)
(out / 'actual-child-guards.log').write_text(result.stdout + result.stderr)
check('object mode retains phase=build for all existing guards',
      "if phase=='build': meta['build_mode']='objects-only' if object_mode else 'full'" in runner.read_text())
result = {'claim': 'Object-only admission, actual generated make traversal and inherited resource guards; no full build/browser acceptance',
          'checked': time.time(), 'checks': checks, 'passed': len(checks), 'failed': 0,
          'admission': admission, 'make_trace_argv': argv,
          'pins': [{'path': str(p), 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()}
                   for p in [runner, recipe / 'object_goals.py', Path(__file__).resolve()]]}
(out / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({'passed': len(checks), 'failed': 0, 'result': str(out / 'result.json')}))
