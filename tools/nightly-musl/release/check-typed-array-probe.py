#!/usr/bin/env python3
"""Check actual typed-array probe records; timing is retained, never presumed fast."""
import argparse,hashlib,json,math
from pathlib import Path
SPEC='typed-array-ic-probe-v1'
SEMANTICS={**{'number-'+n:582 for n in ['Int8','Uint8','Int16','Uint16','Int32','Uint32','Float32','Float64','Uint8Clamped']},'bigint-BigInt64':535,'bigint-BigUint64':535,'resize-and-detach':1038}
THROUGHPUT={'Uint8-read':58490880,'Uint32-read':58490880,'Uint8-write':378,'Uint32-write':430458}
def require(value,message):
 if not value:raise ValueError(message)
def finite(value,minimum=0):return type(value)in [int,float] and math.isfinite(value) and value>=minimum

def evaluate(raw,label):
 rows=[]
 for line in raw.decode('utf-8',errors='strict').splitlines():
  if line.startswith('console.log: '):
   try:line=json.loads(line[len('console.log: '):])
   except ValueError:continue
  if isinstance(line,str) and line.startswith('PBL_TYPED_ARRAY '):rows.append(json.loads(line[len('PBL_TYPED_ARRAY '):]))
 require(len(rows)==18,'Expected exact start,12semantic,4throughput,done records')
 require(all(type(r)is dict and r.get('spec')==SPEC and r.get('label')==label for r in rows),'Unrelated or malformed probe identity')
 require([r.get('event') for r in rows]==['start']+['semantic']*12+['throughput']*4+['done'],'Probe incomplete or reordered')
 start,done=rows[0],rows[-1]
 require('Firefox/' in start.get('userAgent',''),'Actual Firefox user agent missing')
 require(type(start.get('hardwareConcurrency'))is int and start['hardwareConcurrency']>0,'Actual Firefox CPU observation missing')
 require({k:start.get(k) for k in ['wallLimitMs','chunk','samples','chunksPerSample']}==dict(wallLimitMs=120000,chunk=16384,samples=7,chunksPerSample=4),'Fixed workload changed')
 require({r.get('name'):r.get('assertions') for r in rows[1:13]}==SEMANTICS,'Typed-array semantic inventory/assertions differ')
 require(done.get('ok')is True and done.get('assertions')==9514 and finite(done.get('elapsedMs'),.001) and done['elapsedMs']<120000,'Complete bounded9514-assertion pass required')
 timing=[]
 require([r.get('name') for r in rows[13:17]]==list(THROUGHPUT),'Fixed throughput inventory differs')
 for row in rows[13:17]:
  require(row.get('operations')==458752 and row.get('checksum')==THROUGHPUT[row['name']],'Fixed throughput work/checksum differs')
  samples=row.get('samplesMs')
  require(type(samples)is list and len(samples)==7 and all(finite(v) for v in samples),'Seven actual finite samples required')
  active=row.get('activeMs');wall=row.get('wallMs')
  require(finite(active,.001) and finite(wall,.001) and abs(active-sum(samples))<.000001 and wall+.001>=active,'Active/wall timing inconsistent')
  timing.append(dict(name=row['name'],operations=row['operations'],samplesMs=samples,medianSampleMs=sorted(samples)[3],activeMs=active,wallMs=wall,operationsPerActiveSecond=row['operations']*1000/active))
 return dict(rawSemanticPredicatePass=True,assertions=9514,semanticGroups=12,hardwareConcurrency=start['hardwareConcurrency'],throughput=timing,elapsedMs=done['elapsedMs'],runtimeAcceptance=False,performanceAcceptance=False,fullJITAcceptance=False,trustBoundary='These predicates inspect retained rawrecords. Caller must separately bind actual guest capture, native/archive/source hashes, CPU lane, environment, and natural completion; compare same fixed work across controlled runs.')

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--raw',type=Path,required=True);p.add_argument('--label',required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args()
 raw=a.raw.read_bytes();require(len(raw)<2*1024**2,'Capture must be bounded')
 try:result=evaluate(raw,a.label)
 except (ValueError,KeyError,TypeError,UnicodeError) as error:result=dict(rawSemanticPredicatePass=False,errors=[str(error)],runtimeAcceptance=False,performanceAcceptance=False)
 result['rawSHA256']=hashlib.sha256(raw).hexdigest();a.out.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result));raise SystemExit(0 if result['rawSemanticPredicatePass'] else 1)
if __name__=='__main__':main()
