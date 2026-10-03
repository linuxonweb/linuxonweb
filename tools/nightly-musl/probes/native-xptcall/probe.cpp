/* MPL-2.0. Actual Nightly headers and compiled adapter; isolated XPT catalog. */
#include "xptcprivate.h"
#include <stdint.h>
#include <stddef.h>

static uint32_t failures, calls, deletes;
static nsXPTMethodInfo info{};
static nsXPTInterfaceInfo entry{};
static uint32_t mode;
static uintptr_t outPointer;
static void check(bool ok) { if (!ok) ++failures; }

extern "C" void* memcpy(void* dst, const void* src, size_t n) {
  auto* d = static_cast<unsigned char*>(dst);
  auto* s = static_cast<const unsigned char*>(src);
  for (size_t i=0;i<n;++i) d[i]=s[i]; return dst;
}
extern "C" void* memset(void* dst, int v, size_t n) {
  auto* d = static_cast<unsigned char*>(dst);
  for (size_t i=0;i<n;++i) d[i]=v; return dst;
}
extern "C" int memcmp(const void* a,const void* b,size_t n) {
  auto* x=static_cast<const unsigned char*>(a);
  auto* y=static_cast<const unsigned char*>(b);
  for(size_t i=0;i<n;++i) if(x[i]!=y[i]) return x[i]<y[i]?-1:1; return 0;
}
alignas(16) static unsigned char arena[131072];
static size_t allocated;
extern "C" void* moz_xmalloc(size_t n) {
  allocated=(allocated+15)&~size_t(15);
  if(allocated+n>sizeof(arena)) __builtin_trap();
  void* p=arena+allocated; allocated+=n; return p;
}
extern "C" void free(void*) { ++deletes; }
extern "C" void __cxa_pure_virtual() { __builtin_trap(); }
extern "C" {
uintptr_t __stack_chk_guard=0x5a1234ef;
void __stack_chk_fail() { __builtin_trap(); }
}
extern "C" void NS_DebugBreak(uint32_t,const char*,const char*,const char*,int32_t) { ++failures; }

namespace xpt::detail {
const nsXPTParamInfo sParams[] = {
  {{TD_INT8,true,false,false,0,0}}, {{TD_INT16,true,false,false,0,0}},
  {{TD_INT32,true,false,false,0,0}}, {{TD_INT64,true,false,false,0,0}},
  {{TD_UINT8,true,false,false,0,0}}, {{TD_UINT16,true,false,false,0,0}},
  {{TD_UINT32,true,false,false,0,0}}, {{TD_UINT64,true,false,false,0,0}},
  {{TD_FLOAT,true,false,false,0,0}}, {{TD_DOUBLE,true,false,false,0,0}},
  {{TD_BOOL,true,false,false,0,0}}, {{TD_CHAR,true,false,false,0,0}},
  {{TD_WCHAR,true,false,false,0,0}}, {{TD_PSTRING,true,false,false,0,0}},
  {{TD_INT32,true,false,false,0,0}}, {{TD_INT32,false,true,false,0,0}},
#define INT_PARAM {{TD_INT32,true,false,false,0,0}},
  INT_PARAM INT_PARAM INT_PARAM INT_PARAM INT_PARAM INT_PARAM INT_PARAM
  INT_PARAM INT_PARAM INT_PARAM INT_PARAM INT_PARAM INT_PARAM INT_PARAM
  INT_PARAM INT_PARAM INT_PARAM INT_PARAM INT_PARAM INT_PARAM INT_PARAM INT_PARAM
#undef INT_PARAM
};
const nsXPTInterfaceInfo* InterfaceByIID(const nsIID&) { return &entry; }
}
const nsXPTMethodInfo& nsXPTInterfaceInfo::Method(uint16_t) const { return info; }
nsresult nsXPTInterfaceInfo::GetMethodInfo(uint16_t index,const nsXPTMethodInfo** result) const {
  if(index>=MethodCount()) return NS_ERROR_INVALID_ARG;
  *result=&info; return NS_OK;
}

