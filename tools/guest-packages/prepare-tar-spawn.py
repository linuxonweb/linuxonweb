#!/usr/bin/env python3
"""Prepare a source-pinned GNU tar local-file compressor spawn path.

The Linux/Wasm guest has genuine posix_spawn but no fork. Local regular archive
compression/decompression is implemented with native pipe/file actions; remote
rmt, special devices, decompression from stdin, backup mode and unrelated shell
hooks remain explicitly unsupported by this adapter. Uncompressed tar is unchanged.
"""
import argparse,difflib,hashlib,json,pathlib
PIN='505b0ff19bd12b372d966acc3df5107f311f70249964edb5ea40d31b57effa65'
GUARD='defined(__wasm32__) && defined(__linux__) && !defined(__wasi__)'
HELPER=r'''/* Native no-fork compression path for ordinary local archives. */
static pid_t
linuxonweb_spawn_filter (bool compress)
{
  int fds[2];
  int file_fd = -1;
  int rc;
  pid_t child = -1;
  const char *name = archive_name_array[0];
  bool file_owned = strcmp (name, "-") != 0;
  posix_spawn_file_actions_t actions;
  posix_spawnattr_t attr;
  sigset_t defaults;

  if (_remdev (name) || backup_option
      || (!compress && !strcmp (name, "-"))
      || (strcmp (name, "-") && !is_regular_file (name)))
    FATAL_ERROR ((0, ENOSYS,
                  "Linux/Wasm compressed archives require a local regular file (no remote/device/backup mode)"));
  /* Check the original stdout before pipe() can reuse a closed descriptor1. */
  if (!file_owned && fcntl (STDOUT_FILENO, F_GETFD) < 0)
    FATAL_ERROR ((0, errno, "compressed stdout is not open"));
  if (compress)
    signal (SIGPIPE, SIG_IGN);
  xpipe (fds);
  if (!strcmp (name, "-"))
    file_fd = STDOUT_FILENO;
  else
    file_fd = open (name, (compress ? O_WRONLY | O_CREAT | O_TRUNC : O_RDONLY)
                         | O_BINARY | O_CLOEXEC, MODE_RW);
  if (file_fd < 0)
    {
      rc = errno;
      close (fds[0]); close (fds[1]);
      errno = rc;
      open_fatal (name);
    }
  rc = posix_spawn_file_actions_init (&actions);
  if (rc)
    {
      close (fds[0]); close (fds[1]);
      if (file_owned) close (file_fd);
      FATAL_ERROR ((0, rc, "cannot initialize compressor file actions"));
    }
  rc = posix_spawnattr_init (&attr);
  if (rc)
    {
      posix_spawn_file_actions_destroy (&actions);
      close (fds[0]); close (fds[1]);
      if (file_owned) close (file_fd);
      FATAL_ERROR ((0, rc, "cannot initialize compressor spawn attributes"));
    }
  sigemptyset (&defaults);
  sigaddset (&defaults, SIGPIPE);
  rc = posix_spawnattr_setsigdefault (&attr, &defaults);
  if (!rc) rc = posix_spawnattr_setflags (&attr, POSIX_SPAWN_SETSIGDEF);
  if (!rc) rc = posix_spawn_file_actions_adddup2 (&actions,
                          compress ? fds[PREAD] : file_fd, STDIN_FILENO);
  if (!rc) rc = posix_spawn_file_actions_adddup2 (&actions,
                          compress ? file_fd : fds[PWRITE], STDOUT_FILENO);
  for (int i = 0; i != 2 && !rc; ++i)
    if (fds[i] != STDIN_FILENO && fds[i] != STDOUT_FILENO)
      rc = posix_spawn_file_actions_addclose (&actions, fds[i]);
  if (!rc && file_fd != STDIN_FILENO && file_fd != STDOUT_FILENO)
    rc = posix_spawn_file_actions_addclose (&actions, file_fd);

  if (!rc && compress)
    {
      char *argv[] = { (char *) "/bin/sh", (char *) "-c",
                      (char *) use_compress_program_option, NULL };
      rc = posix_spawn (&child, argv[0], &actions, &attr, argv, environ);
    }
  else if (!rc)
    {
      int i;
      const char *program;
      bool first = true;
      struct wordsplit ws;
      int flags = (WRDSF_DEFFLAGS | WRDSF_ENV | WRDSF_DOOFFS) & ~WRDSF_NOVAR;
      ws.ws_env = (const char **) environ;
      ws.ws_offs = 1;
      rc = ENOENT;
      for (program = first_decompress_program (&i); program;
           program = next_decompress_program (&i))
        {
          if (!first)
            WARNOPT (WARN_DECOMPRESS_PROGRAM,
                     (0, rc, "trying decompressor %s", program));
          if (wordsplit (program, &ws, flags))
            {
              rc = EINVAL;
              break;
            }
          flags |= WRDSF_REUSE;
          first = false;
          char **argv = xmalloc ((ws.ws_wordc + 2) * sizeof *argv);
          memcpy (argv, ws.ws_wordv + ws.ws_offs,
                  sizeof *argv * ws.ws_wordc);
          argv[ws.ws_wordc] = (char *) "-d";
          argv[ws.ws_wordc + 1] = NULL;
          rc = posix_spawnp (&child, argv[0], &actions, &attr, argv, environ);
          free (argv);
          if (!rc) break;
        }
      if (!first) wordsplit_free (&ws);
    }
  posix_spawn_file_actions_destroy (&actions);
  posix_spawnattr_destroy (&attr);
  if (file_owned) close (file_fd);
  if (rc)
    {
      close (fds[0]); close (fds[1]);
      FATAL_ERROR ((0, rc, "cannot spawn compression program"));
    }
  archive = compress ? fds[PWRITE] : fds[PREAD];
  close (compress ? fds[PREAD] : fds[PWRITE]);
  return child;
}
'''

