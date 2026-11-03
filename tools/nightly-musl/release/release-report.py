#!/usr/bin/env python3
"""Report only observed build products; compilation is not runtime acceptance."""
import json
from pathlib import Path
import sys


def write_report(out,state):
    out=Path(out)
    firefox={name:state[name] for name in ('raw','final') if name in state}
    optimization=state.get('optimization',{'mode':'not run','optimizedArtifact':None})
    if optimization.get('optimizedArtifact') is not None:
        firefox['optimized']=optimization['optimizedArtifact']
    report={
        'schema':'linuxonweb-jit-release-build-2',
        'passBuild':state.get('passBuild',False),
        'completedThrough':state['stage'] if state.get('passBuild') else 'failed; see commands',
        'note':'Incremental musl release build from canonical JIT source and explicitly retained base inputs. Runtime acceptance remains pending.',
        'sourceBoundary':state.get('sourceBoundary'),
        'xpcIntegration':state.get('xpcIntegration'),
        'sourceInputs':state.get('sourceInputs',[]),
        'generatedSources':state.get('generatedSources',[]),
        'compilerEnvironment':state.get('compilerEnvironment'),
        'compileCommands':state.get('compileCommands',{}),
        'compilerOptimization':state.get('compilerOptimization'),
        'objects':state.get('objects',{}),
        'archive':state.get('archive'),
        'baseLinkArguments':state.get('baseLinkArguments'),
        'linkInputs':state.get('linkInputs',[]),
        'optimizer':optimization,
        'diagnosticOnly':optimization.get('mode')!='O2',
        'fullO2Status':'complete' if optimization.get('optimizedArtifact') is not None else 'unresolved',
        'artifacts':{'firefox':firefox},
        'abiReport':state.get('abiReport'),
        'package':state.get('package'),
        'manifest':state.get('manifest'),
        'elapsedSeconds':state.get('elapsedSeconds'),
        'commands':state.get('commands',[]),
        'error':state.get('error'),
        'lifecycleWarning':state.get('lifecycleWarning'),
        'runtimeAcceptance':False,
        'releaseAcceptance':False,
    }
    (out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    return report


if __name__=='__main__':
    out=Path(sys.argv[1]).resolve(strict=True)
    write_report(out,json.loads((out/'build-state.json').read_text()))
    print(out/'report.json')
