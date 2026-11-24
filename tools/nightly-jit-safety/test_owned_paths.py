#!/usr/bin/env python3
"""Owned path fault checks; no native process or guest is launched."""
import argparse
import json
import os
from pathlib import Path
import subprocess
from unittest.mock import patch
from owned_paths import BUILD_PARENTS, owned_directory, root_for_output, scoped_path, task_root

parser=argparse.ArgumentParser();parser.add_argument('--task-root',required=True);args=parser.parse_args()
root=task_root(args.task_root);directory=scoped_path(root,root/'python-path-tests',fresh=True);directory.mkdir(mode=0o700)
checks=[]
def good(name,fn):
    fn();checks.append(name)
def bad(name,fn):
    try:fn()
    except (ValueError,OSError):checks.append(name);return
    raise RuntimeError('unexpected acceptance: '+name)
good('explicit owned root',lambda:task_root(root))
good('fresh contained output',lambda:scoped_path(root,directory/'fresh',fresh=True))
good('root inference',lambda:root_for_output(directory/'fresh'))
bad('build parent is not a task',lambda:task_root(root.parent))
bad('nested task root refused',lambda:task_root(directory))
bad('root itself is not output',lambda:scoped_path(root,root,fresh=True))
bad('relative root refused',lambda:task_root(Path(os.path.relpath(root))))
bad('unknown root parent refused',lambda:task_root('/usr/example'))
bad('foreign actual UID directory refused',lambda:owned_directory('/usr'))
bad('sibling prefix refused',lambda:scoped_path(root,Path(str(root)+'-other')/'fresh',fresh=True))
bad('dotdot spelling refused',lambda:scoped_path(root,directory/'..'/'fresh',fresh=True))
bad('missing output parent refused',lambda:scoped_path(root,directory/'absent'/'fresh',fresh=True))
bad('existing directory refused',lambda:scoped_path(root,directory,fresh=True))
(directory/'file').write_text('retained')
bad('existing file refused',lambda:scoped_path(root,directory/'file',fresh=True))
(directory/'escape').symlink_to('/usr')
bad('symlink ancestor refused',lambda:scoped_path(root,directory/'escape'/'fresh',fresh=True))
(directory/'dangling').symlink_to(directory/'absent')
bad('dangling output symlink refused',lambda:scoped_path(root,directory/'dangling',fresh=True))
(directory/'alias').symlink_to(directory)
bad('same-root symlink alias refused',lambda:scoped_path(root,directory/'alias'/'fresh',fresh=True))
(directory/'writable').mkdir(mode=0o700);(directory/'writable').chmod(0o777)
bad('group/world writable ancestor refused',lambda:scoped_path(root,directory/'writable'/'fresh',fresh=True))
(directory/'writable').chmod(0o700)
bad('filesystem device mismatch refused',lambda:owned_directory(directory,directory.stat().st_dev+1))
for label,value in [('tmpfs','1021994'),('ramfs','858458f6')]:
    with patch('owned_paths.subprocess.check_output',return_value=value):bad(label+' refused',lambda:owned_directory(directory))
result=subprocess.run(['python3','-O','-c','import owned_paths'],cwd=Path(__file__).resolve().parent,capture_output=True,text=True,timeout=5)
if result.returncode==0 or 'native route requires Python assertions enabled' not in result.stderr:raise RuntimeError('optimized Python admitted')
checks.append('optimized Python refused')
if list(map(str,BUILD_PARENTS))!=['/mnt/p6/project/build','/mnt/p6/build','/mnt/p3/codex-build']:raise RuntimeError('parent compatibility changed')
checks.append('legacy parents retained')
report={'kind':'owned-route-python-host-checks-v1','pass':True,'count':len(checks),'checks':checks,'browserStarted':False,'guestAcceptance':False}
(directory/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
