#!/usr/bin/env python3
import hashlib,json,subprocess,time
from pathlib import Path
root=Path(__file__).resolve().parents[2]/'web/linux/tests/guest-glremote'
records=[]
for stage in ('vert','frag'):
 source=root/('presentation.'+stage); output=source.with_suffix(source.suffix+'.spv'); start=time.time()
 subprocess.run(['glslangValidator','-V','--target-env','vulkan1.0',str(source),'-o',str(output)],check=True,timeout=30)
 subprocess.run(['spirv-val','--target-env','vulkan1.0',str(output)],check=True,timeout=30)
 records.append({'file':output.name,'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'sha256':hashlib.sha256(output.read_bytes()).hexdigest(),'bytes':output.stat().st_size,'seconds':time.time()-start})
(root/'presentation-fixtures.json').write_text(json.dumps({'pass':True,'files':records},indent=2)+'\n')
print(json.dumps(records))
