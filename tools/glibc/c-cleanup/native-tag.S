.globaltype __stack_pointer, i32
.globl cleanup_test_tag
.tagtype cleanup_test_tag i32
cleanup_test_tag:
.text
.globl cleanup_throw
.type cleanup_throw,@function
cleanup_throw:
 .functype cleanup_throw (i32) -> ()
 local.get 0
 throw cleanup_test_tag
 end_function
.globl cleanup_catch
.type cleanup_catch,@function
cleanup_catch:
 .functype cleanup_catch (i32) -> (i32)
 .local i32
 global.get __stack_pointer
 local.set 1
 try i32
  local.get 0
  call_indirect () -> ()
  i32.const 0
 catch cleanup_test_tag
  local.get 1
  global.set __stack_pointer
 end_try
 end_function

.globl cleanup_stack_pointer
.type cleanup_stack_pointer,@function
cleanup_stack_pointer:
 .functype cleanup_stack_pointer () -> (i32)
 global.get __stack_pointer
 end_function
