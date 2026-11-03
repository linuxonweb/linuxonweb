#!/usr/bin/env python3
"""Static ABI inspection and verified native-only Firefox package replacement."""
import argparse
import importlib.util
import json
from pathlib import Path
import re
import subprocess

REPO = Path(__file__).resolve().parents[3]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def save(path, value):
    Path(path).write_text(json.dumps(value, indent=2)+'\n')


def import_abi(report, folder):
    signatures = dict(re.findall(r' - type\[(\d+)\] (.*)', (folder/'type.log').read_text()))
    result = []
    for item in report['imports']:
        record = dict(kind=item['kind'], binding=item['binding'])
        if item['kind'] == 'func':
            match = re.search(r'\bsig=(\d+)\b',item['descriptor'])
            if not match or match[1] not in signatures:
                raise ValueError('Import signature is missing')
            record['signature'] = signatures[match[1]]
        else:
            record['descriptor'] = item['descriptor']
        result.append(record)
    return result


def inspect(args):
    module = load('wasm_inspector',REPO/'tools/nightly-jit-prep/inspect-wasm.py')
    args.output.mkdir()
    if args.fpcast:
        # The full actual-function/element census is required on the transformed
        # binary. Raw C++ display names contain nested '>' and are not an ABI.
        report = module.inspect(args.module,args.output,Path('/usr/bin/wasm-objdump'))
    else:
        commands = []
        dumps = {}
        for section, options in [('headers',['-h']),('type',['-x','-j','Type']),('import',['-x','-j','Import'])]:
            argv = ['/usr/bin/wasm-objdump',*options,str(args.module)]
            result = subprocess.run(argv,capture_output=True,text=True,timeout=30,check=True)
            dumps[section] = result.stdout
            (args.output/(section+'.log')).write_text(result.stdout+result.stderr)
            commands.append(dict(argv=argv,exitCode=result.returncode))
        imports = []
        for line in dumps['import'].splitlines():
            if not line.startswith(' - '):
                continue
            match = re.fullmatch(r' - (\w+)\[(\d+)\](.*?) <- (.+)',line)
            if not match:
                raise ValueError('Unparsed raw import: '+line)
            kind,index,descriptor,binding = match.groups()
            imports.append(dict(kind=kind,index=int(index),descriptor=descriptor.strip(),binding=binding))
        report = dict(claim='Raw import ABI and no-DWARF check; structural validation is recorded separately',
                      module=module.pin(args.module),commands=commands,imports=imports,
                      functionCount=None,elementEntryCount=None,guestAcceptance=False,releaseAcceptance=False)
    report['importAbi'] = import_abi(report,args.output)
    report['noDWARF'] = not re.search(r'\.z?debug',(args.output/'headers.log').read_text())
    report['sharedMemoryImport'] = any(item['kind']=='memory' and item['binding']=='env.memory'
                                      and 'shared' in item['descriptor'] for item in report['imports'])
    if not report['noDWARF'] or not report['sharedMemoryImport']:
        raise ValueError('Expected no DWARF and the existing shared env.memory import')
    if args.fpcast and not report['everyElementUses23I64ToI64']:
        raise ValueError('Actual indirect table targets must all use (23 i64) -> i64')
    if args.compare:
        previous = json.loads(args.compare.read_text())
        if report['importAbi'] != previous['importAbi']:
            raise ValueError('Compatibility transform changed the native import ABI')
        report['comparedImportAbi'] = str(args.compare.resolve())
    report['passStaticAbi'] = True
    save(args.output/'result.json',report)
    print(json.dumps(dict(passStaticAbi=True,functions=report['functionCount'],
                          elements=report['elementEntryCount'],fpcastRequired=args.fpcast)))


