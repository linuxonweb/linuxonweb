 .text
 .globaltype __tls_size, i32, immutable
 .globaltype __tls_align, i32, immutable
 .globl fixture_tls_size
fixture_tls_size:
 .functype fixture_tls_size () -> (i32)
 global.get __tls_size
 end_function
 .globl fixture_tls_align
fixture_tls_align:
 .functype fixture_tls_align () -> (i32)
 global.get __tls_align
 end_function
