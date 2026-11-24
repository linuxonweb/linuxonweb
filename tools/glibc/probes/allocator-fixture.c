/* Host fixture only. Explicit aux values supplied by harness; real guest
   args245/aux startup belongs to the separate startup/TLS packet. */
#include <ldsodefs.h>
#include <tls.h>
#include <unistd.h>
#include <sysdep.h>
#include <dl-tunables.h>
#include <hugepages.h>
#include <string.h>
#include <errno.h>
#include <stdlib.h>
extern char __heap_base;
extern void __wasm_init_tls(void*);
extern unsigned fixture_tls_size(void),fixture_tls_align(void);
extern int __wasm_memory_init(uintptr_t,size_t);
extern void __ptmalloc_init(void);
static struct pthread parent;
static dtv_t initial_dtv[3];
static unsigned char tls_reservation[65536] __attribute__((aligned(65536)));
size_t _dl_pagesize,_dl_elf_thp_pagesize;
enum thp_mode_t _dl_thp_mode;
int __libc_enable_secure;
int _dl_debug_fd=2;
/* Explicit deterministic host fixture guard; production uses AT_RANDOM. */
uintptr_t __pointer_chk_guard_local=0x95ba41e3;
static char option[]="GLIBC_TUNABLES=glibc.malloc.perturb=93";
static char program[]="gnu-allocator-host-fixture";
static char *environment[]={option,0};
static char *arguments[]={program,0};
int fixture_init(unsigned page,unsigned secure) {
 unsigned size=fixture_tls_size(),align=fixture_tls_align();
 if(!align||(align&(align-1))||size>sizeof(tls_reservation)||align>65536||secure>1)return -1;
 __wasm_init_tls(tls_reservation);
 memset(&parent,0,sizeof(parent));parent.header.tcb=&parent;parent.header.self=&parent;
 initial_dtv[0].counter=1;initial_dtv[1].counter=0;
 initial_dtv[2].pointer.val=tls_reservation;initial_dtv[2].pointer.to_free=0;
 INSTALL_DTV(&parent,initial_dtv);
 if(INTERNAL_SYSCALL_CALL(set_thread_area,&parent))return -2;
 parent.tid=INTERNAL_SYSCALL_CALL(gettid);
 _dl_pagesize=page;__libc_enable_secure=secure;
 if(__wasm_memory_init((uintptr_t)&__heap_base,page))return -3;
 __tunables_init(environment,arguments);
 __ptmalloc_init();return 0;
}
unsigned fixture_errno(void){return errno;}
unsigned fixture_heap_base(void){return (uintptr_t)&__heap_base;}
unsigned fixture_thread_pointer(void){return (uintptr_t)&parent;}
unsigned fixture_perturb(void){int value=0;__tunable_get_val(glibc_malloc_perturb,&value,0);return value;}
