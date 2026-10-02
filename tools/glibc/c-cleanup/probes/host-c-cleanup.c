__attribute__((import_module("env"),import_name("abort"),noreturn)) extern void abort(void);
__attribute__((import_module("env"),import_name("throw_control"))) extern void throw_control(void);
__attribute__((import_module("env"),import_name("record_cleanup"))) extern void record_cleanup(int);
static void cleanup(int *value){record_cleanup(*value);}
void c_entry(void){int value __attribute__((cleanup(cleanup)))=1;throw_control();}
/* Host ABI probe only: make the intended import explicit to Clang CodeGen. */
__attribute__((used)) void host_abort_import_declaration(void){abort();}
