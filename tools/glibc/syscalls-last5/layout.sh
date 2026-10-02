#!/bin/bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")" && pwd)
source "$ROOT/env.sh"
source "$ROOT/../probes/gnu-flags.sh"
source "$ROOT/public-flags.sh"
python3 "$ROOT/compiler.py" "${public_flags[@]}" -c "$ROOT/layout-gnu.c" -o "$TASK/objects/layout-gnu.o"
resource=$("$TASK/objects/compiler/clang" -print-resource-dir)
python3 "$ROOT/compiler.py" -nostdinc -isystem "$resource/include" -isystem "$GLIBC_KERNEL_HEADERS" -matomics -mbulk-memory -c "$ROOT/layout-kernel.c" -o "$TASK/objects/layout-kernel.o"
python3 - <<'PY'
import os,pathlib,json,re,hashlib
T=pathlib.Path(os.environ['GLIBC_TASK']);rows={}
for n in ['gnu','kernel']:
 a=[(p,json.loads(p.read_text())) for p in (T/'logs/c-attempts').glob('*/attempt.json') if json.loads(p.read_text()).get('output')==str(T/f'objects/layout-{n}.o')];p,r=a[-1];assert r['pass'];s=(p.parent/'front.ll').read_text();v=[int(x) for x in re.search(r'@last5_layout =.*?\[(i32 .*?)\]',s).group(1).replace('i32 ','').split(', ')];rows[n]={'values':v,'attempt':str(p),'objectSha256':r['objectSha256']}
expected=[8,4,0,4,12,4,0,4,8,32,8,0,8,16,24,128,4,0,4,8,12,16,20,4,0,-1,-6]
assert rows['gnu']['values']==expected,rows
assert rows['kernel']['values']==expected,rows
(T/'logs/layout.json').write_text(json.dumps({'pass':True,'measurements':rows,'supportedSiginfoClasses':['SI_USER','SI_QUEUE','SI_TKILL'],'otherClasses':'not marshaled'},indent=2)+'\n')
PY
