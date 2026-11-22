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
 a=[(p,json.loads(p.read_text())) for p in (T/'logs/c-attempts').glob('*/attempt.json') if json.loads(p.read_text()).get('output')==str(T/f'objects/layout-{n}.o')];p,r=a[-1];assert r['pass'];s=(p.parent/'front.ll').read_text();v=[int(x) for x in re.search(r'@final16_layout =.*?\[(i32 .*?)\]',s).group(1).replace('i32 ','').split(', ')];rows[n]={'values':v,'attempt':str(p),'objectSha256':r['objectSha256']}
assert rows['gnu']['values']==[390,1,325,64,4,4,40,44,52,56,4,16,8,8,8,4,8,8,4,4],rows
assert rows['kernel']['values']==rows['gnu']['values'][:14]+rows['gnu']['values'][17:],rows
(T/'logs/layout.json').write_text(json.dumps({'pass':True,'measurements':rows},indent=2)+'\n')
PY
