/* Public GNU fixed-rounding API and native arithmetic checks. */
#include <fenv.h>
#include <errno.h>
#include <stdint.h>
#include <limits.h>
#if FE_TONEAREST != 0 || FE_ALL_EXCEPT != 0
# error "Wasm exposes only fixed nearest rounding and no exception flags"
#endif
#if defined(FE_DOWNWARD) || defined(FE_UPWARD) || defined(FE_TOWARDZERO) || defined(FE_INVALID) || defined(FE_DIVBYZERO) || defined(FE_OVERFLOW) || defined(FE_UNDERFLOW) || defined(FE_INEXACT)
# error "Unsupported floating-point state must remain absent"
#endif
_Static_assert(sizeof(fexcept_t)==4 && sizeof(fenv_t)==4,"GNU generic environment types");
_Static_assert(_Alignof(fenv_t)==4,"GNU environment alignment");
static int (*volatile get_mode)(void)=fegetround;
static int (*volatile set_mode)(int)=fesetround;
extern void fenv_record(const char *,int);
static uint32_t add32(float a,float b){volatile float x=a,y=b;union {float f;uint32_t u;} r={.f=x+y};return r.u;}
static uint64_t add64(double a,double b){volatile double x=a,y=b;union {double f;uint64_t u;} r={.f=x+y};return r.u;}
static int rejected(int mode,int canary){return set_mode(mode)!=0&&get_mode()==FE_TONEAREST&&errno==canary;}
void fenv_tests(void){
 int old=errno;errno=219;
 fenv_record("fenv-default-pointer",(uintptr_t)FE_DFL_ENV==UINT32_MAX);
 fenv_record("fenv-public-nearest-get",get_mode()==0&&errno==219);
 fenv_record("fenv-public-nearest-set",set_mode(FE_TONEAREST)==0&&get_mode()==0&&errno==219);
 fenv_record("fenv-public-reject-one",rejected(1,219));
 fenv_record("fenv-public-reject-minus-one",rejected(-1,219));
 fenv_record("fenv-public-reject-INT_MIN",rejected(INT_MIN,219));
 fenv_record("fenv-public-reject-INT_MAX",rejected(INT_MAX,219));
 fenv_record("fenv-f32-positive-even-low",add32(0x1p0f,0x1p-24f)==UINT32_C(0x3f800000));
 fenv_record("fenv-f32-positive-even-high",add32(0x1.000002p0f,0x1p-24f)==UINT32_C(0x3f800002));
 fenv_record("fenv-f32-negative-even-low",add32(-0x1p0f,-0x1p-24f)==UINT32_C(0xbf800000));
 fenv_record("fenv-f32-negative-even-high",add32(-0x1.000002p0f,-0x1p-24f)==UINT32_C(0xbf800002));
 fenv_record("fenv-f64-positive-even-low",add64(0x1p0,0x1p-53)==UINT64_C(0x3ff0000000000000));
 fenv_record("fenv-f64-positive-even-high",add64(0x1.0000000000001p0,0x1p-53)==UINT64_C(0x3ff0000000000002));
 fenv_record("fenv-f64-negative-even-low",add64(-0x1p0,-0x1p-53)==UINT64_C(0xbff0000000000000));
 fenv_record("fenv-f64-negative-even-high",add64(-0x1.0000000000001p0,-0x1p-53)==UINT64_C(0xbff0000000000002));
 fenv_record("fenv-arithmetic-errno-preserved",errno==219&&get_mode()==0);
 errno=old;
}
int fenv_thread_test(unsigned id){
 int canary=100+(int)id;
 return errno==canary&&get_mode()==0&&set_mode(0)==0&&rejected(INT_MAX,canary)&&rejected(INT_MIN,canary)&&errno==canary;
}
