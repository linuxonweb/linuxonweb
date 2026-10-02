#!/usr/bin/env python3
"""Adapter boundaries and actual GNU Makerules marker classification."""
import os,pathlib,subprocess,json,re,hashlib
t=pathlib.Path(os.environ['GLIBC_TASK']);tool=pathlib.Path(os.environ['GLIBC_TOOLCHAIN'])/'bin';src=t/'source/glibc-2.44'
out=t/'objects/metadata-tests';out.mkdir()
proofs=list((t/'logs/warning-units').rglob('front.ll'))
originals=[p.read_text() for p in proofs if '@__evoke_link_warning_revoke' in p.read_text()]
assert originals
original=originals[-1];results=[]
def run(name,text,expected):
 p=out/(name+'.ll');p.write_text(text);dest=out/(name+'.bc')
 command=[str(t/'objects/warnings'),str(p),str(dest)]
 r=subprocess.run(command,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 (out/(name+'.log')).write_bytes(r.stdout+r.stderr)
 assert r.returncode==expected,(name,r.returncode)
 results.append({'name':name,'command':command,'exit':r.returncode})
run('unknown-asm',original+'\nmodule asm "nop"\n',3)
run('missing-warning-text',re.sub(r'^module asm.*warning.revoke.*\n','',original,flags=re.M),3)
run('runtime-marker-use',original+'\ndefine ptr @escape_marker() { ret ptr @__evoke_link_warning_revoke }\n',3)
kept=original.replace('@llvm.used = appending global [1 x ptr] [ptr @__evoke_link_warning_revoke]', '@keep = internal constant i32 42\n@llvm.used = appending global [2 x ptr] [ptr @__evoke_link_warning_revoke, ptr @keep]')
assert kept!=original
run('preserve-unrelated-used',kept,0)
subprocess.run([str(tool/'llvm-dis'),str(out/'preserve-unrelated-used.bc'),'-o',str(out/'preserve-unrelated-used-result.ll')],check=True)
assert '@llvm.used = appending global [1 x ptr] [ptr @keep]' in (out/'preserve-unrelated-used-result.ll').read_text()
# dlmopen frontend and metadata adapter succeeded, but its runtime functions
# fail llc on genuine return-address operations. Inspect a METADATA-ONLY
# object to prove warning bytes/class without claiming compiled dlmopen code.
failed=[]
for p in (t/'tmp').glob('fullmake-cc-*/front.ll'):
 if 'warning.dlmopen' in p.read_text():failed.append(p)
assert len(failed)==1
front=failed[0];subprocess.run([str(tool/'llvm-dis'),str(front.parent/'warnings.bc'),'-o',str(out/'dlmopen-translated.ll')],check=True)
ir=(out/'dlmopen-translated.ll').read_text()
metadata='target triple = "wasm32-unknown-linux-gnu"\n'+ '\n'.join(x for x in ir.splitlines() if x.startswith('!'))+'\n'
(out/'dlmopen-metadata-only.ll').write_text(metadata)
subprocess.run([str(tool/'llc'),'-filetype=obj',str(out/'dlmopen-metadata-only.ll'),'-o',str(out/'dlmopen-metadata-only.o')],check=True)
sections=subprocess.check_output([str(tool/'llvm-objdump'),'-h',str(out/'dlmopen-metadata-only.o')]).decode()
(out/'dlmopen-metadata-only-sections.txt').write_text(sections)
assert '.gnu.warning.dlmopen' in sections and '.gnu.glibc-stub.' not in sections
# Invoke the original selected GNU Makerules recipe. Only dependency list is
# restricted to audited objects; parser/source/configuration remain GNU's.
target=t/'objects/fullmake/misc/stubs';target.parent.mkdir(exist_ok=True)
if target.exists():target.unlink()
objects=[t/'objects/guest/warning-revoke.o',t/'objects/guest/warning-sigstack.o',t/'objects/guest/warning-sigreturn.o',out/'dlmopen-metadata-only.o']
command=['make','-C',str(src/'misc'),'objdir='+str(t/'objects/fullmake'),str(target),'objs-for-stubs='+' '.join(map(str,objects))]
r=subprocess.run(command,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
(out/'makerules.log').write_bytes(r.stdout);assert r.returncode==0
assert set(target.read_text().splitlines())=={'#define __stub_revoke','#define __stub_sigreturn'}
(t/'logs/metadata-tests.json').write_text(json.dumps({'pass':True,'boundaries':results,'makerulesCommand':command,'GNUstubHeader':target.read_text(),'dlmopenObject':'metadata-only, no runtime functions; full compile remains FAIL','LLVMusedPreserved':True},indent=2)+'\n')
