#include <linux/utsname.h>
#include <linux/sysinfo.h>
#include <linux/eventpoll.h>
#include <linux/uio.h>
#define O(t,f) __builtin_offsetof(t,f)
const unsigned final16_layout[]={sizeof(struct new_utsname),_Alignof(struct new_utsname),O(struct new_utsname,domainname),sizeof(struct sysinfo),_Alignof(struct sysinfo),O(struct sysinfo,loads),O(struct sysinfo,procs),O(struct sysinfo,totalhigh),O(struct sysinfo,mem_unit),O(struct sysinfo,_f),sizeof(((struct sysinfo*)0)->uptime),sizeof(struct epoll_event),_Alignof(struct epoll_event),O(struct epoll_event,data),sizeof(struct iovec),_Alignof(struct iovec),O(struct iovec,iov_len)};