def prepare(source_root,output):
 p=source_root/'src/system.c';data=p.read_bytes()
 if hashlib.sha256(data).hexdigest()!=PIN:raise ValueError('GNU tar1.35 source pin differs')
 if output.exists():raise ValueError('fresh output required')
 original=data.decode();updated=original
 include='#include <wordsplit.h>\n';assert updated.count(include)==1
 updated=updated.replace(include,include+'#if '+GUARD+'\n#include <spawn.h>\n#endif\n')
 anchor='/* Set ARCHIVE for writing, then compressing an archive.  */\n'
 assert updated.count(anchor)==2
 anchor_at=updated.rindex(anchor)
 updated=updated[:anchor_at]+'#if '+GUARD+'\n'+HELPER+'#endif\n\n'+updated[anchor_at:]
 for function,value,next_anchor in [('sys_child_open_for_compress','true','\nstatic void\nrun_decompress_program'),('sys_child_open_for_uncompress','false','\n/*')]:
  start=updated.index('pid_t\n'+function+' (void)\n{',updated.rindex(anchor) if value=='true' else updated.index('static void\nrun_decompress_program'))
  body_start=updated.index('{',start)+1
  # Find the matching function brace without depending on a nearby comment.
  # Pinned source only: raw brace count is safe here after locating exact boundaries.
  if value=='true': body_end=updated.index('\n}\n\nstatic void\nrun_decompress_program',body_start)
  else: body_end=updated.index('\n}\n',body_start)
  body=updated[body_start:body_end]
  updated=updated[:body_start]+'\n#if '+GUARD+'\n  return linuxonweb_spawn_filter ('+value+');\n#else'+body+'\n#endif'+updated[body_end:]
 output.mkdir(parents=True)
 (output/'src').mkdir();(output/'src/system.c').write_text(updated)
 patch=''.join(difflib.unified_diff(original.splitlines(True),updated.splitlines(True),fromfile='a/src/system.c',tofile='b/src/system.c'))
 (output/'tar-spawn.patch').write_text(patch)
 report={'sourceVersion':'tar-1.35','sourceSha256':PIN,'patchedSha256':hashlib.sha256(updated.encode()).hexdigest(),'mechanism':'native posix_spawn with pipe/fd and SIGPIPE file actions','nativeBuilt':False,'runtimeAccepted':False,'scope':['local regular-file compression','local regular-file decompression','compressed stdout creation'],'notSupported':['remote rmt','special archive devices','compressed stdin extraction','compressed backup mode','other fork-dependent tar command hooks'],'gates':['gzip compressed create/list/extract','content/mode/symlink roundtrip','corrupt/truncated gzip rejection','missing/failing compressor status','no owned child/fd leaks']}
 (output/'tar-spawn-source.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--source-root',type=pathlib.Path,required=True);p.add_argument('--output',type=pathlib.Path,required=True);a=p.parse_args();prepare(a.source_root,a.output)
