target triple = "wasm32-unknown-linux-gnu"

define i32 @forged_primitive() #0 {
entry:
  ret i32 0
}

attributes #0 = { noinline "target-features"="+atomics,+bulk-memory,+exception-handling" "wasm-gnu-provider-sealed"="2" }
