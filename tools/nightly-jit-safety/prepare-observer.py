#!/usr/bin/env python3
"""Generate unapplied source-specific observer overlays; never edit inputs."""
import argparse, hashlib, json, difflib
from pathlib import Path
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--overlay',type=Path,required=True)
p.add_argument('--out',type=Path,required=True)
a=p.parse_args()
if not str(a.out.resolve()).startswith('/mnt/p6/build/'):p.error('disk-backed task output required')
a.out.mkdir(parents=True,exist_ok=False)
records=[]
def replace(s,old,new):
    if s.count(old)!=1:raise RuntimeError('anchor count '+str(s.count(old))+': '+old[:70])
    return s.replace(old,new)
def save(rel,old,new):
    f=a.out/rel;f.parent.mkdir(parents=True,exist_ok=True);f.write_text(new)
    patch=''.join(difflib.unified_diff(old.splitlines(True),new.splitlines(True),fromfile='a/'+rel,tofile='b/'+rel))
    (a.out/(rel.replace('/','_')+'.patch')).write_text(patch)
    records.append({'path':rel,'inputSha256':hashlib.sha256(old.encode()).hexdigest(),'outputSha256':hashlib.sha256(new.encode()).hexdigest()})
rel='PblJit.cpp';old=(a.overlay/rel).read_text();s=old
s=replace(s,'#include <unistd.h>','#include <unistd.h>\n#include <pthread.h>')
# tCache address plus real pthread identity makes TLS separation inspectable.
# No JS, GC, stack walking, allocation or observer callbacks are added.
anchor='bool OnLoopHead(JSScript* script, jit::BaselineFrame* frame, uint64_t* sp,'
observer='''// Diagnostic-only bounded observer. Owned source filter preserves budget.
bool ObserverEnabled(JSScript* script) {
  static const bool enabled = [] {
    const char* v = getenv("PBLJIT_OBSERVE");
    return v && strcmp(v, "1") == 0;
  }();
  if (!enabled) return false;
  static constexpr char prefix[] = "file:///home/admin/nightly-jit-safety/";
  const char* filename = script->filename();
  return filename && strncmp(filename, prefix, sizeof(prefix) - 1) == 0;
}

void Observe(JSScript* script, jsbytecode* pc, JSContext* cx,
             const char* event, uint32_t fn = 0, int64_t kind = -1,
             uint32_t sp = 0, int32_t delta = 0, uint32_t ic = 0) {
  if (!ObserverEnabled(script)) return;
  static std::atomic<int> remaining{4096};
  if (remaining.fetch_sub(1, std::memory_order_relaxed) <= 0) return;
  fprintf(stderr, "PBLJIT_OBS event=%s file=%s line=%u off=%u tid=%ld pthread=%lu tls=%p epoch=%llu fn=%u kind=%lld sp=%u pcDelta=%d ic=%u\\n",
          event, script->filename() ? script->filename() : "?",
          script->lineno(), unsigned(pc - script->code()),
          syscall(SYS_gettid), static_cast<unsigned long>((uintptr_t)pthread_self()), static_cast<void*>(&tCache),
          static_cast<unsigned long long>(MajorGC(cx)), fn,
          static_cast<long long>(kind), sp, delta, ic);
}

void ObserveSkip(JSScript* script, jsbytecode* pc, JSContext* cx,
                 const char* reason) {
  if (!ObserverEnabled(script)) return;
  // Deduplicate repeated heads. Fixed TLS storage; no heap or runtime calls.
  struct Seen { JSScript* script; const char* reason; uint64_t epoch; };
  static thread_local Seen seen[32]{};
  uint64_t epoch = MajorGC(cx);
  for (auto& entry : seen) {
    if (entry.script == script && entry.reason == reason && entry.epoch == epoch)
      return;
  }
  static thread_local unsigned next = 0;
  seen[next++ % 32] = {script, reason, epoch};
  Observe(script, pc, cx, reason);
}

'''
s=replace(s,anchor,observer+anchor)
s=replace(s,'if (IncrementalGC(cx)) return false;','if (IncrementalGC(cx)) {\n    ObserveSkip(script, pc, cx, "skip-incremental");\n    return false;\n  }')
s=replace(s,'    Evict(e);\n    e->pc = pc;\n    e->script = script;','    if (e->state == 1 && e->majorGC != gc) Observe(script, pc, cx, "gc-evict", e->fn);\n    Evict(e);\n    e->pc = pc;\n    e->script = script;')
s=replace(s,'    if (e->state != 1) return false;\n  }\n  // Same pc pointer','    if (e->state != 1) { ObserveSkip(script, pc, cx, "reject"); return false; }\n    Observe(script, pc, cx, "install", e->fn);\n  }\n  // Same pc pointer')
s=replace(s,'  if (kind == NoEntry || kind == Bail) {','  Observe(script, pc, cx, kind == NoEntry ? "noentry" : kind == Bail ? "bail" : kind == Interrupt ? "interrupt" : "run",\n          e->fn, kind, kind == NoEntry ? 0 : out.sp,\n          kind == NoEntry ? 0 : out.pcDelta, kind == NoEntry ? 0 : out.icIndex);\n  if (kind == NoEntry || kind == Bail) {')
save(rel,old,s)
rel='js/src/vm/PortableBaselineInterpret.cpp';old=(a.overlay/rel).read_text();s=old
s=replace(s,'bool OnLoopHead(JSScript* script, jit::BaselineFrame* frame, uint64_t* sp,','void ObserveSkip(JSScript* script, jsbytecode* pc, JSContext* cx,\n                 const char* reason);\nbool OnLoopHead(JSScript* script, jit::BaselineFrame* frame, uint64_t* sp,')
anchor='''            DISPATCH();
          }
        }
        END_OP(LoopHead);'''
new='''            DISPATCH();
          }
        } else {
          if (frame->isDebuggee())
            js::pbljit::ObserveSkip(frame->script(), pc,
                ctx.frameMgr.cxForLocalUseOnly(), "skip-debuggee");
          if (frame->script()->hasScriptCounts())
            js::pbljit::ObserveSkip(frame->script(), pc,
                ctx.frameMgr.cxForLocalUseOnly(), "skip-coverage");
        }
        END_OP(LoopHead);'''
s=replace(s,anchor,new);save(rel,old,s)
(a.out/'manifest.json').write_text(json.dumps({'kind':'unapplied-observer-preparation','records':records,'budget':4096,'sourcePrefix':'file:///home/admin/nightly-jit-safety/','limitations':['Not compiled or run in current full browser.','Current inherited main loop handles pending interrupt before observer; interrupt means generated Wasm returned Interrupt, not cancellation completion.','NoEntry out storage is not read; bailout/run fields report actual output.','Handler policy rejection before OnLoopHead requires separate policy observer for positive exclusion proof.','Incremental event only proves skip at actual active state; verified incremental GC driver still required.','Diagnostics add syscall/stdio overhead; performance arms must use identical observer setting (prefer off).']},indent=2)+'\n')
print(json.dumps({'kind':'preparation','records':records}))
