#!/usr/bin/env python3
"""Classify retained failures without retrying or altering GNU compilation."""
import os,pathlib,json,subprocess,collections,hashlib
T=pathlib.Path(os.environ['GLIBC_TASK']);J=json.loads((T/'logs/object-inventory.json').read_text());rows=[]
for item in J['failedStages']:
 if item['origin']!='GNU lib object':continue
 x=dict(item);target=pathlib.Path(x['target']).relative_to(T/'objects/fullmake').as_posix();stage=x['inferredStage']
 if stage=='frontend':
  if '/source/generated/' in x['source']:category='unaudited generated syscall signature'
  elif target in ['nptl/pthread_cancel.o','nptl/pthread_create.o','nptl/pthread_exit.o']:category='GNU library-name header generation'
  elif target=='nptl/sem_post.o':category='scheduler header dependency'
  elif target=='debug/____longjmp_chk.o':category='checked jump architecture selection'
  elif target in ['io/fstatat64.o','misc/fxstat64.o']:category='kernel/public stat ABI selection'
  elif target in ['misc/mmap64.o','misc/mremap.o','misc/brk.o']:category='omitted kernel memory syscalls'
  else:category='floating point environment architecture'
 elif stage=='warning adapter':category='libio ELF global alias assembly'
 else:
  ir=subprocess.check_output([str(pathlib.Path(os.environ['GLIBC_TOOLCHAIN'])/'bin/llvm-dis'),x['retained']+'/opt.bc','-o','-']).decode()
  x['IREvidence']={'sha256':hashlib.sha256(ir.encode()).hexdigest(),'relevantLines':[l for l in ir.splitlines() if any(s in l for s in ['llvm.returnaddress','personality','landingpad','__syscall_cancel_arch_start','__syscall_cancel_arch_end'])]}
  if 'llvm.returnaddress' in ir:category='native return-address provenance'
  elif 'landingpad' in ir and '__gcc_personality_v0' in ir:category='C cleanup DWARF/native Wasm EH mismatch'
  elif target=='nptl/syscall_cancel.o':category='cancellable syscall instruction-range markers'
  else:raise RuntimeError('unclassified backend '+target)
 x.update(unit=target,primaryClass=category);rows.append(x)
counts=dict(sorted(collections.Counter(x['primaryClass'] for x in rows).items()));assert len(rows)==168
report={'status':'GNU make FAIL, failure inventory complete','counts':counts,'failedUnits':rows,'cascadingDiagnostics':['generated weak/internal alias declarations after an unaudited signature #error','FE_TONEAREST undeclared after missing architecture fenv definition','GNU parent subdir_lib and lib target propagation'], 'stageCaveat':'stage inferred from first missing intermediate; retained commands and IR pin actual attempts; backend diagnostics are in full make log','configureProbeFailuresSeparate':sum(x['origin']=='configure probe' for x in J['failedStages'])}
(T/'logs/primary-failures.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(counts))
