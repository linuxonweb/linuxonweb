#!/usr/bin/env python3
"""Separate authentic fatal scope from short atomic critical depth; no build."""
import json,difflib
from evidence import T,R,sha,budget

def main():
 budget(True);base=T/'fatal-status-proposal-1';out=T/'fatal-status-proposal-2';out.mkdir();old=(base/'fatal-status-v3.c').read_text();c=old
 c=c.replace('t->critical_depth != 1 || !modules(t)', 't->critical_depth != 0 || !modules(t)')
 c=c.replace('!t->task_epoch || !t->root_module || (t->critical_depth && !fatal_live(t)) ||','!t->task_epoch || !t->root_module || t->critical_depth ||')
 c=c.replace('t->critical_depth = 1; fatal_v3.phase = NF_FATAL_ACTIVE;','++t->critical_depth; fatal_v3.phase = NF_FATAL_ACTIVE; --t->critical_depth;')
 assert c.count('t->critical_depth = 0; fatal_clear();')==2
 c=c.replace('t->critical_depth = 0; fatal_clear();','++t->critical_depth; fatal_clear(); --t->critical_depth;')
 needle='int __wasm_gnu_fatal_escape_v3(struct nf_frame *actual) {';assert c.count(needle)==1
 c=c.replace(needle,'''/* Compiler poll policy may suppress only automatic hint dispatch on return1.
   Genuine explicit pthread_exit/testcancel and signal handlers remain ordinary
   recorded operations. Invalid scope returns -1, never a permissive exemption. */
int __wasm_gnu_fatal_scope_v3(void) {
  if (fatal_v3.phase == NF_FATAL_NONE) return 0;
  struct nf_thread *t = __wasm_gnu_frame_thread_v1();
  if (!linear(t, sizeof(*t), 4) || t->version != NF_ABI_VERSION ||
      !t->owner_tp || t->owner_tp != __wasm_gnu_frame_owner_tp_v1() ||
      !t->task_epoch || !fatal_live(t)) return -1;
  return 1;
}
'''+needle)
 source=out/'fatal-status-v3.c';source.write_text(c);header=(R/'fatal-status-v3.h').read_text().replace('int __wasm_gnu_fatal_begin_v3(struct nf_frame *);','int __wasm_gnu_fatal_begin_v3(struct nf_frame *);\nint __wasm_gnu_fatal_scope_v3(void);');(out/'fatal-status-v3.h').write_text(header)
 patch=out/'runtime.patch';patch.write_text(''.join(difflib.unified_diff(old.splitlines(True),c.splitlines(True),fromfile='a/fatal-status-v3.c',tofile='b/fatal-status-v3.c')))
 repo=R.parents[2];consumers=[repo/'tools/glibc/cancel-kernel-boundary/native-bridge.c',repo/'tools/glibc/cancel-kernel-boundary/gnu-helper.c',repo/'tools/glibc/native-forced-unwind/Unwind-wasm-gnu.c',R/'jump-delivery-v2.c',R/'jump-helpers-v2.c']
 pins={str(p):sha(p) for p in [source,out/'fatal-status-v3.h',base/'prepared.json',base/'fatal-status-v3.c',R/'frame-abi.h',*consumers]}
 for p,h in pins.items():
  dest=out/('snapshot-'+__import__('pathlib').Path(p).name);dest.write_bytes(__import__('pathlib').Path(p).read_bytes());assert sha(dest)==h
 proof={'compiled':False,'runtimeAcceptance':False,'compilerConsumer':False,'pins':pins,'patchSha256':sha(patch),'nativeBoundaryCriticalPolicy':'zero critical depth preserved during GNU abort/raise/kernel imports/callbacks; nonzero only inside short no-call mutations','unresolved':['actual compiler poll consumption and preserved explicit cancellation semantics','actual target/escape consumption and epoch invalidation','status0/status3/nested fatal policy','genuine recorded GNU abort corpus/runtime gate']};(out/'prepared.json').write_text(json.dumps(proof,indent=2)+'\n');print(json.dumps({'prepared':str(out/'prepared.json'),'sha256':sha(out/'prepared.json'),'sourceSha256':sha(source),'patchSha256':sha(patch)}))
if __name__=='__main__':main()
