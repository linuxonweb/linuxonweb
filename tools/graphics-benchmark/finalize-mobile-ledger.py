#!/usr/bin/env python3
from pathlib import Path
import json,datetime
ROOT=Path(__file__).resolve().parents[2];scratch=(ROOT/'../../../codex-build/g3g').resolve();base=ROOT/'out/gpt-6-astra-pro_builtin-graphics-rubywebterm-mobile-20261103'
p=ROOT/'agent/graphics-jit-devsummary.json';d=json.loads(p.read_text());entries=d['iterations'];names={e['name'] for e in entries};d.setdefault('pre_mobile_owned_build_test_seconds',d.get('owned_build_test_seconds',0))
def iso(t):return datetime.datetime.fromtimestamp(t,datetime.timezone.utc).isoformat()
newtests=0
for name,kind in [('demo-bundle1','artifact-build'),('demo-bundle2','artifact-build'),('demo-upload1','artifact-upload'),('android-console-build1','artifact-build'),('android-console-build2','artifact-build'),('android-console-build3','artifact-build'),('android-console-host1','host-browser-test'),('android-console-host2','host-browser-test'),('android-readonly-server-owner1','background-service-owner'),('android-readonly-server-owner2','background-service-owner'),('mobile-bundle-gate1','host-browser-test')]:
 f=scratch/name/'receipt.json'
 if not f.exists() or name in names:continue
 r=json.loads(f.read_text());seconds=r['duration_s'];test=kind in ['artifact-build','host-browser-test'];entries.append({'iteration':len(entries)+1,'name':name,'start_utc':iso(r['started_unix']),'end_utc':iso(r['ended_unix']),'seconds':seconds,'kind':kind,'exit_code':r['exit_code'],'stop_reason':r.get('stop_reason'),'scope_score':34 if name.startswith('demo') else 40,'receipt':str(f),'build_test_seconds':seconds if test else 0,'remaining_owned':len(r.get('remaining',[]))});names.add(name)
for i in range(1,15):
 name=f'android{i}';f=base/name/'result.json'
 if not f.exists() or name in names:continue
 r=json.loads(f.read_text())
 if not r.get('end'):continue
 entries.append({'iteration':len(entries)+1,'name':name,'start_utc':r['start'],'end_utc':r['end'],'seconds':round(r['elapsedMs']/1000,3),'kind':'physical-device-owner','exit_code':1 if r.get('errors') else 0,'scope_score':42 if i==14 else 40,'build_test_seconds':0,'device_owner_seconds':round(r['elapsedMs']/1000,3),'owner_lifetime_includes_setup_idle_and_ui':True,'owned_target_closed':r.get('ownedTargetClosed'),'owned_forward_removed':r.get('ownedForwardRemoved'),'guest_deadline_ms':r.get('guestDeadlineMs'),'native_gate_pass':r.get('nativeGate',{}).get('pass'),'raw_evidence_private':str(f.relative_to(ROOT))});names.add(name)
entries[70:]=sorted(entries[70:],key=lambda e:e['start_utc']);
for n,e in enumerate(entries,1):e['iteration']=n
new=entries[70:];d['owned_build_test_seconds']=round(d['pre_mobile_owned_build_test_seconds']+sum(e.get('build_test_seconds',0) for e in new),3)
d['device_owner_lifetime_seconds']=round(sum(e['seconds'] for e in new if e['kind']=='physical-device-owner'),3)
d['background_service_owner_seconds']=round(sum(e['seconds'] for e in new if e['kind']=='background-service-owner'),3)
d['artifact_upload_seconds']=round(sum(e['seconds'] for e in new if e['kind']=='artifact-upload'),3)
d['timing_note']='Owned host build/test, device-owner lifetimes, background services and uploads are separate categories. Device lifetimes include setup/UI/tool idle. Background services overlap phone tests; sums are not project elapsed. Model/planning time is unmeasured. Startup-owned Firefox runs remain excluded from owned build/test total.'
d['task_start_utc']='2026-11-03T07:06:26Z';d['total_owned_build_test_seconds']=d['owned_build_test_seconds'];d['last_work_state']='Accepted authenticated MI8 console with native commands, one verified worker fetch and exact physical Stop/Blob cleanup; final scoped checkpoint.';d['overall_provisional_score']=42;d['mobile_acceptance_points']='2/5';d['final_mobile_evidence']='tools/graphics-benchmark/evidence/gpt6-astra-rubywebterm-mobile-20261103.json';d['status']='Graphics/JIT acceptance remains partial; authenticated MI8 Linux console, native commands, signed repository update and worker cleanup accepted. Full Firefox mobile, soft keyboard, mobile Python installation and iOS unaccepted.'
parse=lambda s:datetime.datetime.fromisoformat(s.replace('Z','+00:00'));end=max(parse(e['end_utc']) for e in entries if e.get('end_utc'));start=datetime.datetime(2026,11,3,7,6,26,tzinfo=datetime.timezone.utc);d['elapsed_to_last_seconds']=round((end-start).total_seconds(),3);d['elapsed_wall_seconds']=d['elapsed_to_last_seconds'];d['last_measured_event_utc']=end.isoformat();p.write_text(json.dumps(d,indent=2)+'\n')
md=['# Graphics, JIT and mobile development ledger','',f'GPT-6 Astra Pro / built-in graphics_jit / Rubywebterm. {len(entries)} measured iterations; overall CTO acceptance42/100.','',f"Host build/test owner time: **{d['owned_build_test_seconds']:.3f}s**. Device owner lifetimes: **{d['device_owner_lifetime_seconds']:.3f}s**. Background read-only server lifetimes: **{d['background_service_owner_seconds']:.3f}s**. Artifact upload: **{d['artifact_upload_seconds']:.3f}s**.",'',d['timing_note'],'',f"Elapsed task time through last measured event: **{d['elapsed_to_last_seconds']:.3f}s** ({d['last_measured_event_utc']}).",'', '| Iteration | Activity | Start UTC | End UTC | Seconds | Kind | Score |','|---:|---|---|---|---:|---|---:|']
for e in entries:md.append(f"| {e.get('iteration')} | {e['name']} | {e.get('start_utc','unrecorded')} | {e.get('end_utc','unrecorded')} | {e.get('seconds',0):.3f} | {e.get('kind','legacy')} | {e.get('scope_score','—')} |")
(ROOT/'agent/graphics-jit-devsummary.md').write_text('\n'.join(md)+'\n');print(json.dumps({k:d[k] for k in ['owned_build_test_seconds','device_owner_lifetime_seconds','background_service_owner_seconds','artifact_upload_seconds','elapsed_to_last_seconds','last_measured_event_utc']}));print('ITERATIONS',len(entries))
