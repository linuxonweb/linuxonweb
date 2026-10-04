from pathlib import Path
import sys,json,hashlib,shlex
T=Path('/mnt/p6/project/build/nightly-current-rust-gpu-smoke-20261003')
ROOT=Path('/mnt/p6/project/linux/linuxonweb')
sys.dont_write_bytecode=True
sys.path.insert(0,str(ROOT/'web/linux/tests/guest-vulkan-graphics'))
from package import records,record
def pin(p):
    return {'path':str(p.resolve()),'bytes':p.stat().st_size,'sha256':hashlib.file_digest(p.open('rb'),'sha256').hexdigest()}
old=T/'attempt1-freeze/package/initramfs.cpio'
raw=old.read_bytes();rows=list(records(raw));chunks=[];changed=[]
for key,header,name,body,encoded in rows:
    if key=='bin/current-gpu-native':
        chunks.append(record(header,name,(T/'guest.wasm').read_bytes()));changed.append(key)
    else:chunks.append(encoded)
assert changed==['bin/current-gpu-native']
archive=b''.join(chunks)+raw[sum(len(r[4])for r in rows):]
before={r[0]:r[4]for r in rows};after={r[0]:r[4]for r in records(archive)}
assert set(before)==set(after) and [k for k in before if before[k]!=after[k]]==changed
(T/'package/initramfs.cpio').write_bytes(archive)
metadata=json.loads((T/'attempt1-freeze/package/package.json').read_text())
metadata['bytes']=len(archive);metadata['archiveSha256']=hashlib.sha256(archive).hexdigest()
metadata['inputs']=[pin(T/n)for n in ['guest.cpp','guest.o','guest-raw.wasm','guest.wasm','input-copies.json','compile-plan-native.json','abi-inspection2/result.json','refresh-package.py']]
metadata['retryDelta']={'base':pin(old),'changedRecord':changed,'reason':'allow actual privacy-reduced empty adapter name; real limits/ID/callback checks retained'}
(T/'package/package.json').write_text(json.dumps(metadata,indent=2)+'\n')
dependencyText=(T/'guest.d').read_text().replace('\\\n',' ')
dependencies=[pin(Path(p))for p in sorted(set(shlex.split(dependencyText.split(':',1)[1])))]
(T/'compile-dependencies2.json').write_text(json.dumps(dependencies,indent=2)+'\n')
(T/'native-final.json').write_text(json.dumps({'artifacts':[pin(T/n)for n in ['guest.cpp','guest.o','guest-raw.wasm','guest.wasm']],'package':pin(T/'package/package.json'),'guestExecuted':False,'firefoxGpuAcceptance':False},indent=2)+'\n')
files=[T/n for n in ['run-guest.mjs','browser-session.mjs','guest.html','owner.mjs','run-guest-bounded.py','package/package.json','native-final.json','guest.cpp','refresh-package.py']]
(T/'guest-prelaunch.json').write_text(json.dumps({'sources':[pin(p)for p in files],'scope':'standalone actual current Rust client; no Firefox','releaseAcceptance':False,'simpleVulkanBenchmarkPrerequisite':'passed18.1778xmatchedreadbacks'},indent=2)+'\n')
print(json.dumps({'package':pin(T/'package/package.json'),'guest':pin(T/'guest.wasm'),'changedRecords':changed}))
