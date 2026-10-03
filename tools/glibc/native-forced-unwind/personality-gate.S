.globaltype __stack_pointer, i32
.globl __cpp_exception
.tagtype __cpp_exception i32
__cpp_exception:
.globl abort
.functype abort () -> ()
.import_module abort, env
.import_name abort, unexpected_abort
.globl _ZSt9terminatev
.functype _ZSt9terminatev () -> ()
.import_module _ZSt9terminatev, env
.import_name _ZSt9terminatev, unexpected_terminate
.globl _ZSt11__terminatePFvvE
.functype _ZSt11__terminatePFvvE (i32) -> ()
.import_module _ZSt11__terminatePFvvE, env
.import_name _ZSt11__terminatePFvvE, unexpected_terminate_with_handler
.text
.globl observe_stack
.type observe_stack,@function
observe_stack:
 .functype observe_stack () -> (i32)
 global.get __stack_pointer
 end_function
