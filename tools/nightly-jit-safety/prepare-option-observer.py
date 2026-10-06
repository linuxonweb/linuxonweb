#!/usr/bin/env python3
"""Prepare unapplied startup/Worker option logging after broad+restart-pref overlays."""
import argparse, difflib, hashlib, json
from pathlib import Path

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--source', type=Path, required=True)
p.add_argument('--overlay', type=Path, required=True)
p.add_argument('--out', type=Path, required=True)
a = p.parse_args()
if not any(a.out.resolve().is_relative_to(root) for root in ('/mnt/p6/build','/mnt/p6/project/build')):
    p.error('disk task output required')
if a.out.resolve().is_relative_to(a.source.resolve()) or a.out.resolve().is_relative_to(a.overlay.resolve()):
    p.error('output must be outside source and input overlay')
a.out.mkdir(parents=True, exist_ok=False)
pins = []
guard = '#if defined(__wasm__) && !defined(__wasi__) && defined(ENABLE_PORTABLE_BASELINE_INTERP)\n'
headers = guard + '#  include "jsapi.h"\n#  include <atomic>\n#  include <stdio.h>\n#  include <stdlib.h>\n#  include <pthread.h>\n#  include <sys/syscall.h>\n#  include <unistd.h>\n#endif\n'

def replace(text, old, new):
    if text.count(old) != 1: raise RuntimeError('nonunique source anchor: ' + old[:100])
    return text.replace(old, new)

def log(event, extra):
    return guard + '''  // Opt-in initialization diagnostic, outside any generated-module hot hook.
  static std::atomic<unsigned> optionObservationCount{0};
  const char* observePortable = getenv("PBLJIT_OBSERVE");
  if (observePortable && observePortable[0] == '1' && observePortable[1] == '\\0') {
    unsigned optionObservationIndex = optionObservationCount.fetch_add(1, std::memory_order_relaxed);
    if (optionObservationIndex == 64)
      fprintf(stderr, "PBLJIT_OPTION_EXHAUSTED event=EVENT budget=64 pid=%ld\\n", static_cast<long>(getpid()));
    if (optionObservationIndex < 64) {
    uint32_t actualPortable = 0, actualWarmup = 0;
    bool gotPortable = JS_GetGlobalJitCompilerOption(CX,
        JSJITCOMPILER_PORTABLE_BASELINE_ENABLE, &actualPortable);
    bool gotWarmup = JS_GetGlobalJitCompilerOption(CX,
        JSJITCOMPILER_PORTABLE_BASELINE_WARMUP_THRESHOLD, &actualWarmup);
    fprintf(stderr, "PBLJIT_OPTION event=EVENT pid=%ld tid=%ld pthread=%lu option=%u threshold=%u available=%u EXTRA\\n",
        static_cast<long>(getpid()), syscall(SYS_gettid),
        static_cast<unsigned long>((uintptr_t)pthread_self()),
        actualPortable, actualWarmup, unsigned(gotPortable && gotWarmup) ARGS);
    }
  }
#endif
'''.replace('CX', 'cx' if event == 'startup' else 'aWorkerCx').replace('EVENT', event).replace('EXTRA', extra[0]).replace(' ARGS', extra[1])

for rel, input_path in [
    ('js/xpconnect/src/XPCJSContext.cpp', a.overlay/'js/xpconnect/src/XPCJSContext.cpp'),
    ('dom/workers/RuntimeService.cpp', a.source/'dom/workers/RuntimeService.cpp')]:
    before = input_path.read_text()
    text = before
    if rel.endswith('XPCJSContext.cpp'):
        if 'JS_OPTIONS_DOT_STR "portable_baseline"' not in before:
            raise RuntimeError('reviewed restart-only pref overlay required first')
        text = replace(text, '#include "xpcpublic.h"\n', '#include "xpcpublic.h"\n' + headers)
        anchor = '  JS_SetGlobalJitCompilerOption(cx, JSJITCOMPILER_PORTABLE_BASELINE_WARMUP_THRESHOLD,\n                                10);\n'
        text = replace(text, anchor, anchor + log('startup', ('pref=%u safemode=%u', ', unsigned(Preferences::GetBool(JS_OPTIONS_DOT_STR "portable_baseline", true)), unsigned(safeMode)')))
    else:
        text = replace(text, '#include "RuntimeService.h"\n', '#include "RuntimeService.h"\n' + headers)
        anchor = '  JS::ContextOptionsRef(aWorkerCx) = settings.contextOptions;\n'
        text = replace(text, anchor, anchor + '\n' + log('worker-context', ('worker=%p', ', static_cast<void*>(aWorkerPrivate)')))
    dest = a.out/rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(text)
    (a.out/(rel.replace('/','_')+'.patch')).write_text(''.join(difflib.unified_diff(before.splitlines(True), text.splitlines(True), fromfile='a/'+rel, tofile='b/'+rel)))
    pins.append({'path':rel, 'inputPath':str(input_path), 'inputSha256':hashlib.sha256(before.encode()).hexdigest(), 'outputSha256':hashlib.sha256(text.encode()).hexdigest()})
report = {'kind':'unapplied-nightly-option-observer', 'records':pins, 'perProcessPerSiteCap':64,
          'enabledBy':'PBLJIT_OBSERVE=1', 'sourceTarget':'Nightly159 wasm32 Linux native musl',
          'guestAcceptance':False, 'productionAdoption':False,
          'limitations':['Must compile through actual fresh full graph and validate shipping candidate.', 'Worker evidence is the process-wide PBL option at real Worker context initialization, not a separate per-worker tier preference.', 'Diagnostic off is required for primary performance arms; same binary/settings across A and B.']}
(a.out/'manifest.json').write_text(json.dumps(report, indent=2)+'\n')
print(json.dumps(report))
