.globaltype __stack_pointer, i32
.globl __cpp_exception
.tagtype __cpp_exception i32
__cpp_exception:
.globl __c_longjmp
.tagtype __c_longjmp i32
__c_longjmp:
.import_module foreign_raise, env
.import_name foreign_raise, foreign_raise
.functype foreign_raise () -> ()
 .globl abort
.functype abort () -> ()
.import_module abort, env
.import_name abort, unexpected_abort
.globl _ZSt9terminatev
.functype _ZSt9terminatev () -> ()
.import_module _ZSt9terminatev, env
.import_name _ZSt9terminatev, unexpected_terminate
.text
.globl observe_stack
.type observe_stack,@function
observe_stack:
 .functype observe_stack () -> (i32)
 global.get __stack_pointer
 end_function
.globl raw_raise
.type raw_raise,@function
raw_raise:
 .functype raw_raise (i32,i32) -> ()
 local.get 0
 i32.eqz
 if
  local.get 1
  throw __cpp_exception
 end_if
 local.get 0
 i32.const 3
 i32.eq
 if
  local.get 1
  throw __c_longjmp
 end_if
 call foreign_raise
 unreachable
 end_function