static void checkScalars(int8_t i8,int16_t i16,int32_t i32,int64_t i64,
                         uint8_t u8,uint16_t u16,uint32_t u32,uint64_t u64,
                         float f,double d,bool b,char c,char16_t wc) {
  check(i8==-128); check(i16==-32768); check(i32==-2147483647);
  check(i64==INT64_C(-0x123456789abcdef)); check(u8==255); check(u16==65535);
  check(u32==0xfedcba98); check(u64==UINT64_C(0xfedcba9876543210));
  uint32_t fb; uint64_t db; memcpy(&fb,&f,4); memcpy(&db,&d,8);
  check(fb==(mode==15?0x7fc12345u:0x80000000u));
  check(db==(mode==15?UINT64_C(0x7ff8123456789abc):UINT64_C(0x8000000000000000)));
  check(b); check(c=='Z'); check(wc==0x8abc);
}
class Proxy final : public nsIXPTCProxy {
 public:
  MozExternalRefCountType refs=1;
  NS_IMETHOD QueryInterface(REFNSIID,void** p) override { *p=this; return NS_OK; }
  NS_IMETHOD_(MozExternalRefCountType) AddRef() override { return ++refs; }
  NS_IMETHOD_(MozExternalRefCountType) Release() override { return --refs; }
  NS_IMETHOD CallMethod(uint16_t index,const nsXPTMethodInfo* metadata,nsXPTCMiniVariant* p) override {
    ++calls; check(index==((mode==9)?249:3)); check(metadata==&info);
    if(mode==0 || mode==15) {
      checkScalars(p[0].val.i8,p[1].val.i16,p[2].val.i32,p[3].val.i64,p[4].val.u8,
                   p[5].val.u16,p[6].val.u32,p[7].val.u64,p[8].val.f,p[9].val.d,
                   p[10].val.b,p[11].val.c,p[12].val.wc);
    } else if(mode>=2 && mode<=4) {
      check(p[0].val.i32==-98765);
      if(mode!=2) check(uintptr_t(p[1].val.p)==outPointer);
    } else if(mode==10) {
      for(uint32_t i=0;i<22;++i) check(p[i].val.i32==int32_t(i*17+3));
    } else if(mode==9) check(p[0].val.i8==-128);
    return nsresult(0x12345678);
  }
};
class Receiver final : public nsISupports {
 public:
  NS_IMETHOD QueryInterface(REFNSIID,void** p) override { *p=this; return NS_OK; }
  NS_IMETHOD_(MozExternalRefCountType) AddRef() override { return 1; }
  NS_IMETHOD_(MozExternalRefCountType) Release() override { return 1; }
  virtual nsresult Mixed(int8_t a,int16_t b,int32_t c,int64_t d,uint8_t e,
                         uint16_t f,uint32_t g,uint64_t h,float i,double j,
                         bool k,char l,char16_t m) {
    ++calls; checkScalars(a,b,c,d,e,f,g,h,i,j,k,l,m); return nsresult(0x87654321);
  }
  virtual nsresult Indirect(int32_t* n,double* d) {
    ++calls; *n=-7654321; *d=-123.75; return NS_OK;
  }
};
static void setScalarVariants(nsXPTCVariant* p) {
  for(uint32_t i=0;i<13;++i) p[i].type=xpt::detail::sParams[i].Type();
  p[0].val.i8=-128; p[1].val.i16=-32768; p[2].val.i32=-2147483647;
  p[3].val.i64=INT64_C(-0x123456789abcdef); p[4].val.u8=255; p[5].val.u16=65535;
  p[6].val.u32=0xfedcba98; p[7].val.u64=UINT64_C(0xfedcba9876543210);
  uint32_t fb=mode==15?0x7fc12345u:0x80000000u;
  uint64_t db=mode==15?UINT64_C(0x7ff8123456789abc):UINT64_C(0x8000000000000000);
  memcpy(&p[8].val.f,&fb,4); memcpy(&p[9].val.d,&db,8);
  p[10].val.b=true; p[11].val.c='Z'; p[12].val.wc=0x8abc;
}
using ScalarFn=nsresult (*)(nsISupports*,int8_t,int16_t,int32_t,int64_t,uint8_t,
                           uint16_t,uint32_t,uint64_t,float,double,bool,char,char16_t);
