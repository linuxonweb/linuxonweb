#!/usr/bin/env python3
"""Check exact XPC adaptation, then optionally compile its extracted budget code.

--compile tests the actual adapted selector, callback table and watchdog minimum
under five target macro combinations. Stubs model the verified BasePrincipal API:
AddonPolicy is for content principals; ContentScriptAddonPolicy is for expanded
principals. This is a classifier regression check, not Firefox runtime acceptance.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess

from extension_document_budget import ADAPTATIONS, PREFERENCE, adapt_xpc


def metadata(path):
    data = path.read_bytes()
    return dict(path=str(path.resolve()), bytes=len(data), sha256=hashlib.sha256(data).hexdigest())


def reject(text):
    try:
        adapt_xpc(text)
    except ValueError:
        return
    raise AssertionError('Adaptation accepted a partial, duplicated, or changed anchor')


def extract(text):
    definitions = text[text.index('#define PREF_MAX_SCRIPT_RUN_TIME_CONTENT'):text.index('class WatchdogManager {')]
    start = text.index('  int32_t limit;\n', text.index('TimeDuration duration = now - self->mSlowScriptCheckpoint;'))
    selector = text[start:text.index('  // When the parent process slow script dialog', start)]
    start = text.index('      int32_t contentTime = StaticPrefs::dom_max_script_run_time();')
    end = text.index('mWatchdog->SetMinScriptRunTimeSeconds(', start)
    minimum = text[start:text.index(');\n', end)+3]
    return definitions, selector, minimum


STUBS = r'''
namespace Preferences {
std::map<std::string, int32_t> values;
int32_t GetInt(const char* name, int32_t fallback) {
  auto it = values.find(name); return it == values.end() ? fallback : it->second;
}
void SetInt(const char* name, int32_t value) { values[name] = value; }
}
namespace StaticPrefs {
int32_t dom_max_script_run_time() { return Preferences::GetInt("dom.max_script_run_time", 10); }
int32_t dom_max_chrome_script_run_time() { return Preferences::GetInt("dom.max_chrome_script_run_time", 20); }
int32_t dom_max_ext_content_script_run_time() { return Preferences::GetInt("dom.max_ext_content_script_run_time", 5); }
}
using nsString = std::string;
struct SystemPrincipal {};
enum class Kind { System, Content, Expanded, Null };
struct Policy { void GetId(nsString& out) { out = "content-addon"; } };
struct Principal {
  Kind kind; bool hasPolicy; Policy policy;
  template<class T> bool Is() const {
    static_assert(std::is_same<T, SystemPrincipal>::value); return kind == Kind::System;
  }
  Policy* ContentScriptAddonPolicy() { return kind == Kind::Expanded && hasPolicy ? &policy : nullptr; }
  Policy* AddonPolicy() { return kind == Kind::Content && hasPolicy ? &policy : nullptr; }
};
struct BasePrincipal { static Principal* Cast(Principal* p) { return p; } };
namespace nsContentUtils { Principal* SubjectPrincipal(Principal* p) { return p; } }
struct Context { bool mExecutedChromeScript = false; };
struct Selection { int32_t limit; std::string pref; std::string addon; bool chrome; };
struct Watchdog { int32_t value; void SetMinScriptRunTimeSeconds(int32_t n) { value = n; } };
'''

ORACLE = r'''
int checks = 0;
void require(bool ok, const char* message) {
  ++checks; if (!ok) throw std::runtime_error(message);
}
void expect(Kind kind, bool policy, int limit, const char* pref, bool chrome = false,
            const char* addon = "") {
  Principal principal{kind, policy, {}}; auto got = selectBudget(principal);
  require(got.limit == limit, "budget differs"); require(got.pref == pref, "preference scope differs");
  require(got.chrome == chrome, "chrome tracking differs"); require(got.addon == addon, "dialog addon ID differs");
}
int main() {
 try {
  constexpr bool target = TEST_TARGET_EXTENDED;
  const char* documentPref = "dom.max_ext_document_script_run_time";
  const char* ordinaryPref = "dom.max_script_run_time";
  const char* contentPref = "dom.max_ext_content_script_run_time";
  const char* chromePref = "dom.max_chrome_script_run_time";
  // Independent expected categories, including missing policy and system priority.
  expect(Kind::System, false, 20, chromePref, true);
  expect(Kind::System, true, 20, chromePref, true);
  expect(Kind::Content, false, 10, ordinaryPref);
  expect(Kind::Content, true, target ? 60 : 10, target ? documentPref : ordinaryPref);
  expect(Kind::Expanded, true, 5, contentPref, false, "content-addon");
  expect(Kind::Expanded, false, 10, ordinaryPref);
  expect(Kind::Null, true, 10, ordinaryPref);
  expect(Kind::Null, false, 10, ordinaryPref);
  require(watchdogMinimum() == 5, "default watchdog minimum differs");
  int documentCallbacks = 0, originalCallbacks = 0;
  for (auto name : gCallbackPrefs) if (name) {
    if (std::string(name) == documentPref) ++documentCallbacks; else ++originalCallbacks;
  }
  require(documentCallbacks == (target ? 1 : 0), "target callback registration differs");
  require(originalCallbacks == 4, "original callbacks changed");
  Preferences::SetInt(ordinaryPref, 37); Preferences::SetInt(chromePref, 81);
  Preferences::SetInt(contentPref, 9); Preferences::SetInt(documentPref, 77);
  expect(Kind::Content, false, 37, ordinaryPref);
  expect(Kind::Content, true, target ? 77 : 37, target ? documentPref : ordinaryPref);
  expect(Kind::Expanded, true, 9, contentPref, false, "content-addon");
  expect(Kind::System, false, 81, chromePref, true);
  require(watchdogMinimum() == 9, "configured watchdog minimum differs");
  Preferences::SetInt(documentPref, 2);
  require(watchdogMinimum() == (target ? 2 : 9), "document budget omitted from watchdog minimum");
  Preferences::values.clear(); Preferences::SetInt(ordinaryPref, 0);
  Preferences::SetInt(chromePref, 0); Preferences::SetInt(contentPref, 0);
  require(watchdogMinimum() == (target ? 60 : INT32_MAX), "sole finite document budget omitted");
  Preferences::SetInt(documentPref, 0);
  require(watchdogMinimum() == INT32_MAX, "explicit no-limit budget changed watchdog minimum");
  Preferences::SetInt(documentPref, -7);
  expect(Kind::Content, true, target ? -7 : 0, target ? documentPref : ordinaryPref);
  require(watchdogMinimum() == INT32_MAX, "negative budget was treated as a finite watchdog minimum");
  Preferences::values.clear(); Preferences::SetInt(documentPref, -7);
  expect(Kind::Content, true, target ? -7 : 10, target ? documentPref : ordinaryPref);
  expect(Kind::Content, false, 10, ordinaryPref);
  expect(Kind::Expanded, true, 5, contentPref, false, "content-addon");
  require(watchdogMinimum() == 5, "negative document preference changed another category");
  // The existing AlwaysContinue path writes the selected preference. On target,
  // opting out for an extension document must not disable ordinary-page limits.
  Preferences::values.clear(); Principal document{Kind::Content, true, {}};
  auto selected = selectBudget(document); Preferences::SetInt(selected.pref.c_str(), 0);
  expect(Kind::Content, true, 0, target ? documentPref : ordinaryPref);
  expect(Kind::Content, false, target ? 10 : 0, ordinaryPref);
  expect(Kind::Expanded, true, 5, contentPref, false, "content-addon");
  expect(Kind::System, false, 20, chromePref, true);
  std::cout << "{\"checks\":" << checks << "}\n";
  return 0;
 } catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--compile', action='store_true', help='also compile/run the extracted-code checks')
    parser.add_argument('--compiler', default='c++')
    args = parser.parse_args()
    out = args.output.resolve(); out.mkdir(exist_ok=False)
    (out/'t').mkdir()
    original = args.source.read_text(); adapted = adapt_xpc(original)
    assert adapt_xpc(adapted) == adapted
    reverse = adapted
    for old, new, _ in reversed(ADAPTATIONS): reverse = reverse.replace(new, old, 1)
    assert reverse == original, 'A source change escaped the four reviewed adaptations'
    negatives = []
    for old, new, name in ADAPTATIONS:
        for kind, bad in [('drift', original.replace(old, old[:-1]+' /* changed anchor */\n', 1)),
                          ('duplicate', original+old), ('partial', original.replace(old, new, 1))]:
            reject(bad); negatives.append(dict(anchor=name, condition=kind, rejected=True))
    definitions, selector, minimum = extract(adapted)
    header = r'''#include <algorithm>
#include <cstdint>
#include <iostream>
#include <map>
#include <stdexcept>
#include <string>
#include <type_traits>
#undef __wasm__
#undef __linux__
#undef __wasi__
#if TEST_WASM
#define __wasm__ 1
#endif
#if TEST_LINUX
#define __linux__ 1
#endif
#if TEST_WASI
#define __wasi__ 1
#endif
'''
    code = header+definitions+STUBS
    code += '\nSelection selectBudget(Principal& value) {\n  auto* cx = &value; Context context; auto* self = &context;\n'+selector
    code += '  return {limit, prefName, addonId, self->mExecutedChromeScript};\n}\n'
    code += '\nint32_t watchdogMinimum() {\n  Watchdog watchdog; auto* mWatchdog = &watchdog;\n'+minimum+'  return watchdog.value;\n}\n'
    (out/'extracted-budget.cpp').write_text(code+ORACLE)
    record = dict(source=metadata(args.source), adapter=metadata(Path(__file__).with_name('extension_document_budget.py')),
                  unchangedOutsideReviewedAdaptations=True, idempotent=True, negativeChecks=negatives,
                  extractedSource=metadata(out/'extracted-budget.cpp'), compiledCases=[], firefoxRuntimeAcceptance=False)
    if args.compile:
        env = dict(os.environ, TMPDIR=str(out/'t'), TMP=str(out/'t'), TEMP=str(out/'t'))
        cases = [('linux-wasm',1,1,0,1),('native-linux',0,1,0,0),('nonlinux-wasm',1,0,0,0),
                 ('wasi',1,0,1,0),('linux-wasi',1,1,1,0)]
        for name, wasm, linux, wasi, target in cases:
            exe = out/name
            command = [args.compiler, '-std=c++17', '-O0', '-Wall', '-Wextra', '-pedantic',
                       f'-DTEST_WASM={wasm}', f'-DTEST_LINUX={linux}', f'-DTEST_WASI={wasi}',
                       f'-DTEST_TARGET_EXTENDED={target}', str(out/'extracted-budget.cpp'), '-o', str(exe)]
            compiled = subprocess.run(command, capture_output=True, text=True, env=env, timeout=30)
            (out/(name+'.compile.log')).write_text(compiled.stdout+compiled.stderr)
            if compiled.returncode: raise RuntimeError(name+' compilation failed; see retained log')
            result = subprocess.run([exe], capture_output=True, text=True, env=env, timeout=5)
            (out/(name+'.run.log')).write_text(result.stdout+result.stderr)
            if result.returncode: raise RuntimeError(name+' classifier checks failed; see retained log')
            record['compiledCases'].append(dict(name=name, argv=command, result=json.loads(result.stdout)))
    record['passSourceChecks'] = True
    record['passCompiledChecks'] = bool(args.compile and len(record['compiledCases']) == 5)
    (out/'result.json').write_text(json.dumps(record, indent=2)+'\n')
    print(json.dumps(dict(result=metadata(out/'result.json'), negativeChecks=len(negatives),
                         compiledCases=len(record['compiledCases']), firefoxRuntimeAcceptance=False)))


if __name__ == '__main__':
    main()
