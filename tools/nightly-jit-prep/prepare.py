#!/usr/bin/env python3
"""Create a pinned review overlay, never modify the live Nightly source/objdir."""
import argparse, difflib, hashlib, json, re
from pathlib import Path
from extension_document_budget import adapt_xpc
p=argparse.ArgumentParser()
p.add_argument('--source',type=Path,required=True)
p.add_argument('--output',type=Path,required=True)
p.add_argument('--coverage', choices=('integer', 'broad'), default='integer',
               help='Broad migrates existing args/numbers/arrays/properties/Math coverage; acceptance remains unproven')
a=p.parse_args()
repo=Path(__file__).resolve().parents[2]
out=a.output.resolve(); source=a.source.resolve()
if out == source or source in out.parents: raise SystemExit('Output must be outside source')
out.mkdir(parents=True,exist_ok=False)
checks=[]; inputs=[]
def read(path):
    data=path.read_bytes(); inputs.append({'path':str(path),'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data)})
    return data.decode()
def change(text,needle,replacement,name):
    n=text.count(needle); checks.append({'name':name,'expected':1,'actual':n,'pass':n==1})
    if n!=1: raise RuntimeError(f'{name}: expected unique anchor, found {n}')
    return text.replace(needle,replacement)
def save(original, adapted, relative):
    dest=out/'overlay'/relative; dest.parent.mkdir(parents=True,exist_ok=True); dest.write_text(adapted)
    if original != adapted:
        patch=out/'patches'/(relative+'.patch'); patch.parent.mkdir(parents=True,exist_ok=True)
        patch.write_text(''.join(difflib.unified_diff(original.splitlines(True),adapted.splitlines(True),fromfile=relative,tofile=relative)))
proof=json.loads(read(Path('/mnt/p6/build/firefox-nightly-musl-metadata-20261002/acquisition-proof.json')))
assert (proof['buildID'],proof['hgRevision'],proof['gitMirrorCommit']) == ('20261002211853','dfc77f7a6d716f1a20a2576597638d4fc21cd916','bf9757d91e2e53b8ab836f2a08bf4c0275fdcd23')
# Integer-only phase: booleans are intermediate comparison values, live locals are Int32.
allowed='Zero One Int8 Uint16 Uint24 Int32 GetLocal SetLocal Add Sub Mul Mod Inc Dec Neg Pos ToNumeric BitNot BitOr BitAnd BitXor Lsh Rsh Ursh Lt Le Gt Ge Eq Ne StrictEq StrictNe Not JumpTarget Goto JumpIfFalse JumpIfTrue Pop Dup Swap Nop NopIsAssignOp'.split()
optext=read(source/'js/src/vm/Opcodes.h')
ops=[]
for m in re.finditer(r'^\s*MACRO\((\w+),\s*\w+,\s*(?:"[^"]*"|NULL),\s*(\d+),\s*(-?\d+),\s*(-?\d+),\s*([^\n]+?)\)\s*\\?$',optext,re.M):
    ops.append({'name':m[1],'number':len(ops),'length':int(m[2]),'uses':int(m[3]),'defs':int(m[4]),'format':m[5]})
assert len(ops)==len(re.findall(r'^\s*MACRO\((\w+),',optext,re.M))
assert len(ops)>220 and len(ops)<256 and len({o['name'] for o in ops})==len(ops)
names={o['name'] for o in ops}; assert set(allowed)<=names
(out/'opcode-audit.json').write_text(json.dumps({'source_sha256':inputs[-1]['sha256'],'ops':ops,'integer_whitelist':allowed if a.coverage == 'integer' else None,'coverage':a.coverage,'default':'reject'},indent=2)+'\n')
rel='js/src/vm/PortableBaselineInterpret.cpp'; original=read(source/rel)
text=change(original,'namespace js {\nnamespace pbl {\n','''namespace js {
namespace pbljit {
struct Exit { uint64_t* sp; int32_t pcDelta; uint32_t icIndex; };
bool OnLoopHead(JSScript* script, jit::BaselineFrame* frame, uint64_t* sp,
                jsbytecode* pc, JSContext* cx, Exit* exit);
}  // namespace pbljit
}  // namespace js

namespace js {
namespace pbl {
''','PBL declaration')
text=change(text,'        COUNT_COVERAGE_PC(pc);\n        END_OP(LoopHead);\n','''        COUNT_COVERAGE_PC(pc);
        // This adapter may not GC, walk the stack, or invoke JS/runtime calls.
        if (!frame->isDebuggee() && !frame->script()->hasScriptCounts()) {
          static_assert(sizeof(StackVal) == sizeof(uint64_t));
          js::pbljit::Exit jx;
          if (MOZ_UNLIKELY(js::pbljit::OnLoopHead(
                  frame->script(), frame, reinterpret_cast<uint64_t*>(sp), pc,
                  ctx.frameMgr.cxForLocalUseOnly(), &jx))) {
            sp = reinterpret_cast<StackVal*>(jx.sp);
            pc += jx.pcDelta;
            // Nightly consumes the local cursor; keep the saved cursor coherent.
            icEntry = icEntries + jx.icIndex;
            frame->interpreterICEntry() = icEntry;
            DISPATCH();
          }
        }
        END_OP(LoopHead);
''','LoopHead after interrupt/coverage')
text=change(text,'#include "vm/AsyncIteration.h"\n','#include "vm/AsyncIteration.h"\n#include "vm/BytecodeUtil.h"\n','BytecodeUtil include')
text=change(text,'  if (!JitOptions.portableBaselineInterpreter) {\n','''#if !defined(__wasm__) || defined(__wasi__) || !defined(JS_CODEGEN_NONE) || !defined(ENABLE_PORTABLE_BASELINE_INTERP) || !defined(ENABLE_INTERRUPT_CHECKS)
#  error "Guest specializer requires real threaded Linux/wasm PBL and interrupts"
#endif
  if (state.script()->baselineDisabled()) {
    return MethodStatus::Method_CantCompile;
  }
  if (!JitOptions.portableBaselineInterpreter) {
''','cached admission/target contract')
text=change(text,'  if (!cx->zone()->ensureJitZoneExists(cx)) {\n','''  // After warmup and before first JitScript allocation: retain C++ exception policy.
  bool reject = false;
  for (const auto& note : state.script()->trynotes()) {
    reject |= note.kind() == TryNoteKind::Catch ||
              note.kind() == TryNoteKind::Finally;
  }
  for (jsbytecode* pc = state.script()->code();
       !reject && pc < state.script()->codeEnd(); pc += GetBytecodeLength(pc)) {
    JSOp op = JSOp(*pc);
    reject = op == JSOp::Throw || op == JSOp::ThrowWithStack;
  }
  if (reject) {
    MOZ_RELEASE_ASSERT(!state.script()->hasJitScript());
    state.script()->disableBaselineCompile();
    return MethodStatus::Method_CantCompile;
  }
  if (!cx->zone()->ensureJitZoneExists(cx)) {
''','hot handler/throw rejection')
save(original,text,rel)
rel='js/src/jit/Jit.cpp'; original=read(source/rel)
text=change(original,'  JSScript* script = state.script();\n\n  uint8_t* code = script->jitCodeRaw();\n','''  JSScript* script = state.script();

#if defined(__wasm__) && defined(JS_CODEGEN_NONE) && defined(ENABLE_PORTABLE_BASELINE_INTERP)
  if (script->baselineDisabled()) {
    return EnterJitStatus::NotEntered;
  }
#endif
  uint8_t* code = script->jitCodeRaw();
''','Jit.cpp admission fast return')
save(original,text,rel)
rel='js/xpconnect/src/XPCJSContext.cpp'; original=read(source/rel)
text=change(original,'  // Disable most JITs in Safe-Mode.\n','''#if defined(__wasm__) && defined(ENABLE_PORTABLE_BASELINE_INTERP)
#  if defined(__wasi__) || !defined(JS_CODEGEN_NONE)
#    error "Linux/wasm browser PBL requires the real guest threading ABI"
#  endif
  // PBL has no browser pref setter upstream. Avoid FORCE and zero-threshold.
  JS_SetGlobalJitCompilerOption(cx, JSJITCOMPILER_PORTABLE_BASELINE_ENABLE,
                                safeMode ? 0 : 1);
  JS_SetGlobalJitCompilerOption(cx, JSJITCOMPILER_PORTABLE_BASELINE_WARMUP_THRESHOLD,
                                10);
#endif

  // Disable most JITs in Safe-Mode.
''','explicit wasm browser PBL setter')
read(repo/'tools/nightly-jit-prep/extension_document_budget.py')
text=adapt_xpc(text)
checks.append({'name':'Linux/Wasm extension-document watchdog default', 'pass':True, 'seconds':60})
save(original,text,rel)
original=read(repo/'tools/pbl-jit/PblJit.cpp'); text=original
text=change(text,'!Watchtower::watchesPropertyModification(&n)','!Watchtower::watchesPropertyValueChange(&n)','Nightly Watchtower API (disabled phase)')
text=change(text,'static_assert(kTagObject == uint32_t(JSVAL_TAG_OBJECT));\n','''static_assert(kTagObject == uint32_t(JSVAL_TAG_OBJECT));
static_assert(sizeof(void*) == 4, "Guest specializer requires wasm32 pointers");
static_assert(sizeof(Value) == sizeof(uint64_t));
static_assert(uint32_t(JSVAL_TAG_CLEAR) == 0xFFFFFF80u);
static_assert(uint32_t(JSVAL_TAG_SHIFT) == 32);
#if !defined(__wasm__) || defined(__wasi__)
#  error "Native Linux/wasm only; no WASI or fake pthread ABI"
#endif
''','fresh wasm32 value contract')
whitelist='''// Phase one rejects every opcode outside this explicit integer subset.
bool IntegerOpcodeAllowed(JSOp op) {
  switch (op) {
'''+''.join(f'    case JSOp::{name}:\n' for name in allowed)+'''      return true;
    default:
      return false;
  }
}

'''
if a.coverage == 'integer':
    text=change(text,'constexpr uint32_t kMaxInstalls = 4000;\n','constexpr uint32_t kMaxInstalls = 4000;\n\n'+whitelist,'integer whitelist')
    text=change(text,'    for (jsbytecode* pc = body; pc < end; pc += GetBytecodeLength(pc)) {\n      JSOp op = JSOp(*pc);\n','    for (jsbytecode* pc = body; pc < end; pc += GetBytecodeLength(pc)) {\n      JSOp op = JSOp(*pc);\n      if (!IntegerOpcodeAllowed(op)) return reject("phase-one opcode", pc);\n','scan whitelist before liveness')
    text=change(text,'      if (uint32_t(bits >> 32) == kTagObject) {\n','      if (uint32_t(bits >> 32) != TagOf(Ty::Int)) return reject("phase-one head type", head);\n      if (uint32_t(bits >> 32) == kTagObject) {\n','Int32 head-live guards')
    start=text.index('// Translate one loop. `init` sets up a fresh Compiler for each attempt.')
    end=text.index('void FreeCompiler(Compiler* c)',start)
    text=text[:start]+'''// Integer-only translation: type disagreement is a rejection, never a Double retry.
template <typename Init>
Compiler* TranslateLoop(Init init, Buf& m) {
  void* mem = malloc(sizeof(Compiler));
  if (!mem) return nullptr;
  Compiler* c = new (mem) Compiler;
  m.n = 0;
  init(*c);
  c->attempts = 1;
  if (c->scan() && c->liveness() && c->translate()) c->assemble(m);
  return c;
}

'''+text[end:]
    checks.append({'name':'single translation attempt, no widening','expected':1,'actual':text.count('c->attempts = 1;'),'pass':text.count('c->attempts = 1;')==1})
    text=change(text,'''        if (frame->isFunctionFrame()) {
          k.argv = reinterpret_cast<const uint64_t*>(frame->argv());
          k.nformals = frame->numFormalArgs();
          k.argsAliased = script->argsObjAliasesFormals();
        }
''','        // Argument-frame ABI is deferred; the first phase accepts locals only.\n','defer runtime argument-frame access')
save(original,text,'PblJit.cpp')
cache_header=read(repo/'tools/pbl-jit/PblCacheObserve.h')
save(cache_header,cache_header,'PblCacheObserve.h')
original=read(repo/'tools/pbl-jit/host-test/mock.h')
start=original.index('#define PBLJIT_OPS(X)'); end=original.index('enum class JSOp',start)
macro='#define PBLJIT_OPS(X) '+ ' \\\n  '.join(f"X({o['name']}, {o['number']}, {o['length']})" for o in ops)+'\n'
text=original[:start]+macro+original[end:]
text=text.replace("Firefox 128.14.0's", "the pinned Firefox Nightly 159.0a1 source's")
save(original,text,'host-test/mock.h')
# Record checked API inputs even for currently disabled broad features.
for rel in ['js/src/vm/Watchtower.h','js/src/jit/BaselineFrame.h','js/src/vm/JSContext.h','js/src/gc/GCRuntime.h','js/src/jsapi.cpp','js/src/jit/JitOptions.cpp','js/moz.configure','js/src/vm/moz.build']:
    read(source/rel)
manifest={'scope':a.coverage+' source overlay and host emitter preparation; no Nightly compile/runtime acceptance','coverage':a.coverage,'source':str(source),'official_build':'20261002211853','hg':'dfc77f7a6d716f1a20a2576597638d4fc21cd916','git_mirror':'bf9757d91e2e53b8ab836f2a08bf4c0275fdcd23','libc':'musl','full_tree_hg_git_identity':'inference; acquisition proof establishes reviewed overlay/canonical pairs','generator':{'path':str(Path(__file__).resolve()),'sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()},'checks':checks,'pass':all(c['pass'] for c in checks),'inputs':inputs,'files':[{'path':str(f.relative_to(out)),'sha256':hashlib.sha256(f.read_bytes()).hexdigest(),'bytes':f.stat().st_size} for f in sorted(out.rglob('*')) if f.is_file()]}
(out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps({'pass':manifest['pass'],'coverage':a.coverage,'anchorChecks':len(checks),'opcodeCount':len(ops),'allowedOpcodeCount':len(allowed) if a.coverage == 'integer' else None,'output':str(out)}))
