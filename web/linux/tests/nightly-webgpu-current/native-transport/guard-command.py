#!/usr/bin/env python3
"""Record actual compiler/validator inheritance before replacing this process."""
import json,os,resource,sys
from pathlib import Path
name=sys.argv[1];assert name.replace('-','').isalnum()
Path('/proc/self/oom_score_adj').write_text('1000')
row={'pid':os.getpid(),'pgid':os.getpgrp(),'oomScoreAdj':int(Path('/proc/self/oom_score_adj').read_text()),'addressSpaceBytes':resource.getrlimit(resource.RLIMIT_AS),'coreBytes':resource.getrlimit(resource.RLIMIT_CORE),'affinity':sorted(os.sched_getaffinity(0)),'argv':sys.argv[2:]}
assert row['oomScoreAdj']==1000 and row['addressSpaceBytes']==(16*1024**3,16*1024**3) and row['coreBytes']==(0,0)
Path('/mnt/p6/project/build/nightly-current-native-gpu-transport-20261003',name+'-inheritance.json').write_text(json.dumps(row,indent=2)+'\n')
os.execvp(sys.argv[2],sys.argv[2:])
