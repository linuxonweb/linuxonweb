.globaltype __stack_pointer, i32
.globaltype __tls_base, i32
.globl __cpp_exception
.tagtype __cpp_exception i32
__cpp_exception:
.globl abort
.functype abort () -> ()
.import_module abort, env
.import_name abort, unexpected_abort
.globl __abort_message
.functype __abort_message (i32,i32) -> ()
.import_module __abort_message, env
.import_name __abort_message, unexpected_abort_message
.text
.globl observe_stack
.type observe_stack,@function
observe_stack:
 .functype observe_stack () -> (i32)
 global.get __stack_pointer
 end_function
.globl fixture_tls_size
.type fixture_tls_size,@function
fixture_tls_size:
 .functype fixture_tls_size () -> (i32)
 i32.const __tls_size
 end_function
.globl fixture_tls_align
.type fixture_tls_align,@function
fixture_tls_align:
 .functype fixture_tls_align () -> (i32)
 i32.const __tls_align
 end_function
