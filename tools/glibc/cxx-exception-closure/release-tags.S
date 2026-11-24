.globaltype __stack_pointer, i32
.globl __cpp_exception
.tagtype __cpp_exception i32
__cpp_exception:
.text
.globl prototype_stack_pointer
.type prototype_stack_pointer,@function
prototype_stack_pointer:
 .functype prototype_stack_pointer () -> (i32)
 global.get __stack_pointer
 end_function
