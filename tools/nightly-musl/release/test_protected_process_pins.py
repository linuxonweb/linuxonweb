#!/usr/bin/env python3
"""Focused explicit-pin parsing/stat checks; never read process command lines."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
from unittest.mock import patch


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    out = args.output.resolve(); out.mkdir(exist_ok=False)
    spec = importlib.util.spec_from_file_location('build_release', Path(__file__).with_name('build-release.py'))
    b = importlib.util.module_from_spec(spec); spec.loader.exec_module(b)
    pid = os.getpid(); identity = b.process_identity(pid); key = str(pid); start = identity['start']
    cases = []
    malformed = ['{}', '[]', 'null', '{', '{"bad":"1"}', '{"0":"1"}', '{"01":"1"}',
                 json.dumps({key: True}), json.dumps({key: int(start)}), json.dumps({key: '-1'}),
                 json.dumps({key: '01'}), '{"'+key+'":"'+start+'","'+key+'":"'+start+'"}']
    negatives = [('malformed-'+str(index), text) for index, text in enumerate(malformed)]
    negatives += [('stale-start', json.dumps({key: str(int(start)+1)})),
                  ('missing-process', json.dumps({'2147483647': '0'}))]
    for name, text in negatives:
        path = out/(name+'.json'); path.write_text(text)
        try:
            b.load_protected_process_pins(str(path))
        except (ValueError, OSError) as error:
            cases.append(dict(name=name, rejected=True, error=type(error).__name__))
        else:
            raise AssertionError(name+' was accepted')
    pins = out/'valid.json'; pins.write_text(json.dumps({key: start})+'\n')
    actual, source = b.load_protected_process_pins(str(pins))
    assert actual == {key: identity} and source == b.artifact(pins)
    owner_out = out/'owner'; (owner_out/'t/cache').mkdir(parents=True)
    original_bytes, original_text, original_iterdir = Path.read_bytes, Path.read_text, Path.iterdir
    def read_bytes(path, *args, **kwargs):
        if path.name == 'cmdline': raise AssertionError('Explicit pins read a command line')
        return original_bytes(path, *args, **kwargs)
    def read_text(path, *args, **kwargs):
        if path.name == 'cmdline': raise AssertionError('Explicit pins read a command line')
        return original_text(path, *args, **kwargs)
    def iterdir(path):
        if path == Path('/proc'): raise AssertionError('Explicit pins scanned all processes')
        return original_iterdir(path)
    affinity = sorted(os.sched_getaffinity(0))
    with patch.dict(os.environ, {'LINUXWEB_PROTECTED_PROCESS_PINS': str(pins)}), \
         patch.object(b, 'cpu_limit', return_value={'affinity': affinity, 'effective': 1}), \
         patch.object(b.os, 'sched_setaffinity'), patch.object(b.Owner, 'guard'), \
         patch.object(Path, 'read_bytes', read_bytes), patch.object(Path, 'read_text', read_text), \
         patch.object(Path, 'iterdir', iterdir):
        owner = b.Owner(owner_out, 1)
    assert owner.protected == {key: identity} and owner.protected_pin_source == source
    recorded = json.loads((owner_out/'owner.json').read_text())
    assert recorded['protected'] == {key: identity} and recorded['protectedPinSource'] == source
    result = dict(passChecks=True, rejectedCases=cases, exactStatIdentityAccepted=True,
                  ownerExplicitBranchAvoidsCmdlineAndProcessScan=True, actualAffinityUnchanged=affinity == sorted(os.sched_getaffinity(0)),
                  ownerResourceAndAffinityActionsMocked=True, protectedPinSourceRecorded=True,
                  test=b.artifact(Path(__file__)), buildRecipe=b.artifact(Path(__file__).with_name('build-release.py')),
                  nativeBuildLaunched=False)
    (out/'result.json').write_text(json.dumps(result, indent=2)+'\n')
    print(json.dumps(dict(result=b.artifact(out/'result.json'), rejectedCases=len(cases), passChecks=True)))


if __name__ == '__main__':
    main()
