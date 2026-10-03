"""Admit generated compile-object goals without any program-link targets."""
import hashlib
import re
from pathlib import Path


def objects_only_mode(phase, environ):
    value = environ.get('NIGHTLY_OBJECTS_ONLY')
    if value is None:
        return False
    if phase != 'build' or value not in ('0', '1'):
        raise ValueError('NIGHTLY_OBJECTS_ONLY must be 0 or 1 for the full build phase only')
    return value == '1'


def admit_object_goals(objdir, source):
    objdir, source = Path(objdir), Path(source)
    paths = [objdir / 'root.mk', objdir / 'root-deps.mk',
             source / 'config/rules.mk', source / 'config/recurse.mk']
    data = {p: p.read_bytes() for p in paths}
    root = data[paths[0]].decode()

    def declaration(name):
        rows = re.findall(r'^' + re.escape(name) + r' := (.*)$', root, re.M)
        if len(rows) != 1:
            raise ValueError('Missing or ambiguous generated declaration: ' + name)
        return rows[0].split()

    goals = [n for n in declaration('compile_targets')
             if n.endswith(('/target-objects', '/host-objects'))]
    preparations = declaration('pre_compile_targets')
    if not goals or len(set(goals)) != len(goals):
        raise ValueError('Generated object goals must be nonempty and unique')
    allowed = set(goals + preparations)
    for n in allowed:
        if not re.fullmatch(r'[A-Za-z0-9_.+/-]+', n) or n.startswith('/') or '..' in Path(n).parts:
            raise ValueError('Noncanonical generated goal: ' + n)
    if any(not n.endswith('/pre-compile') for n in preparations):
        raise ValueError('Unexpected preparation goal')
    required_rule = ('target-objects: $(OBJS) $(PROGOBJS) '
                     '$(filter-out $(MOZBUILD_NON_DEFAULT_TARGETS),$(RUST_LIBRARY_FILE))')
    if required_rule not in data[paths[2]].decode().splitlines():
        raise ValueError('Upstream target-objects rule changed; review required')
    dependencies = {}
    for line in data[paths[1]].decode().splitlines():
        if line.startswith('\t') or ':' not in line:
            continue
        lhs, rhs = line.split(':', 1)
        for n in lhs.split():
            dependencies.setdefault(n, []).extend(rhs.split())
    closure, pending = set(), list(goals)
    while pending:
        n = pending.pop()
        if n in closure:
            continue
        if n not in allowed:
            raise ValueError('Object closure reaches a non-object/non-preparation goal: ' + n)
        closure.add(n)
        pending.extend(dependencies.get(n, []))
    return {'goals': goals, 'closure': sorted(closure),
            'goal_count': len(goals), 'closure_count': len(closure),
            'goals_sha256': hashlib.sha256(('\n'.join(goals) + '\n').encode()).hexdigest(),
            'graph_pins': [{'path': str(p), 'bytes': len(data[p]),
                            'sha256': hashlib.sha256(data[p]).hexdigest()} for p in paths]}
