extern "C" void prototype_raise(void);
extern "C" void prototype_record(int) noexcept;
struct D{int n;~D(){prototype_record(n);}};
extern "C" __attribute__((noinline)) void fixture_cpp_inner(){D d{4};prototype_raise();}
extern "C" __attribute__((noinline)) void fixture_cpp_middle(){D d{3};fixture_cpp_inner();}
