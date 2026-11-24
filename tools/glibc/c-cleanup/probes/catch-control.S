.text
.functype throw_control () -> ()
.import_module throw_control, env
.import_name throw_control, throw_control
.globl catch_control
.type catch_control,@function
catch_control:
 .functype catch_control () -> (i32)
 try i32
  call throw_control
  i32.const 0
 catch_all
  i32.const 1
 end_try
 end_function
