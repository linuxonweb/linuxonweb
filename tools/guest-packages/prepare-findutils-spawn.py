#!/usr/bin/env python3
"""Prepare a pinned findutils 4.10.0 Linux/Wasm posix_spawn source patch.

No fork result is simulated. The existing child wait/status and xargs scheduler
remain authoritative. The target musl's spawn file actions implement child cwd
and stdin setup without mutating the parent's working directory or descriptors.
"""
import argparse
import difflib
import hashlib
import json
import pathlib

GUARD = 'defined(__wasm32__) && defined(__linux__) && !defined(__wasi__)'
PINS = {'find/exec.c': '7e124e6df795112a5d311528afeec00b0c7eaf7ce8b862d97371ccc369f36924',
        'xargs/xargs.c': 'a823a6be7b9f16fbdf310bd8d32c3569684ab48061a1297b3ef8b62b55e9efa2'}

FIND_HELPER = r'''/* The wasm32 Linux ABI supports posix_spawn, not independent fork.
   File actions keep directory and stdin changes in the spawned process. */
static int
linuxonweb_spawn_find (pid_t *child, struct exec_val *execp, char **argv)
{
  posix_spawn_file_actions_t actions;
  const struct saved_cwd *wd = execp->wd_for_exec;
  int rc = posix_spawn_file_actions_init (&actions);
  if (rc)
    return rc;
  assert (wd != NULL);
  if (execp->close_stdin)
    rc = posix_spawn_file_actions_addopen (&actions, STDIN_FILENO,
                                           "/dev/null", O_RDONLY, 0);
  if (!rc)
    {
      if (wd->desc >= 0)
        rc = posix_spawn_file_actions_addfchdir_np (&actions, wd->desc);
      else if (wd->name)
        rc = posix_spawn_file_actions_addchdir_np (&actions, wd->name);
      else
        rc = EINVAL;
    }
  if (!rc)
    rc = bc_args_exceed_testing_limit (argv) ? E2BIG
         : posix_spawnp (child, argv[0], &actions, NULL, argv, environ);
  posix_spawn_file_actions_destroy (&actions);
  return rc;
}
'''

FIND_LAUNCH = r'''  int spawn_error = linuxonweb_spawn_find (&child_pid, execp, argv);
  if (spawn_error)
    {
      /* No child was created. Encode a failed predicate for the existing
         -exec semicolon path, never a successful or fabricated process exit.
         The + form also sets find's overall failure status, like failed exec. */
      execp->last_child_status = EXIT_FAILURE << 8;
      if (execp->multiple)
        state.exit_status = EXIT_FAILURE;
      error (0, spawn_error, "%s", safely_quote_err_filename (0, argv[0]));
      return 1;                 /* consumed, do not retry a failed command */
    }
'''

XARGS_HELPER = r'''/* Obtain the same free slot add_proc will reserve after a successful spawn.
   Unlike the fork path, do not increment the parent's child count in advance. */
static int
linuxonweb_spawn_xargs (pid_t *child, char **argv, unsigned int *slot,
                       bool *stdin_failed)
{
  posix_spawn_file_actions_t actions;
  int input_fd = -1;
  int rc = posix_spawn_file_actions_init (&actions);
  *stdin_failed = false;
  if (rc)
    return rc;

  if (!keep_stdin || open_tty)
    {
      const char *inputfile = open_tty ? "/dev/tty" : "/dev/null";
      input_fd = open (inputfile, O_RDONLY | O_CLOEXEC);
      if (input_fd < 0)
        {
          error (0, errno, "%s",
                 quotearg_n_style (0, locale_quoting_style, inputfile));
          if (open_tty)
            {
              /* Upstream's child setup exits 1 without running the utility;
                 xargs reports its ordinary nonzero-client result (123). */
              *stdin_failed = true;
              rc = errno ? errno : EIO;
              goto done;
            }
          /* Upstream permits /dev/null open failure with child stdin closed. */
          rc = posix_spawn_file_actions_addclose (&actions, STDIN_FILENO);
        }
      else
        {
          rc = posix_spawn_file_actions_adddup2 (&actions, input_fd, STDIN_FILENO);
          if (!rc && input_fd != STDIN_FILENO)
            rc = posix_spawn_file_actions_addclose (&actions, input_fd);
        }
    }
  if (rc)
    goto done;

  for (;;)
    {
      for (*slot = 0; *slot < pids_alloc && pids[*slot]; ++*slot)
        ;
      set_slot_var (*slot);
      rc = bc_args_exceed_testing_limit (argv) ? E2BIG
           : posix_spawnp (child, argv[0], &actions, NULL, argv, environ);
      /* Startup deliberately removed this variable from the parent's env.
         Spawn consumes env before returning; no per-child slot leaks onward. */
      if (slot_var_name && unsetenv (slot_var_name) != 0)
        error (EXIT_FAILURE, errno,
               _("failed to remove environment variable %s"), slot_var_name);
      if (rc != EAGAIN || !procs_executing)
        break;
      wait_for_proc (false, 1u);
    }

done:
  if (input_fd >= 0)
    close (input_fd);
  posix_spawn_file_actions_destroy (&actions);
  return rc;
}
'''