static nsresult callScalars(nsISupports* stub, nsXPTCVariant* p) {
  auto v=*reinterpret_cast<uintptr_t**>(stub);
  return reinterpret_cast<ScalarFn>(v[3])(stub,p[0].val.i8,p[1].val.i16,p[2].val.i32,
      p[3].val.i64,p[4].val.u8,p[5].val.u16,p[6].val.u32,p[7].val.u64,
      p[8].val.f,p[9].val.d,p[10].val.b,p[11].val.c,p[12].val.wc);
}
extern "C" __attribute__((export_name("run_case"))) uint32_t run_case(uint32_t test) {
  failures=calls=deletes=0; allocated=0; mode=test;
  info={}; entry={}; entry.mNumMethods=4; info.mNumParams=13;
  Proxy proxy; Receiver receiver; nsXPTCVariant params[22]; setScalarVariants(params);
  if(test==1 || test==15) {
    check(uint32_t(NS_InvokeByIndex(&receiver,3,13,params))==0x87654321);
    if(test==1) return failures + (calls!=1);
  }
  if(test==13) {
    params[0].type=nsXPTType::T_I32; params[0].SetIndirect();
    params[1].type=nsXPTType::T_DOUBLE; params[1].SetIndirect();
    check(NS_InvokeByIndex(&receiver,4,2,params)==NS_OK);
    check(params[0].val.i32==-7654321); check(params[1].val.d==-123.75);
    return failures + (calls!=1);
  }
  if(test==14) {
    check(NS_InvokeByIndex(nullptr,3,0,nullptr)==NS_ERROR_INVALID_ARG);
    check(NS_InvokeByIndex(&receiver,3,1,nullptr)==NS_ERROR_INVALID_ARG);
    check(NS_InvokeByIndex(&receiver,3,23,params)==NS_ERROR_NOT_IMPLEMENTED);
    return failures;
  }
  if(test>=2 && test<=4) {
    info.mParams=14; info.mNumParams=test==2?1:2; info.mContext=true;
    info.mGetter=test==2; info.mHasRetval=test!=2; info.mOptArgc=test==4;
  } else if(test==5 || test==8) info.mNumParams=0;
  else if(test==9) { info.mNumParams=1; entry.mNumMethods=250; }
  else if(test==10) { info.mParams=16; info.mNumParams=22; }
  else if(test==11) info.mNumParams=23;
  else if(test==12) entry.mNumMethods=251;
  nsISupports* stub=reinterpret_cast<nsISupports*>(uintptr_t(1));
  nsresult rv=NS_GetXPTCallStub(entry.IID(),&proxy,&stub);
  if(test==11 || test==12) {
    check(rv==NS_ERROR_NOT_IMPLEMENTED); check(stub==nullptr); check(deletes==1);
    return failures;
  }
  check(rv==NS_OK); if(NS_FAILED(rv)) return failures+100;
  auto v=*reinterpret_cast<uintptr_t**>(stub);
  if(test==0 || test==15) check(uint32_t(callScalars(stub,params))==0x12345678);
  else if(test==2) {
    using F=nsresult(*)(nsISupports*,void*,int32_t);
    check(uint32_t(reinterpret_cast<F>(v[3])(stub,reinterpret_cast<void*>(0x7654),-98765))==0x12345678);
  } else if(test==3) {
    outPointer=uintptr_t(&params[1]); using F=nsresult(*)(nsISupports*,int32_t,void*,void*);
    check(uint32_t(reinterpret_cast<F>(v[3])(stub,-98765,reinterpret_cast<void*>(0x7654),reinterpret_cast<void*>(outPointer)))==0x12345678);
  } else if(test==4) {
    outPointer=uintptr_t(&params[1]); using F=nsresult(*)(nsISupports*,int32_t,void*,uint8_t,void*);
    check(uint32_t(reinterpret_cast<F>(v[3])(stub,-98765,reinterpret_cast<void*>(0x7654),3,reinterpret_cast<void*>(outPointer)))==0x12345678);
  } else if(test==5) {
    using F=nsresult(*)(nsISupports*); check(uint32_t(reinterpret_cast<F>(v[3])(stub))==0x12345678);
  } else if(test==8) {
    check(stub->AddRef()==2); check(stub->Release()==1);
    void* found=nullptr; check(stub->QueryInterface(entry.IID(),&found)==NS_OK);
    check(found==stub); check(proxy.refs==2); check(stub->Release()==1);
    auto* base=static_cast<nsXPTCStubBase*>(stub);
    check(v==base->mWasmVTable+2); check(v[-2]==0); check(v[-1]==0);
  } else if(test==9) {
    using F=nsresult(*)(nsISupports*,int8_t);
    check(uint32_t(reinterpret_cast<F>(v[249])(stub,-128))==0x12345678);
  } else if(test==10) {
    using F=nsresult(*)(nsISupports*,int32_t,int32_t,int32_t,int32_t,int32_t,int32_t,int32_t,
      int32_t,int32_t,int32_t,int32_t,int32_t,int32_t,int32_t,int32_t,int32_t,int32_t,
      int32_t,int32_t,int32_t,int32_t,int32_t);
    check(uint32_t(reinterpret_cast<F>(v[3])(stub,3,20,37,54,71,88,105,122,139,156,173,
      190,207,224,241,258,275,292,309,326,343,360))==0x12345678);
  } else return failures+999; // Every advertised case must execute a real path.
  NS_DestroyXPTCallStub(stub); check(deletes==2);
  check(calls==(test==8?0:test==15?2:1)); return failures;
}
