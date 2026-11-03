#!/usr/bin/env python3
"""One fixed native Firefox run bracketed by matched host runs, with quota proof."""
import argparse
import datetime
import importlib.util
import json
import pathlib
import re
import statistics
import sys
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('scene_metrics', pathlib.Path(__file__).with_name('summarize-method-threshold.py'))
metric = importlib.util.module_from_spec(spec); spec.loader.exec_module(metric)


def sole_blank(targets):
    pages = [row for row in targets if row.get('type') == 'page']
    return len(pages) == 1 and pages[0].get('url') == 'about:blank' and not any(row.get('type') in ['worker','shared_worker','service_worker'] for row in targets)


def host(label, directory):
    data = metric.host(label, directory)
    if data.get('status'): return data
    monitor = data['monitor']; browser = metric.read(data['artifacts'][0]['path'])
    samples = [json.loads(line) for line in (pathlib.Path(directory)/'resources.jsonl').read_text().splitlines()]
    snapshots = [row.get('ownedQuota') for row in samples]
    valid = bool(snapshots) and all(row and row.get('valid') is True and row.get('commonSharedAncestors') for row in snapshots)
    common = None
    if valid:
        for row in snapshots:
            paths = {limit['path'] for limit in row['commonSharedAncestors'] if 0 < limit['maximumObservedCpuLimit'] <= 3}
            common = paths if common is None else common & paths
    before = browser.get('quotaPreflight', {})
    data['quotaAcceptance'] = bool(valid and common and before.get('valid') and before.get('commonSharedAncestors'))
    data['quotaSamples'] = len(snapshots); data['commonQuotaAncestors'] = sorted(common or [])
    data['soleBlankInitialPage'] = sole_blank(browser.get('initialTargets', []))
    data['oneResourceMonitor'] = monitor.get('sampling') == {'cpuRssAvailableRamQuotaSeconds':1,'pssSeconds':5,'pssPeakIsSampledLowerBound':True}
    data['measurementAccepted'] = bool(data['measurementAccepted'] and data['quotaAcceptance'] and data['soleBlankInitialPage'] and data['oneResourceMonitor'])
    return data


