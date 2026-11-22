#include <bits/wordsize.h>
extern "C" void record_cleanup(unsigned);
struct Guard {
 unsigned id;
 explicit Guard(unsigned x) noexcept:id(x) {}
 ~Guard() noexcept {record_cleanup(id);}
};
extern "C" void cpp_while() {
 Guard a(21); unsigned v=1;
 while (__atomic_load_n(&v,__ATOMIC_RELAXED)) {}
}
extern "C" void cpp_range_lambda() {
 Guard a(22);unsigned values[3]={1,2,3};
 auto body=[&](unsigned x) {Guard b(x+30);for (;;) {__atomic_load_n(&x,__ATOMIC_RELAXED);}};
 for (unsigned x:values) body(x);
}
extern "C" void cpp_normal() {Guard a(23);}
