/* Independent genuine GNU public-header client, _ISOMAC; no internal inline substitutions. */
#include <fcntl.h>
#include <sys/epoll.h>
#include <sys/mman.h>
#include <sys/quota.h>
#include <sys/sysinfo.h>
#include <sys/utsname.h>

#define VERIFY(name,result,...) \
 _Static_assert(__builtin_types_compatible_p(__typeof__(&name),result (*)(__VA_ARGS__)),#name " GNU public prototype"); \
 __typeof__(&name) volatile public_reference_##name=&name
VERIFY(mlock,int,const void *,size_t);
VERIFY(quotactl,int,int,const char *,int,caddr_t);
VERIFY(name_to_handle_at,int,int,const char *,struct file_handle *,int *,int);
VERIFY(process_madvise,ssize_t,int,const struct iovec *,size_t,int,unsigned int);
VERIFY(mseal,int,void *,size_t,unsigned long);
VERIFY(sysinfo,int,struct sysinfo *);
VERIFY(pkey_alloc,int,unsigned int,unsigned int);
VERIFY(munlock,int,const void *,size_t);
VERIFY(uname,int,struct utsname *);
VERIFY(remap_file_pages,int,void *,size_t,int,size_t,int);
VERIFY(process_mrelease,int,int,unsigned int);
VERIFY(munlockall,int,void);
VERIFY(mlockall,int,int);
VERIFY(epoll_ctl,int,int,int,int,struct epoll_event *);
VERIFY(pkey_free,int,int);
VERIFY(mincore,int,void *,size_t,unsigned char *);
_Static_assert(sizeof(size_t)==4 && sizeof(unsigned long)==4 && sizeof(ssize_t)==4,"Wasm32 scalar slots");
