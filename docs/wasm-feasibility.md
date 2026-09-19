# Native Linux in a browser: feasibility and adapter boundary

The requirement “compile Linux, X server, and Firefox to WebAssembly and run them in a browser without emulation” is not satisfied by selecting a different compiler target. Linux is a privileged operating-system kernel: the upstream tree has architecture ports for CPUs such as x86 and arm, but no `wasm32` port. WebAssembly code runs inside a host runtime and cannot execute privileged instructions or install interrupt/MMU handlers. A new port would need to define the boot path, scheduler context switches, atomics, virtual memory model, clocks, and every device operation used by the selected kernel configuration.

The least invasive design is to leave upstream code untouched and add a `wasm` architecture/host layer. The layer exposes a small import table implemented by JavaScript: monotonic time and timers, linear-memory growth, event delivery, framebuffer presentation, persistent files, and network transport. The kernel and userspace must be built for a purpose-built WASI-like ABI that has these calls. This is still a new operating-system port, not a normal Linux build.

Xorg has a similar boundary. Its normal DDX drivers expect host displays, input devices, and sockets. A browser target would need a dedicated framebuffer/input backend that writes pixels into shared WebAssembly memory and receives DOM events through imports. X clients also need a process and IPC model, so a single-process or explicitly supervised WASI runtime must be designed before Xorg can run.

Firefox is a much larger independent blocker. It assumes a complete Unix/GUI environment and contains a JIT and sandbox/process machinery. Browser WebAssembly does not provide the native executable/JIT facilities Firefox expects, and embedding a second Firefox inside the host browser is not equivalent to opening a page in the host browser. Preserve Firefox sources and first prove a portable, non-JIT build in a standalone WASI runtime; if that gate fails, the requested final score is unattainable under the no-emulator constraint.

The current host can produce a trivial WASI module with system Clang and `wasm-ld`, but the installed Emscripten wrapper fails before compilation because its bundled Clang requires GLIBC 2.44. Toolchain repair and pinned source manifests should precede any large build.

