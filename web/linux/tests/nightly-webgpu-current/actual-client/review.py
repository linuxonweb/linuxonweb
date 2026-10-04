#!/usr/bin/env python3
"""Review retained real native Rust-client runs; never launch Firefox or a browser."""
import argparse
import hashlib
import json
import re
from pathlib import Path


def pin(path):
    path = Path(path)
    with path.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    return {'path': str(path.resolve()), 'bytes': path.stat().st_size, 'sha256': digest}


def read(path):
    return json.loads(Path(path).read_text())


def checked(row):
    actual = pin(row['path'])
    assert (actual['bytes'], actual['sha256']) == (row['bytes'], row['sha256']), row['path']
    return actual


def live_group(group):
    members = []
    for path in Path('/proc').glob('[0-9]*/stat'):
        try:
            fields = path.read_text().rsplit(')', 1)[1].split()
            if int(fields[2]) == group and fields[0] != 'Z':
                members.append(int(path.parent.name))
        except FileNotFoundError:
            pass
    return members


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('task', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    task = args.task.resolve()
    assert task == Path('/mnt/p6/project/build/nightly-current-rust-gpu-smoke-20261003')
    package_path = task / 'package/package.json'
    package = read(package_path)
    archive = checked({'path': str(task / 'package/initramfs.cpio'),
                       'bytes': package['bytes'], 'sha256': package['archiveSha256']})
    assert package['testOnly'] and package['passPackage'] and package['actualFirefoxClientSerializer']
    assert package['firefoxGpuAcceptance'] is False
    inputs = read(task / 'input-copies.json')['inputs']
    assert len(inputs) == 8
    for row in inputs:
        checked(row)
        source = Path(row['source'])
        checked(dict(row, path=str(source)))
        assert source.stat().st_ino != Path(row['path']).stat().st_ino
    assert inputs[0]['sha256'] == '2ec67aadb6a229fa55a174d7188b34e955dc2f9ce57bb58e4eb81865326475bc'
    for row in package['inputs'] + package['currentPins']['files']:
        checked(row)
    for name, row in package['artifacts'].items():
        checked(dict(row, path=str(task / 'package' / name)))
    for row in read(task / 'compile-dependencies2.json'):
        checked(row)
    for row in read(task / 'guest-prelaunch.json')['sources']:
        checked(row)
    abi = read(task / 'abi-inspection2/result.json')
    checked(abi['module'])
    assert abi['pass'] and abi['everyElementUses23I64ToI64'] and abi['elementEntryCount'] == 155
    assert abi['module']['sha256'] == 'b5d45d6ae90e90591ca4aa025ece86a38c8b7d10b68c65d5c8d2612dfdf2d29f'
    phases = []
    for name in ['compile3', 'link3', 'raw-validate2', 'fpcast2', 'final-validate2', 'abi3']:
        status = read(task / (name + '.json'))
        assert status['exit'] == 0 and not status['error'] and not status['remainingGroup']
        assert status['coreBytes'] == 0 and status['addressSpaceBytes'] == 16 * 2**30
        assert not live_group(status['pgid'])
        phases.append(pin(task / (name + '.json')))
    compile_command = read(task / 'compile3.json')['argv']
    assert '-fc++-abi=webassembly' in compile_command and '-fwasm-exceptions' in compile_command
    link_status = read(task / 'link3.json')
    assert '-Wl,--fatal-warnings' in link_status['argv']
    link_log = (task / 'link3.log').read_text()
    assert not re.search(r'function signature mismatch|wasm-ld: (warning|error)', link_log)
    arms = []
    for arm, backend in [('hardware2', 'auto'), ('software1', 'auto'), ('webgl1', 'webgl')]:
        out = task / ('guest-run-' + arm)
        result = read(out / 'result.json')
        guest = read(out / 'guest.json')
        inner = result['result']
        status_path = task / (out.name + '-supervisor-status.json')
        status = read(status_path)
        assert result['pass'] and inner['pass'] and inner['actualFirefoxClientSerializer']
        assert not result['firefoxGpuAcceptance'] and not result['releaseAcceptance']
        assert result['packageSha256'] == pin(package_path)['sha256']
        assert result['archiveSha256'] == archive['sha256']
        assert inner['guest'] == guest and guest['done'] and guest['pass']
        assert guest['exitStatus'] == 0 and not guest['errors'] and guest['isolated']
        log = (out / 'guest-log.txt').read_bytes().decode()
        assert log == guest['logs']
        marker = ('CURRENT_GPU_CLIENT_COMPLETE backend=' + backend +
                  ' words=16 failures=0 adapter_callbacks=1 device_callbacks=1 map_callbacks=1'
                  ' work_callbacks=1 actual_messages=12 queued=12 adapter=')
        assert log.count(marker) == 1 and 'CURRENT_GPU_INIT_EXIT status=0' in log
        cpu = read(out / 'native-cpu.json')
        assert cpu == inner['cpu'] and all(cpu['checks'].values())
        counts = [cpu[k] for k in ['hostNproc', 'browserHardwareConcurrency', 'hostCores',
                  'expectedHostCores', 'requestedGuestCpus', 'hostNprocObserved',
                  'browserHardwareConcurrencyAtBoot', 'selectedGuestCpus', 'guestBootCpus']]
        assert len(set(counts)) == 1 and counts[0] > 0
        assert f'smp: Brought up 1 node, {counts[0]} CPUs' in guest['bootLogs']
        affinity = result['affinity']
        assert all(affinity['checks'].values()) and affinity['hostNproc'] == counts[0]
        assert len(affinity['assignedCpus']) == counts[0]
        assert affinity['browserCpuList'] == ','.join(str(c) for c in affinity['assignedCpus']) or (
            affinity['browserCpuList'] == f"0-{counts[0] - 1}" and affinity['assignedCpus'] == list(range(counts[0])))
        assert guest['configuration']['cpus'] == counts[0]
        assert guest['configuration']['memoryBytes'] == 2**30
        events = [json.loads(e['message']) for e in guest['gpuEvents'] if e['kind'] == 'owner-log']
        assert events == inner['owner']
        completed = [e for e in events if e['kind'] == 'completed']
        cleanup = [e for e in events if e['kind'] == 'cleanup']
        assert [e['messageCount'] for e in completed] == [1, 1, 8, 1, 1]
        assert [e['mappedBytes'] for e in completed] == [[], [], [], [64], []]
        assert len(cleanup) == 1 and cleanup[0]['count'] == cleanup[0]['liveSessions'] == 0
        stats = cleanup[0]['stats']
        assert stats['opened'] == stats['closed'] == stats['maps'] == stats['completedQueue'] == 1
        assert stats['dispatches'] == 5 and stats['resourcesAfter'] == [0]
        assert stats['rejected'] == stats['abandoned'] == 0
        adapter = completed[0]['adapter']
        if arm == 'hardware2':
            assert inner['apiIdentity']['vendor'] == 'nvidia'
            assert adapter['deviceType'] != 'Cpu'
        elif arm == 'software1':
            assert inner['apiIdentity']['architecture'] == 'swiftshader' and adapter['deviceType'] == 'Cpu'
        else:
            assert adapter['vendor'] == 4318 and 'NVIDIA' in adapter['name']
            assert 'WebGL 2.0' in adapter['driverInfo']
        assert all(e['backend'] == ('Gl' if backend == 'webgl' else 'BrowserWebGpu') for e in completed)
        assert result['inputsUnchanged'] and result['groupEmpty'] and result['serverClosed']
        assert result['browserExit'] == {'code': 0, 'signal': None}
        assert not result['guardError'] and not result['remainingGroup']
        assert status['childExit'] == 0 and status['ownerReaped'] and not status['stopReason']
        assert status['nodeGroupEmpty'] and status['chromeGroupEmpty'] and not status['members']
        for key in ['nodeOwner', 'chromeOwner']:
            assert not live_group(status[key]['pgid'])
        assert status['limits']['coreBytes'] == 0 and status['limits']['taskCapBytes'] == 2**30
        assert status['limits']['addressSpaceBytes'] == 2**41
        assert result['endpointOwnership']['verified']
        arms.append({'arm': arm, 'backend': completed[0]['backend'], 'adapter': adapter,
                     'apiIdentity': inner['apiIdentity'], 'cpus': counts[0], 'cleanup': cleanup[0],
                     'seconds': status['elapsedSeconds'], 'peakRSSBytes': status['peakGroupRSSBytes'],
                     'evidence': [pin(out / n) for n in ['result.json', 'guest.json', 'guest-log.txt', 'native-cpu.json']]
                                 + [pin(status_path)]})
    report = {'schema': 1, 'pass': True, 'scope': 'actual current Nightly Rust client standalone Linux/Wasm copy/map and FFI callbacks',
              'firefoxGpuAcceptance': False, 'jitAcceptance': False, 'releaseAcceptance': False,
              'performanceAcceptance': False, 'task': str(task), 'reviewer': pin(__file__),
              'module': abi['module'], 'package': pin(package_path), 'archive': archive,
              'inputs': inputs, 'nativePhases': phases, 'arms': arms,
              'limits': 'No Firefox DOM/IPC shared mapping, rendering, device-loss/cancel races, compute execution or FPS claim.'}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'pass': True, 'arms': len(arms), 'output': pin(args.output)}))


if __name__ == '__main__':
    main()
