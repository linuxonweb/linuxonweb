#!/usr/bin/env python3
"""Prepare exact blocked-signal bootstrap source copies for startup review."""
import argparse
import difflib
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess

HERE = Path(__file__).resolve().parent


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def replace(text, old, new):
    assert text.count(old) == 1, old
    return text.replace(old, new)


def main():
    ap = argparse.ArgumentParser()
    for name in ('task', 'kernel-source', 'startup-proof', 'entry-proof', 'gate-proof'):
        ap.add_argument('--' + name, type=Path, required=True)
    args = ap.parse_args()
    task = args.task.resolve()
    assert task.parent == Path('/mnt/p6/build') and not task.exists()
    expected = {'startup': '607fd7186649e1b788982d5cb0f9a0764b48ad4574d5df6efc20d5e3705e075b',
                'entry': '01668aab772352f4810ae0a6d1789887e4d2dba2247514f4636225e491166816',
                'gate': 'b7c6c3aa572a1a2d5f72be5b7c23d81bf5e9d7c2e35e8f9acb78e2d4be051668'}
    task.mkdir()
    assert subprocess.check_output(['findmnt', '-T', str(task), '-no', 'FSTYPE'], text=True).strip() == 'ext4'
    assert shutil.disk_usage(task).free >= 8 * 1024**3
    for name in ('source', 'original', 'snapshots', 'tmp', 'cache'):
        (task / name).mkdir()
    os.environ.update(TMPDIR=str(task / 'tmp'), TMP=str(task / 'tmp'), TEMP=str(task / 'tmp'),
                      XDG_CACHE_HOME=str(task / 'cache'), PYTHONDONTWRITEBYTECODE='1')
    pins = []

    def pin(path):
        path = path.resolve()
        dest = task / 'snapshots' / (digest(path) + '-' + path.name)
        if dest.exists():
            assert dest.read_bytes() == path.read_bytes()
        else:
            shutil.copyfile(path, dest)
        row = {'path': str(path), 'sha256': digest(path), 'bytes': path.stat().st_size,
               'snapshot': str(dest)}
        pins.append(row)
        return row

    old = {}
    pin(Path(__file__))
    for name in expected:
        path = getattr(args, name + '_proof')
        assert digest(path) == expected[name]
        pin(path)
        report = json.loads(path.read_text())
        assert report['pass'] and not report['runtimeAcceptance'] and not report['nativeRecordsAdmitted']
        if name == 'entry':
            source = path.parent / 'source/owner-entry.s'
        else:
            row = report['source']
            source = Path(row['snapshot'])
            assert digest(source) == row['sha256']
        pin(source)
        filename = {'entry': 'owner-entry.s', 'gate': 'owner-gate.c', 'startup': 'owner-startup.c'}[name]
        shutil.copyfile(source, task / 'original' / filename)
        old[filename] = source.read_text()
    kernel = args.kernel_source.resolve()
    assert str(kernel).startswith('/mnt/p6/build/')
    facts = {}
    for rel, required in {
        'arch/wasm/kernel/syscall.c': ['regs->syscall_return = syscall_table[nr](regs);', 'syscall_exit_to_user_mode(regs);'],
        'kernel/entry/common.c': ['if (ti_work & (_TIF_SIGPENDING | _TIF_NOTIFY_SIGNAL))', 'arch_do_signal_or_restart(regs);'],
        'kernel/signal.c': ['SYSCALL_DEFINE4(rt_sigprocmask', 'old_set = current->blocked;',
                            'sigdelsetmask(&new_set, sigmask(SIGKILL)|sigmask(SIGSTOP));',
                            'error = sigprocmask(how, &new_set, NULL);', 'flush_signal_handlers(struct task_struct *t, int force_default)'],
        'fs/exec.c': ['flush_signal_handlers(me, 0);'],
        'include/uapi/asm-generic/signal.h': ['#define _NSIG'],
        'include/uapi/asm-generic/signal-defs.h': ['#define SIG_BLOCK', '#define SIG_SETMASK'],
    }.items():
        path = kernel / rel
        text = path.read_text()
        for word in required:
            assert word in text, (rel, word)
        facts[rel] = {'input': pin(path), 'requiredSource': required}
    startup = replace(old['owner-startup.c'],
        'static _Thread_local uint32_t zero_canary;',
        '''static _Thread_local uint32_t zero_canary;
/* Raw kernel sigset is exactly 64 bits, distinct from GNU public sigset_t.
   Only this reviewed startup bridge uses this explicit kernel transport. */
static const uint32_t bootstrap_full_mask[2] = {UINT32_MAX, UINT32_MAX};
static uint32_t bootstrap_saved_mask[2];
static unsigned bootstrap_masked;''')
    startup = replace(startup, 'void *startup_prepare(void)', '''void bootstrap_block_signals(void)
{
  /* FIRST startup operation: syscall applies the mask before its signal exit
     loop. Kernel retains pending signals; SIGKILL/SIGSTOP remain unblocked. */
  if (bootstrap_masked || owner_raw(134, 0, (int)(uintptr_t)bootstrap_full_mask,
      (int)(uintptr_t)bootstrap_saved_mask, 8, 0, 0) != 0) {
    owner_raw(94, 93, 0, 0, 0, 0, 0);
    __builtin_unreachable();
  }
  bootstrap_masked = 1;
}

/* This helper MUST have a real descriptor4 record. Called only after the
   owning gate has published its actual activation; never from bootstrap. */
int owner_restore_signals(void)
{
  if (!bootstrap_masked) return -EINVAL;
  bootstrap_masked = 0;
  return owner_raw(134, 2, (int)(uintptr_t)bootstrap_saved_mask, 0, 8, 0, 0);
}

void *startup_prepare(void)''')
    entry = replace(old['owner-entry.s'], ' .functype startup_prepare () -> (i32)',
                    ' .functype bootstrap_block_signals () -> ()\n .functype startup_prepare () -> (i32)')
    entry = replace(entry, ' call startup_prepare', ' call bootstrap_block_signals\n call startup_prepare')
    gate = replace(old['owner-gate.c'], 'extern int owner_raw(int, int, int, int, int, int, int);',
                   'extern int owner_raw(int, int, int, int, int, int, int);\nextern int owner_restore_signals(void);')
    gate = replace(gate, '  int lifetime = good ?',
                   '  good = good && owner_restore_signals() == 0;\n  int lifetime = good ?')
    patch = ''
    outputs = []
    for filename, text in {'owner-startup.c': startup, 'owner-entry.s': entry, 'owner-gate.c': gate}.items():
        path = task / 'source' / filename
        path.write_text(text)
        patch += ''.join(difflib.unified_diff(old[filename].splitlines(True), text.splitlines(True),
                                            fromfile='a/' + filename, tofile='b/' + filename))
        outputs.append(pin(path))
    (task / 'startup.patch').write_text(patch)
    pin(task / 'startup.patch')
    report = {'prepared': True, 'buildAccepted': False, 'runtimeAcceptance': False,
              'scope': 'exact separately authenticated pre-owner startup proposal; no primitive2 import exemption',
              'kernelFacts': facts, 'inputPins': pins, 'outputs': outputs,
              'requiredAdmissionContract': [
                  'exact startup source/IR/machine body and import argument seals, outside general primitive2',
                  'first rt_sigprocmask import blocks maskable callbacks before all GNU TLS/rawTP operations',
                  'kernel default/ignored handlers preserved; exec resets caught handlers, does not admit old module pointers',
                  'actual raw TP/task epoch/instance and immutable compiler root authenticated before first record',
                  'first descriptor4 owner gate publishes live cleanup scope before restoring inherited mask',
                  'genuine pending state and kernel queued signals preserved; no fake cancellation state copied across exec',
                  'KILL/STOP and exit/exec traps remain real control; no resumed abandoned startup',
                  'real guest pending/ignored/blocked/foreign-handler/exec-invalidation gates required'],
              'storageFree': shutil.disk_usage(task).free}
    for row in pins:
        assert digest(Path(row['path'])) == row['sha256']
    (task / 'prepared.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'prepared': str(task / 'prepared.json'), 'sha256': digest(task / 'prepared.json'),
                      'patchSha256': digest(task / 'startup.patch')}))


if __name__ == '__main__':
    main()
