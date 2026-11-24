#include <unwind.h>
#define OFF(m) __builtin_offsetof(struct _Unwind_Exception,m)
extern "C" unsigned abi(unsigned n) {
 static const unsigned values[]={sizeof(struct _Unwind_Exception),alignof(struct _Unwind_Exception),sizeof(_Unwind_Exception_Class),sizeof(void*),OFF(exception_class),OFF(exception_cleanup),OFF(private_1),OFF(private_2),sizeof(_Unwind_Stop_Fn)};
 return n<sizeof(values)/sizeof(values[0])?values[n]:0xffffffffu;
}
