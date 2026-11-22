#ifndef NATIVE_STATIC_LOADER_H
#define NATIVE_STATIC_LOADER_H
#include <ldsodefs.h>
struct native_callsite {unsigned id,module,kind;};
struct native_symbol {
 const char *name,*version;
 void *address;
 unsigned type,default_version;
 ElfW(Sym) elf;
};
struct native_module_input {
 const char *name;
 struct native_symbol *symbols;
 unsigned symbol_count;
};
int native_static_registry_init(const struct native_module_input inputs[3],
 const struct native_callsite *const *tokens,unsigned token_count);
int native_static_query(unsigned module,const char *name,const char *version,
 void **address);
struct link_map *native_static_map(unsigned module);
#endif
