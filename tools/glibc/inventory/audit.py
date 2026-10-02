#!/usr/bin/env python3
"""Pin attempted commands, retained stage failures and real Wasm object outputs."""
import os,pathlib,json,hashlib,re,shlex,shutil
t=pathlib.Path(os.environ['GLIBC_TASK']);src=t/'source/glibc-2.44';obj=t/'objects/fullmake'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
def valid(p):
 b=p.read_bytes()
 if len(b)<=8 or b[:8]!=b'\0asm\1\0\0\0':return False
 i=8
 while i<len(b):
  i+=1;size=shift=0
  while True:
   if i>=len(b) or shift>35:return False
   c=b[i];i+=1;size|=(c&127)<<shift
   if not c&128:break
   shift+=7
  i+=size
  if i>len(b):return False
 return i==len(b)
log=(t/'logs/fullmake-inventory.log').read_text();attempts={}
for line in log.splitlines():
 if not line.startswith(str(pathlib.Path(os.environ['PORT_ROOT'])/'fullmake/compiler.py')+' '):continue
 try:argv=shlex.split(line);output=pathlib.Path(argv[argv.index('-o')+1])
 except (ValueError,IndexError):continue
 if output.suffix=='.o' and output.is_relative_to(obj):attempts.setdefault(str(output),[]).append({'argv':argv,'kind':'GNU make command log'})
for p in (t/'logs').glob('generated-*-command.json'):
 j=json.loads(p.read_text());argv=j['command'];output=pathlib.Path(argv[argv.index('-o')+1])
 attempts.setdefault(str(output),[]).append({'argv':argv,'kind':'GNU generated stream invocation','proof':str(p)})
objects={};partial={};stamps={}
for p in obj.rglob('*.o'):
 entry={'bytes':p.stat().st_size,'sha256':sha(p),'WasmV1SectionsComplete':valid(p)}
 destination=stamps if p.name=='stamp.o' else objects if entry['WasmV1SectionsComplete'] else partial
 destination[str(p)]=entry
failures=[];snapshot=t/'source-snapshots/failed-sources';snapshot.mkdir(exist_ok=True)
for work in sorted((t/'tmp').glob('fullmake-cc-*')):
 p=work/'commands.json'
 if not p.exists():continue
 commands=json.loads(p.read_text());output=pathlib.Path(commands[-1][-1]);argv=commands[0]
 stage=next((name for name,file in [('frontend','front.ll'),('warning adapter','warnings.bc'),('jump adapter','lower.bc'),('optimizer','opt.bc')] if not (work/file).exists()),'llc or post-compile proof')
 buildTarget=output.is_absolute() and output.is_relative_to(obj)
 unit=next((x for x in argv if x.endswith('.c')),None);cwd=src/output.relative_to(obj).parent if buildTarget else obj
 source=pathlib.Path(unit) if unit and pathlib.Path(unit).is_absolute() else (cwd/unit).resolve() if unit else None
 saved=None
 if source and source.is_file():
  saved=snapshot/(sha(source)+'-'+source.name)
  if not saved.exists():shutil.copyfile(source,saved)
 failures.append({'target':str(output),'origin':'GNU lib object' if buildTarget else 'configure probe','inferredStage':stage,'stageInference':'first missing intermediate; llc failure if all intermediates exist','inferredGNUcwd':str(cwd),'source':str(source),'sourceSnapshot':str(saved),'retained':str(work),'commands':commands})
errors=[{'line':i+1,'text':line} for i,line in enumerate(log.splitlines()) if re.search(r'error:|fatal error:|unsupported GNU|unsupported indirect|\*\*\*|Stack dump:|Running pass',line)]
report={'scope':'failure-discovery inventory, no libc archive/runtime acceptance','attemptedObjectTargets':len(attempts),'validWasmObjectCount':len(objects),'partialOrNonWasmObjectCount':len(partial),'GNUStampMetadataCount':len(stamps),'objects':objects,'partialOutputs':partial,'GNUStampMetadata':stamps,'attemptedCommands':attempts,'failedStages':failures,'diagnostics':errors,'exit':json.loads((t/'logs/inventory-exit.json').read_text()),'completedDefinition':'Wasm v1 magic, size>8, structurally complete sections and SHA256; GNU stamp.o text metadata excluded; no runtime claim'}
(t/'logs/object-inventory.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({k:report[k] for k in ['attemptedObjectTargets','validWasmObjectCount','partialOrNonWasmObjectCount']}))
