"""Replay the real-guest-tested main-stack adapter; keep libc threads unchanged."""
from pathlib import Path
import hashlib, json, shutil, subprocess
T = Path('/mnt/p6/build/firefox-nightly-musl-recovery-20261002')
J = Path('/mnt/p6/project/build/nightly-native-stack-20261003')
S = Path('/nix/store/drmrcqyqqvyngx2jv0wp6hisphs738j1-source')
SYSROOT = '/nix/store/bp3in3ifwgps003464g4ncrd6yzp9fn9-sysroot'
P = T/'native-stack-accepted-run1'
source = Path(__file__).resolve().parents[1]/'adapters/native-stack/stack.c'
def digest(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def pin(p): return dict(path=str(p), bytes=p.stat().st_size, sha256=digest(p))
assert digest(source) == '7d1d0d85dacd408c3b94278be44d1ac00baf0d81a8c3b2ffa936416e1f0590d5'
guest = J/'guest-run/result.json'
result = json.loads(guest.read_text())
assert result['pass'] and result['ownedGroupEmpty'] and result['serverClosed']
assert result['unwind']['passes'] == 55 and result['unwind']['failures'] == 0
status = json.loads((J/'guest-run-supervisor-status.json').read_text())
assert status['ownerReaped'] and status['nodeGroupEmpty'] and status['chromeGroupEmpty']
assert status['childExit'] == 0 and status['stopReason'] is None
assert digest(J/'private-header-pins.json') == '75cf2fe5b7a5c7294fd5cc6cc65f1799e5e930fed6b7a6238231b58c91406ab6'
header_pins = json.loads((J/'private-header-pins.json').read_text())
for path, expected in header_pins.items():
    p = Path(path); assert p.is_relative_to(S) and digest(p) == expected
assert digest(J/'native-stack.o') == '46c762f103d7f09c899afccd9997a96e9da21db466fc75b58f5c10e0c4d00cda'
groups = set(map(int, subprocess.check_output(['ps','-eo','pgid='],text=True).split()))
for p in (T/'status').glob('*.json'):
    d = json.loads(p.read_text())
    if isinstance(d,dict) and all(k in d for k in ('phase','pgid','state')):
        # Retained pre-reboot statuses may say running; actual groups must be absent.
        assert d['pgid'] not in groups, p
env = dict(x.split('=',1) for x in subprocess.check_output(['bash','-c','source "$1"; env -0','stack',str(T/'recipe/environment.sh')]).decode().split('\0') if '=' in x)
assert env['WASM_MUSL_SYSROOT'] == SYSROOT
libc = Path(SYSROOT)/'lib/libc.a'
assert digest(libc) == 'f2636fe6df25bd50e23a1726d9e28e6cdc82a03a4f000c693e569b6a65d5608b', 'Selected libc/private-header ABI must match the real guest gate'
assert all(env[k].startswith(str(T)+'/') for k in ('TMPDIR','TMP','TEMP'))
assert not P.exists(); P.mkdir()
copy = P/'stack.c'; shutil.copyfile(source,copy)
obj = P/'stack.o'; archive = P/'libnightly-native-stack.a'
flags = [env['CC'],'-O2','-pthread','-Wall','-Wextra','-Werror','-matomics','-mbulk-memory','-include',str(S/'src/include/features.h'),'-isystem',str(S/'src/internal'),'-isystem',str(S/'arch/wasm32'),'-isystem',str(S/'arch/generic')]
commands = [('compile',flags+['-c',str(copy),'-o',str(obj)]),('validate',['wasm-validate','--enable-all',str(obj)]),('archive',[env['AR'],'crs',str(archive),str(obj)])]
for name, argv in commands:
    run = subprocess.run(argv,env=env,capture_output=True,text=True,timeout=60)
    (P/(name+'.log')).write_text(run.stdout+run.stderr)
    assert run.returncode == 0, run.stderr
assert digest(obj) == digest(J/'native-stack.o'), 'Production object must equal actual guest-tested object'
(P/'build.json').write_text(json.dumps(dict(source=pin(copy), object=pin(obj), archive=pin(archive), guestEvidence=pin(guest), libc=pin(libc), privateHeaders=header_pins, commands=commands, browserLinkAcceptance=False),indent=2)+'\n')
print(archive)
