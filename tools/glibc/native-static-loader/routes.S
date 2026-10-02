.globaltype __stack_pointer, i32
.globl __cpp_exception
.tagtype __cpp_exception i32
__cpp_exception:
.globl __c_longjmp
.tagtype __c_longjmp i32
__c_longjmp:
.text
.globl eh_raise
.type eh_raise,@function
eh_raise:
 .functype eh_raise (i32) -> ()
 local.get 0
 throw __cpp_exception
 end_function
.globl route_stack
.type route_stack,@function
route_stack:
 .functype route_stack () -> (i32)
 global.get __stack_pointer
 end_function
.globl route_invoke
.type route_invoke,@function
route_invoke:
 .functype route_invoke (i32) -> (i32)
 .functype route_entry (i32) -> (i32)
 .local i32
 global.get __stack_pointer
 local.set 1
 try i32
  local.get 0
  call route_entry
 catch __cpp_exception
  local.get 1
  global.set __stack_pointer
 end_try
 end_function
