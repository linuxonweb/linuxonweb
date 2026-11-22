#!/usr/bin/env python3
"""Prepare exact mixed-provider input classes; this does not admit a module.

The compiler must compare these exact source/IR bodies before consuming any
class, and final machine bodies still require an independent audit. Allocating
or stop-calling functions keep real compiler records even when optimization
happens to remove their current stack allocations.
"""
import sys
sys.dont_write_bytecode = True
import hashlib, json, pathlib, re, shutil
from common import T, R, pin

out = T / 'source/provider-admission-plan-1'
out.mkdir()
ir = T / 'objects/provider-compile-1/provider.ll'
assembly = T / 'objects/provider-compile-1/provider.s'
text, native = ir.read_text(), assembly.read_text()
primitive = {
    '__wasm_gnu_unwind_state_valid_v1',
    '__wasm_gnu_unwind_escape_v2',
    '__wasm_gnu_unwind_target_v2',
    '__wasm_gnu_unwind_register_v1',
}
permitted_callees = {
    '__wasm_gnu_frame_thread_v1', '__wasm_gnu_frame_owner_tp_v1',
    '__wasm_gnu_jump_delivery_resolve_v2',
    '__wasm_gnu_jump_delivery_retire_v2',
}
definitions = list(re.finditer(r'^define ([^\n]+)\{\n(.*?)^\}', text, re.M | re.S))
functions = []
for match in definitions:
    body = match.group(0)
    name = re.search(r'@([^ (]+)\(', match.group(1)).group(1)
    emitted = re.search(r'^' + re.escape(name) + r':[^\n]*\n(.*?\bend_function\b)',
                        native, re.M | re.S)
    assert emitted, name
    machine = emitted.group(0)
    signature = re.search(r'^\s*\.functype\s+' + re.escape(name) + r'\s+(.+)$',
                          machine, re.M).group(1)
    direct = re.findall(r'^\s*call\s+(\S+)', machine, re.M)
    indirect = re.findall(r'^\s*(?:call_indirect|return_call_indirect)\s+(.+)$',
                          machine, re.M)
    natives = re.findall(r'^\s*(throw|rethrow)\b', machine, re.M)
    stack_writes = len(re.findall(r'\bglobal\.set\s+__stack_pointer\b', machine))
    if name in primitive:
        assert set(direct) <= permitted_callees, (name, direct)
        assert not indirect and not natives and not stack_writes, name
    ll = out / (name + '.ll')
    asm = out / (name + '.s')
    ll.write_text(body + '\n')
    asm.write_text(machine + '\n')
    functions.append({
        'symbol': name, 'actualWasmSignature': signature,
        'proposedDescriptorFlags': 2 if name in primitive else 4,
        'classification': 'sealed-no-stack-candidate' if name in primitive else 'real-record-required',
        'actualIRBody': {'path': str(ll), **pin(ll)},
        'actualMachineBody': {'path': str(asm), **pin(asm)},
        'directCalls': direct, 'indirectCallSignatures': indirect,
        'nativeThrowOperations': natives, 'linearSPWrites': stack_writes,
        'intrinsicReferences': sorted(set(re.findall(r'@(llvm\.[^ (]+)', body))),
    })
assert {f['symbol'] for f in functions if f['proposedDescriptorFlags'] == 2} == primitive
sources = [ir, assembly, R / 'Unwind-wasm-gnu.c', R / 'forced-abi.h',
           R / 'frame-abi.h', R / 'jump-abi-v2.h', R / 'gnu-unwind.h',
           R / 'unwind.h', R / 'provider-admission-plan.py',
           T / 'logs/provider-primitive-audit-1.json']
rows = []
for i, path in enumerate(sources):
    copy = out / ('input-' + str(i) + '-' + path.name)
    shutil.copyfile(path, copy)
    rows.append({'path': str(path), **pin(path), 'snapshot': str(copy)})
proof = {
    'schema': 'wasm-gnu-mixed-provider-input-proposal-v1',
    'providerAdmissionImplemented': False, 'runtimeAccepted': False,
    'compilerConsumptionRequiresExactInputDigest': True,
    'inputPins': rows, 'functions': functions,
    'closedPrimitiveDefinitions': len(primitive),
    'recordedDefinitionsRequired': len(functions) - len(primitive),
    'notAnAdmissionDecision': [
        'Current provider IR was compiled flags-off. It has no compiler-owned records or descriptor manifest.',
        'Only four exact bodies are proposed as primitives; the same namespace does not admit another definition or declaration.',
        'All other functions must be materialized as real descriptor4 activations before execution, including guard, terminal, personality, context validation, fatal and native raise helpers.',
        'Canonical accessor and generation-handle delivery bodies require separately pinned transitive no-stack/no-import/no-poll/no-reentrancy audits.',
        'The final immutable compiler root must include both descriptor2 and descriptor4 identities and derive the genuine root getter.',
        'The primitive functions may not acquire calls to allocating guard/stop/personality/fatal functions through optimization or later transformations.',
        'Authenticated native throw intrinsics are provider-specific compiler inputs; arbitrary source throw/import/inline assembly remains rejected.',
        'Source/IR pin matching does not replace final machine verification and admission audits.',
    ],
}
destination = T / 'logs/provider-admission-plan-1.json'
assert not destination.exists()
destination.write_text(json.dumps(proof, indent=2) + '\n')
print(json.dumps({'plan': str(destination), **pin(destination),
                  'definitions': len(functions), 'primitiveCandidates': len(primitive),
                  'realRecordsRequired': len(functions) - len(primitive)}, indent=2))
