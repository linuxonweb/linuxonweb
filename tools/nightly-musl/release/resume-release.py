#!/usr/bin/env python3
"""Resume verified release stages without recompiling or changing optimizer flags."""
import argparse,copy,importlib.util,json,os,signal,sys,time
from pathlib import Path
HERE=Path(__file__).resolve().parent

def module(name,path):
 spec=importlib.util.spec_from_file_location(name,path)
 value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value

def main():
 b=module('build_release',HERE/'build-release.py')
 parser=argparse.ArgumentParser(description=__doc__,allow_abbrev=False)
 parser.add_argument('previous',type=Path);parser.add_argument('output',type=Path)
 parser.add_argument('--stage',choices=['optimize','package','compat-package'],required=True)
 parser.add_argument('--cpus',type=int,default=3)
 parser.add_argument('--base-package',type=Path,default=b.BASE_PACKAGE)
 parser.add_argument('--name-only-input',type=Path,help='independently prove only the name custom section was removed before original O2')
 deadline_group=parser.add_mutually_exclusive_group()
 deadline_group.add_argument("--extended-optimizer",action="store_true",help="explicit alias for the default optimize-only 1800-second phase")
 deadline_group.add_argument("--short-optimizer",action="store_true",help="historical optimize-only 530-second comparison window; not the normal release budget")
 parser.add_argument("--observe-optimizer",action="store_true",help="bounded external PID/start-bound five-second /proc sampling; optimizer flags unchanged")
 args=parser.parse_args()
 if not 1<=args.cpus<=8:parser.error('--cpus must be in 1..8')
 if args.name_only_input and args.stage!='optimize':parser.error('--name-only-input is only valid for the optimize stage')
 if (args.extended_optimizer or args.short_optimizer or args.observe_optimizer) and args.stage!='optimize':parser.error('optimizer deadline/observation options are only valid for the optimize stage')
 extended_optimizer=args.stage=='optimize' and not args.short_optimizer
 optimizer_seconds=1800 if extended_optimizer else 530
 owner_seconds=1860 if extended_optimizer else 560
 outer_seconds=1900 if extended_optimizer else 600
 observer=None
 previous=args.previous.resolve(strict=True);out=args.output.resolve(strict=True)
 if set(p.name for p in out.iterdir())!={'t'} or not (out/'t/cache').is_dir():parser.error('Use the wrapper with fresh disk output')
 for key in ['TMPDIR','TMP','TEMP']:
  if Path(os.environ.get(key,'/')).resolve()!=out/'t':parser.error('Task-owned disk scratch is required')
 old=json.loads((previous/'build-state.json').read_text())
 state={k:copy.deepcopy(old[k]) for k in ['schema','sourceBoundary','xpcIntegration','compilerOptimization','sourceInputs','generatedSources','generatorManifest','compilerEnvironment','objects','compileCommands','archive','linkInputs','linker','baseLinkArguments','raw','nameOnlyInput','optimizerDeadlineProfile','optimizerToolchain'] if k in old}
 state.update(schema='linuxonweb-jit-build-2',stage='package' if args.stage=='compat-package' else args.stage,resumeStage=args.stage,runtimeAcceptance=False,releaseAcceptance=False,resumedFrom=b.artifact(previous/'build-state.json'),reusedCommands=[],reusedEvidence=[])
 owner=None;error=None
 def interrupted(signum,frame):raise InterruptedError('Resume owner received signal '+str(signum))
 for value in [signal.SIGTERM,signal.SIGINT,signal.SIGALRM]:signal.signal(value,interrupted)
 signal.alarm(owner_seconds)
 try:
  if args.stage=='optimize':
   state['optimizerDeadlineProfile']=dict(extended=extended_optimizer,explicitExtended=args.extended_optimizer,selection='explicit-short-comparison' if args.short_optimizer else 'explicit-extended' if args.extended_optimizer else 'default-production',optimizerSeconds=optimizer_seconds,ownerSeconds=owner_seconds,outerTotalSeconds=outer_seconds,comparisonMilestoneSeconds=530)
   state['optimizerToolchain']=dict(executable=b.artifact(Path('/usr/bin/wasm-opt')),dynamicLibrary=b.artifact(Path('/usr/lib/libbinaryen.so')) if Path('/usr/lib/libbinaryen.so').is_file() else None)
  if args.observe_optimizer:
   observer_path=Path(__file__).resolve().with_name('optimizer-observer.py')
   observer_spec=importlib.util.spec_from_file_location('optimizer_observer',observer_path)
   observer_module=importlib.util.module_from_spec(observer_spec);observer_spec.loader.exec_module(observer_module)
   observer=observer_module.OptimizerObserver(out,deadline_extended=extended_optimizer)
  owner=b.Owner(out,args.cpus,work_seconds=owner_seconds,outer_seconds=outer_seconds,optimizer_observer=observer.sample if observer else None);(out/'obj').mkdir()
  successful={}
  for command in old.get('reusedCommands',[])+old.get('commands',[]):
   if command.get('returncode')==0 and not command.get('remainingGroup'):
    successful[command['name']]=command
  required={'compile-PblJit','compile-PortableBaselineInterpret','archive','link','validate-raw','inspect-raw'}
  if old.get('xpcIntegration'):required.add('compile-'+b.XPC_KIND)
  if not required<=set(successful):raise ValueError('Missing completed source/link/raw validation stages')
  state['reusedCommands']=[dict(value,reusedFrom=str(previous)) for value in successful.values()]
  def verify(item):
   actual=b.artifact(item['path'])
   if actual!=item:raise ValueError('Retained input changed: '+item['path'])
   state['reusedEvidence'].append(actual);owner.guard();return Path(actual['path'])
  for item in old['sourceInputs']+old['generatedSources']+list(old['objects'].values())+old['linkInputs']+[old['archive']['base'],old['archive']['output']]:verify(item)
  if old.get('xpcIntegration'):
   xpc_link=old['xpcIntegration']['link'];verify(xpc_link['outputResponse'])
   if xpc_link['outputObject']!=old['objects'][b.XPC_KIND] or not xpc_link['otherTokensIdentical']:raise ValueError('XPC object response binding differs')
  raw=verify(old['raw'])
  raw_check=old.get('rawAbiReport')
  if raw_check is None:
   command=successful['inspect-raw'];raw_check=b.artifact(Path(command['argv'][-1])/'result.json')
  raw_abi=verify(raw_check);state['rawAbiReport']=raw_check
  raw_value=json.loads(raw_abi.read_text())
  if raw_value.get('module')!=old['raw'] or not raw_value.get('passStaticAbi') or not raw_value.get('noDWARF') or not raw_value.get('sharedMemoryImport'):raise ValueError('Raw ABI report identity or predicates mismatch')
  optimizer_input=raw
  if args.name_only_input:
   if state.get('nameOnlyInput'):raise ValueError('A name-only input is already bound to this retained stage')
   if 'optimize' in successful:raise ValueError('O2 already completed; resume package instead')
   candidate=args.name_only_input.resolve(strict=True)
   owner.run('verify-name-only-input',[sys.executable,'-B',HERE/'verify-wasm-name-parity.py',raw,candidate,out/'name-only-parity','--expected-sha256',old['raw']['sha256']],seconds=20)
   parity_path=out/'name-only-parity/result.json';parity=json.loads(parity_path.read_text())
   state['nameOnlyInput']=dict(originalRaw=old['raw'],candidate=parity['candidate'],parityReport=b.artifact(parity_path),verifier=b.artifact(HERE/'verify-wasm-name-parity.py'),wabt=b.artifact('/usr/bin/wasm-objdump'))
  if state.get('nameOnlyInput'):
   if args.stage=='compat-package':raise ValueError('Use the original raw build for compatibility-only packaging')
   record=state['nameOnlyInput'];optimizer_input=verify(record['candidate']);parity=json.loads(verify(record['parityReport']).read_text())
   verify(record['verifier']);verify(record['wabt'])
   if record['originalRaw']!=old['raw'] or parity.get('source')!=old['raw'] or parity.get('candidate')!=record['candidate']:raise ValueError('Name-only input identity differs')
   if parity.get('kind')!='wabt-independent-name-section-parity-v1' or parity.get('passNameOnlyParity') is not True or parity.get('headerIdentical') is not True or parity.get('everyOtherSectionEnvelopeAndPayloadIdentical') is not True:raise ValueError('Independent name-only parity is missing')
   sections=parity.get('preservedSections',[])
   if parity.get('removed',{}).get('description')!='"name"' or parity.get('removed',{}).get('kind')!='Custom' or not sections or parity.get('sectionCountAfter')!=len(sections) or parity.get('sectionCountBefore')!=len(sections)+1 or not all(s.get('envelopeAndPayloadIdentical') is True for s in sections):raise ValueError('Independent section inventory differs')
   if parity.get('inlineMePreserved',{}).get('description')!='"llvm.func_attr.annotate.inline-me"' or parity.get('inlineMePreserved',{}).get('envelopeAndPayloadIdentical') is not True:raise ValueError('Inline annotation preservation is missing')
  if args.stage=='optimize':
   if 'optimize' in successful:raise ValueError('O2 already completed; resume package instead')
   optimized=out/'obj/firefox.optimized.wasm'
   owner.run('optimize',['/usr/bin/wasm-opt',optimizer_input,'-O2','-o',optimized],seconds=optimizer_seconds)
   state['optimization']=dict(mode='O2',optimizedArtifact=b.artifact(optimized),tool=b.artifact('/usr/bin/wasm-opt'))
  else:
   if args.stage=='compat-package':
    transform_input=raw
    state['optimization']=dict(mode='compat',optimizedArtifact=None,tool=b.artifact('/usr/bin/wasm-opt'))
    state.update(diagnosticOnly=True,fullO2Status='unresolved')
   else:
    if 'optimize' not in successful or old.get('optimization',{}).get('mode')!='O2':raise ValueError('A completed original O2 stage is required')
    optimized_record=old['optimization'].get('optimizedArtifact') or b.artifact(successful['optimize']['argv'][-1])
    if successful['optimize']['argv']!=['/usr/bin/wasm-opt',str(optimizer_input),'-O2','-o',optimized_record['path']]:raise ValueError('Retained optimizer argv differs')
    transform_input=verify(optimized_record);verify(old['optimization']['tool'])
    state['optimization']=dict(mode='O2',optimizedArtifact=optimized_record,tool=old['optimization']['tool'])
   final=out/'obj/firefox.fpcast.wasm';old_final=None
   if 'fpcast' in successful:
    argv=successful['fpcast']['argv'];old_final=old.get('final') or b.artifact(argv[-1])
    expected=['/usr/bin/wasm-opt','--all-features','--disable-compact-imports','--pass-arg=max-func-params@23','--fpcast-emu',str(transform_input),'-o',old_final['path']]
    if argv!=expected:raise ValueError('Retained fpcast argv differs')
    verify(old_final)
    owner.run('reuse-final',['/usr/bin/cp','--reflink=auto',old_final['path'],final],seconds=30)
    if b.artifact(final)['sha256']!=old_final['sha256']:raise ValueError('Final copy hash differs')
   else:
    owner.run('fpcast',['/usr/bin/wasm-opt','--all-features','--disable-compact-imports','--pass-arg=max-func-params@23','--fpcast-emu',transform_input,'-o',final])
   state['final']=b.artifact(final)
   validated=old_final is not None and 'validate-final' in successful and successful['validate-final']['argv']==['/usr/bin/wasm-validate','--enable-all',old_final['path']]
   if not validated:owner.run('validate-final',['/usr/bin/wasm-validate','--enable-all',final],seconds=60)
   if old_final is not None and 'inspect-final' in successful:
    argv=successful['inspect-final']['argv'];position=argv.index('inspect')
    if argv[position+1]!=old_final['path'] or argv[-2:]!=['--compare',str(raw_abi)]:raise ValueError('Retained final inspection binding differs')
    abi_record=old.get('abiReport') or b.artifact(Path(argv[position+2])/'result.json')
    abi_path=verify(abi_record);abi=json.loads(abi_path.read_text())
    if abi.get('module')!=old_final or not all(abi.get(k) is True for k in ['passStaticAbi','noDWARF','sharedMemoryImport','everyElementUses23I64ToI64']) or not abi.get('elementEntryCount',0)>0 or abi.get('importAbi')!=raw_value.get('importAbi'):raise ValueError('Retained final ABI predicates or identity differ')
    (out/'final-abi').mkdir()
    owner.run('reuse-final-abi',['/usr/bin/cp','--reflink=auto',abi_path,out/'final-abi/result.json'],seconds=30)
    state['abiReport']=b.artifact(out/'final-abi/result.json')
    if state['abiReport']['sha256']!=abi_record['sha256']:raise ValueError('ABI report copy differs')
   else:
    owner.run('inspect-final',[sys.executable,'-B',HERE/'release-artifacts.py','inspect',final,out/'final-abi','--fpcast','--compare',raw_abi],seconds=90)
    state['abiReport']=b.artifact(out/'final-abi/result.json')
   owner.run('package',[sys.executable,'-B',HERE/'release-artifacts.py','package',args.base_package,final,out/'package','--optimizer',state['optimization']['mode']],seconds=150)
   state['package']=b.artifact(out/'package/package.json');state['manifest']=b.artifact(out/'package/boot-manifest.json')
  owner.guard();state['passBuild']=True
 except BaseException as caught:
  error=repr(caught);state.update(passBuild=False,error=error)
 finally:
  signal.alarm(0)
  if observer is not None:
   state["optimizerObservation"]=observer.summary()
   state["optimizerObservation"]["source"]=b.artifact(observer_path)
  if owner:
   state['elapsedSeconds']=time.monotonic()-owner.started;state['commands']=owner.commands
   state['protectedReview']=[dict(before=value,after=b.process_identity(int(pid)),unchanged=b.process_identity(int(pid))==value) for pid,value in owner.protected.items()]
   if not all(row['unchanged'] for row in state['protectedReview']):state.update(passBuild=False,lifecycleWarning='Previously running protected service changed; investigate separately')
   b.save(out/'resources.json',owner.resources)
  b.save(out/'build-state.json',state)
  report_module=module('release_report',HERE/'release-report.py');report=report_module.write_report(out,state)
  report.update(resumedFrom=state['resumedFrom'],reusedCommands=state['reusedCommands'],reusedEvidence=state['reusedEvidence'],note='Finite stage resumption from verified retained inputs; no recompilation; explicit optimizer mode '+state.get('optimization',{}).get('mode','not completed')+'; original release commands; runtime acceptance remains pending.')
  if state.get('nameOnlyInput'):report['nameOnlyInput']=state['nameOnlyInput']
  for key in ['optimizerDeadlineProfile','optimizerToolchain']:
   if key in state:report[key]=state[key]
  if args.stage=='compat-package':report.update(diagnosticOnly=True,fullO2Status='unresolved')
  b.save(out/'report.json',report)
 print(json.dumps(dict(passBuild=state.get('passBuild',False),stage=args.stage,elapsedSeconds=state.get('elapsedSeconds'),error=error,report=str(out/'report.json'),runtimeAcceptance=False)))
 return 0 if state.get('passBuild') else 1
if __name__=='__main__':raise SystemExit(main())
