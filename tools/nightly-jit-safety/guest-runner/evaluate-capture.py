#!/usr/bin/env python3
"""Run existing session predicates on real captured bytes, without review claims."""
import hashlib,importlib.util,json,pathlib,sys
sys.dont_write_bytecode=True
HERE=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('session_checker',HERE/'safety/check-session.py');checker=importlib.util.module_from_spec(spec);spec.loader.exec_module(checker)
def main():
 capture=json.loads(pathlib.Path(sys.argv[1]).read_text());artifacts=capture['artifacts'];blobs={}
 for role,row in artifacts.items():
  path=pathlib.Path(row['path']);assert path.is_absolute() and path.stat().st_size<=checker.LIMIT
  raw=path.read_bytes();assert hashlib.sha256(raw).hexdigest()==row['sha256'];blobs[role]=raw
 contract=json.loads(blobs['contract']);binding=json.loads(blobs['binding'])
 assert hashlib.sha256(blobs['binding']).hexdigest()==contract['buildBindingSHA256']
 for name,want in {**contract['files'],**contract['fixtureContract']['files']}.items():
  assert hashlib.sha256(blobs['file:'+name]).hexdigest()==want
 result=checker.evaluate(contract,json.loads(blobs['result']),binding,json.loads(blobs['cpu']),blobs['startup'],blobs['combined'],blobs['observer'],{scope:blobs.get(scope,b'') for scope in checker.SCOPES})
 output={'kind':'actual-unreviewed-broad-session-predicates-v1','pass':False,'predicatesPass':result['pass'],'independentAcquisitionReviewPending':True,'sessionPredicates':result,'guestAcceptance':False,'jitAcceptance':False,'gpuAcceptance':False}
 pathlib.Path(sys.argv[2]).write_text(json.dumps(output,indent=2)+'\n');print(json.dumps(output));raise SystemExit(0 if result['pass'] else 1)
if __name__=='__main__':main()