def main(args):
    if args.output.exists(): raise SystemExit('fresh final evidence output required')
    experiment = metric.read(args.experiment)
    if experiment.get('nativeChanged') or experiment.get('launcherChanged') or experiment.get('thresholdOverridden') or experiment.get('cacheLifecycleEnabled'):
        raise SystemExit('this curator requires the exact unchanged default-JIT image')
    if experiment.get('matchedSceneSha256') != metric.SCENE_SHA or experiment.get('manifestSha256') != '9da17bf944a4d25d8f4c4811e93a0dc9ca76b7b37f52579544959c7ae18a4bd5':
        raise SystemExit('unreviewed selected image or scene')
    native = metric.native('current-default', 50, args.native, experiment)
    owner = metric.read(pathlib.Path(args.native)/'report.json')
    watchdog = metric.read(pathlib.Path(args.native_owner)/'result.json')
    samples = owner.get('samples', []); valid = bool(samples); common = None
    for sample in samples:
        groups = sample.get('quotaByGroup', {})
        paths = set(sample.get('commonCpuAncestors') or [])
        valid = valid and bool(groups) and bool(paths) and not sample.get('changedMembership')
        valid = valid and all(isinstance(g.get('capacity'), (int,float)) and 0 < g['capacity'] <= 3 for g in groups.values())
        valid = valid and bool(sample.get('processes')) and all(isinstance(p.get('effectiveCpus'), (int,float)) and 0 < p['effectiveCpus'] <= 3 for p in sample['processes'])
        common = paths if common is None else common & paths
    pins = owner.get('ownedProxy', {}).get('pins', {})
    forbidden = ['/linux/persistent-home.mjs','/linux/dist/virtio/input.js','/linux/dist/worker.js','/linux/dist/platform.js','/linux/main.js']
    native['unmodifiedRuntimeHotPaths'] = owner.get('ownedProxy',{}).get('diagnosticMode') == 'performance' and not any(name in pins for name in forbidden)
    native['manifestIdentity'] = pins.get('/linux/boot-manifest.json',{}).get('sha256') == experiment['manifestSha256']
    native['soleBlankInitialPage'] = sole_blank(owner.get('initialTargets', []))
    native['quotaAcceptance'] = bool(valid and common and owner.get('configuration',{}).get('descendantQuotaGate',{}).get('beforeNavigation'))
    native['commonQuotaAncestors'] = sorted(common or [])
    native['oneResourceMonitor'] = watchdog.get('kind') == 'lifecycle-only-startup-watchdog' and watchdog.get('watchdogSamplesPss') is False and watchdog.get('watchdogProducesCpuRssSamples') is False
    native['watchdog'] = watchdog
    native['nativeSceneVisuallyReviewed'] = args.visible_scene_reviewed
    logs = (pathlib.Path(args.native)/'guest.log').read_text()
    native['observedHostGlRenderers'] = sorted(set(re.findall(r'gpu-owner: gl context \d+ open: ([^\n]+)', logs)))
    native['measurementAccepted'] = bool(native['measurementAccepted'] and native['unmodifiedRuntimeHotPaths'] and native['manifestIdentity'] and native['soleBlankInitialPage'] and native['quotaAcceptance'] and native['oneResourceMonitor'] and watchdog.get('pass') and args.visible_scene_reviewed)
    hosts = [host('before',args.host_before),host('after',args.host_after)]
    renderers = []
    for item in hosts:
        rows = (item.get('measurement') or {}).get('renderer') or []
        renderers.append(next((row.removeprefix('unmasked renderer: ') for row in rows if row.startswith('unmasked renderer: ')),None))
    backend_same = len(set(renderers)) == 1 and bool(renderers[0]) and renderers[0] in native['observedHostGlRenderers']
    accepted = bool(native['measurementAccepted'] and all(item.get('measurementAccepted') for item in hosts) and backend_same)
    host_fps = [item['measurement']['fps'] for item in hosts if item.get('measurementAccepted')]
    mean = statistics.mean(host_fps) if len(host_fps)==2 else None
    ratio = native['measurement']['fps']/mean*100 if accepted else None
    report = {'schema':1,'createdUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'scope':'One current default-threshold native Firefox sample bracketed by host controls; no threshold tuning',
              'predeclaredOrder':['host-before','native-default50','host-after'],'experiment':experiment,
              'sameObservedHardwareRenderer':backend_same,'hostRendererStrings':renderers,'native':native,'hosts':hosts,
              'allMeasurementsAccepted':accepted,'hostMeanFps':mean,'nativePercentOfHostMean':ratio,
              'nativePercentOfEachHost':[native['measurement']['fps']/value*100 for value in host_fps] if accepted else None,
              'atLeastHalfOfBothHostControls':bool(accepted and native['measurement']['fps']>=max(host_fps)*.5),
              'broadGuardGcAcceptance':False,'fullJitAcceptance':False,'physicalPresentationRateMeasured':False,'startupReadinessAcceptanceFromThisRun':False,
              'limits':['Single native sample; host bracketing is not a statistically powered study',
                        'Same320x240 render canvas/workload/settings; guest framebuffer and host viewport1280x720; hostDPR1',
                        'Native content-area innerWidth/innerHeight was not measured and is not claimed equal',
                        'Metric is completed page rAF intervals including stalls and overruns, not physical displayed frames',
                        'Scene10s warmup and20s sample are independent of240s outer quiet observation',
                        'Current observer uses one resource monitor and omits HomeFS call instrumentation; earlier double-monitored failed run is not a throughput baseline',
                        'Sparse native compile/entry logs are not complete final tier counters; broad native guard/GC gates remain unmet']}
    args.output.write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({key:report[key] for key in ['allMeasurementsAccepted','hostMeanFps','nativePercentOfHostMean','atLeastHalfOfBothHostControls']}))

if __name__ == '__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--experiment',type=pathlib.Path,required=True);p.add_argument('--native',type=pathlib.Path,required=True)
    p.add_argument('--native-owner',type=pathlib.Path,required=True);p.add_argument('--host-before',type=pathlib.Path,required=True)
    p.add_argument('--host-after',type=pathlib.Path,required=True);p.add_argument('--output',type=pathlib.Path,required=True)
    p.add_argument('--visible-scene-reviewed',action='store_true')
    main(p.parse_args())
