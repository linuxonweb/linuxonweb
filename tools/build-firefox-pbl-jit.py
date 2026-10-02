#!/usr/bin/env python3
"""Build a PBL + runtime loop specializer Firefox candidate in new files.

JIT packet 4 (docs/guest-jit-pbl-spec-20261001.md). Starting from the coherent
PBL candidate (pbl-candidate-v3), this tool:
  1. copies PortableBaselineInterpret.cpp and adds one hook in CASE(LoopHead)
     that calls js::pbljit::OnLoopHead (the only upstream-source change, made
     to a copy; the original tree is untouched),
  2. compiles the copy and tools/pbl-jit/PblJit.cpp with the PBL object's own
     compile command,
  3. rebuilds the js archive and relinks Firefox with the candidate's command,
  4. applies fpcast emulation (23 x i64) and makes the function table growable
     (the jit_install runtime appends installed functions to it),
  5. validates the result and writes report.json.
"""
import argparse
import difflib
import hashlib
import json
import os
from pathlib import Path
import shlex
import signal
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--candidate', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--timeout', type=int, default=1800)
args = parser.parse_args()
candidate, out = args.candidate.resolve(), args.output.resolve()
if out == candidate or candidate in out.parents:
    parser.error('use a separate output directory')
if out.exists():
    parser.error('use a fresh output directory')
report = json.loads((candidate / 'report.json').read_text())
if not report.get('pass'):
    parser.error('coherent candidate must have completed successfully')
plan = json.loads((candidate / 'plan.json').read_text())
task = next(t for t in plan['tasks'] if t['name'] == 'PortableBaselineInterpret.o')
source = Path(task['source'])
original = source.read_text()

PATCHES = [
    ('namespace js {\nnamespace pbl {\n',
     '''namespace js {
namespace pbljit {
struct Exit {
  uint64_t* sp;
  int32_t pcDelta;
  uint32_t icIndex;
};
bool OnLoopHead(JSScript* script, jit::BaselineFrame* frame, uint64_t* sp,
                jsbytecode* pc, JSContext* cx, Exit* exit);
}  // namespace pbljit
}  // namespace js

namespace js {
namespace pbl {
'''),
    ('''      COUNT_COVERAGE_PC(pc);
      END_OP(LoopHead);
''',
     '''      COUNT_COVERAGE_PC(pc);
      if (!frame->isDebuggee() && !script->hasScriptCounts()) {
        js::pbljit::Exit jx;
        if (MOZ_UNLIKELY(js::pbljit::OnLoopHead(
                script, frame, reinterpret_cast<uint64_t*>(sp), pc,
                frameMgr.cxForLocalUseOnly(), &jx))) {
          sp = reinterpret_cast<StackVal*>(jx.sp);
          pc += jx.pcDelta;
          frame->interpreterICEntry() =
              frame->icScript()->icEntries() + jx.icIndex;
          DISPATCH();
        }
      }
      END_OP(LoopHead);
'''),
]
text = original
for needle, replacement in PATCHES:
    if text.count(needle) != 1:
        parser.error('unexpected PBL source near: ' + needle.splitlines()[0])
    text = text.replace(needle, replacement)

out.mkdir(parents=True)
copy = out / 'PortableBaselineInterpret.cpp'
copy.write_text(text)
(out / 'pbl-jit-hook.patch').write_text(''.join(difflib.unified_diff(
    original.splitlines(True), text.splitlines(True), fromfile=str(source), tofile=str(copy))))
jit_source = ROOT / 'tools/pbl-jit/PblJit.cpp'
started = time.monotonic()


