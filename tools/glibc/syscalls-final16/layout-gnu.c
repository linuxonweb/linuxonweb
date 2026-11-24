#include <sys/utsname.h>
#include <sys/sysinfo.h>
#include <sys/epoll.h>
#include <fcntl.h>
#include <sys/uio.h>
#define O(t,f) __builtin_offsetof(t,f)
const unsigned final16_layout[]={sizeof(struct utsname),_Alignof(struct utsname),O(struct utsname,domainname),sizeof(struct sysinfo),_Alignof(struct sysinfo),O(struct sysinfo,loads),O(struct sysinfo,procs),O(struct sysinfo,totalhigh),O(struct sysinfo,mem_unit),O(struct sysinfo,_f),sizeof(((struct sysinfo*)0)->uptime),sizeof(struct epoll_event),_Alignof(struct epoll_event),O(struct epoll_event,data),sizeof(struct file_handle),_Alignof(struct file_handle),O(struct file_handle,f_handle),sizeof(struct iovec),_Alignof(struct iovec),O(struct iovec,iov_len)};
