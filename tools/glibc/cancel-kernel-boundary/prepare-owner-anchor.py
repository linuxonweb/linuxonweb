#!/usr/bin/env python3
"""Prepare SAME-live-caller GNU cancellation anchor source; no build/admission."""
import argparse
import difflib
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def replace(text, old, new):
    assert text.count(old) == 1, old
    return text.replace(old, new)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--task', type=Path, required=True)
    ap.add_argument('--bootstrap-plan', type=Path, required=True)
    ap.add_argument('--gnu-source', type=Path, required=True)
    args = ap.parse_args()
    task = args.task.resolve()
    assert task.parent == Path('/mnt/p6/build') and not task.exists()
    assert sha(args.bootstrap_plan/'prepared.json') == 'cc16e739490c97f5f4427a4dfda56330fa13e2e32dcb8724344495ee9b8704ac'
    task.mkdir()
    assert subprocess.check_output(['findmnt','-T',str(task),'-no','FSTYPE'],text=True).strip() == 'ext4'
    assert shutil.disk_usage(task).free >= 8*1024**3
    for name in ('source','snapshots','tmp','cache'): (task/name).mkdir()
    os.environ.update(TMPDIR=str(task/'tmp'), TMP=str(task/'tmp'), TEMP=str(task/'tmp'),
                      XDG_CACHE_HOME=str(task/'cache'), PYTHONDONTWRITEBYTECODE='1')
    pins=[]

    def pin(path):
        path=path.resolve();dest=task/'snapshots'/(sha(path)+'-'+path.name)
        if dest.exists(): assert dest.read_bytes()==path.read_bytes()
        else: shutil.copyfile(path,dest)
        pins.append({'path':str(path),'snapshot':str(dest),'sha256':sha(path),'bytes':path.stat().st_size})

    for path in (Path(__file__), args.bootstrap_plan/'prepared.json',
                 args.bootstrap_plan/'source/owner-gate.c', args.gnu_source/'nptl/pthread_create.c',
                 args.gnu_source/'nptl/unwind.c', args.gnu_source/'nptl/descr.h',
                 args.gnu_source/'sysdeps/nptl/pthreadP.h', args.gnu_source/'sysdeps/nptl/pthread.h'):
        pin(path)
    original=(args.bootstrap_plan/'source/owner-gate.c').read_text()
    new=replace(original, '#include <stdint.h>', '#include <stdint.h>\n#include <stddef.h>')
    new=replace(new, '  int good = thread && thread->head', '''  /* Exact backend64 layout. No full 196-byte sigjmp mask area is written
     when the GNU cancellation alias saves mask0 into this 84-byte buffer. */
  _Static_assert(sizeof(__jmp_buf) == 64 && sizeof(struct pthread_unwind_buf) == 84,
                 "genuine coherent cancellation buffer");
  _Static_assert(offsetof(struct pthread_unwind_buf, priv) == 68,
                 "GNU cancellation private fields after common prefix");
  struct pthread_unwind_buf unwind_buf;
  volatile int expected_cancel = 0; /* Later real cancellation modes set this
                                     before a cancellable operation, not here. */
  int resumed = __sigsetjmp_cancel(
      (struct __cancel_jmp_buf_tag *)(void *)unwind_buf.cancel_jmp_buf, 0);
  /* Match genuine start_thread ordering: private fields follow the actual
     returning-twice call in this SAME recorded invocation. Never use a helper
     wrapper returning into a dead frame. */
  unwind_buf.priv.data.prev = NULL;
  unwind_buf.priv.data.cleanup = NULL;
  if (resumed) {
    int canceled = expected_cancel && self->result == PTHREAD_CANCELED &&
      (atomic_load_relaxed(&self->cancelhandling) &
        (CANCELSTATE_BITMASK | EXITING_BITMASK)) ==
        (CANCELSTATE_BITMASK | EXITING_BITMASK) && self->cleanup == NULL &&
      self->cleanup_jmp_buf == &unwind_buf && thread && thread->head &&
      thread->head->owner_tp == self;
    print(canceled ? "GNU_BOUNDARY_OWNER_CANCEL genuineGNUanchor=1 result=PASS\\n"
                   : "GNU_BOUNDARY_OWNER_CANCEL unexpected-resume FAIL\\n");
    owner_raw(94, canceled ? 0 : 98, 0, 0, 0, 0, 0);
    __builtin_unreachable();
  }
  int empty_cleanup = self->cleanup == NULL && self->cleanup_jmp_buf == NULL;
  THREAD_SETMEM(self, cleanup_jmp_buf, &unwind_buf);
  int good = empty_cleanup && thread && thread->head''')
    new=replace(new, 'GNU_BOUNDARY_OWNER genuineTP=1 canonical=1 lifetime=',
                'GNU_BOUNDARY_OWNER genuineTP=1 canonical=1 liveGNUanchor=1 lifetime=')
    (task/'source/owner-gate.c').write_text(new)
    (task/'owner-anchor.patch').write_text(''.join(difflib.unified_diff(original.splitlines(True),new.splitlines(True),
        fromfile='a/owner-gate.c',tofile='b/owner-gate.c')))
    report={'prepared':True,'compiled':False,'runtimeAcceptance':False,'inputPins':pins,
            'source':{'path':str(task/'source/owner-gate.c'),'sha256':sha(task/'source/owner-gate.c')},
            'patchSha256':sha(task/'owner-anchor.patch'),
            'scope':'ordinary owner gate with genuine SAME-live-caller anchor; expected_cancel remains0, no synthetic cancellation acceptance',
            'requirements':['actual early GNU alias lowering to real caller setjmp + new64 prepare before producer',
                            'final authentic GNU __pthread_unwind definition, never zero weak fallback',
                            'real record4 GNU jump/unwind/cleanup/helper closure and actual canonical root',
                            'genuine forced provider calls unmodified GNU unwind_stop with actual CFA/registered target',
                            'later real cancellation modes set expected_cancel before actual blocked syscall and assert cleanup/thread result']}
    for row in pins: assert sha(Path(row['path']))==row['sha256']
    (task/'prepared.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'prepared':str(task/'prepared.json'),'sha256':sha(task/'prepared.json'),
                      'sourceSha256':report['source']['sha256'],'runtimeAcceptance':False}))


if __name__=='__main__':main()
