#!/usr/bin/env python3
"""Fetch only the immutable source-lock closure to a fresh disk-backed directory."""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import urllib.request
sys.dont_write_bytecode=True
from storage import checked_storage

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    out,storage=checked_storage(args.output);out.mkdir(parents=True,exist_ok=False)
    lock=json.loads(Path(__file__).with_name('source-lock.json').read_text())
    audit={'pass':False,'storage':storage,'files':[]}
    try:
        for entry in lock['files']:
            group=entry['group'];repo={'loader-source':'Vulkan-Loader','headers-source':'Vulkan-Headers'}[group]
            commit=lock['loaderCommit' if group=='loader-source' else 'headersCommit']
            expected='https://raw.githubusercontent.com/KhronosGroup/'+repo+'/'+commit+'/'+entry['path']
            if entry['url']!=expected or Path(entry['path']).is_absolute() or '..' in Path(entry['path']).parts:
                raise ValueError('unsafe/unpinned source URL')
            target=out/group/entry['path'];target.parent.mkdir(parents=True,exist_ok=True)
            request=urllib.request.Request(expected,headers={'User-Agent':'linuxonweb-static-vulkan-source-audit'})
            with urllib.request.urlopen(request,timeout=30) as response:
                if response.status!=200 or response.url!=expected: raise ValueError('unexpected response')
                data=response.read(entry['bytes']+1)
            # Retain failed bytes at their exact path for audit; never use before verification.
            target.write_bytes(data)
            actual=hashlib.sha256(data).hexdigest()
            audit['files'].append({'url':expected,'bytes':len(data),'sha256':actual})
            if len(data)!=entry['bytes'] or actual!=entry['sha256']: raise ValueError('pinned bytes differ: '+entry['path'])
        audit['pass']=True
    except Exception as error:
        audit['error']=str(error);raise
    finally:
        (out/'fetch.json').write_text(json.dumps(audit,indent=2)+'\n')
    print(json.dumps({'pass':True,'files':len(audit['files']),'output':str(out)}))

if __name__=='__main__':main()
