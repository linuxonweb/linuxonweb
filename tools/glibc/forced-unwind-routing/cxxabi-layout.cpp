#include "cxa_exception.h"
extern "C" unsigned cxxabi_layout(unsigned n) {
 using __cxxabiv1::__cxa_exception;
 using __cxxabiv1::__cxa_dependent_exception;
 unsigned v[]={sizeof(_Unwind_Exception),alignof(_Unwind_Exception),sizeof(__cxa_exception),alignof(__cxa_exception),__builtin_offsetof(__cxa_exception,unwindHeader),sizeof(__cxa_dependent_exception),__builtin_offsetof(__cxa_dependent_exception,unwindHeader),sizeof(__cxxabiv1::__cxa_eh_globals)};
 return n<8?v[n]:0;
}
