#!/usr/bin/env python3
"""Read-only audit of the observed pre-array preparation and reconstruction."""
import hashlib,importlib.util,json,subprocess,sys
from pathlib import Path
repo=Path.cwd();build=Path(sys.argv[1]).resolve();output=Path(sys.argv[2]);checks=[]
def check(ok,label):
    checks.append({'name':label,'pass':bool(ok)})
    if not ok:raise ValueError(label)
def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def pin(record):
    p=Path(record['path']);check(p.is_file() and p.stat().st_size==record['bytes'] and sha(p)==record['sha256'],'pin:'+str(p))
def load_module(name,path):
    spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
try:
    d=json.loads((build/'preparation.json').read_text());source=Path(d['source'])
    check(d['preparationComplete'] and not any(d[k] for k in ['compiled','nativeIntegrationReady','fullBuildReady','guestRuntimeAcceptance']),'preparation scope remains explicit')
    check(subprocess.check_output(['git','--no-pager','-C',str(source),'rev-parse','HEAD'],text=True).strip()==d['sourceHead'],'pinned source HEAD')
    for key in ['packet','hostPacket','candidate','recipe','egl','dependencyHeaders','sourceChanges','environment','nativeCompileCommands','linkArguments','phaseCommands']:pin(d[key])
    for row in d['dependencyArchives']:pin(row)
    changes=json.loads(Path(d['sourceChanges']['path']).read_text())
    check(len(changes)==10,'exact ten source destinations')
    for row in changes:pin(row['after'])
    status=subprocess.check_output(['git','--no-pager','-C',str(source),'status','--porcelain','--untracked-files=all'],text=True)
    actual={line[3:] for line in status.splitlines()};expected={str(Path(r['after']['path']).relative_to(source)) for r in changes}- {'.mozconfig'}
    check(actual==expected,'only declared tracked/untracked source changes')
    headers=json.loads(Path(d['dependencyHeaders']['path']).read_text());check(len(headers)==1687,'complete native header inventory')
    for row in headers:pin(row)
    check(not list((build/'obj').rglob('*.o')) and not list((build/'native-obj').glob('*.o')),'no Firefox compilation occurred')
    prep=load_module('owned_preparation',repo/'tools/nightly-jit-prep/prepare-owned-build.py')
    env=prep.PREFLIGHT.parse_environment(Path(d['environment']['path']).read_text());check('HOME' not in env and 'LD_LIBRARY_PATH' not in env,'owned environment preserves HOME and removes only stale host path')
    for key in ['TMPDIR','TMP','TEMP','XDG_CACHE_HOME','CARGO_HOME','MOZBUILD_STATE_PATH','CCACHE_DIR','SCCACHE_DIR']:check(Path(env[key]).is_relative_to(build),'owned environment:'+key)
    phases=json.loads(Path(d['phaseCommands']['path']).read_text())
    check(set(phases)=={'configure','pre-export','export','build'},'finite declared phases')
    check(all(v['cwd']==str(source) and v['requiresStableProcessRoute'] and v['executeOnlyUnderUnchangedBoundedOwner'] for v in phases.values()),'phase route remains supervised and explicit')
    for command in json.loads(Path(d['nativeCompileCommands']['path']).read_text()):check(command['argv'][-1]==str(build/'native-src'/(command['name']+'.cpp')),'native compiler source binding:'+command['name'])
    for name in ['recipe/environment.sh','recipe/cargo','recipe/rustc','.mozconfig','link/link.args']:
        text=(build/name).read_text();check(str(Path(d['packet']['path']).parent) not in text,'no stale packet output path:'+name)
    try:prep.PREFLIGHT.safe_output(build,[source]);raise ValueError('existing output admitted')
    except ValueError as e:check('output must not already exist' in str(e),'existing preparation output refused without mutation')
    helper=Path(json.loads((build/'dependency-refresh.json').read_text())['helperReconstruction']['path']);h=json.loads(helper.read_text())
    check(h['passArtifactReconstruction'] and not h['compiled'] and h['helperOnlyLinkage'] and not h['guestRuntimeAcceptance'],'exact reconstruction scope')
    for key in ['recipe','historicalReceipt','source','wrappedObject','wrappedBrowserArchive','object','archive']:pin(h[key])
    check(h['object']['sha256']=='bae2a8cc8dd968036e4cecec8dfbdc218923e5a6a8594f89baceb0cdd874e755' and h['archive']['sha256']=='ce9bde472373b4d7d09555954006b94b3c0a8137d341d51d689371fb8e2c7561','independent historical full object/archive hashes')
    recon=load_module('helper_reconstruction',repo/'tools/nightly-musl/recipe/reconstruct-helper-mapping.py')
    original=Path(h['wrappedObject']['path']).read_bytes();rebuilt,renamed,unchanged=recon.reconstruct(original)
    check(rebuilt==Path(h['object']['path']).read_bytes() and len(renamed)==2 and len(unchanged)==9,'deterministic replay, only linking metadata changes')
    tampered=bytearray(original);tampered[-1]^=1
    try:recon.reconstruct(bytes(tampered));raise ValueError('altered wrapped object admitted')
    except ValueError as e:check('wrapped object identity mismatch' in str(e),'altered owned input refused')
    refresh=json.loads((build/'dependency-refresh.json').read_text());check(len(refresh['remainingUniqueMissingFiles'])==1 and refresh['remainingUniqueMissingFiles'][0].endswith('/libc++.a'),'only libc++ still missing from declared dependency closure')
    check(all(not Path(p).exists() for p in refresh['remainingUniqueMissingFiles']),'remaining dependency gap remains real')
    evidence=repo/'docs/evidence/firefox-jit-integration-20261110'
    owners=json.loads((evidence/'owner-receipts.json').read_text())
    for owner in owners:
        r=owner['receipt'];check(r['ownedProcessesRemaining']==0 and not r['cleanupInventoryErrors'] and not r['quotaFailure'] and owner['allRecordedQuotaSamplesValid'],'owner cleanup and continuous quota:'+owner['label'])
        pin(owner['receiptFile']);pin(owner['resourcesFile']);pin(owner['logFile'])
    check([o['label'] for o in owners if not o['receipt']['pass']]==['prepare-owner'],'only retained first preparation failure')
    gpu=json.loads((evidence/'headless-egl.json').read_text());check(gpu['hardwareWebglAcceptance'] and not gpu['hardwareWebgpuAcceptance'] and not gpu['guestRuntimeAcceptance'] and gpu['ownedProcessesRemaining']==0 and gpu['allQuotaSamplesValid'],'scoped hardware WebGL evidence')
    check(gpu['earlierRejectedHardwareWebgpu']['webgpu']['adapter']['isFallbackAdapter'] is True and not gpu['earlierRejectedHardwareWebgpu']['pass'],'software WebGPU remains rejected for hardware claim')
    check(subprocess.check_output(['git','--no-pager','-C','../../project/linux/linuxonweb','status','--porcelain','--untracked-files=no'],text=True).strip()=='','primary tracked work remains untouched')
    result={'pass':True,'scope':'preparation/hash/policy/reconstruction audit only; no native execution or speed acceptance','checks':len(checks),'compiled':False,'nativeIntegrationReady':False,'guestRuntimeAcceptance':False,'checksDetail':checks}
except Exception as error:
    result={'pass':False,'scope':'preparation audit only','checks':len(checks),'error':str(error),'checksDetail':checks}
output.parent.mkdir(parents=True,exist_ok=True);output.write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({k:v for k,v in result.items() if k!='checksDetail'},indent=2));raise SystemExit(0 if result['pass'] else 1)
