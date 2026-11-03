#!/usr/bin/env python3
"""Fetch pinned GNU release archives over official HTTPS and record exact bytes."""
import argparse,concurrent.futures,hashlib,json,pathlib,subprocess
sources=[('coreutils','9.11','tar.xz'),('wget','1.25.0','tar.gz'),('tar','1.35','tar.xz'),('gzip','1.14','tar.xz'),('findutils','4.10.0','tar.xz'),('grep','3.12','tar.xz'),('sed','4.10','tar.xz')]
q=argparse.ArgumentParser();q.add_argument('--out',type=pathlib.Path,required=True);a=q.parse_args();a.out.mkdir(parents=True,exist_ok=True)
def fetch(spec):
 name,version,suffix=spec;filename=name+'-'+version+'.'+suffix;url='https://ftp.gnu.org/gnu/'+name+'/'+filename;p=a.out/filename
 if not p.exists():
  tmp=p.with_suffix(p.suffix+'.partial');subprocess.run(['curl','-fLsS','--connect-timeout','15','--max-time','180','--retry','2','--retry-delay','2','-o',str(tmp),url],check=True);tmp.replace(p)
 return {'name':name,'version':version,'url':url,'archive':str(p),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'sourceVerification':'official HTTPS transport; exact downloaded hash recorded; no OpenPGP verification claimed'}
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:records=list(pool.map(fetch,sources))
(a.out/'gnu-sources.json').write_text(json.dumps(records,indent=2)+'\n');print(json.dumps(records))
