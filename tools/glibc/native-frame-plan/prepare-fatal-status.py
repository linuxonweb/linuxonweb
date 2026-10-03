#!/usr/bin/env python3
"""Separate concrete status2 genuine-abort scope proposal; no build/consumer."""
import json
from evidence import T,R,sha,budget,G

def main():
 budget(True);out=T/'fatal-status-proposal-1';out.mkdir();old=(R/'transition-status-v2.c').read_text()
 c=old.replace('#include "transition-status-v2.h"','#include "fatal-status-v3.h"')
 c=c.replace('INLINE struct nf_thread *owner(void) {',(R/'fatal-status-v3.inc').read_text()+'\nINLINE struct nf_thread *owner(void) {')
 c=c.replace('!t->task_epoch || !t->root_module || t->critical_depth ||','!t->task_epoch || !t->root_module || (t->critical_depth && !fatal_live(t)) ||')
 c=c.replace('__wasm_gnu_frame_enter_status_v2','__wasm_gnu_frame_enter_status_v3').replace('__wasm_gnu_frame_leave_status_v2','__wasm_gnu_frame_leave_status_v3').replace('__wasm_gnu_frame_admit_status_v2','__wasm_gnu_frame_admit_status_v3')
 c=c.replace('if (f->forced_epoch || f->stopped_epoch) return NF_TRANSITION_PUBLISHED_FATAL_REQUIRED;','if (f->forced_epoch || f->stopped_epoch) return published_fatal(t, head, 2);')
 c=c.replace('if (s->current == f) return NF_TRANSITION_PUBLISHED_FATAL_REQUIRED;','if (s->current == f) return published_fatal(t, head, 2);')
 c=c.replace('return fn && lookup(t, 0, fn) ? NF_TRANSITION_OK : NF_TRANSITION_PUBLISHED_FATAL_REQUIRED;','return fn && lookup(t, 0, fn) ? NF_TRANSITION_OK : published_fatal(t, head, 1);')
 source=out/'fatal-status-v3.c';source.write_text(c)
 pins={str(p):sha(p) for p in [source,R/'fatal-status-v3.h',R/'fatal-status-v3.inc',R/'transition-status-v2.c',R/'transition-status-v2.h',R/'frame-abi.h',G/'stdlib/abort.c']}
 for p,h in pins.items():
  dest=out/('snapshot-'+__import__('pathlib').Path(p).name)
  dest.write_bytes(__import__('pathlib').Path(p).read_bytes());assert sha(dest)==h
 proof={'compiled':False,'runtimeAcceptance':False,'compilerConsumer':False,'pins':pins,'unresolved':['status0 corrupt owner/geometry fatal admission','status3 unpublished/counter saturation fatal admission','nested fatal failure','actual GNU abort/handler record corpus','authentic escape/target hook consumption','compiler status-returning consumers','epoch invalidation and startup8 composition']};(out/'prepared.json').write_text(json.dumps(proof,indent=2)+'\n');print(json.dumps({'prepared':str(out/'prepared.json'),'sha256':sha(out/'prepared.json'),'sourceSha256':sha(source)}))
if __name__=='__main__':main()
