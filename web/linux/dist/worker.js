// SPDX-License-Identifier: MIT
import { platform } from "./platform.js";
import { assert } from "./util.js";
import { read_wasm_memories } from "./wasm_binary.js";
import { allocate_shared_memory, HALT_KERNEL, kernel_imports, memory_bytes, user_module_imports_supported, } from "./wasm.js";
import { ensureUserDestination, growForSyscallResult } from "./user-memory-growth-adapter.js";
import { installFirefoxCallbackAdapter } from "./firefox-callback-adapter.mjs";
const unavailable = () => {
    throw new Error("not available on worker thread");
};
const channel = platform.worker_channel();
const postMessage = channel.post;
function user_imports({ kernel_memory, get_kernel_instance, parent_user: parent, }) {
    const HALT_USER = Symbol("halt user");
    let context = parent;
    let instance = null;
    let pending_module_bytes = null;
    let pending = null;
    // One slot per nested SA_SIGINFO callback; null means its trampoline has
    // not requested the active signal payload yet.
    const siginfo_copy_results = [];
    function copy_bytes(destination_memory, destination, source_memory, source, length, grow_user_destination = false) {
        if (grow_user_destination) {
            try {
                ensureUserDestination(destination_memory, destination, length, "copy_bytes");
            }
            catch {
                return length;
            }
        }
        const to = memory_bytes(destination_memory, destination, length);
        const from = memory_bytes(source_memory, source, length);
        if (!to || !from)
            return length;
        try {
            to.set(from);
            return 0;
        }
        catch {
            return length;
        }
    }
    function user_atomic_word(uaddr) {
        const address = uaddr >>> 0;
        if (!context || (address & 3) !== 0)
            return null;
        try {
            ensureUserDestination(context.memory, address, Int32Array.BYTES_PER_ELEMENT, "atomic");
        }
        catch {
            return null;
        }
        const bytes = memory_bytes(context.memory, address, Int32Array.BYTES_PER_ELEMENT);
        return bytes ? new Int32Array(bytes.buffer, bytes.byteOffset, 1) : null;
    }
    function write_kernel_u32(addr, value) {
        const bytes = memory_bytes(kernel_memory, addr >>> 0, Uint32Array.BYTES_PER_ELEMENT);
        if (!bytes)
            return false;
        new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(0, value, true);
        return true;
    }
    function firefox_diagnostics_enabled() {
        try {
            return new URL(globalThis.location?.href ?? "").searchParams.get("firefox_diagnostics") === "1";
        }
        catch {
            return false;
        }
    }
    function firefox_memory_pregrow_enabled() {
        try {
            return new URL(globalThis.location?.href ?? "", globalThis.location?.origin).searchParams.get("firefox_memory_pregrow") === "1";
        } catch {
            return false;
        }
    }

    function firefox_memory_pregrow_before_start(memory) {
        if (!firefox_memory_pregrow_enabled() || !firefox_memory_pregrow_allowed || !memory?.buffer)
            return null;
        try {
            const pageSize = 65536;
            const oldPages = memory.buffer.byteLength / pageSize;
            const targetPages = 1024;
            if (oldPages >= targetPages) {
                console.warn("[FIREFOX_MEMORY_PREGROW]", JSON.stringify({ moduleGate: firefox_strict_module_allowed, oldPages, newPages: oldPages, delta: 0 }));
                return oldPages;
            }
            const delta = targetPages - oldPages;
            const grownFrom = memory.grow(delta);
            const newPages = memory.buffer.byteLength / pageSize;
            console.warn("[FIREFOX_MEMORY_PREGROW]", JSON.stringify({ moduleGate: firefox_strict_module_allowed, oldPages: grownFrom, newPages, delta }));
            return newPages;
        } catch (error) {
            console.warn("[FIREFOX_MEMORY_PREGROW] grow failed", JSON.stringify({ moduleGate: firefox_strict_module_allowed, error: String(error) }));
            return null;
        }
    }

    function firefox_guard_memory_diag_enabled() {
        try {
            return new URL(globalThis.location?.href ?? "", globalThis.location?.origin).searchParams.get("firefox_guard_memory_diag") === "1";
        } catch {
            return false;
        }
    }

    function firefox_guard_memory_diag_before_start(memory) {
        if (!firefox_guard_memory_diag_enabled() || !firefox_strict_module_allowed || !memory?.buffer)
            return null;
        const addresses = {
            mutex: 46209940,
            cond: 46209920,
            guardA: 45757056,
            guardB: 45757072,
        };
        const values = {};
        try {
            const view = new DataView(memory.buffer);
            for (const [name, address] of Object.entries(addresses)) {
                if (name === "guardA" || name === "guardB") {
                    values[name] = address < view.byteLength ? view.getUint8(address) : null;
                } else {
                    values[name] = address + 4 <= view.byteLength ? view.getUint32(address, true) : null;
                }
            }
            console.warn("[FIREFOX_GUARD_MEMORY_DIAG]", JSON.stringify({ moduleGate: firefox_strict_module_allowed, values }));
            return values;
        } catch (error) {
            console.warn("[FIREFOX_GUARD_MEMORY_DIAG] read failed", JSON.stringify({ moduleGate: firefox_strict_module_allowed, error: String(error), values }));
            return null;
        }
    }

    function firefox_guard_bypass_all_enabled() {
        try {
            return new URL(globalThis.location?.href ?? "", globalThis.location?.origin).searchParams.get("firefox_guard_bypass_all") === "1";
        } catch {
            return false;
        }
    }

    function firefox_guard_bypass_all_before_start(memory) {
        if (!firefox_guard_bypass_all_enabled() || !firefox_strict_module_allowed || !memory?.buffer)
            return null;
        const addresses = [45757056, 45757072];
        const writes = [];
        try {
            const buffer = memory.buffer;
            const shared = typeof SharedArrayBuffer !== "undefined" && buffer instanceof SharedArrayBuffer;
            for (const address of addresses) {
                if (address + 1 > buffer.byteLength)
                    continue;
                const bytes = new Uint8Array(buffer, address, 1);
                const oldValue = shared ? Atomics.load(bytes, 0) : bytes[0];
                if (shared)
                    Atomics.store(bytes, 0, 1);
                else
                    bytes[0] = 1;
                writes.push({ address, old: oldValue, new: 1 });
            }
            console.warn("[FIREFOX_GUARD_BYPASS_ALL]", JSON.stringify({ moduleGate: firefox_strict_module_allowed, writes }));
            return writes;
        } catch (error) {
            console.warn("[FIREFOX_GUARD_BYPASS_ALL] write failed", JSON.stringify({ moduleGate: firefox_strict_module_allowed, error: String(error), writes }));
            return null;
        }
    }

    function firefox_guard_bypass_enabled() {
        try {
            return new URL(globalThis.location?.href ?? "", globalThis.location?.origin).searchParams.get("firefox_guard_bypass") === "1";
        } catch {
            return false;
        }
    }

    function firefox_guard_bypass_before_start(memory) {
        if (!firefox_guard_bypass_enabled() || !memory?.buffer)
            return null;
        const address = 0x02ba0000;
        try {
            const buffer = memory.buffer;
            if (address + 1 > buffer.byteLength)
                return null;
            const shared = typeof SharedArrayBuffer !== "undefined" && buffer instanceof SharedArrayBuffer;
            const bytes = new Uint8Array(buffer, address, 1);
            const oldValue = shared ? Atomics.load(bytes, 0) : bytes[0];
            if (shared)
                Atomics.store(bytes, 0, 1);
            else
                bytes[0] = 1;
            console.warn("[FIREFOX_GUARD_BYPASS]", JSON.stringify({ address, old: oldValue, new: 1 }));
            return oldValue;
        } catch (error) {
            console.warn("[FIREFOX_GUARD_BYPASS] write failed", JSON.stringify({ address, error: String(error) }));
            return null;
        }
    }

    function firefox_start_guard_enabled() {
        try {
            return new URL(globalThis.location?.href ?? "", globalThis.location?.origin).searchParams.get("firefox_start_guard") === "1";
        } catch {
            return false;
        }
    }

    function firefox_start_guard_snapshot(memory, phase) {
        if (!firefox_start_guard_enabled() || !memory?.buffer)
            return null;
        const address = 37277824;
        try {
            const buffer = memory.buffer;
            if (address + 4 > buffer.byteLength)
                return null;
            let value;
            if (typeof SharedArrayBuffer !== "undefined" && buffer instanceof SharedArrayBuffer)
                value = Atomics.load(new Uint32Array(buffer, address, 1), 0);
            else
                value = new DataView(buffer).getUint32(address, true);
            console.warn("[FIREFOX_START_GUARD] memory", JSON.stringify({ phase, address, value }));
            return value;
        } catch (error) {
            console.warn("[FIREFOX_START_GUARD] memory read failed", JSON.stringify({ phase, address, error: String(error) }));
            return null;
        }
    }

    function call_start() {
        assert(instance);
        const { _start } = instance.exports;
        assert(typeof _start === "function", "_start not found");
        if (firefox_diagnostics_enabled())
            console.error("[firefox-callback-adapter] before _start");
        firefox_memory_pregrow_before_start(firefox_start_guard_memory);
        firefox_guard_memory_diag_before_start(firefox_start_guard_memory);
        firefox_guard_bypass_before_start(firefox_start_guard_memory);
        firefox_guard_bypass_all_before_start(firefox_start_guard_memory);
        firefox_start_guard_snapshot(firefox_start_guard_memory, "before-start");
        try {
            _start();
        } catch (error) {
            if (firefox_abort_trace_instances.has(instance)) {
                try {
                    console.warn("[FIREFOX_ABORT_TRACE] start error", JSON.stringify({
                        message: String(error?.message ?? error).slice(0, 1024),
                        stack: String(error?.stack ?? "").slice(0, 8192),
                    }));
                } catch {
                    // Diagnostics must not replace the original guest error.
                }
            }
            firefox_start_guard_snapshot(firefox_start_guard_memory, "after-start-error");
            throw error;
        }
        firefox_start_guard_snapshot(firefox_start_guard_memory, "after-start");
        throw new Error("_start reached the end without exiting");
    }
    // Binaryen's fpcast-emu pass gives every indirect-table entry one uniform
    // i64 ABI. This makes legacy native-C callback casts safe on WebAssembly,
    // but user entrypoints invoked directly by the Linux shim must use that ABI
    // too. Normal, untransformed user modules keep their original JS-facing
    // signatures and continue down the first branch.
    const FPCAST_EMU_ARITY = 23;
    function call_user_table_function(f, args, expected_arity, error_message) {
        assert(typeof f === "function", error_message);
        if (f.length === expected_arity)
            return f(...args);
        assert(f.length === FPCAST_EMU_ARITY, error_message);
        const abi_args = Array(FPCAST_EMU_ARITY).fill(0n);
        for (let index = 0; index < args.length; index += 1) {
            abi_args[index] = BigInt(args[index] >>> 0);
        }
        return f(...abi_args);
    }
    let call_entry = call_start;
let firefox_start_guard_memory = null;
const firefox_abort_trace_instances = new WeakSet();

function firefox_abort_trace_enabled() {
    try {
        return new URL(globalThis.location.href).searchParams.get("firefox_abort_trace") === "1";
    } catch {
        return false;
    }
}
let firefox_memory_pregrow_allowed = false;
let firefox_strict_module_allowed = false;

function firefox_syscall_trace_enabled() {
    try {
        return new URL(globalThis.location?.href ?? "", globalThis.location?.origin).searchParams.get("firefox_syscall_trace") === "1";
    } catch {
        return false;
    }
}

function firefox_tls_adapter_enabled() {
    try {
        return new URL(globalThis.location?.href ?? "", globalThis.location?.origin).searchParams.get("firefox_tls_adapter") === "1";
    } catch {
        return false;
    }
}

function isFirefoxSyscallTraceModule(module) {
    try {
        const hasStart = WebAssembly.Module.exports(module).some(({ name }) => name === "_start");
        const hasLinuxSyscalls = WebAssembly.Module.imports(module).some(({ module: name, name: field }) => name === "linux" && field === "syscall");
        return hasStart && hasLinuxSyscalls;
    } catch {
        return false;
    }
}

function isFirefoxTlsModule(module) {
    try {
        const exports = WebAssembly.Module.exports(module);
        return exports.some(({ name }) => name === "_start") &&
            exports.some(({ name }) => name === "__indirect_function_table");
    } catch {
        return false;
    }
}

function create_instance(context) {
  firefox_start_guard_memory = context.memory;
  firefox_strict_module_allowed = isFirefoxSyscallTraceModule(context.module);
  firefox_memory_pregrow_allowed = firefox_strict_module_allowed;
  const kernel_instance = get_kernel_instance();
  const traceSyscalls = firefox_syscall_trace_enabled() && isFirefoxSyscallTraceModule(context.module);
  const tlsAdapter = firefox_tls_adapter_enabled() &&
    (isFirefoxSyscallTraceModule(context.module) || isFirefoxTlsModule(context.module));
  let tracedSyscalls = 0;
  let threadAreaPointer = null;
  let threadAreaLogged = false;
  let threadAreaGetLogged = false;
    firefox_start_guard_snapshot(context.memory, "before-instance");
    const abortTrace = firefox_abort_trace_enabled() && isFirefoxSyscallTraceModule(context.module);
    if (abortTrace) Error.stackTraceLimit = 64;
    let abortTraceWrites = 0;
    let abortTraceBytes = 0;
    function traceAbortWrite(nr, fd, pointer, length) {
        if (!abortTrace || abortTraceWrites >= 16 || abortTraceBytes >= 4096)
            return;
        const callNumber = Number(nr);
        const descriptor = Number(fd);
        // The guest uses the Linux i386 ABI: write=4, writev=146.
        if ((callNumber !== 4 && callNumber !== 146) || (descriptor !== 1 && descriptor !== 2))
            return;
        abortTraceWrites += 1;
        try {
            const buffer = context.memory.buffer;
            const view = new DataView(buffer);
            const limit = Math.min(512, 4096 - abortTraceBytes);
            const captured = [];
            function copyRange(address, count) {
                if (!Number.isSafeInteger(address) || !Number.isSafeInteger(count) || address < 0 || count < 0 || address + count > buffer.byteLength)
                    return;
                const take = Math.min(count, limit - captured.length);
                const bytes = new Uint8Array(buffer, address, take);
                for (const byte of bytes) captured.push(byte);
            }
            const address = Number(pointer);
            const count = Number(length);
            if (callNumber === 4) {
                copyRange(address, count);
            } else if (Number.isSafeInteger(address) && Number.isSafeInteger(count) && address >= 0 && count >= 0 && address + Math.min(count, 8) * 8 <= buffer.byteLength) {
                for (let i = 0; i < Math.min(count, 8) && captured.length < limit; i += 1) {
                    copyRange(view.getUint32(address + i * 8, true), view.getUint32(address + i * 8 + 4, true));
                }
            }
            abortTraceBytes += captured.length;
            console.warn("[FIREFOX_ABORT_TRACE] write attempt", JSON.stringify({
                nr: callNumber, fd: descriptor, bytes: captured.length,
                text: new TextDecoder().decode(new Uint8Array(captured)),
                stack: String(new Error().stack ?? "").slice(0, 4096),
            }));
        } catch {
            // Observing a bad guest pointer must not change syscall behavior.
        }
    }
    const user_instance = new WebAssembly.Instance(context.module, {
            env: { memory: context.memory },
            linux: {
      syscall: (nr, arg0, arg1, arg2, arg3, arg4, arg5) => {
        const original_instance = instance;
        traceAbortWrite(nr, arg0, arg1, arg2);
        const ret = kernel_instance.exports.syscall(nr, arg0, arg1, arg2, arg3, arg4, arg5);
        if (tlsAdapter && (nr === 244 || nr === 244n)) {
          let descriptorValue = null;
          try {
            const descriptor = Number(arg0);
            const buffer = firefox_start_guard_memory?.buffer;
            if (Number.isSafeInteger(descriptor) && buffer && descriptor >= 0 && descriptor + 8 <= buffer.byteLength)
              descriptorValue = new DataView(buffer).getUint32(descriptor + 4, true);
          } catch {
            descriptorValue = null;
          }
          if (descriptorValue !== null)
            threadAreaPointer = typeof arg0 === "bigint" ? BigInt(descriptorValue) : descriptorValue;
          else
            threadAreaPointer = null;
          if (!threadAreaLogged) {
            threadAreaLogged = true;
            console.warn("[FIREFOX_TLS_ADAPTER]", JSON.stringify({ nr: String(nr), descriptor: String(arg0), pointer: descriptorValue === null ? null : String(threadAreaPointer) }));
          }
        }
        if (traceSyscalls && tracedSyscalls < 128) {
          tracedSyscalls += 1;
          const marker = nr === 60 ? "exit" : nr === 231 ? "exit_group" : nr === 1 ? "write" : null;
          console.warn("[FIREFOX_SYSCALL_TRACE]", JSON.stringify({ call: tracedSyscalls, nr, args: [arg0, arg1, arg2], result: ret, marker }));
        }
                    try {
                        growForSyscallResult(context, nr, arg0, arg1, arg2, ret);
                    }
                    catch (error) {
                        console.debug("[user-memory-growth] syscall range unavailable", { nr, ret, error });
                    }
                    if (instance !== original_instance) {
                        call_entry = call_start;
                        throw HALT_USER;
                    }
                    return ret;
                },
      get_thread_area: (addr) => {
        const original = kernel_instance.exports.get_thread_area(addr);
        const returned = tlsAdapter && threadAreaPointer !== null ? threadAreaPointer : original;
        if (tlsAdapter && !threadAreaGetLogged) {
          threadAreaGetLogged = true;
          console.warn("[FIREFOX_TLS_ADAPTER] get_thread_area", JSON.stringify({
            addr: String(addr),
            original: String(original),
            returned: String(returned),
            returnedType: typeof returned,
            cached: threadAreaPointer !== null,
          }));
        }
        return returned;
      },
                copy_siginfo: (to) => {
                    const result = kernel_instance.exports.copy_siginfo(to);
                    const current = siginfo_copy_results.length - 1;
                    if (current >= 0)
                        siginfo_copy_results[current] = result;
                    return result;
                },
            },
        });
        const diagnostics = firefox_diagnostics_enabled();
        if (diagnostics)
            console.error("[firefox-callback-adapter] before install");
    firefox_start_guard_snapshot(context.memory, "after-instance");
    if (abortTrace) firefox_abort_trace_instances.add(user_instance);
    const patched = installFirefoxCallbackAdapter(context.module, user_instance);
        if (diagnostics)
            console.error("[firefox-callback-adapter] after install", { patched });
        if (patched) {
            console.debug(`[firefox-callback-adapter] filled ${patched} reserved indirect-table entries`);
        }
        return user_instance;
    }
    function instantiate(fresh_memory) {
        if (fresh_memory) {
            assert(pending);
            context = pending;
            pending = null;
        }
        assert(context);
        instance = create_instance(context);
    }
    return {
        get context() {
            return context;
        },
        prepare() {
            if (parent)
                instantiate(false);
        },
        imports: {
            // program management:
            compile_begin(size) {
                pending_module_bytes = null;
                pending = null;
                try {
                    pending_module_bytes = new Uint8Array(size >>> 0);
                    return 0;
                }
                catch {
                    return -12; // out of memory
                }
            },
            compile_write(buf, offset, size) {
                const source = buf >>> 0;
                const destination = offset >>> 0;
                const length = size >>> 0;
                const kernel_buffer = kernel_memory.buffer;
                if (!pending_module_bytes ||
                    source > kernel_buffer.byteLength - length ||
                    destination > pending_module_bytes.length - length) {
                    return -22; // invalid argument
                }
                pending_module_bytes.set(new Uint8Array(kernel_buffer, source, length), destination);
                return 0;
            },
            compile_end(maximum_memory_pages) {
                const bytes = pending_module_bytes;
                pending_module_bytes = null;
                if (!bytes)
                    return -22; // invalid argument
                const rlimit_pages = maximum_memory_pages >>> 0;
                let module;
                let minimum;
                let maximum;
                try {
                    const memories = read_wasm_memories(bytes);
                    const memory_import = memories.imports[0];
                    if (memories.definitions.length !== 0 ||
                        memories.imports.length !== 1 ||
                        !memory_import ||
                        memory_import.module !== "env" ||
                        memory_import.name !== "memory" ||
                        memory_import.type.address !== "i32" ||
                        !memory_import.type.shared ||
                        memory_import.type.maximum === undefined) {
                        return -8; // exec format error
                    }
                    module = new WebAssembly.Module(bytes);
                    if (!user_module_imports_supported(module)) {
                        return -8; // exec format error
                    }
                    minimum = Number(memory_import.type.minimum);
                    maximum = Math.min(Number(memory_import.type.maximum), rlimit_pages);
                }
                catch {
                    return -8; // exec format error
                }
                if (maximum < minimum)
                    return -12; // out of memory
                let allocated;
                try {
                    allocated = allocate_shared_memory(minimum, maximum);
                }
                catch {
                    return -12; // out of memory
                }
                const next_context = { module, ...allocated };
                pending = next_context;
                return 0;
            },
            compile_abort() {
                pending_module_bytes = null;
                pending = null;
            },
            instantiate(fresh_memory) {
                instantiate(Boolean(fresh_memory));
            },
            call() {
                for (;;) {
                    try {
                        call_entry();
                    }
                    catch (error) {
                        if (error === HALT_USER)
                            continue;
                        if (error === HALT_KERNEL)
                            throw error;
                        // A trap from the guest Wasm module is expected to arrive
                        // here through call_start/call_entry.  Keep the existing
                        // return/status behaviour, but identify it as a guest
                        // failure so it is not confused with a worker/JS bug.
                        const wasm_runtime_error = typeof WebAssembly !== "undefined" &&
                            typeof WebAssembly.RuntimeError === "function" &&
                            error instanceof WebAssembly.RuntimeError;
                        if (wasm_runtime_error) {
                            let exports = [];
                            try {
                                exports = context?.module ?
                                    WebAssembly.Module.exports(context.module).map(({ name }) => name) : [];
                            }
                            catch {
                                // Module metadata is diagnostic only; preserve the
                                // original trap handling if it cannot be read.
                            }
                            console.error("[user-module] WebAssembly runtime trap", {
                                name: error?.name,
                                message: error?.message,
                                entry: call_entry === call_start ? "_start" : "indirect",
                                exports,
                                stack: error?.stack,
                            });
                            if (firefox_abort_trace_enabled()) {
                                const stack = typeof error?.stack === "string" ? error.stack : String(error);
                                console.error("[FIREFOX_ABORT_TRACE] RuntimeError.stack\n" + stack.slice(0, 8192));
                            }
                        }
                        else {
                            console.error("[user-module] bridge exception", error);
                        }
                        return;
                    }
                }
            },
            switch_entry(fn, arg) {
                // This is called if this thread was created by a clone call,
                // so its entrypoint is a user-specified function.
                // The worker prepares an instance sharing the parent's user context
                // before the kernel enters this callback.
                assert(parent);
                call_entry = () => {
                    assert(instance);
                    const { __indirect_function_table } = instance.exports;
                    assert(__indirect_function_table instanceof WebAssembly.Table, "Invalid function table");
                    call_user_table_function(__indirect_function_table.get(fn >>> 0), [arg], 1, "Invalid function signature");
                    // throw new Error("thread entrypoint reached the end without exiting");
                    console.warn("thread entrypoint reached the end without exiting");
                };
            },
            // signal handling:
            call_signal_handler(fn, sig) {
                assert(instance);
                const { __indirect_function_table } = instance.exports;
                assert(__indirect_function_table instanceof WebAssembly.Table, "Invalid function table");
                call_user_table_function(__indirect_function_table.get(fn >>> 0), [sig], 1, "Invalid function signature");
            },
            call_siginfo_handler(trampoline, fn, sig) {
                assert(instance);
                const { __indirect_function_table } = instance.exports;
                assert(__indirect_function_table instanceof WebAssembly.Table, "Invalid function table");
                siginfo_copy_results.push(null);
                try {
                    call_user_table_function(__indirect_function_table.get(trampoline >>> 0), [fn, sig], 2, "Invalid siginfo trampoline");
                    return siginfo_copy_results.at(-1) ?? -22;
                }
                finally {
                    // Non-local exits can unwind the kernel callback before its C cleanup.
                    try {
                        get_kernel_instance().exports.clear_siginfo();
                    }
                    finally {
                        siginfo_copy_results.pop();
                    }
                }
            },
            // memory:
            read(to, from, n) {
                const length = n >>> 0;
                if (!context)
                    return length;
                return copy_bytes(kernel_memory, to >>> 0, context.memory, from >>> 0, length);
            },
            write(to, from, n) {
                const length = n >>> 0;
                if (!context)
                    return length;
                return copy_bytes(context.memory, to >>> 0, kernel_memory, from >>> 0, length, true);
            },
            write_zeroes(to, n) {
                const length = n >>> 0;
                if (!context)
                    return length;
                let destination;
                try {
                    destination = ensureUserDestination(context.memory, to >>> 0, length, "write_zeroes");
                }
                catch {
                    return length;
                }
                if (!destination)
                    return length;
                try {
                    destination.fill(0);
                    return 0;
                }
                catch {
                    return length;
                }
            },
            futex_atomic_op(oldval, uaddr, op, oparg) {
                const word = user_atomic_word(uaddr);
                if (!word)
                    return -14; // bad address
                let old;
                switch (op) {
                    case 0: // FUTEX_OP_SET
                        old = Atomics.exchange(word, 0, oparg);
                        break;
                    case 1: // FUTEX_OP_ADD
                        old = Atomics.add(word, 0, oparg);
                        break;
                    case 2: // FUTEX_OP_OR
                        old = Atomics.or(word, 0, oparg);
                        break;
                    case 3: // FUTEX_OP_ANDN
                        old = Atomics.and(word, 0, ~oparg);
                        break;
                    case 4: // FUTEX_OP_XOR
                        old = Atomics.xor(word, 0, oparg);
                        break;
                    default:
                        return -38; // function not implemented
                }
                return write_kernel_u32(oldval, old) ? 0 : -14; // bad address
            },
            futex_atomic_cmpxchg(oldval, uaddr, expected, replacement) {
                const word = user_atomic_word(uaddr);
                if (!word)
                    return -14; // bad address
                const old = Atomics.compareExchange(word, 0, expected, replacement);
                return write_kernel_u32(oldval, old) ? 0 : -14; // bad address
            },
        },
    };
}
function start({ fn, arg, vmlinux, memory, user: initial_user_context, user_copy_status, framebuffer, }) {
    let user_context = initial_user_context;
    if (user_copy_status) {
        assert(user_context);
        // fork.c permits COPY only for a single-user mm, and the caller blocks
        // until publication below, so the source is stable. Allocate here so the
        // private backing store is owned by the destination isolate, not the
        // long-lived parent.
        try {
            const source = memory_bytes(user_context.memory, 0);
            if (!source)
                throw new RangeError("invalid source memory");
            const copied = allocate_shared_memory(source.byteLength / 0x10000, user_context.maximum_pages);
            const destination = memory_bytes(copied.memory, 0, source.byteLength);
            if (!destination)
                throw new RangeError("invalid destination memory");
            destination.set(source);
            user_context = { module: user_context.module, ...copied };
            Atomics.store(user_copy_status, 0, 1);
        }
        catch {
            Atomics.store(user_copy_status, 0, -12);
        }
        Atomics.notify(user_copy_status, 0);
        if (Atomics.load(user_copy_status, 0) < 0) {
            postMessage({ type: "worker_exit" });
            platform.quit();
            return;
        }
    }
    const user = user_imports({
        kernel_memory: memory,
        get_kernel_instance: () => instance,
        parent_user: user_context,
    });
    const imports = {
        env: { memory },
        boot: {
            get_devicetree: unavailable,
            get_initramfs: unavailable,
        },
        user: user.imports,
        kernel: kernel_imports({
            is_worker: true,
            memory,
            spawn_worker(fn, arg, name, user, copy_user_memory) {
                const direct = new MessageChannel();
                postMessage({
                    type: "spawn_worker",
                    name,
                    port: direct.port1,
                }, [direct.port1]);
                const user_copy_status = copy_user_memory
                    ? new Int32Array(new SharedArrayBuffer(4))
                    : null;
                direct.port2.postMessage({
                    type: "init",
                    fn,
                    arg,
                    vmlinux,
                    memory,
                    user,
                    user_copy_status,
                    framebuffer,
                });
                if (!user_copy_status)
                    return 0;
                // If publication wins the race, wait returns "not-equal"; no wakeup
                // is lost.
                Atomics.wait(user_copy_status, 0, 0);
                const result = Atomics.load(user_copy_status, 0);
                assert(result === 1 || result < 0, "copy wait completed without a result");
                return result === 1 ? 0 : result;
            },
            boot_console_write(message) {
                postMessage({ type: "boot_console_write", message });
            },
            boot_console_close() {
                postMessage({ type: "boot_console_close" });
            },
            terminate_machine(reason) {
                postMessage({ type: "terminate_machine", reason });
            },
            run_on_main(fn, arg) {
                postMessage({ type: "run_on_main", fn, arg });
            },
            get_user_context() {
                return user.context;
            },
            worker_exit() {
                postMessage({ type: "worker_exit" });
            },
        }),
        virtio: {
            set_features: unavailable,
            setup: unavailable,
            reset: unavailable,
            enable_vring: unavailable,
            disable_vring: unavailable,
            notify: unavailable,
            // Probe runs on workers and needs a synchronous config rewrite.
            config_written(dev) {
                const status = new Int32Array(new SharedArrayBuffer(4));
                postMessage({
                    type: "virtio_config_written",
                    dev: dev >>> 0,
                    status,
                });
                Atomics.wait(status, 0, 0);
            },
        },
        // get_mode must work on workers (probe runs there). present() is only
        // invoked from the main agent after run_on_main.
        fb: {
            get_mode(width_ptr, height_ptr, bpp_ptr) {
                const view = new DataView(memory.buffer);
                view.setUint32(width_ptr >>> 0, framebuffer.width, true);
                view.setUint32(height_ptr >>> 0, framebuffer.height, true);
                view.setUint32(bpp_ptr >>> 0, framebuffer.bpp, true);
            },
            present: unavailable,
        },
    };
    const instance = new WebAssembly.Instance(vmlinux, imports);
    user.prepare();
    try {
        instance.exports.__indirect_function_table.get(fn >>> 0)(arg);
    }
    catch (error) {
        if (error === HALT_KERNEL)
            return;
        throw error;
    }
}
channel.on_message((raw) => {
    const message = raw;
    // Initial workers receive InitMessage directly from the page. Workers
    // spawned by another worker receive their InitMessage over this port, which
    // works around a WebKit bug reclaiming shared Wasm memory across JS VMs.
    if (message.type === "forwarded_init") {
        message.port.onmessage = ({ data }) => {
            message.port.close();
            start(data);
        };
        message.port.start();
        return;
    }
    start(message);
});
