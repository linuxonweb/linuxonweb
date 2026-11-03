#!/usr/bin/env python3
"""Fetch the repository's hash-locked Khronos loader plus same-revision X11 headers."""
import argparse,pathlib,json,hashlib,urllib.request,concurrent.futures,time
p=argparse.ArgumentParser();p.add_argument('--output',type=pathlib.Path,required=True);a=p.parse_args();a.output.mkdir(parents=True,exist_ok=False);root=pathlib.Path(__file__).resolve().parents[2];lock=json.loads((root/'web/linux/tests/guest-vulkan-loader/source-lock.json').read_text());files=list(lock['files']);start=time.time()
for name,sha in [('vulkan_xlib.h','e2efd24ada4479131f932dea1cd2f4dad9b3aad44aae60330fde9679a70f3d52'),('vulkan_xcb.h','972d6d7f2ff66bc3d8f627bd66cffcc75ba9fb1d16a7acec7fd9d93dd85c243c')]:
 files.append({'group':'headers-source','path':'include/vulkan/'+name,'sha256':sha,'url':'https://raw.githubusercontent.com/KhronosGroup/Vulkan-Headers/'+lock['headersCommit']+'/include/vulkan/'+name})
def fetch(entry):
 path=pathlib.Path(entry['path']);assert not path.is_absolute() and '..' not in path.parts;assert entry['url'].startswith('https://raw.githubusercontent.com/KhronosGroup/')
 with urllib.request.urlopen(entry['url'],timeout=25) as response:data=response.read(8*1024*1024+1)
 if len(data)>8*1024*1024 or hashlib.sha256(data).hexdigest()!=entry['sha256'] or ('bytes' in entry and len(data)!=entry['bytes']):raise ValueError('pinned input mismatch: '+entry['path'])
 target=a.output/entry['group']/path;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data);return {**entry,'bytes':len(data)}
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:checked=list(pool.map(fetch,files))
report={'loaderCommit':lock['loaderCommit'],'headersCommit':lock['headersCommit'],'files':checked,'seconds':time.time()-start};(a.output/'source-lock.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'files':len(checked),'bytes':sum(x['bytes'] for x in checked),'seconds':report['seconds']}))
