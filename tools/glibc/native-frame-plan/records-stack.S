# Read-only native SP observation. No reset/restore provider exists.
.globaltype __stack_pointer, i32
.globl read_sp
.type read_sp,@function
read_sp:
.functype read_sp () -> (i32)
  global.get __stack_pointer
  end_function
