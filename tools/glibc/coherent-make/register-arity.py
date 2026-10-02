#!/usr/bin/env python3
"""Retain run1 and register two genuine C providers omitted by source selection."""
import hashlib,json,os,pathlib
T=pathlib.Path(os.environ['GLIBC_TASK']).resolve()
R=pathlib.Path(__file__).resolve().parent
A=T/'source/glibc-2.44/sysdeps/unix/sysv/linux/wasm32'
destination=T/'logs/provider-selection-run2.json'
assert not destination.exists(), 'preserve previous source-selection proof'
old='override compile-syscall = $(PYTHON) '+str(R/'compile-syscall.py')+' $(COMPILE.c) -o $@ $(compile-mkdep-flags)\n\nifeq ($(subdir),misc)\nsysdep_routines += wasm-memory-authority\nendif\n'
new=old.replace('sysdep_routines += wasm-memory-authority\n', '# GNU suppresses generated extras when these architecture C sources exist.\nsysdep_routines += wasm-memory-authority init_module delete_module\n')
assert (A/'Makefile').read_text()==old
initial=json.loads((T/'logs/coherent-final-overlay.json').read_text())
assert initial['pass']
def digest(p):return {'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
for name,h in initial['architectureFiles'].items():assert digest(pathlib.Path(name))==h
before=T/'source-snapshots/provider-selection-run2'
before.mkdir()
for p in [A/'Makefile',T/'logs/coherent-final-overlay.json']:
 (before/p.name).write_bytes(p.read_bytes())
(A/'Makefile').write_text(new)
destination.write_text(json.dumps({'pass':True,'scope':'register genuine unchanged architecture C providers; no target outputs copied','previousMakefile':str(before/'Makefile'),'previousMakefileHash':digest(before/'Makefile'),'currentMakefile':str(A/'Makefile'),'currentMakefileHash':digest(A/'Makefile'),'registeredRoutines':['init_module','delete_module'],'providerSources':{str(A/(n+'.c')):digest(A/(n+'.c')) for n in ['init_module','delete_module']},'previousOverlayProof':str(before/'coherent-final-overlay.json'),'previousOverlayProofHash':digest(before/'coherent-final-overlay.json'),'architectureFiles':{str(p):digest(p) for p in A.rglob('*') if p.is_file()}},indent=2)+'\n')