def package(args):
    helper = load('native_package',REPO/'tools/startup-benchmark/gpt6-codex-package.py')
    verifier = load('archive_verifier',REPO/'tools/guest-rootfs/rewrite-firefox-archive.py')
    base = args.base.resolve(strict=True)
    manifest_path = base/'boot-manifest.json'
    manifest = json.loads(manifest_path.read_text())
    source = base/Path(manifest['assets']['firefox']['url'].split('?',1)[0]).name
    source_sha = helper.digest(source)
    if (source_sha,source.stat().st_size) != (manifest['assets']['firefox']['sha256'],manifest['assets']['firefox']['bytes']):
        raise ValueError('Base manifest does not identify the actual Firefox archive')
    native_sha = helper.digest(args.binary)
    before, before_tail = verifier._scan(source)
    old_native = before['opt/firefox/firefox']['sha256']
    args.output.mkdir()
    destination = args.output/'initramfs-firefox.cpio.gz'
    result = helper.package(source,destination,source_sha,args.binary,old_native,native_sha)
    after, after_tail = verifier._scan(destination)
    if list(before) != list(after) or before_tail != after_tail:
        raise ValueError('Archive record order or trailing bytes changed')
    for name, original in before.items():
        new = after[name]
        if name != 'opt/firefox/firefox':
            if original != new:
                raise ValueError('Unexpected non-native archive change: '+name)
        else:
            expected_fields = original['fields'].copy()
            expected_fields[6] = args.binary.stat().st_size
            if new['fields'] != expected_fields or new['sha256'] != native_sha:
                raise ValueError('Native record changed beyond its body and size')
            if original['prefix'][:54] != new['prefix'][:54] or original['prefix'][62:] != new['prefix'][62:]:
                raise ValueError('Native record metadata/name padding changed')
    result.update(passPackage=True,verifiedRecords=len(before),verifiedUnchangedRecords=len(before)-1,
                  nativeOnly=True,trailerPreserved=True,runtimeAcceptance=False,releaseAcceptance=False,
                  optimizer=args.optimizer,diagnosticOnly=args.optimizer=='compat',
                  fullO2Status='unresolved' if args.optimizer=='compat' else 'complete')
    save(args.output/'package.json',result)
    manifest['version'] = result['sha256'][:12]
    mode = 'compatibility-only, no O2' if args.optimizer=='compat' else 'original O2 plus compatibility pass'
    manifest['assets']['firefox'].update(url='./initramfs-firefox.cpio.gz',bytes=result['bytes'],
                                       sha256=result['sha256'],label=f'Firefox JIT testing; {mode}; runtime acceptance pending')
    save(args.output/'boot-manifest.json',manifest)
    frozen = base/'freeze-receipt.json'
    if frozen.is_file():
        receipt = json.loads(frozen.read_text())
        receipt.update(kind='linuxonweb-jit-source-rebuild',build=manifest['version'],
                       parentReceipt=str(frozen),parentSha256=helper.digest(frozen),
                       runtimeAcceptance=False,diagnosticLabel=mode,diagnosticOnly=args.optimizer=='compat',
                       fullO2Status='unresolved' if args.optimizer=='compat' else 'complete')
        changed = {}
        for route,path in [('/linux/initramfs-firefox.cpio.gz',destination),
                           ('/linux/boot-manifest.json',args.output/'boot-manifest.json')]:
            old = receipt['routes'][route]
            entry = dict(source=str(path),snapshot=str(path),bytes=path.stat().st_size,sha256=helper.digest(path))
            changed[old['snapshot']] = entry
            receipt['routes'][route] = entry
        receipt['files'] = [changed.get(item['snapshot'],item) for item in receipt['files']]
        save(args.output/'freeze-receipt.json',receipt)
    print(json.dumps(result))


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    commands=parser.add_subparsers(dest='command',required=True)
    check=commands.add_parser('inspect')
    check.add_argument('module',type=Path)
    check.add_argument('output',type=Path)
    check.add_argument('--fpcast',action='store_true')
    check.add_argument('--compare',type=Path)
    pack=commands.add_parser('package')
    pack.add_argument('base',type=Path)
    pack.add_argument('binary',type=Path)
    pack.add_argument('output',type=Path)
    pack.add_argument('--optimizer',choices=['compat','O2'],required=True)
    args=parser.parse_args()
    (inspect if args.command=='inspect' else package)(args)


if __name__=='__main__':
    main()
