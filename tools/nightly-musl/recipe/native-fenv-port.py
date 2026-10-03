from pathlib import Path
import difflib, hashlib, json, subprocess, sys
T=Path('/mnt/p6/build/firefox-nightly-musl-recovery-20261002')
name='toolkit/components/resistfingerprinting/nsUserCharacteristics.cpp'
p=T/'source/firefox-159.0a1'/name
old=p.read_text()
assert hashlib.sha256(old.encode()).hexdigest()=='81750263322911a2bcd98a1dc3da224ddaff841f2b1c63b8b24a7148226b6f92'
new=old
for macro,value in [('FE_DOWNWARD','1'),('FE_UPWARD','2'),('FE_TOWARDZERO','3')]:
    needle=f'    case {macro}:\n      mode_str = "{value}";\n      break;\n'
    assert new.count(needle)==1
    new=new.replace(needle,f'#ifdef {macro}\n'+needle+'#endif\n')
groups=set(map(int,subprocess.check_output(['ps','-eo','pgid='],text=True).split()))
for status in (T/'status').glob('*.json'):
    row=json.loads(status.read_text())
    if isinstance(row,dict) and all(k in row for k in ('phase','pgid','state')):
        assert row['state']=='completed' and row['pgid'] not in groups,status
backup=T/'fenv-preflight/original-nsUserCharacteristics.cpp'
backup.parent.mkdir(exist_ok=True); assert not backup.exists(); backup.write_text(old)
(T/'patches/nightly-optional-fenv-rounding.patch').write_text(''.join(difflib.unified_diff(old.splitlines(True),new.splitlines(True),fromfile='a/'+name,tofile='b/'+name)))
proof=dict(scope='Guard only optional fenv rounding macros in telemetry; no fenv implementation or floating-point behavior changed',original_sha256=hashlib.sha256(old.encode()).hexdigest(),updated_sha256=hashlib.sha256(new.encode()).hexdigest(),original_backup=str(backup),owned_phase_groups_empty_before_apply=True,applied='--apply' in sys.argv)
if '--apply' in sys.argv:
    assert p.read_text()==old; p.write_text(new)
(T/'status/native-fenv-port.json').write_text(json.dumps(proof,indent=2)+'\n')
print(json.dumps(proof))
