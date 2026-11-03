#!/usr/bin/env python3
"""Resumable, bounded FileHarbor folder uploads. Tokens stay in private state."""
import argparse,atexit,concurrent.futures,datetime,hashlib,json,os,pathlib,subprocess,tempfile,time
HTTP_STATS={"calls":0,"activeSecondsSum":0.0}
RUN_STATE=None
RUN_START=time.monotonic()
def record_run():
 if RUN_STATE is not None:
  with (RUN_STATE/"transfer-runs.jsonl").open("a") as f:f.write(json.dumps({"finishedAt":datetime.datetime.now(datetime.timezone.utc).isoformat(),"runWallSeconds":round(time.monotonic()-RUN_START,3),"httpRequestCount":HTTP_STATS["calls"],"activeHttpSecondsSum":round(HTTP_STATS["activeSecondsSum"],3),"pauseRequested":(RUN_STATE/"PAUSE").exists(),"pausePolicy":"finish current part request, then exit and resume from server state; no SIGSTOP"})+"\n")
atexit.register(record_run)
BASE='https://fileharbor-meak.basicgleam65.chatgpt.site'
def sha(path):
 h=hashlib.sha256()
 with path.open('rb') as f:
  for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
 return h.hexdigest()
def save(path,data):
 tmp=path.with_suffix('.tmp');tmp.write_text(json.dumps(data,indent=2)+'\n');tmp.chmod(0o600);tmp.replace(path)
def request(state,path,method='GET',payload=None,headers=None,raw=None):
 with tempfile.TemporaryDirectory(prefix='request-',dir=state) as d:
  d=pathlib.Path(d);hf=d/'headers';all_headers=dict(headers or {})
  if payload is not None:all_headers['Content-Type']='application/json';raw=json.dumps(payload).encode()
  hf.write_text(''.join(k+': '+v+'\n' for k,v in all_headers.items()));hf.chmod(0o600)
  cmd=['curl','--silent','--show-error','--max-time','180','--connect-timeout','20','--request',method,'--header','@'+str(hf),'--write-out','\n%{http_code}',BASE+path]
  if raw is not None:
   body=d/'body';body.write_bytes(raw);body.chmod(0o600);cmd+=['--data-binary','@'+str(body)]
  for attempt in range(4):
   started=time.monotonic();r=subprocess.run(cmd,stdout=subprocess.PIPE,stderr=subprocess.PIPE);HTTP_STATS["calls"]+=1;HTTP_STATS["activeSecondsSum"]+=time.monotonic()-started
   data,sep,status=r.stdout.rpartition(b'\n');code=int(status) if sep and status.isdigit() else 0
   if r.returncode==0 and 200<=code<300:
    return json.loads(data) if data else None
   if attempt<3 and (code in (0,408,429,500,502,503,504) or (code==409 and b'UPLOAD_BUSY' in data)):
    time.sleep([2,5,10][attempt]);continue
   raise RuntimeError(f'{method} {path}: HTTP {code}, curl status {r.returncode}; response withheld to protect tokens')
def main():
 global RUN_STATE
 q=argparse.ArgumentParser();q.add_argument('--root',type=pathlib.Path,required=True);q.add_argument('--state',type=pathlib.Path,required=True);q.add_argument('--username',required=True);q.add_argument('--name',required=True);q.add_argument('--parallel',type=int,choices=(1,2,3,4),default=2);a=q.parse_args();root=a.root.resolve();state=a.state.resolve();state.mkdir(parents=True,exist_ok=True);state.chmod(0o700);RUN_STATE=state
 paths=sorted(p for p in root.rglob('*') if p.is_file())
 if not 1<=len(paths)<=100:raise ValueError('FileHarbor requires 1..100 files')
 for p in paths:
  if p.is_symlink() or root not in p.resolve().parents or p.stat().st_size>100000000:raise ValueError('unsafe member or file exceeds 100 MB')
 manifest=[{'path':p.relative_to(root).as_posix(),'size':p.stat().st_size,'sha256':sha(p)} for p in paths]
 identity={'username':a.username,'name':a.name,'files':manifest};identity_hash=hashlib.sha256(json.dumps(identity,sort_keys=True).encode()).hexdigest();sf=state/'resume.json'
 if sf.exists():
  resume=json.loads(sf.read_text())
  if resume['identityHash']!=identity_hash:raise ValueError('resume manifest changed')
 else:
  folder=request(state,'/api/folders','POST',{'username':a.username,'name':a.name,'files':[{'path':f['path'],'size':f['size']} for f in manifest]})
  resume={'identityHash':identity_hash,'folder':folder,'completed':{},'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()};save(sf,resume)
 folder=resume['folder'];fh={'X-Folder-Token':folder['token']};fp='/api/folders/'+folder['folderId']
 def transfer(f,p):
  if (state/"PAUSE").exists():raise RuntimeError("pause requested at complete-part boundary")
  session=request(state,fp+'/uploads','POST',{'path':f['path']},fh)
  if session.get('completed'):file=session['file']
  else:
   up='/api/uploads/'+session['uploadId'];uh={'X-Upload-Token':session['token']}
   if session.get('status')!='assembled':
    remote=request(state,up,headers=uh)
    have={int(part['partNumber']):int(part['size']) for part in remote.get('uploadedParts',[])}
    with p.open('rb') as src:
     for part in range(1,session['totalParts']+1):
      if (state/"PAUSE").exists():raise RuntimeError("pause requested at complete-part boundary")
      expected=min(session['partSize'],f['size']-(part-1)*session['partSize'])
      if have.get(part)==expected:src.seek(expected,1);continue
      data=src.read(expected);request(state,up+'/parts/'+str(part),'PUT',headers={**uh,'Content-Type':'application/octet-stream'},raw=data)
   completed=request(state,up+'/complete','POST',headers=uh);file=completed['file']
  server_sha=file.get('sha256') or file.get('sha256Hex');server_size=file.get('size') if file.get('size') is not None else file.get('sizeBytes')
  if server_sha!=f['sha256'] or server_size!=f['size']:raise RuntimeError('server checksum/size mismatch for '+f['path'])
  return f,{'sha256':server_sha,'size':server_size}
 with concurrent.futures.ThreadPoolExecutor(max_workers=a.parallel) as pool:
  pending=[pool.submit(transfer,f,p) for f,p in zip(manifest,paths) if f['path'] not in resume['completed']]
  failures=[]
  for future in concurrent.futures.as_completed(pending):
   try:f,verified=future.result()
   except Exception as error:
    failures.append(str(error));print(json.dumps({'memberError':str(error),'resumable':True}),flush=True);continue
   resume['completed'][f['path']]=verified;save(sf,resume)
   print(json.dumps({'file':f['path'],'bytes':f['size'],'verified':True,'completed':len(resume['completed']),'total':len(paths),'at':datetime.datetime.now(datetime.timezone.utc).isoformat()}),flush=True)
 if failures:raise RuntimeError(str(len(failures))+' member transfers failed; successful members preserved in resume state')
 published=request(state,fp+'/complete','POST',headers=fh)
 receipt={'folderId':published['folderId'],'baseUrl':published['baseUrl'],'entryUrl':published.get('entryUrl'),'files':published['files'],'startedAt':resume['startedAt'],'finishedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'localManifest':manifest,'allServerHashesMatch':True}
 save(state/'publication.json',receipt);print(json.dumps({'published':True,'baseUrl':receipt['baseUrl'],'files':len(paths),'allServerHashesMatch':True}),flush=True)
if __name__=='__main__':main()
