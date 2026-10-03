#include <unwind.h>
static _Unwind_Exception record;
static unsigned trace[24], used, typed, caught, cleaned, bad_cleanup;
static void mark(unsigned n){if(used<24)trace[used++]=n;}
static void cleanup(_Unwind_Reason_Code reason,_Unwind_Exception *p){
 if(p!=&record||reason!=_URC_FOREIGN_EXCEPTION_CAUGHT)bad_cleanup++;
 cleaned++;mark(7);
}
struct Scope {unsigned n;~Scope(){mark(n);}};
static void init(){used=typed=caught=cleaned=bad_cleanup=0;record.exception_class=0x464f524549474e00ULL;record.exception_cleanup=cleanup;record.private_1=record.private_2=0;}
__attribute__((noinline)) static void raise(){Scope x{1};_Unwind_RaiseException(&record);}
extern "C" unsigned foreign_direct(){
 init();try{Scope x{2};raise();}catch(int &){typed++;}catch(...){caught++;mark(3);}
 return caught==1&&typed==0&&cleaned==1&&bad_cleanup==0?0:1;
}
extern "C" unsigned foreign_rethrow(){
 init();try{try{Scope x{2};raise();}catch(int &){typed++;}catch(...){caught++;mark(3);throw;}}
 catch(int &){typed++;}catch(...){caught++;mark(4);}
 return caught==2&&typed==0&&cleaned==1&&bad_cleanup==0?0:1;
}
extern "C" unsigned foreign_escape(){
 init();try{Scope x{2};raise();}catch(int &){typed++;}catch(...){caught++;mark(3);throw;}
 return 99;
}
extern "C" void foreign_delete(){_Unwind_DeleteException(&record);}
extern "C" unsigned foreign_query(unsigned n){
 if(n==0)return used;if(n==1)return typed;if(n==2)return caught;if(n==3)return cleaned;
 if(n==4)return bad_cleanup;if(n==5)return (unsigned)&record;return n-6<used?trace[n-6]:0;
}
extern "C" unsigned exception_size(){return sizeof(record);}
extern "C" unsigned exception_align(){return alignof(_Unwind_Exception);}
