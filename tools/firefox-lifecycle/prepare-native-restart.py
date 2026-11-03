#!/usr/bin/env python3
"""Prepare a pinned native restart source overlay; never patch shipped Wasm."""
import argparse
import datetime
import difflib
import hashlib
import json
import pathlib

SOURCE = 'xpcom/base/AppShutdown.cpp'
SOURCE_SHA = '7ccde58f3987f2d120d1e0009b34e48e6ce73cde2c46c63c4bf4c8cf13e608be'
OLD = '    LaunchChild(true);\n'
NEW = '''#if defined(__wasm__) && defined(__linux__) && !defined(__wasi__)
    // This target cannot fork an independent process. Restart intent is already
    // explicit here, profile locks have been released, and XUL/profile restart
    // environment has been restored. Replace this process through the existing
    // Unix exec path; ordinary Quit never enters this branch.
    nsresult restartResult = LaunchChild(true, true);
    if (NS_FAILED(restartResult)) {
      printf_stderr("Firefox restart exec failed (0x%08x)\\n",
                    static_cast<unsigned int>(restartResult));
      sExitCode = 1;
    }
#else
    LaunchChild(true);
#endif
'''


def prepare(source_root, output):
    original_path = source_root / SOURCE
    data = original_path.read_bytes()
    if hashlib.sha256(data).hexdigest() != SOURCE_SHA:
        raise ValueError('Readable source changed: review native restart adapter before use')
    original = data.decode()
    if original.count(OLD) != 1:
        raise ValueError('Native restart call site differs')
    updated = original.replace(OLD, NEW)
    if output.exists() or output.is_symlink():
        raise ValueError('Use a fresh owned output directory')
    output.mkdir(parents=True)
    destination = output / SOURCE
    destination.parent.mkdir(parents=True)
    destination.write_text(updated)
    patch = ''.join(difflib.unified_diff(original.splitlines(True), updated.splitlines(True),
                                       fromfile='a/' + SOURCE, tofile='b/' + SOURCE))
    (output / 'native-restart-wasm.patch').write_text(patch)
    report = {'schema': 1, 'generatedUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'sourcePath': str(original_path.resolve()), 'sourceSha256': SOURCE_SHA,
              'patchedSourceSha256': hashlib.sha256(updated.encode()).hexdigest(),
              'changedFiles': [SOURCE], 'scope': '__wasm__ && __linux__ && !__wasi__; explicit AppShutdownMode::Restart only',
              'mechanism': 'existing LaunchChild(true,true) Unix execv after native profile unlock and restart environment restoration',
              'ordinaryQuitUnchanged': True, 'exitCodeRespawn': False,
              'binaryPatched': False, 'nativeBuildCompleted': False,
              'runtimeRestartAccepted': False,
              'requiredBuildInputs': ['reviewed equivalent configured Firefox159 source and generated headers',
                'matching full native object/archive graph', 'native mapping/runtime/stack adapters',
                'Mesa/EGL and matching libc++/libc++abi/libunwind inputs',
                'original target compiler/linker/optimizer and fpcast transforms'],
              'requiredRuntimeChecks': ['real about:profiles Restart normally returns usable same profile',
                'replacement exec lifecycle and inherited generation XUL_APP_FILE observed',
                'ordinary Close remains closed', 'failed exec reports failure and exits nonzero',
                'original JIT semantic/GC/guard/lifecycle gates unchanged'],
              'accessBoundary': 'Protected historical p6 build inputs are not read or permission-modified by this tool'}
    (output / 'restart-source-report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({k: report[k] for k in ('sourceSha256','patchedSourceSha256','nativeBuildCompleted','runtimeRestartAccepted')}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-root', type=pathlib.Path, required=True)
    parser.add_argument('--output', type=pathlib.Path, required=True)
    args = parser.parse_args()
    prepare(args.source_root, args.output)
