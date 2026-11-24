/* Native architecture backend. It describes actual prelinked modules, never
   ELF segments or read-only Wasm data. GNU wrappers/error handling stay GNU. */
#include "native-loader.h"
#include <errno.h>
#include <string.h>
#include <dl-hash.h>
#include <libc-lock.h>
#include <stdint.h>

struct native_module {
 struct link_map map;
 struct native_module_input input;
 struct link_map *local_maps[3];
 struct r_scope_elem *local_scopes[2],*global_scopes[3];
 unsigned direct,pinned,visible,active,dependencies;
};
static struct native_module modules[3];
static struct link_map *global_maps[3];
static struct r_scope_elem global_scope;
static const struct native_callsite *const *callsites;
static unsigned callsite_count,ready;
struct link_namespaces _dl_ns[DL_NNS];
__rtld_lock_define_initialized_recursive(,_dl_load_lock)

static struct native_module *module_for_map(struct link_map *map) {
 for(unsigned i=0;i<3;i++)if(map==&modules[i].map)return &modules[i];
 return NULL;
}
struct link_map *native_static_map(unsigned id) {return ready&&id<3?&modules[id].map:NULL;}
static void update_scopes(void) {
 for(unsigned i=0;i<3;i++)modules[i].active=modules[i].direct||modules[i].pinned;
 for(unsigned pass=0;pass<3;pass++)for(unsigned i=0;i<3;i++)if(modules[i].active)
  for(unsigned j=0;j<3;j++)if(modules[i].dependencies&(1u<<j))modules[j].active=1;
 global_scope.r_nlist=0;
 for(unsigned i=0;i<3;i++) {
  struct native_module *m=&modules[i];
  if(!m->active)m->visible=0;
  m->map.l_direct_opencount=m->direct;
  m->map.l_global=m->visible;
  if(m->active&&m->visible)global_maps[global_scope.r_nlist++]=&m->map;
 }
 modules[0].map.l_searchlist=global_scope;
}
int native_static_registry_init(const struct native_module_input in[3],
 const struct native_callsite *const *tokens,unsigned count) {
 if(ready||!in||!tokens||!count)return -1;
 for(unsigned i=0;i<3;i++) {
  if(!in[i].name||!in[i].symbols||!in[i].symbol_count)return -2;
  for(unsigned k=0;k<i;k++)if(strcmp(in[i].name,in[k].name)==0)return -3;
  for(unsigned j=0;j<in[i].symbol_count;j++) {
   struct native_symbol *s=&in[i].symbols[j];
   if(!s->name||!s->address||(s->type!=STT_FUNC&&s->type!=STT_OBJECT))return -4;
   for(unsigned k=0;k<j;k++) {
    struct native_symbol *p=&in[i].symbols[k];
    if(strcmp(p->name,s->name)==0&&((p->default_version&&s->default_version)||(!p->version&&!s->version)||
       (p->version&&s->version&&strcmp(p->version,s->version)==0)))return -5;
   }
  }
 }
 for(unsigned i=0;i<count;i++) {
  if(!tokens[i]||tokens[i]->module>=3||!tokens[i]->id||
    (tokens[i]->kind!=1&&tokens[i]->kind!=2))return -6;
  for(unsigned j=0;j<i;j++)if(tokens[i]==tokens[j]||tokens[i]->id==tokens[j]->id)return -7;
 }
 memset(modules,0,sizeof(modules));memset(_dl_ns,0,sizeof(_dl_ns));
 callsites=tokens;callsite_count=count;global_scope.r_list=global_maps;
 for(unsigned i=0;i<3;i++) {
  struct native_module *m=&modules[i];m->input=in[i];
  m->map.l_name=(char*)in[i].name;m->map.l_real=&m->map;
  m->map.l_ns=LM_ID_BASE;m->map.l_relocated=1;m->map.l_init_called=1;
  m->map.l_type=i?lt_loaded:lt_executable;
  m->map.l_prev=i?&modules[i-1].map:NULL;m->map.l_next=i<2?&modules[i+1].map:NULL;
  /* GNU top-level dlopen has no loader; B is A's dependency. */
  m->map.l_loader=i==2?&modules[1].map:NULL;
  if(i==1)m->dependencies=1u<<2;
  for(unsigned j=0;j<in[i].symbol_count;j++) {
   struct native_symbol *s=&in[i].symbols[j];memset(&s->elf,0,sizeof(s->elf));
   s->elf.st_info=ELFW(ST_INFO)(STB_GLOBAL,s->type);s->elf.st_shndx=SHN_ABS;
   s->elf.st_value=(ElfW(Addr))s->address;
  }
  // Actual local dependency order: process globals, A->B, B alone.
  unsigned n=0;if(i==0){for(unsigned j=0;j<3;j++)m->local_maps[n++]=&modules[j].map;}
  else {m->local_maps[n++]=&m->map;if(i==1)m->local_maps[n++]=&modules[2].map;}
  m->map.l_searchlist=(struct r_scope_elem){m->local_maps,n};
  m->local_scopes[0]=&m->map.l_searchlist;m->map.l_local_scope[0]=m->local_scopes[0];
  m->global_scopes[0]=&global_scope;
  if(i)m->global_scopes[1]=&modules[i==2?1:i].map.l_searchlist;
  m->map.l_scope=m->global_scopes;m->map.l_scope_max=3;
  for(unsigned j=0;j<count;j++)if(tokens[j]->module==i) {
   ElfW(Addr) p=(ElfW(Addr))tokens[j];
   if(!m->map.l_map_start||p<m->map.l_map_start)m->map.l_map_start=p;
   if(p+sizeof(*tokens[j])>m->map.l_map_end)m->map.l_map_end=p+sizeof(*tokens[j]);
  }
 }
 modules[0].visible=modules[0].pinned=modules[0].direct=1;
 _dl_ns[0]._ns_loaded=&modules[0].map;_dl_ns[0]._ns_nloaded=3;
 _dl_ns[0]._ns_main_searchlist=&modules[0].map.l_searchlist;
 ready=1;update_scopes();return 0;
}
struct link_map *_dl_find_dso_for_object(ElfW(Addr) token) {
 if(!ready)return NULL;
 for(unsigned i=0;i<callsite_count;i++)if((ElfW(Addr))callsites[i]==token)
  return &modules[callsites[i]->module].map;
 return NULL;
}
static struct native_symbol *find_symbol(struct native_module *m,const char *name,
 const char *version) {
 for(unsigned i=0;i<m->input.symbol_count;i++) {
  struct native_symbol *s=&m->input.symbols[i];if(strcmp(name,s->name))continue;
  if(version){if(s->version&&!strcmp(version,s->version))return s;}
  else if(!s->version||s->default_version)return s;
 }
 return NULL;
}
// Read-only registry primitive for a separately labelled finite metadata gate.
// Public providers below retain actual GNU recursive lock/error routes.
int native_static_query(unsigned id,const char *name,const char *version,void **out) {
 if(!ready||id>=3||!name||!out)return -1;
 struct native_symbol *s=find_symbol(&modules[id],name,version);
 if(!s)return -2;*out=s->address;return 0;
}
void *_dl_open(const char *file,int mode,const void *caller,Lmid_t ns,
 int argc,char *argv[],char *env[]) {
 (void)argc;(void)argv;(void)env;
 struct link_map *origin=_dl_find_dso_for_object((ElfW(Addr))caller);
 if(!ready||!origin||!module_for_map(origin)->active)_dl_signal_error(EINVAL,file,NULL,"unregistered or inactive native caller");
 if(ns!=LM_ID_BASE&&ns!=__LM_ID_CALLER)_dl_signal_error(EINVAL,file,NULL,"unsupported native namespace");
 if((mode&RTLD_BINDING_MASK)!=RTLD_NOW&&(mode&RTLD_BINDING_MASK)!=RTLD_LAZY)
  _dl_signal_error(EINVAL,file,NULL,"invalid native dlopen mode");
 if(mode&RTLD_DEEPBIND)_dl_signal_error(ENOTSUP,file,NULL,"native DEEPBIND is unsupported");
 unsigned allowed=RTLD_BINDING_MASK|RTLD_NOLOAD|RTLD_GLOBAL|RTLD_NODELETE|__RTLD_DLOPEN;
 if((unsigned)mode&~allowed)_dl_signal_error(ENOTSUP,file,NULL,"unsupported native dlopen flags");
 struct native_module *m=NULL;
 if(!file||!*file)m=&modules[0];else for(unsigned i=0;i<3;i++)if(!strcmp(file,modules[i].input.name))m=&modules[i];
 if(!m)_dl_signal_error(ENOTSUP,file,NULL,"ELF loading is unsupported by the native static loader");
 __rtld_lock_lock_recursive(_dl_load_lock);
 if((mode&RTLD_NOLOAD)&&!m->active){__rtld_lock_unlock_recursive(_dl_load_lock);return NULL;}
 if(m->direct==~0u){__rtld_lock_unlock_recursive(_dl_load_lock);_dl_signal_error(EOVERFLOW,file,NULL,"native handle count overflow");}
 m->direct++;
 if(mode&RTLD_NODELETE){m->pinned=1;if(m==&modules[1])modules[2].pinned=1;}
 if(mode&RTLD_GLOBAL){m->visible=1;if(m==&modules[1])modules[2].visible=1;}
 update_scopes();__rtld_lock_unlock_recursive(_dl_load_lock);return &m->map;
}
void _dl_close(void *handle) {
 struct native_module *m=module_for_map(handle);
 if(!ready||!m)_dl_signal_error(EINVAL,NULL,NULL,"invalid native handle");
 __rtld_lock_lock_recursive(_dl_load_lock);
 if(m->direct<=((m==&modules[0])?1u:0u)) {
  __rtld_lock_unlock_recursive(_dl_load_lock);_dl_signal_error(EINVAL,m->input.name,NULL,"unbalanced native close");
 }
 m->direct--;update_scopes();__rtld_lock_unlock_recursive(_dl_load_lock);
}
lookup_t _dl_lookup_symbol_x(const char *name,struct link_map *from,
 const ElfW(Sym) **ref,struct r_scope_elem *scopes[],
 const struct r_found_version *version,int type_class,int flags,struct link_map *skip) {
 if(!ready||!module_for_map(from)||!name||!ref||!scopes||type_class)
  _dl_signal_error(EINVAL,NULL,NULL,"unsupported native lookup request");
 if(flags&~(DL_LOOKUP_RETURN_NEWEST|DL_LOOKUP_ADD_DEPENDENCY|DL_LOOKUP_GSCOPE_LOCK))
  _dl_signal_error(ENOTSUP,name,NULL,"unsupported native lookup flags");
 if(version&&(!version->name||version->hash!=_dl_elf_hash(version->name)||version->filename))
  _dl_signal_error(EINVAL,name,NULL,"unsupported native version request");
 lookup_t result=NULL;const ElfW(Sym) *selected=NULL;unsigned after=skip==NULL;
 __rtld_lock_lock_recursive(_dl_load_lock);
 for(unsigned s=0;scopes[s]&&!result;s++)for(unsigned i=0;i<scopes[s]->r_nlist;i++) {
  struct link_map *map=scopes[s]->r_list[i];
  if(!after){if(map==skip)after=1;continue;}
  struct native_module *m=module_for_map(map);if(!m||!m->active)continue;
  struct native_symbol *sym=find_symbol(m,name,version?version->name:NULL);
  if(sym){result=map;selected=&sym->elf;
   if(flags&DL_LOOKUP_ADD_DEPENDENCY)module_for_map(from)->dependencies|=1u<<(m-modules);
   break;}
 }
 update_scopes();__rtld_lock_unlock_recursive(_dl_load_lock);
 if(!result)_dl_signal_error(0,name,NULL,version?"native symbol version not found":"native symbol not found");
 *ref=selected;return result;
}
enum dl_readonly_area_error_type _dl_readonly_area(const void *ptr,size_t size) {
 uint64_t bytes=(uint64_t)__builtin_wasm_memory_size(0)*65536u;
 uint64_t start=(uintptr_t)ptr;
 if(start>bytes||(uint64_t)size>bytes-start)return dl_readonly_area_not_found;
 return dl_readonly_area_writable;
}
