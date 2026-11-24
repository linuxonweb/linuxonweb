#include "native-loader.h"
#include <dlfcn.h>
#include <stdint.h>
extern const struct native_callsite *const __native_token_table[];
extern const unsigned __native_token_count;
static unsigned checks,failures;
static void check(int condition){checks++;if(!condition)failures++;}
__attribute__((noinline)) static int process_duplicate(void){return 100;}
__attribute__((noinline)) static int a_duplicate(void){return 101;}
__attribute__((noinline)) static int b_duplicate(void){return 102;}
__attribute__((noinline)) static int b_private(void){return 103;}
__attribute__((noinline)) static int a_version_old(void){return 104;}
__attribute__((noinline)) static int a_version_new(void){return 105;}
__attribute__((noinline)) static void *a_default(const char *name){return dlsym(RTLD_DEFAULT,name);}
__attribute__((noinline)) static void *b_default(const char *name){return dlsym(RTLD_DEFAULT,name);}
__attribute__((noinline)) static void *a_next(const char *name){return dlsym(RTLD_NEXT,name);}
__attribute__((noinline)) static void *b_next(const char *name){return dlsym(RTLD_NEXT,name);}
static struct native_symbol process_symbols[]={
 {"duplicate",0,(void*)process_duplicate,STT_FUNC,1,{0}},
};
static struct native_symbol a_symbols[]={
 {"duplicate",0,(void*)a_duplicate,STT_FUNC,1,{0}},
 {"versioned","NATIVE_1",(void*)a_version_old,STT_FUNC,0,{0}},
 {"versioned","NATIVE_2",(void*)a_version_new,STT_FUNC,1,{0}},
 {"default_callback",0,(void*)a_default,STT_FUNC,1,{0}},
 {"next_callback",0,(void*)a_next,STT_FUNC,1,{0}},
};
static struct native_symbol b_symbols[]={
 {"duplicate",0,(void*)b_duplicate,STT_FUNC,1,{0}},
 {"private_b",0,(void*)b_private,STT_FUNC,1,{0}},
 {"default_callback",0,(void*)b_default,STT_FUNC,1,{0}},
 {"next_callback",0,(void*)b_next,STT_FUNC,1,{0}},
};
static const struct native_module_input registry[]={
 {"/native/process",process_symbols,sizeof process_symbols/sizeof *process_symbols},
 {"/native/A",a_symbols,sizeof a_symbols/sizeof *a_symbols},
 {"/native/B",b_symbols,sizeof b_symbols/sizeof *b_symbols},
};
static void *handle;
typedef void *(*lookup_callback)(const char *);
__attribute__((noinline,visibility("default"))) unsigned native_loader_entry(unsigned mode){
 checks=failures=0;
 if(mode==0){check(native_static_registry_init(registry,__native_token_table,__native_token_count)==0);return failures;}
 if(mode==1){
  handle=dlopen("/native/A",RTLD_NOW|RTLD_LOCAL);check(handle==native_static_map(1));
  check(native_static_map(1)->l_loader==0);check(native_static_map(2)->l_loader==native_static_map(1));
  check(dlsym(handle,"duplicate")==a_duplicate);
  void *bh=dlopen("/native/B",RTLD_NOW|RTLD_NOLOAD|RTLD_LOCAL);check(bh==native_static_map(2));
  lookup_callback ad=dlsym(handle,"default_callback"),bd=dlsym(bh,"default_callback");
  lookup_callback an=dlsym(handle,"next_callback"),bn=dlsym(bh,"next_callback");
  check(ad==a_default&&bd==b_default&&an==a_next&&bn==b_next);
  if(!ad||!bd||!an||!bn)return ++failures;
  check(ad("private_b")==b_private);check(bd("private_b")==b_private);
  check(ad("duplicate")==process_duplicate);check(bd("duplicate")==process_duplicate);
  check(an("duplicate")==b_duplicate);check(bn("duplicate")==0);
  check(dlerror()!=0);check(dlerror()==0);
  check(dlsym(handle,"versioned")==a_version_new);
  check(dlvsym(handle,"versioned","NATIVE_1")==a_version_old);
  check(dlvsym(handle,"versioned","NATIVE_missing")==0);check(dlerror()!=0);check(dlerror()==0);
  check(dlclose(bh)==0);
 }else if(mode==2){
  void *global=dlopen("/native/A",RTLD_NOW|RTLD_NOLOAD|RTLD_GLOBAL);check(global==handle);
  check(dlsym(RTLD_DEFAULT,"private_b")==b_private);
  check(a_default("duplicate")==process_duplicate);check(b_default("duplicate")==process_duplicate);
  check(a_next("duplicate")==b_duplicate);check(b_next("duplicate")==0);check(dlerror()!=0);check(dlerror()==0);
  check(dlclose(global)==0);check(dlclose(handle)==0);
 }else if(mode==3){
  check(dlopen("/unsupported/elf",RTLD_NOW)==0);check(dlerror()!=0);check(dlerror()==0);
  check(dlmopen(LM_ID_NEWLM,"/native/A",RTLD_NOW)==0);check(dlerror()!=0);check(dlerror()==0);
 }else if(mode==4){
  check(_dl_readonly_area(registry,sizeof registry)==dl_readonly_area_writable);
  check(_dl_readonly_area((void*)(uintptr_t)-1,2)==dl_readonly_area_not_found);
 }
 return failures;
}
__attribute__((visibility("default"))) unsigned native_loader_checks(void){return checks;}
