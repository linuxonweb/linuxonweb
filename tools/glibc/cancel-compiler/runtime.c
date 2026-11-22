/* Audited mode-off boundary; no cancellation polling or GNU runtime is claimed. */
__attribute__((import_module("control"),import_name("poll")))
extern void control_poll(unsigned,unsigned);
void __wasm_gnu_cancel_poll_v1(unsigned sp,unsigned reason) {control_poll(sp,reason);}
__attribute__((import_module("control"),import_name("cleanup")))
extern void control_cleanup(unsigned);
void record_cleanup(unsigned id) {control_cleanup(id);}
__attribute__((import_module("control"),import_name("buffer")))
extern void control_buffer(volatile void*,unsigned);
void observe_buffer(volatile void *p,unsigned n) {control_buffer(p,n);}
__attribute__((noreturn)) void __clang_call_terminate(void *e) {(void)e;__builtin_trap();}
void *__cxa_begin_catch(void *p){return p;}
__attribute__((noreturn)) void _ZSt9terminatev(void){__builtin_trap();}
/* Diagnostic-only unexpected fatal boundary; genuine GNU abort is not linked. */
__attribute__((import_module("control"),import_name("unexpected_fatal")))
__attribute__((noreturn)) extern void control_fatal(void);
__attribute__((noreturn)) void abort(void){control_fatal();__builtin_unreachable();}
/* Uninterpreted tag0 payload only: not a GNU/libunwind exception record. */
__attribute__((noreturn)) void raise_tag0(void){static unsigned payload[6];__builtin_wasm_throw(0,payload);}
__attribute__((noreturn)) void actual_trap(void){__builtin_trap();}
