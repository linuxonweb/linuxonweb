/* Genuine public GNU declarations; raw calls are independent observations. */
#include <sys/utsname.h>
#include <sys/sysinfo.h>
#include <sys/epoll.h>
#include <sys/eventfd.h>
#include <sys/mman.h>
#include <sys/quota.h>
#include <sys/uio.h>
#include <fcntl.h>
#include <errno.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <limits.h>
extern void final16_record(const char*,int);
extern int final16_raw(int,int,int,int,int,int,int);
#define C(n,x) final16_record(n,!!(x))
#define REF(n) static __typeof__(&n) volatile p_##n=&n
REF(uname);REF(sysinfo);REF(epoll_ctl);REF(quotactl);REF(name_to_handle_at);REF(mlock);REF(munlock);REF(mlockall);REF(munlockall);REF(mincore);REF(remap_file_pages);REF(process_madvise);REF(process_mrelease);REF(mseal);REF(pkey_alloc);REF(pkey_free);
#define MAXPTR ((void*)(uintptr_t)UINT32_MAX)
static int guards(unsigned char*b,unsigned n){for(unsigned i=0;i<16;i++)if(b[i]!=0xa5||b[16+n+i]!=0xa5)return 0;return 1;}
static int terminated(const char*p){return memchr(p,0,65)!=0;}
__thread unsigned final16_trace;
__attribute__((export_name("final16_trace_enabled"))) unsigned final16_trace_enabled(void){return final16_trace;}
void final16_tests(void){
 int saved=errno;
 _Alignas(8) unsigned char ub[16+390+16],rb[16+390+16],sb[16+64+16],slo[16+64+16],shi[16+64+16],eb[16+16+16],ob[16+16+16];
 memset(ub,0xa5,sizeof ub);memset(rb,0xa5,sizeof rb);struct utsname*u=(void*)(ub+16),*r=(void*)(rb+16);errno=221;
 C("uname-public-guards",p_uname(u)==0&&errno==221&&guards(ub,390)&&terminated(u->sysname)&&terminated(u->nodename)&&terminated(u->release)&&terminated(u->version)&&terminated(u->machine)&&terminated(u->domainname));
 C("uname-raw-equal",final16_raw(160,(int)r,0,0,0,0,0)==0&&guards(rb,390)&&!memcmp(u,r,390));
 unsigned char olduname[390];memcpy(olduname,u,390);errno=0;C("uname-EFAULT-preserves",p_uname(MAXPTR)==-1&&errno==EFAULT&&!memcmp(olduname,u,390)&&guards(ub,390));
 memset(sb,0xa5,sizeof sb);memset(slo,0xa5,sizeof slo);memset(shi,0xa5,sizeof shi);struct sysinfo*s=(void*)(sb+16),*lo=(void*)(slo+16),*hi=(void*)(shi+16);
 int rawlo=final16_raw(179,(int)lo,0,0,0,0,0);errno=222;int publicinfo=p_sysinfo(s);int rawhi=final16_raw(179,(int)hi,0,0,0,0,0);
 C("sysinfo-public-raw-bracket-guards",rawlo==0&&publicinfo==0&&rawhi==0&&errno==222&&guards(sb,64)&&guards(slo,64)&&guards(shi,64)&&lo->uptime<=s->uptime&&s->uptime<=hi->uptime&&s->uptime>=0&&s->mem_unit>0&&s->totalram==lo->totalram&&s->totalram==hi->totalram&&s->mem_unit==lo->mem_unit&&s->mem_unit==hi->mem_unit);
 C("sysinfo-bounds-padding",(uint64_t)s->freeram*s->mem_unit<=(uint64_t)s->totalram*s->mem_unit&&s->freeswap<=s->totalswap&&s->freehigh<=s->totalhigh&&s->pad==0&&!memcmp(s->_f,"\0\0\0\0\0\0\0\0",8));
 unsigned char oldinfo[64];memcpy(oldinfo,s,64);errno=0;C("sysinfo-EFAULT-preserves",p_sysinfo(MAXPTR)==-1&&errno==EFAULT&&!memcmp(oldinfo,s,64)&&guards(sb,64));
 C("uname-repeat-after-sysinfo",p_uname(r)==0&&!memcmp(u,r,390)&&guards(rb,390));
 memset(eb,0xa5,sizeof eb);memset(ob,0xa5,sizeof ob);struct epoll_event*ev=(void*)(eb+16),*out=(void*)(ob+16);int ep=epoll_create1(EPOLL_CLOEXEC),fd=eventfd(0,EFD_NONBLOCK|EFD_CLOEXEC);
 C("epoll-owned-fds",ep>=0&&fd>=0);if(ep>=0&&fd>=0){ev->events=EPOLLIN;ev->data.u64=UINT64_C(0xfedcba9876543210);unsigned char original[16];memcpy(original,ev,16);errno=223;
 C("epoll-ADD-input-preserved",p_epoll_ctl(ep,EPOLL_CTL_ADD,fd,ev)==0&&errno==223&&!memcmp(original,ev,16)&&guards(eb,16));
 C("epoll-initial-empty",final16_raw(22,ep,(int)out,1,0,0,8)==0&&guards(ob,16));
 uint64_t one=1,count=0;C("epoll-write-ready-data64",final16_raw(64,fd,(int)&one,8,0,0,0)==8&&final16_raw(22,ep,(int)out,1,0,0,8)==1&&(out->events&EPOLLIN)&&out->data.u64==ev->data.u64&&guards(ob,16));
 errno=0;C("epoll-duplicate-ADD",p_epoll_ctl(ep,EPOLL_CTL_ADD,fd,ev)==-1&&errno==EEXIST);
 ev->data.u64=UINT64_C(0x12345678abcdef09);memcpy(original,ev,16);errno=224;C("epoll-MOD-data64-input-preserved",p_epoll_ctl(ep,EPOLL_CTL_MOD,fd,ev)==0&&errno==224&&!memcmp(original,ev,16)&&guards(eb,16)&&final16_raw(22,ep,(int)out,1,0,0,8)==1&&out->data.u64==ev->data.u64&&guards(ob,16));
 C("epoll-drain-empty",final16_raw(63,fd,(int)&count,8,0,0,0)==8&&count==1&&final16_raw(22,ep,(int)out,1,0,0,8)==0);
 errno=0;C("epoll-MOD-EFAULT",p_epoll_ctl(ep,EPOLL_CTL_MOD,fd,MAXPTR)==-1&&errno==EFAULT&&!memcmp(original,ev,16)&&guards(eb,16));
 C("epoll-DEL-null",p_epoll_ctl(ep,EPOLL_CTL_DEL,fd,0)==0);C("epoll-deleted-not-ready",final16_raw(64,fd,(int)&one,8,0,0,0)==8&&final16_raw(22,ep,(int)out,1,0,0,8)==0);
 errno=0;C("epoll-missing-MOD",p_epoll_ctl(ep,EPOLL_CTL_MOD,fd,ev)==-1&&errno==ENOENT);errno=0;C("epoll-missing-DEL",p_epoll_ctl(ep,EPOLL_CTL_DEL,fd,0)==-1&&errno==ENOENT);
 errno=0;C("epoll-bad-fd",p_epoll_ctl(-1,EPOLL_CTL_ADD,fd,ev)==-1&&errno==EBADF);errno=0;C("epoll-self",p_epoll_ctl(ep,EPOLL_CTL_ADD,ep,ev)==-1&&errno==EINVAL);errno=0;C("epoll-invalid-op",p_epoll_ctl(ep,999,fd,ev)==-1&&errno==EINVAL);errno=0;C("epoll-ADD-EFAULT",p_epoll_ctl(ep,EPOLL_CTL_ADD,fd,MAXPTR)==-1&&errno==EFAULT);
 C("epoll-final-guards",guards(eb,16)&&guards(ob,16));}
 if(fd>=0)C("eventfd-close",final16_raw(57,fd,0,0,0,0,0)==0);if(ep>=0)C("epoll-close",final16_raw(57,ep,0,0,0,0,0)==0);
 _Alignas(8) unsigned char qb[16+128+16],hb[16+40+16],mb[16+4+16],vb[16+8+16];memset(qb,0xa5,sizeof qb);memset(hb,0xa5,sizeof hb);memset(mb,0xa5,sizeof mb);memset(vb,0xa5,sizeof vb);struct file_handle*h=(void*)(hb+16);h->handle_bytes=32;h->handle_type=17;unsigned char oldh[40];memcpy(oldh,h,40);void*payload=malloc(4096);C("unsupported-owned-payload",payload!=0);if(payload){memset(payload,0x69,4096);struct iovec io={payload,4096};
#define U(n,x) do{errno=225;C(n,(x)==-1&&errno==ENOSYS);}while(0)
 U("quotactl-ENOSYS",p_quotactl(QCMD(Q_GETQUOTA,USRQUOTA),"/",0,(char*)qb+16));U("quotactl-altered-ENOSYS",p_quotactl(-1,"/",-1,(char*)qb+16));
 U("name-to-handle-ENOSYS",p_name_to_handle_at(AT_FDCWD,"/",h,(void*)(mb+16),0));U("name-to-handle-altered-ENOSYS",p_name_to_handle_at(-1,"/",h,(void*)(mb+16),-1));
 U("mlock-ENOSYS",p_mlock(payload,4096));U("mlock-altered-ENOSYS",p_mlock(payload,0));U("munlock-ENOSYS",p_munlock(payload,4096));U("munlock-altered-ENOSYS",p_munlock(payload,0));U("mlockall-ENOSYS",p_mlockall(MCL_CURRENT));U("mlockall-altered-ENOSYS",p_mlockall(-1));U("munlockall-ENOSYS",p_munlockall());U("munlockall-repeat-ENOSYS",p_munlockall());
 U("mincore-ENOSYS",p_mincore(payload,4096,vb+16));U("mincore-altered-ENOSYS",p_mincore(payload,0,vb+16));U("remap-ENOSYS",p_remap_file_pages(payload,4096,0,0,0));U("remap-altered-ENOSYS",p_remap_file_pages(payload,0,-1,1,-1));
 U("process-madvise-ENOSYS",p_process_madvise(-1,&io,1,MADV_NORMAL,0));U("process-madvise-altered-ENOSYS",p_process_madvise(-1,&io,1,-1,UINT_MAX));U("process-mrelease-ENOSYS",p_process_mrelease(-1,0));U("process-mrelease-altered-ENOSYS",p_process_mrelease(-1,UINT_MAX));U("mseal-ENOSYS",p_mseal(payload,4096,0));U("mseal-altered-ENOSYS",p_mseal(payload,0,ULONG_MAX));U("pkey-alloc-ENOSYS",p_pkey_alloc(0,0));U("pkey-alloc-altered-ENOSYS",p_pkey_alloc(UINT_MAX,UINT_MAX));U("pkey-free-ENOSYS",p_pkey_free(0));U("pkey-free-altered-ENOSYS",p_pkey_free(-1));
 int intact=1;for(unsigned i=0;i<4096;i++)intact&=((unsigned char*)payload)[i]==0x69;for(unsigned i=16;i<144;i++)intact&=qb[i]==0xa5;for(unsigned i=16;i<20;i++)intact&=mb[i]==0xa5;for(unsigned i=16;i<24;i++)intact&=vb[i]==0xa5;
 C("ENOSYS-outputs-payload-iovec-preserved",intact&&guards(qb,128)&&guards(hb,40)&&guards(mb,4)&&guards(vb,8)&&!memcmp(h,oldh,40)&&io.iov_base==payload&&io.iov_len==4096);free(payload);}
 errno=saved;
}
int final16_thread(unsigned id){int saved=errno;struct utsname u;struct sysinfo s;errno=230+(int)id;int ok=p_uname(&u)==0&&p_sysinfo(&s)==0&&errno==230+(int)id;errno=0;ok&=p_uname(MAXPTR)==-1&&errno==EFAULT;errno=0;ok&=p_pkey_alloc(0,0)==-1&&errno==ENOSYS;errno=saved;return ok;}
