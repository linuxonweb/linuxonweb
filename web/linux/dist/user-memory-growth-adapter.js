/*
 * Out-of-tree user-memory growth adapter.
 *
 * The kernel linear memory remains bounded by memory_bytes().  This module is
 * used only for user WebAssembly.Memory instances that are shared with the
 * userspace runtime.  Keep this file independent from the sibling
 * linuxwasm-wasm/tools/wasm tree; worker.js imports it explicitly.
 */

const PAGE_BYTES = 64 * 1024;
const MAX_SAFE = Number.MAX_SAFE_INTEGER;

function diagnostic(message, details = {}) {
  try {
    if (typeof console !== "undefined" && typeof console.debug === "function") {
      console.debug(`[user-memory-growth] ${message}`, details);
    }
  } catch (_) {
    // Diagnostics must never turn a memory copy into a trap.
  }
}

function asSafeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`unsafe ${name}: ${String(value)}`);
  }
  return value;
}

/**
 * Ensure [address,address+length) is backed by a user WebAssembly.Memory.
 * Returns a fresh Uint8Array because memory.grow detaches the old buffer.
 */
export function ensureUserBytes(context, address, length, reason = "user") {
  address = asSafeInteger(address, "address");
  length = asSafeInteger(length, "length");
  if (address > MAX_SAFE - length) {
    throw new RangeError(`user range overflow: ${address}+${length}`);
  }

  const end = address + length;
  // Callers may pass the worker context ({memory, maximum_pages}) or the
  // WebAssembly.Memory object directly (copy_bytes destination_memory).
  const memory = context && context.memory ? context.memory : context;
  if (!memory || typeof memory.grow !== "function" || !memory.buffer) {
    throw new RangeError("user memory is unavailable");
  }

  let currentPages = memory.buffer.byteLength / PAGE_BYTES;
  if (!Number.isSafeInteger(currentPages) || currentPages < 0) {
    throw new RangeError(`invalid user memory size: ${memory.buffer.byteLength}`);
  }
  const requiredPages = Math.ceil(end / PAGE_BYTES);
  const maximumPages = Number.isSafeInteger(context && context.maximum_pages)
    ? context.maximum_pages
    : (Number.isSafeInteger(memory.maximum) ? memory.maximum : 65536);
  if (requiredPages > maximumPages) {
    diagnostic("user range exceeds memory maximum", { address, length, requiredPages, maximumPages, reason });
    throw new RangeError(`user memory maximum exceeded: ${requiredPages}>${maximumPages}`);
  }
  if (requiredPages > currentPages) {
    const delta = requiredPages - currentPages;
    if (!Number.isSafeInteger(delta) || delta < 0 || delta > maximumPages - currentPages) {
      throw new RangeError(`invalid user memory growth: ${delta}`);
    }
    try {
      memory.grow(delta);
    } catch (error) {
      diagnostic("user memory growth failed", { delta, requiredPages, currentPages, reason, error });
      throw error;
    }
    // memory.grow detaches memory.buffer; always refresh it.
    currentPages = memory.buffer.byteLength / PAGE_BYTES;
    diagnostic("grew user memory", { fromPages: requiredPages - delta, toPages: currentPages, address, length, reason });
    if (currentPages < requiredPages) {
      throw new RangeError(`user memory growth incomplete: ${currentPages}<${requiredPages}`);
    }
  }
  return new Uint8Array(memory.buffer, address, length);
}

export function ensureUserDestination(context, address, length, reason = "destination") {
  return ensureUserBytes(context, address, length, reason);
}

/** Grow before a syscall returns a userspace mapping/brk range. */
export function growForSyscallResult(context, resultOrNr, lengthOrArg0, arg1, arg2, ret) {
  // Preferred form: (context, result, length, reason).
  if (arguments.length <= 4 || typeof ret === "undefined") {
    const result = resultOrNr;
    const length = lengthOrArg0;
    const reason = arg1 || "syscall";
    if (Number.isSafeInteger(result) && result >= 0 && Number.isSafeInteger(length) && length >= 0) {
      ensureUserBytes(context, result, length, reason);
    }
    return;
  }

  // Worker syscall form: (context, nr, arg0, arg1, arg2, ret).  Wasm Linux
  // trees have used both the x86 and legacy syscall numbering; cover the
  // brk/mmap/mmap2/mremap numbers while ignoring unrelated syscalls.
  const nr = resultOrNr;
  if (!Number.isSafeInteger(ret) || ret < 0) return;
  let address = 0;
  let length = 0;
  if (nr === 9 || nr === 90 || nr === 192 || nr === 222) { // mmap/mmap2
    address = ret;
    length = arg1;
  } else if (nr === 12 || nr === 45) { // brk
    address = lengthOrArg0;
    length = ret >= address ? ret - address : 0;
  } else if (nr === 25 || nr === 163) { // mremap
    address = ret;
    length = arg2;
  } else {
    return;
  }
  if (Number.isSafeInteger(address) && address >= 0 && Number.isSafeInteger(length) && length >= 0) {
    ensureUserBytes(context, address, length, `syscall:${nr}`);
  }
}
