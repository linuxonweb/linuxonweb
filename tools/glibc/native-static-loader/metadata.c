#include "native-loader.h"
#include <stdint.h>
extern const struct native_callsite *const __native_token_table[];
extern const unsigned __native_token_count;
extern int mod_a_identify(void),mod_a_bridge(void),mod_b_identify(void);
static unsigned failures,checks;
static unsigned data=0x719302;
static void check(int condition){checks++;if(!condition)failures++;}
static struct native_symbol p[]={ {"data",0,&data,STT_OBJECT,1,{0}} };
static struct native_symbol a[]={
 {"callback","NATIVE_1",(void*)mod_a_identify,STT_FUNC,0,{0}},
 {"callback","NATIVE_2",(void*)mod_a_bridge,STT_FUNC,1,{0}},
};
static struct native_symbol b[]={ {"callback",0,(void*)mod_b_identify,STT_FUNC,1,{0}} };
static struct native_module_input in[]={ {"/native/process",p,1},{"/native/A",a,2},{"/native/B",b,1} };
unsigned metadata_entry(void){
 checks=failures=0;
 check(native_static_registry_init(in,__native_token_table,__native_token_count)==0);
 void *out=(void*)0x719301;
 check(native_static_query(0,"data",0,&out)==0&&out==&data);
 check(native_static_query(1,"callback",0,&out)==0&&out==mod_a_bridge);
 check(native_static_query(1,"callback","NATIVE_1",&out)==0&&out==mod_a_identify);
 check(native_static_query(2,"callback",0,&out)==0&&out==mod_b_identify);
 out=(void*)0x719301;
 check(native_static_query(1,"missing",0,&out)==-2&&out==(void*)0x719301);
 check(native_static_query(1,"callback","missing",&out)==-2&&out==(void*)0x719301);
 check(native_static_query(3,"callback",0,&out)==-1&&out==(void*)0x719301);
 check(native_static_map(1)->l_loader==0);
 check(native_static_map(2)->l_loader==native_static_map(1));
 check(native_static_map(1)->l_scope[1]==&native_static_map(1)->l_searchlist);
 check(native_static_map(2)->l_scope[1]==&native_static_map(1)->l_searchlist);
 check(native_static_map(1)->l_searchlist.r_nlist==2);
 check(native_static_map(1)->l_searchlist.r_list[0]==native_static_map(1));
 check(native_static_map(1)->l_searchlist.r_list[1]==native_static_map(2));
 for(unsigned i=0;i<__native_token_count;i++)
  check(_dl_find_dso_for_object((ElfW(Addr))__native_token_table[i])==native_static_map(__native_token_table[i]->module));
 check(_dl_find_dso_for_object((ElfW(Addr))0x719301)==0);
 check(_dl_readonly_area(in,sizeof in)==dl_readonly_area_writable);
 check(_dl_readonly_area((void*)(uintptr_t)-1,2)==dl_readonly_area_not_found);
 check(native_static_registry_init(in,__native_token_table,__native_token_count)==-1);
 return failures;
}
unsigned metadata_checks(void){return checks;}