XARGS_LAUNCH = r'''      unsigned int spawn_slot = 0;
      bool stdin_failed = false;
      int spawn_error = linuxonweb_spawn_xargs (&child, argv, &spawn_slot,
                                                &stdin_failed);
      if (stdin_failed)
        {
          child_error = XARGS_EXIT_CLIENT_EXIT_NONZERO;
          return 1;              /* setup failed; no command or child exists */
        }
      if (spawn_error == E2BIG)
        return 0;                /* unchanged buildcmd argument splitting */
      if (spawn_error)
        {
          error (0, spawn_error, "%s", argv[0]);
          if (spawn_error == EAGAIN || spawn_error == ENOMEM)
            exit (EXIT_FAILURE);
          exit (spawn_error == ENOENT ? XARGS_EXIT_COMMAND_NOT_FOUND
                                     : XARGS_EXIT_COMMAND_CANNOT_BE_RUN);
        }
      unsigned int actual_slot = add_proc (child);
      assert (actual_slot == spawn_slot);
'''


def conditional(target, original):
    return '#if ' + GUARD + '\n' + target + '#else\n' + original + '#endif\n'


def adapt_find(source):
    start = source.index('static bool\nprep_child_for_exec (')
    end = source.index('\n\nint\nlaunch (', start)
    old = source[start:end]
    source = source[:start] + conditional(FIND_HELPER, old + '\n') + source[end:]
    start = source.index('  child_pid = fork ();\n')
    end = source.index('\n  while (waitpid (child_pid,', start)
    old = source[start:end]
    source = source[:start] + conditional(FIND_LAUNCH, old + '\n') + source[end:]
    return source


def adapt_xargs(source):
    start = source.index('static void\nprep_child_for_exec (void)\n')
    end = source.index('\n\n/* Execute the command that has been built', start)
    old = source[start:end]
    source = source[:start] + conditional(XARGS_HELPER, old + '\n') + source[end:]
    old = '  int fd[2];\n  int buf;\n  size_t r;\n'
    if source.count(old) != 1:
        raise ValueError('xargs fork-pipe declarations changed')
    source = source.replace(old, '#if !(' + GUARD + ')\n' + old + '#endif\n')
    start = source.index('      if (pipe (fd))\n')
    end = source.index('      close (fd[0]);\n    }\n  return 1;', start) + len('      close (fd[0]);\n')
    old = source[start:end]
    source = source[:start] + conditional(XARGS_LAUNCH, old) + source[end:]
    # musl deliberately traps recursive exit(). The all=true caller is the
    # atexit handler, which already uses _exit() after all children are reaped.
    old = "      child_error = deferred_exit_status > child_error ? deferred_exit_status : child_error;\n      exit (child_error);\n"
    if source.count(old) != 1:
        raise ValueError('xargs deferred-exit anchor differs')
    target = ("      child_error = deferred_exit_status > child_error ? deferred_exit_status : child_error;\n"
              "      /* Return to wait_for_proc_all during atexit: it owns the final\n"
              "         _exit after reaping all children. Recursive exit traps in musl. */\n"
              "      if (!all)\n"
              "        exit (child_error);\n")
    source = source.replace(old, conditional(target, old))
    return source


def prepare(source_root, output):
    if output.exists() or output.is_symlink():
        raise ValueError('Use a fresh owned overlay output directory')
    output.mkdir(parents=True)
    patches = []
    files = []
    for name, expected in PINS.items():
        data = (source_root / name).read_bytes()
        if hashlib.sha256(data).hexdigest() != expected:
            raise ValueError('Upstream source differs: ' + name)
        original = data.decode()
        updated = adapt_find(original) if name == 'find/exec.c' else adapt_xargs(original)
        anchor = '#include <config.h>\n'
        if updated.count(anchor) != 1:
            raise ValueError('Configuration include anchor differs')
        updated = updated.replace(anchor, anchor + '#if ' + GUARD + '\n#include <spawn.h>\nextern char **environ;\n#endif\n')
        destination = output / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(updated)
        patches.append(''.join(difflib.unified_diff(original.splitlines(True), updated.splitlines(True),
                       fromfile='a/' + name, tofile='b/' + name)))
        files.append({'path': name, 'originalSha256': expected,
                      'patchedSha256': hashlib.sha256(updated.encode()).hexdigest()})
    (output / 'findutils-spawn.patch').write_text(''.join(patches))
    report = {'schema': 1, 'sourceVersion': 'findutils-4.10.0', 'targetGuard': GUARD,
              'files': files, 'mechanism': 'target musl posix_spawnp plus child file actions',
              'nativeBuildCompleted': False, 'runtimeAccepted': False,
              'requires': ['posix_spawnp with exec errno propagation',
                'posix_spawn_file_actions_addfchdir_np/addchdir_np/adddup2/addclose/addopen',
                'GNU waitpid and xargs scheduler with nonrecursive target atexit cleanup'],
              'acceptance': ['find -exec semicolon and plus success/failure',
                'find -execdir restores each child cwd and preserves parent cwd',
                'xargs quoting/null/batching/P2/P0/slot-var/stdin and tty cases',
                'xargs ENOENT127/EACCES126/E2BIG splitting/client1=>123/255=>124/signal=>125',
                'no residual child processes or leaked descriptors'],
              'limits': ['target spawn route does not run the optional child-only fd-leak diagnostic before exec',
                         'native guest acceptance required; a host build alone is insufficient']}
    (output / 'findutils-spawn-source.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-root', type=pathlib.Path, required=True)
    parser.add_argument('--output', type=pathlib.Path, required=True)
    args = parser.parse_args()
    prepare(args.source_root, args.output)
