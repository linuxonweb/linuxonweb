/* Only this freestanding host ABI probe: unexpected termination is observable. */
.text
.functype host_abort () -> ()
.import_module host_abort, env
.import_name host_abort, unexpected_abort
.globl abort
.type abort,@function
abort:
 .functype abort () -> ()
 call host_abort
 unreachable
 end_function
