#!/usr/bin/env python3
"""Prepare a source-only bootstrap class delta; never patch a peer compiler."""
import argparse
import difflib
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess

HERE = Path(__file__).resolve().parent


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def replace(text, old, new):
    assert text.count(old) == 1, (old[:100], text.count(old))
    return text.replace(old, new)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--task', required=True, type=Path)
    ap.add_argument('--basis', required=True, type=Path)
    ap.add_argument('--bootstrap-proof', required=True, type=Path)
    ap.add_argument('--loader-proof', required=True, type=Path)
    args = ap.parse_args()
    task = args.task.resolve()
    assert task.parent == Path('/mnt/p6/build') and not task.exists()
    assert sha(args.bootstrap_proof) == 'f149f926e598648e4e7493b34b4e90d5861e984f5ad7b2bc95d385152fb06101'
    assert sha(args.loader_proof) == 'e2aff2aab01627be499e645c575e2317cdb096195a43629be98cecd4b808dd03'
    task.mkdir()
    assert subprocess.check_output(['findmnt', '-T', str(task), '-no', 'FSTYPE'], text=True).strip() == 'ext4'
    assert shutil.disk_usage(task).free >= 8 * 1024**3
    for name in ('basis', 'source', 'snapshots', 'tmp', 'cache'):
        (task / name).mkdir()
    os.environ.update(TMPDIR=str(task/'tmp'), TMP=str(task/'tmp'), TEMP=str(task/'tmp'),
                      XDG_CACHE_HOME=str(task/'cache'), PYTHONDONTWRITEBYTECODE='1')
    pins = []

    def pin(path):
        path = path.resolve()
        dest = task / 'snapshots' / (sha(path) + '-' + path.name)
        if dest.exists():
            assert dest.read_bytes() == path.read_bytes()
        else:
            shutil.copyfile(path, dest)
        pins.append({'path': str(path), 'snapshot': str(dest), 'sha256': sha(path), 'bytes': path.stat().st_size})

    for path in (Path(__file__), HERE/'startup-admission.cpp', HERE/'startup-class-contract.md',
                 HERE/'startup-module.mjs', HERE/'test-startup-module.mjs',
                 args.bootstrap_proof, args.loader_proof):
        pin(path)
    for report_path in (args.bootstrap_proof, args.loader_proof):
        report = json.loads(report_path.read_text())
        assert report['pass'] and not report['runtimeAcceptance']
    rel = 'llvm/lib/Target/WebAssembly/WebAssemblyGNUFrames.cpp'
    basis = args.basis / 'source' / rel
    old = basis.read_text()
    pin(basis)
    # Preserve primitive2 functions exactly. The new seal is deliberately separate.
    primitive_query = old.split('bool llvm::isWebAssemblyGNUPrimitiveAuthenticated', 1)[1].split('\n}', 1)[0]
    primitive_prepare = old.split('static void prepareGNUPrimitive', 1)[1].split('// Run before physical-SP', 1)[0]
    primitive_audit = old.split('static bool auditGNUPrimitive', 1)[1].split('\nnamespace {', 1)[0]
    new = replace(old, 'static void prepareGNUProviders(Module &M) {',
                  'static void prepareGNUStartupManifest(Module &M, json::Object &Object);\n'
                  'static void prepareGNUProviders(Module &M) {')
    new = replace(new, 'if (F.hasFnAttribute("wasm-gnu-provider-sealed"))',
                  'if (F.hasFnAttribute("wasm-gnu-provider-sealed") || F.hasFnAttribute("wasm-gnu-startup-sealed"))')
    new = replace(new, 'Object->getInteger("version") != 1 ||',
                  '(Object->getInteger("version") != 1 && Object->getInteger("version") != 2) ||')
    new = replace(new, '(F.isDeclaration() ? *Flag != 0 : (*Flag != 2 && *Flag != 4)))',
                  '(F.isDeclaration() ? *Flag != 0 : (*Flag != 2 && *Flag != 4 &&\n'
                  '         !(*Flag == 8 && Object->getInteger("version") == 2))))')
    new = replace(new, '  GNUProviderAuthenticatedModule = &M;\n}',
                  '  prepareGNUStartupManifest(M, *Object);\n  GNUProviderAuthenticatedModule = &M;\n}')
    new = replace(new, '\nnamespace {\nclass WebAssemblyGNUFrames',
                  '\n' + (HERE/'startup-admission.cpp').read_text() + '\nnamespace {\nclass WebAssemblyGNUFrames')
    new = replace(new, '  for (Function *F : Functions) {', '''  for (Function *F : Functions) {
    if (gnuStartup(*F)) {
      prepareGNUStartup(*F);
      // Startup is outside the ordinary runtime frame descriptor table. Bind
      // actual body identities in source metadata; final machine/loader seal
      // must bind final module bytes before any Instance executes.
      auto *Facts = M.getOrInsertNamedMetadata("wasm.gnu.startup.seal.v1");
      Metadata *Fields[] = {ValueAsMetadata::get(F),
        ConstantAsMetadata::get(ConstantInt::get(I32, 8)),
        ConstantAsMetadata::get(ConstantInt::get(I32, GNUStartupPhases.lookup(F)))};
      Facts->addOperand(MDNode::get(C, Fields));
      continue;
    }''')
    new = new.replace('    if (auditGNUPrimitive(MF)) return false;',
                      '    if (auditGNUPrimitive(MF)) return false;\n    if (auditGNUStartup(MF)) return false;')
    assert new.count('if (auditGNUStartup(MF)) return false;') == 2
    new = replace(new, 'F.getFnAttribute("wasm-gnu-provider-sealed").getValueAsString() == "2") return false;',
                  '(F.getFnAttribute("wasm-gnu-provider-sealed").getValueAsString() == "2" ||\n'
                  '         F.getFnAttribute("wasm-gnu-startup-sealed").getValueAsString() == "8")) return false;')
    assert new.split('bool llvm::isWebAssemblyGNUPrimitiveAuthenticated',1)[1].split('\n}',1)[0] == primitive_query
    assert new.split('static void prepareGNUPrimitive',1)[1].split('// Run before physical-SP',1)[0] == primitive_prepare
    assert new.split('static bool auditGNUPrimitive',1)[1].split('\n// Source-only finite bootstrap',1)[0] == primitive_audit
    source_pairs = {}
    patch = ''
    for name, original, changed in [(rel, old, new)]:
        (task/'basis'/name).parent.mkdir(parents=True, exist_ok=True)
        (task/'basis'/name).write_text(original)
        (task/'source'/name).parent.mkdir(parents=True, exist_ok=True)
        (task/'source'/name).write_text(changed)
        patch += ''.join(difflib.unified_diff(original.splitlines(True), changed.splitlines(True),
                                            fromfile='a/'+name, tofile='b/'+name))
        source_pairs[name] = {'basis': str(args.basis/'source'/name), 'basisSnapshot': str(task/'basis'/name),
                             'basisSha256': sha(task/'basis'/name), 'path': str(task/'source'/name),
                             'sha256': sha(task/'source'/name)}
    header_rel = 'llvm/lib/Target/WebAssembly/WebAssembly.h'
    header = args.basis / 'source' / header_rel
    pin(header)
    before = header.read_text()
    after = replace(before, 'bool isWebAssemblyGNUPrimitiveAuthenticated(const Function &F);',
                    'bool isWebAssemblyGNUPrimitiveAuthenticated(const Function &F);\n'
                    'bool isWebAssemblyGNUStartupAuthenticated(const Function &F);')
    (task/'basis'/header_rel).write_text(before)
    (task/'source'/header_rel).write_text(after)
    patch += ''.join(difflib.unified_diff(before.splitlines(True), after.splitlines(True),
                                        fromfile='a/'+header_rel, tofile='b/'+header_rel))
    source_pairs[header_rel] = {'basis': str(header), 'basisSnapshot': str(task/'basis'/header_rel),
                              'basisSha256': sha(task/'basis'/header_rel), 'path': str(task/'source'/header_rel),
                              'sha256': sha(task/'source'/header_rel)}
    (task/'compiler.patch').write_text(patch)
    for row in pins:
        assert sha(Path(row['path'])) == row['sha256'] and sha(Path(row['snapshot'])) == row['sha256']
    report = {'prepared': True, 'compiled': False, 'runtimeAcceptance': False, 'startupAdmissionAccepted': False,
              'basis': str(args.basis), 'inputPins': pins, 'sourcePairs': source_pairs,
              'patchSha256': sha(task/'compiler.patch'), 'primitive2QueryPrepareAuditByteUnchanged': True,
              'descriptorTableABIUnchanged': 'only class2/class4 descriptors; startup8 is separate source seal',
              'requirementsBeforeBuild': [
                  'root exact patch and external assembly/import/phase contract review',
                  'peer EH routing skips only authenticated startup8 under this distinct query, with no import exemption in primitive2',
                  'final source-bound external assembly/TLS initializer machine closure and no linear SP writes',
                  'host actual first-mask/TLS/TP/admit phase witness bound to exact final bytes/task/instance',
                  'actual final no-start/constructor loader rejection before Instance creation',
                  'owner gate/restore descriptor4 publication and pending-signal delivery under real kernel'],
              'freeBytes': shutil.disk_usage(task).free}
    (task/'prepared.json').write_text(json.dumps(report, indent=2)+'\n')
    print(json.dumps({'prepared': str(task/'prepared.json'), 'sha256': sha(task/'prepared.json'),
                      'patchSha256': report['patchSha256'], 'compiled': False}))


if __name__ == '__main__':
    main()
