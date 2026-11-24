#!/usr/bin/env python3
"""Sanitized host-only array JIT check. Invoke inside unchanged bounded.py."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output',type=Path,required=True)
a=parser.parse_args()
out=a.output.resolve()
out.mkdir(parents=True,exist_ok=False)
for name in ('tmp','cache','fixtures'):(out/name).mkdir()
assets=['tools/pbl-jit/PblJit.cpp','tools/pbl-jit/PblCacheObserve.h']+[
    'tools/pbl-jit/host-test/'+name for name in ('mock.h','emit.cpp','nested-fixtures.h','array-fixtures.h','run.mjs','run-nested.mjs','run-array.mjs','check-array.py')]+[
    'tools/guest-rootfs/firefox-gpu-check/gpu-check.html','tools/guest-packages/bounded.py']
def pins():
    return [{'path':p,'bytes':Path(p).stat().st_size,'sha256':hashlib.sha256(Path(p).read_bytes()).hexdigest()} for p in assets]
def utc():return datetime.datetime.now(datetime.timezone.utc).isoformat()
report={'pass':False,'startedUtc':utc(),'inputs':pins(),'commands':[], 'testResults':{},
        'hostEvidenceOnly':True,'nativeFirefoxAcceptance':False,'performanceClaim':False}
env=os.environ.copy()
env.pop('PBL_ARRAY_CASE',None)
env.update({key:str(out/'tmp')for key in ('TMPDIR','TMP','TEMP')})
env.update(XDG_CACHE_HOME=str(out/'cache'),XDG_CONFIG_HOME=str(out/'cache'),
           ASAN_OPTIONS='detect_leaks=1:abort_on_error=1',
           UBSAN_OPTIONS='halt_on_error=1:print_stacktrace=1')
report['environment']={key:env[key]for key in ('TMPDIR','TMP','TEMP','XDG_CACHE_HOME','XDG_CONFIG_HOME','ASAN_OPTIONS','UBSAN_OPTIONS')}
commands=[('compile',['c++','-std=c++17','-O1','-g','-fsanitize=address,undefined','-fno-omit-frame-pointer',
                      'tools/pbl-jit/host-test/emit.cpp','-o',str(out/'emit')],100),
          ('emit',[str(out/'emit'),str(out/'fixtures')],20)]+[
              (name,['node','tools/pbl-jit/host-test/'+filename,str(out/'fixtures')],20)
              for name,filename in [('baseline','run.mjs'),('nested','run-nested.mjs'),('array','run-array.mjs')]]
try:
    for name,cmd,seconds in commands:
        start=time.monotonic();row={'name':name,'argv':cmd,'startedUtc':utc(),'timeoutSeconds':seconds}
        report['commands'].append(row)
        try:
            result=subprocess.run(cmd,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=seconds)
        except subprocess.TimeoutExpired as error:
            row.update(exitCode=None,timedOut=True,durationSeconds=round(time.monotonic()-start,6),finishedUtc=utc())
            for stream in ('stdout','stderr'):
                data=getattr(error,stream) or b''
                if isinstance(data,str):data=data.encode()
                (out/(name+'.'+stream)).write_bytes(data)
                row[stream+'Bytes']=len(data)
            raise
        row.update(exitCode=result.returncode,durationSeconds=round(time.monotonic()-start,6),finishedUtc=utc())
        for stream in ('stdout','stderr'):
            (out/(name+'.'+stream)).write_bytes(getattr(result,stream))
            row[stream+'Bytes']=len(getattr(result,stream))
        print(json.dumps(row),flush=True)
        if result.returncode:raise ValueError('command failed: '+name)
        if name in ('compile','emit') and result.stderr:raise ValueError('unexpected compiler/sanitizer stderr: '+name)
        if name not in ('compile','emit'):
            result_json=json.loads(result.stdout.decode().splitlines()[-1])
            report['testResults'][name]=result_json
            if name=='array' and (result_json.get('completeSuite') is not True or result_json.get('cases')!=87):
                raise ValueError('array runner did not execute its complete contract')
            if result_json.get('pass') is not True or result_json.get('failures')!=0 or not result_json.get('checks'):
                raise ValueError('runner did not pass: '+name)
    if report['inputs']!=pins():raise ValueError('source changed during validation')
    report['pass']=True
except (OSError,ValueError,subprocess.SubprocessError) as error:
    report['error']=str(error)
finally:
    report['finishedUtc']=utc()
    (out/'result.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'pass':report['pass'],'testResults':report['testResults'],'error':report.get('error')}))
raise SystemExit(0 if report['pass'] else 1)
