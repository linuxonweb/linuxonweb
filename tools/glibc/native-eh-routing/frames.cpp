extern "C" void cpp_cleanup(unsigned),cpp_raise(void),cpp_mark(void);
struct OwnedScope { unsigned id; ~OwnedScope(){cpp_cleanup(id);} };
extern "C" __attribute__((noinline)) void cpp_frame(unsigned n){
 OwnedScope outer{3};cpp_mark();
 { OwnedScope inner{4}; volatile char a[85];a[0]=n;cpp_raise(); }
}
