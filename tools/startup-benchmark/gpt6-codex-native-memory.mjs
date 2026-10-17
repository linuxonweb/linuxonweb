import { read_wasm_memories } from '../../web/linux/dist/wasm_binary.js';
import { allocate_shared_memory, user_module_imports_supported } from '../../web/linux/dist/wasm.js';

function readU32(bytes, cursor, end = bytes.length) {
  let value = 0;
  for (let index = 0; index < 5; index++) {
    if (cursor.offset >= end) throw Error('Truncated section integer');
    const byte = bytes[cursor.offset++];
    if (index === 4 && byte > 15) throw Error('Section integer overflow');
    value += (byte & 127) * 2 ** (7 * index);
    if (!(byte & 128)) return value;
  }
  throw Error('Invalid section integer');
}

function inspectStartSection(bytes, approval) {
  if (![0, 97, 115, 109, 1, 0, 0, 0].every((value, index) => bytes[index] === value)) throw Error('Invalid Wasm header');
  const cursor = { offset: 8 };
  const result = { index: null, code: null };
  while (cursor.offset < bytes.length) {
    const identifier = bytes[cursor.offset++];
    const size = readU32(bytes, cursor);
    if (size > bytes.length - cursor.offset) throw Error('Truncated section');
    const end = cursor.offset + size;
    if (identifier === 8) {
      if (!approval) throw Error('Automatic Wasm start section is not permitted');
      result.index = readU32(bytes, cursor, end);
      if (cursor.offset !== end || result.index !== approval.index) throw Error('Pinned initializer index mismatch');
    }
    if (identifier === 10) result.code = { offset: cursor.offset, end };
    cursor.offset = end;
  }
  if (approval && result.index === null) throw Error('Missing pinned initializer');
  return result;
}

function verifyInitializer(bytes, module, start, approval) {
  if (start.index === null) return;
  const imported = WebAssembly.Module.imports(module).filter(entry => entry.kind === 'function').length;
  const defined = start.index - imported;
  if (defined < 0 || !start.code) throw Error('Initializer must have an inspected body');
  const cursor = { offset: start.code.offset };
  const count = readU32(bytes, cursor, start.code.end);
  if (defined >= count) throw Error('Initializer function out of range');
  for (let index = 0; index <= defined; index++) {
    const size = readU32(bytes, cursor, start.code.end);
    if (size > start.code.end - cursor.offset) throw Error('Truncated initializer body');
    if (index === defined) {
      if (size * 2 !== approval.bodyHex.length) throw Error('Pinned initializer body length mismatch');
      for (let offset = 0; offset < size; offset++) {
        if (bytes[cursor.offset + offset] !== Number.parseInt(approval.bodyHex.slice(offset * 2, offset * 2 + 2), 16)) throw Error('Pinned initializer body mismatch');
      }
    }
    cursor.offset += size;
  }
}

export function createNativeMemoryProbe({ url, expectedBytes, expectedPages, expectedStart, emit = () => {}, fetch: fetchBytes = globalThis.fetch, clock = performance }) {
  if (typeof url !== 'string' || !url.startsWith('/') || url.startsWith('//') || !Number.isSafeInteger(expectedBytes) || expectedBytes < 8 ||
      !Number.isSafeInteger(expectedPages?.minimum) || !Number.isSafeInteger(expectedPages?.maximum) || expectedPages.minimum < 1 || expectedPages.maximum < expectedPages.minimum || expectedPages.maximum > 65536) {
    throw Error('Invalid pinned native memory plan');
  }
  if (expectedStart && (!Number.isSafeInteger(expectedStart.index) || expectedStart.index < 0 || typeof expectedStart.bodyHex !== 'string' || !/^(?:[a-f0-9]{2})+$/.test(expectedStart.bodyHex))) throw Error('Invalid initializer approval');
  const phases = ['download', 'compile', 'drop-input', 'memory', 'instance', 'release'];
  let next = 0, busy = false, failed = false;
  let input = null, module = null, allocated = null, instance = null;
  let startFunction = null;
  const clear = () => { input = null; module = null; allocated = null; instance = null; };
  const observation = phase => ({
    phase, startFunction, inputBytes: input?.byteLength ?? 0,
    memoryBytes: allocated?.memory.buffer.byteLength ?? 0,
    maximumPages: allocated?.maximum_pages ?? null,
    moduleHeld: module !== null, instanceHeld: instance !== null,
    exports: module ? WebAssembly.Module.exports(module).map(entry => entry.name) : [],
  });
  return {
    async step(phase) {
      if (failed) throw Error('Diagnostic is terminal after failure');
      if (busy) throw Error('Diagnostic stage is busy');
      if (next === phases.length || phase !== phases[next]) throw Error('Unexpected diagnostic phase or already complete');
      busy = true;
      const began = clock.now();
      emit({ phase, event: 'begin', timestampMs: clock.timeOrigin + began });
      let ok = false;
      try {
        if (phase === 'download') {
          const response = await fetchBytes(url, { cache: 'no-store' });
          if (!response.ok || response.status !== 200) throw Error('Native response failed');
          if (response.headers.get('Content-Length') !== String(expectedBytes)) throw Error('Native declared length mismatch');
          input = new Uint8Array(await response.arrayBuffer());
          if (input.byteLength !== expectedBytes) throw Error('Native received size mismatch');
        } else if (phase === 'compile') {
          const start = inspectStartSection(input, expectedStart);
          const memories = read_wasm_memories(input);
          const imported = memories.imports[0];
          if (memories.definitions.length || memories.imports.length !== 1 || imported.module !== 'env' || imported.name !== 'memory' ||
              imported.type.address !== 'i32' || !imported.type.shared || Number(imported.type.minimum) !== expectedPages.minimum || Number(imported.type.maximum) !== expectedPages.maximum) {
            throw Error('Pinned native memory import mismatch');
          }
          module = new WebAssembly.Module(input);
          if (!user_module_imports_supported(module)) throw Error('Unsupported native import');
          verifyInitializer(input, module, start, expectedStart);
          startFunction = start.index;
        } else if (phase === 'drop-input') {
          input = null;
        } else if (phase === 'memory') {
          allocated = allocate_shared_memory(expectedPages.minimum, expectedPages.maximum);
        } else if (phase === 'instance') {
          const linux = Object.fromEntries(WebAssembly.Module.imports(module).filter(entry => entry.kind === 'function').map(entry => [entry.name, () => { throw Error('Application import invoked during constructor-only diagnostic'); }]));
          instance = new WebAssembly.Instance(module, { env: { memory: allocated.memory }, linux });
        } else {
          clear();
        }
        next++;
        ok = true;
        return observation(phase);
      } catch (error) {
        failed = true;
        clear();
        throw error;
      } finally {
        busy = false;
        const ended = clock.now();
        emit({ phase, event: 'end', ok, timestampMs: clock.timeOrigin + ended, durationMs: ended - began, ...observation(phase) });
      }
    },
  };
}
