.globaltype __stack_pointer, i32
.globl __cpp_exception
.tagtype __cpp_exception i32
__cpp_exception:
.globl __c_longjmp
.tagtype __c_longjmp i32
__c_longjmp:
.text
.globl prototype_stack_pointer
.type prototype_stack_pointer,@function
prototype_stack_pointer:
 .functype prototype_stack_pointer () -> (i32)
 global.get __stack_pointer
 end_function
.globl prototype_restore_stack
.type prototype_restore_stack,@function
prototype_restore_stack:
 .functype prototype_restore_stack (i32) -> ()
 local.get 0
 global.set __stack_pointer
 end_function
