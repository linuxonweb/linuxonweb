# Browser adapter architecture

This project keeps Linux, X server, and Firefox source trees as upstream checkouts. Browser-specific code belongs in a separate adapter layer so that an upstream update can be tested without carrying a fork. The adapter is a host ABI, not an instruction emulator: the WebAssembly module executes its own code and calls only explicitly defined browser services.

## Runtime layers

```text
DOM / Web APIs
      |
      v
browser-host.js  (event queue, timers, fetch/WebSocket, IndexedDB, canvas)
      |
linux_host imports (stable C ABI)
      |
arch/wasm port + selected kernel services
      |
WASI-like libc and supervised userspace
      |
X framebuffer backend / clients
```

The first implementation should use one linear memory and one cooperative execution context. That removes assumptions about preemptive browser threads while the ABI is being proven. Shared memory and `SharedArrayBuffer` can be added only after the single-threaded path has tests.

## Host ABI (v0)

All handles are 32-bit integers. Pointers and lengths refer to the module's exported linear memory and are validated by the host before access. Functions return zero on success or a negative, stable error code. The import module name is `linux_host`; JavaScript owns the implementation.

| Import | Purpose |
| --- | --- |
| `clock_monotonic_ns() -> i64` | Monotonic clock used by scheduler and timers. |
| `sleep_until_ns(deadline: i64) -> i32` | Yield to the browser event loop until a deadline. |
| `poll_events(ptr: i32, capacity: i32) -> i32` | Copy keyboard, pointer, resize, and close events into module memory. |
| `frame_present(ptr: i32, width: i32, height: i32, stride: i32, format: i32) -> i32` | Present an RGBA/BGRA framebuffer through a canvas. |
| `file_read(handle: i32, ptr: i32, len: i32, off: i64) -> i32` | Read from an explicitly mounted persistent file. |
| `file_write(handle: i32, ptr: i32, len: i32, off: i64) -> i32` | Write to an explicitly mounted persistent file. |
| `net_request(ptr: i32, len: i32) -> i32` | Queue a browser `fetch`/WebSocket request; completion arrives as an event. |
| `log(ptr: i32, len: i32, level: i32) -> i32` | Send diagnostic text to the browser console. |

The host never fabricates CPU instructions, translates guest opcodes, or schedules a second CPU architecture. If an operation is not represented by this ABI, the wasm port must implement or reject it explicitly.

## Kernel entry and event loop

The wasm entry point initializes memory and the host table, then runs a bounded step and returns to JavaScript. JavaScript calls it again from `requestAnimationFrame` or a timer. A bounded step is required because an unbounded kernel loop would block the browser main thread.

```text
start -> init host ABI -> init clock/framebuffer -> scheduler_step
      -> poll_events -> deliver input -> run ready work
      -> present dirty framebuffer -> return to JS
```

The browser smoke module now exercises `log`, `clock_monotonic_ns`,
`poll_events`, and `frame_present` with a 64×32 RGBA buffer and DOM keyboard /
pointer event queue. Its Chromium test verifies one rendered pixel and a
synthetic key event copied into wasm memory. It intentionally does not claim to
boot Linux. A real `arch/wasm` port must later supply context switching,
virtual memory, atomics, and syscall plumbing behind the same boundary.

## X and browser-engine boundaries

Xorg should be evaluated only after the framebuffer and event ABI are stable. Its backend would translate X screen updates into `frame_present` calls and DOM events into the X input path. Keep this backend in a separate module/patch series rather than editing generic X server code.

Firefox is a separate gate. Its process sandbox, filesystem, networking, graphics, and JIT assumptions need a complete target port. The host browser's own networking can be used only through an explicit adapter and normal CORS/security policy. A successful kernel/X smoke test does not imply that Firefox can be built or that a nested Firefox can load a page.
