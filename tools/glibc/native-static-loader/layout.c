#include "native-loader.h"
#include <dlfcn.h>
#include <stddef.h>
#include <pthreadP.h>
_Static_assert(__builtin_types_compatible_p(__typeof__(&dlopen),void *(*)(const char *,int)),"GNU dlopen ABI");
_Static_assert(__builtin_types_compatible_p(__typeof__(&dlsym),void *(*)(void *,const char *)),"GNU dlsym ABI");
_Static_assert(__builtin_types_compatible_p(__typeof__(&dlvsym),void *(*)(void *,const char *,const char *)),"GNU dlvsym ABI");
_Static_assert(__builtin_types_compatible_p(__typeof__(&dlmopen),void *(*)(Lmid_t,const char *,int)),"GNU dlmopen ABI");
_Static_assert(__builtin_types_compatible_p(__typeof__(&dlclose),int (*)(void *)),"GNU dlclose ABI");
_Static_assert(__builtin_types_compatible_p(__typeof__(&dlerror),char *(*)(void)),"GNU dlerror ABI");
static const unsigned values[]={sizeof(struct link_map),_Alignof(struct link_map),
 offsetof(struct link_map,l_loader),offsetof(struct link_map,l_scope),offsetof(struct link_map,l_local_scope),
 sizeof(struct r_scope_elem),sizeof(struct r_found_version),sizeof(ElfW(Sym)),sizeof(Lmid_t),
 sizeof(pthread_mutex_t),offsetof(struct pthread,header.gscope_flag),offsetof(struct pthread,rtld_catch),
 sizeof(struct native_callsite),_Alignof(struct native_callsite)};
unsigned native_layout(unsigned index){return index<sizeof values/sizeof *values?values[index]:~0u;}
