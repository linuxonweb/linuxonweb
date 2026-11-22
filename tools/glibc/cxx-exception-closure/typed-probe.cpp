#include <exception>
#include <cxxabi.h>
#include <unwind.h>
static unsigned destroyed;
struct Token {unsigned value;~Token(){destroyed++;}};
extern "C" unsigned typed_probe(){
 Token *first=nullptr;destroyed=0;
 try {try {throw Token{77};}catch(Token &t){first=&t;throw;}}
 catch(Token &t){if(&t!=first||t.value!=77)return 1;}
 return destroyed==1?0:2;
}
static unsigned cleaned;
static void foreign_cleanup(_Unwind_Reason_Code reason,_Unwind_Exception *){if(reason==_URC_FOREIGN_EXCEPTION_CAUGHT)cleaned++;}
static _Unwind_Exception foreign_record;
extern "C" unsigned foreign_probe(){
 foreign_record.exception_class=0x464f524549474e00ULL;foreign_record.exception_cleanup=foreign_cleanup;cleaned=0;
 try{try{_Unwind_RaiseException(&foreign_record);}catch(...){throw;}}
 catch(...){if(cleaned)return 1;}
 return cleaned==1?0:2;
}
