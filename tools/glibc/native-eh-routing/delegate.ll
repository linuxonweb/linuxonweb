; Owned runtime adaptation of upstream unwind_mismatches_5 shape.
target triple = "wasm32-unknown-linux-gnu"
declare i32 @__gxx_wasm_personality_v0(...)
declare i32 @delegate_step(i32,i32,i32,ptr)
declare void @delegate_record(i32)
declare void @raw_raise(i32,i32)
define i32 @delegate_entry(i32 %selected, i32 %tag) personality ptr @__gxx_wasm_personality_v0 {
entry:
 %frame = alloca [144 x i8], align 64
 store volatile i8 7, ptr %frame
 %v = call i32 @delegate_step(i32 %selected,i32 0,i32 %tag,ptr %frame)
 %r = invoke i32 @delegate_step(i32 %selected,i32 %v,i32 %tag,ptr %frame) to label %done unwind label %cleanup
cleanup:
 %p = cleanuppad within none []
 call void @delegate_record(i32 51) [ "funclet"(token %p) ]
 cleanupret from %p unwind to caller
done:
 ret i32 %r
}
; Deliberate architecture catch-all, not a destructor/cleanup handler.
; No llvm.wasm.get.exception means LateEHPrepare emits native catch_all.
define i32 @catchall_entry(i32 %tag) personality ptr @__gxx_wasm_personality_v0 {
entry:
 invoke void @raw_raise(i32 %tag,i32 731) to label %done unwind label %dispatch
dispatch:
 %s = catchswitch within none [label %catch] unwind to caller
catch:
 %p = catchpad within %s [ptr null]
 call void @delegate_record(i32 61) [ "funclet"(token %p) ]
 catchret from %p to label %done
done:
 ret i32 99
}
