#!/usr/bin/env python3
"""Select the accepted native checked jump backend in actual GNU sysdeps make."""
import hashlib,json,os,pathlib
T=pathlib.Path(os.environ['GLIBC_TASK']);R=pathlib.Path(__file__).resolve().parents[3];P=pathlib.Path(os.environ['GLIBC_STAT_RUNTIME_PACKET'])
h=lambda p:{'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
manifest=json.loads((P/'manifest.json').read_text())['files'];helper=R/'tools/glibc/jumps/helpers.c';assert h(helper)==manifest[str(helper)]
body=helper.read_bytes();marker=b'/* Checked backend is restricted to known GNU descriptor/linear-stack bounds. */\n';assert body.count(marker)==1
ordinary,checked=body.split(marker);assert b'____longjmp_chk' not in ordinary and checked.count(b'void ____longjmp_chk(')==1
source=T/'source/glibc-2.44';core=source/'sysdeps/wasm32/__longjmp.c';assert core.read_bytes() in [body,ordinary]
# Keep the already accepted implementation byte-for-byte, while placing each
# GNU routine into its actual source-selection unit. No unchecked alias/fallback.
if core.read_bytes()!=ordinary:core.write_bytes(ordinary)
check=source/'sysdeps/unix/sysv/linux/wasm32/____longjmp_chk.c';check.write_bytes(b'#include <setjmp.h>\n#include <tls.h>\n'+marker+checked)
rows=[{'source':str(p),**h(p)} for p in [helper,core,check]]
(T/'logs/checked-jump-overlay.json').write_text(json.dumps({'pass':True,'inputs':rows,'ordinaryBodyPreserved':True,'checkedBodyPreserved':True,'sourceSelection':'linux/wasm32 overrides generic linux fortify backend','scope':'owned source selection, not a new public jump ABI'},indent=2)+'\n')
