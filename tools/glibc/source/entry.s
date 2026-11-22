 .text
 .globaltype __stack_pointer, i32
 .globaltype __tls_base, i32
 .globaltype __tls_size, i32, immutable
 .globaltype __tls_align, i32, immutable
 .functype __wasm_init_tls (i32) -> ()
 .functype startup_prepare () -> (i32)
 .functype startup_main () -> ()
 .functype child_body (i32) -> ()
 .globl _start
 .export_name _start, _start
_start:
 .functype _start () -> ()
 call startup_prepare
 call __wasm_init_tls
 call startup_main
 unreachable
 end_function
 .globl clone_entry
clone_entry:
 .functype clone_entry (i32) -> ()
 local.get 0
 i32.load 0
 global.set __stack_pointer
 local.get 0
 i32.load 4
 call __wasm_init_tls
 local.get 0
 call child_body
 unreachable
 end_function
 .globl tls_size
tls_size:
 .functype tls_size () -> (i32)
 global.get __tls_size
 end_function
 .globl tls_align
tls_align:
 .functype tls_align () -> (i32)
 global.get __tls_align
 end_function
 .globl tls_base
tls_base:
 .functype tls_base () -> (i32)
 global.get __tls_base
 end_function
