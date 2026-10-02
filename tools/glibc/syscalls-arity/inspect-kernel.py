#!/usr/bin/env python3
"""Read retained Wasm sections; no compiler, guest, or kernel mutation."""
import hashlib, json, pathlib
ROOT = pathlib.Path('/mnt/p6/project/linux/linuxonweb')
import os
OUT=pathlib.Path(os.environ['GLIBC_TASK'])/'logs'
b = (ROOT/'web/linux/vmlinux.wasm').read_bytes()
p = 8
def u():
    global p
    n = s = 0
    while True:
        v = b[p]; p += 1; n |= (v & 127) << s
        if v < 128: return n
        s += 7
def string():
    global p
    n = u(); x = b[p:p+n]; p += n
    return x.decode()
def limits():
    f = u(); u()
    if f & 1: u()
def expr():
    global p
    opcode = b[p]; p += 1
    assert opcode == 0x41, (p, opcode)
    value = u(); assert b[p] == 0x0b; p += 1
    return value
sections = {}; names = {}; bodies = {}; elements = {}; imports = 0
while p < len(b):
    sid = b[p]; p += 1; n = u(); start = p; end = start + n
    sections[sid] = (start, n)
    if sid == 2:
        for _ in range(u()):
            string(); string(); kind = b[p]; p += 1
            if kind == 0: u(); imports += 1
            elif kind == 1: p += 1; limits()
            elif kind == 2: limits()
            elif kind == 3: p += 2
            elif kind == 4: p += 1; u()
            else: raise ValueError(kind)
    elif sid == 9:
        for _ in range(u()):
            flags = u()
            assert flags == 0, flags
            offset = expr()
            for i in range(u()): elements[offset+i] = u()
    elif sid == 10:
        count = u()
        for index in range(imports, imports + count):
            size = u(); offset = p; raw = b[p:p+size]; p += size
            bodies[index] = dict(bodyOffset=offset, bodySize=size,
                bodySha256=hashlib.sha256(raw).hexdigest(),
                bodyPrefixHex=raw[:24].hex(), boundEnosys=(raw == bytes.fromhex('00415a0b')))
    elif sid == 0 and string() == 'name':
        while p < end:
            sub = b[p]; p += 1; size = u(); subend = p + size
            if sub == 1:
                for _ in range(u()):
                    index = u(); names[index] = string()
            p = subend
    p = end
requested=['prctl','vhangup','sync','init_module','delete_module','cap_task_prctl']
entries = []
for call in requested:
    candidates = []
    for idx, name in names.items():
        if name in (call,'__wasm_sys_'+call, 'sys_'+call, '__se_sys_'+call):
            candidates.append(dict(name=name, functionIndex=idx,
                elementIndices=[i for i, f in elements.items() if f == idx], **bodies.get(idx, {})))
    entries.append(dict(call=call, functions=candidates))
report = dict(scope='retained binary section inspection only; no runtime acceptance',
    kernelPath=str(ROOT/'web/linux/vmlinux.wasm'), kernelSha256=hashlib.sha256(b).hexdigest(),
    functionImports=imports, codeBodyCount=count, entries=entries)
(OUT/'kernel-bodies.json').write_text(json.dumps(report, indent=2)+'\n')
for e in entries:
    print(e['call'], '; '.join(f"{x['name']} fn={x['functionIndex']} elem={x['elementIndices']} offset={x['bodyOffset']} size={x['bodySize']} enosys={x['boundEnosys']}" for x in e['functions']) or 'no named definition')
