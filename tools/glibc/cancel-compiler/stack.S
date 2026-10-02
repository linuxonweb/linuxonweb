.globaltype __stack_pointer, i32
.globl __cpp_exception
.tagtype __cpp_exception i32
__cpp_exception:
.text
.globl read_sp
.type read_sp,@function
read_sp:
 .functype read_sp () -> (i32)
 global.get __stack_pointer
 end_function
.globl restore_sp
.type restore_sp,@function
restore_sp:
 .functype restore_sp (i32) -> ()
 local.get 0
 global.set __stack_pointer
 end_function
