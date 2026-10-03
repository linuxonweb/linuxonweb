from pathlib import Path
import hashlib,json,difflib,subprocess,sys
T=Path('/mnt/p6/build/firefox-nightly-musl-recovery-20261002');S=T/'source/firefox-159.0a1';P=T/'libevent-time64-preflight';r=json.loads((P/'result.json').read_text());assert all((v['exit']==0)==v['expected_success'] for v in r['results'].values())
relative='ipc/chromium/src/third_party/libeventcommon.mozbuild';p=S/relative;old=p.read_text();assert hashlib.sha256(old.encode()).hexdigest()=='d986dcbcb7ae0c187992a315816512f3111756eebd288e8aa810d15b33287f6d';assert old.count("elif CONFIG['TARGET_OS'] == 'Android':\n    libevent_include_suffix = 'android'\nelse:")==1
new=old.replace("elif CONFIG['TARGET_OS'] == 'Android':\n    libevent_include_suffix = 'android'\nelse:","elif CONFIG['TARGET_OS'] == 'Android':\n    libevent_include_suffix = 'android'\nelif CONFIG['TARGET_KERNEL'] == 'Linux' and CONFIG['TARGET_CPU'] == 'wasm32':\n    libevent_include_suffix = 'wasm'\nelse:")
adapter=(P/'wasm/event2/event-config.h').read_text();adapter_relative='ipc/chromium/src/third_party/libevent/wasm/event2/event-config.h';assert not (S/adapter_relative).exists()
linux=S/'ipc/chromium/src/third_party/libevent/linux/event2/event-config.h';assert linux.read_bytes()==(P/'linux/event2/event-config.h').read_bytes()
statuses=[json.loads(p.read_text()) for p in (T/'status').glob('*.json')];phases=[r for r in statuses if isinstance(r,dict) and 'phase' in r and 'pgid' in r and 'state' in r];active={int(x) for x in subprocess.check_output(['ps','-eo','pgid='],text=True).split()};assert all(r['state']=='completed' and r['pgid'] not in active for r in phases)
changes={relative:(old,new),adapter_relative:('',adapter)}
patch=''.join(''.join(difflib.unified_diff(a.splitlines(True),b.splitlines(True),fromfile='a/'+name if a else '/dev/null',tofile='b/'+name)) for name,(a,b) in changes.items());(T/'patches/nightly-native-libevent-time64.patch').write_text(patch)
proof={'scope':'Shared native Linux/Wasm musl adapter; original Linux configuration and consumer size assertions preserved','selector':'TARGET_KERNEL=Linux and TARGET_CPU=wasm32 after Android branch','sizes':{'TIME_T':8,'OFF_T':8,'LONG':4,'VOID_P':4,'PTHREAD_T':4},'applied':'--apply' in sys.argv,'original_linux_config_sha256':hashlib.sha256(linux.read_bytes()).hexdigest(),'source_changes':{n:{'original_sha256':hashlib.sha256(a.encode()).hexdigest(),'updated_sha256':hashlib.sha256(b.encode()).hexdigest()} for n,(a,b) in changes.items()},'probe':str(P/'result.json'),'terminal_build_pgid':max((r for r in phases if r['phase']=='build'),key=lambda r:r['started'])['pgid'],'owned_groups_empty_before_apply':True}
if '--apply' in sys.argv:
 for name,(a,b) in changes.items():
  p=S/name;assert not p.exists() if not a else p.read_text()==a;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(b)
(T/'status/native-libevent-time64-port.json').write_text(json.dumps(proof,indent=2));print(json.dumps(proof,indent=2))