def digest(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def run(command, name, cwd):
    (out / (name + '.command.txt')).write_text(shlex.join(command) + '\n')
    env = os.environ.copy()
    remaining = args.timeout - (time.monotonic() - started)
    if remaining <= 0:
        raise TimeoutError('build deadline exceeded')
    with (out / (name + '.log')).open('w') as log:
        process = subprocess.Popen(command, cwd=cwd, env=env, stdout=log, stderr=subprocess.STDOUT,
                                   start_new_session=True)
        try:
            status = process.wait(timeout=remaining)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()
            raise
    if status:
        raise RuntimeError(name + ' failed; see ' + str(out / (name + '.log')))
    print(name + ' passed', flush=True)


def uleb(value):
    data = bytearray()
    while True:
        byte = value & 0x7f
        value >>= 7
        data.append(byte | (0x80 if value else 0))
        if not value:
            return bytes(data)


def read_uleb(data, offset):
    value = shift = 0
    while True:
        byte = data[offset]
        offset += 1
        value |= (byte & 0x7f) << shift
        shift += 7
        if not byte & 0x80:
            return value, offset


def splice_table(module):
    """Make the single funcref table growable: flags 1 (min==max) -> flags 0."""
    offset, tables = 8, []
    while offset < len(module):
        section_id = module[offset]
        size, payload = read_uleb(module, offset + 1)
        if section_id == 4:
            tables.append((offset, payload, payload + size))
        offset = payload + size
    if len(tables) != 1:
        raise ValueError('exactly one Table section required')
    start, payload, end = tables[0]
    count, p = read_uleb(module, payload)
    if count != 1 or module[p] != 0x70 or module[p + 1] != 0x01:
        raise ValueError('expected one funcref table with a maximum')
    minimum, p = read_uleb(module, p + 2)
    maximum, p = read_uleb(module, p)
    if p != end or minimum != maximum:
        raise ValueError('unexpected table limits')
    body = b'\x01\x70\x00' + uleb(minimum)
    section = b'\x04' + uleb(len(body)) + body
    spliced = module[:start] + section + module[end:]
    return spliced, {'offset': start, 'min': minimum, 'oldSection': module[start:end].hex(),
                     'newSection': section.hex()}


result = {'pass': False, 'scope': 'JIT packet 4 test candidate; not for promotion without its gates',
          'baseCandidateSHA256': report['sha256'], 'hookSourceSHA256': digest(copy),
          'pblJitSourceSHA256': digest(jit_source), 'upstreamSourceSHA256': digest(source)}
try:
    base = task['command']
    if base.count(str(source)) != 1:
        raise RuntimeError('unexpected PBL translation input')
    objects = {}
    for name, src in (('PortableBaselineInterpret', copy), ('PblJit', jit_source)):
        command = base.copy()
        obj = out / (name + '.o')
        command[command.index('-o') + 1] = str(obj)
        command[command.index(str(source))] = str(src)
        run(command, 'compile-' + name, task['cwd'])
        objects[name] = obj
    old_object = task['output']
    members = shlex.split((candidate / 'libjs.list').read_text())
    if members.count(old_object) != 1:
        raise RuntimeError('unexpected PBL archive membership')
    members[members.index(old_object)] = str(objects['PortableBaselineInterpret'])
    members.append(str(objects['PblJit']))
    archive_list = out / 'libjs.list'
    archive_list.write_text('\n'.join(shlex.quote(p) for p in members) + '\n')
    archive = out / 'libjs_static.a'
    run(['llvm-ar', 'crs', str(archive), '@' + str(archive_list)], 'archive', out)
    command = shlex.split((candidate / 'logs/link.command.txt').read_text())
    old_archive = str(candidate / 'libjs_static.a')
    if command.count(old_archive) != 1:
        raise RuntimeError('unexpected coherent archive link')
    command[command.index(old_archive)] = str(archive)
    raw = out / 'firefox-pbl-jit-raw.wasm'
    command[command.index('-o') + 1] = str(raw)
    run(command, 'link', Path(plan['objects']) / 'browser/app')
    fpcast = out / 'firefox-pbl-jit-fpcast.wasm'
    run(['wasm-opt', '--all-features', '--disable-compact-imports', '--pass-arg=max-func-params@23',
         '--fpcast-emu', str(raw), '-o', str(fpcast)], 'fpcast', out)
    spliced, splice = splice_table(fpcast.read_bytes())
    final = out / 'firefox-pbl-jit.wasm'
    final.write_bytes(spliced)
    result['tableSplice'] = splice
    run(['wasm-validate', '--enable-all', str(final)], 'validate', out)
    result.update({'pass': True, 'candidate': str(final), 'sha256': digest(final),
                   'bytes': final.stat().st_size})
except Exception as error:
    result['error'] = str(error)
finally:
    result['elapsedSeconds'] = round(time.monotonic() - started, 2)
    (out / 'report.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result), flush=True)
raise SystemExit(0 if result['pass'] else 1)
