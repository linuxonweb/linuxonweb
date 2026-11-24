/* Compile against genuine GNU headers: never infer C type from Wasm width. */
#include <unistd.h>
#include <signal.h>
#include <sys/stat.h>
#define SAME(name,type) _Static_assert(__builtin_types_compatible_p(__typeof__(&name),type),#name " GNU signature")
SAME(getpid,pid_t(*)(void));SAME(getppid,pid_t(*)(void));SAME(gettid,pid_t(*)(void));
SAME(getuid,uid_t(*)(void));SAME(geteuid,uid_t(*)(void));
SAME(getgid,gid_t(*)(void));SAME(getegid,gid_t(*)(void));
SAME(kill,int(*)(pid_t,int));SAME(close,int(*)(int));SAME(dup,int(*)(int));
SAME(dup3,int(*)(int,int,int));SAME(chdir,int(*)(const char*));SAME(fchdir,int(*)(int));
SAME(unlinkat,int(*)(int,const char*,int));SAME(mkdirat,int(*)(int,const char*,mode_t));
SAME(readlinkat,ssize_t(*)(int,const char*,char*,size_t));
SAME(fchmod,int(*)(int,mode_t));SAME(fchown,int(*)(int,uid_t,gid_t));
_Static_assert(sizeof(pid_t)==4&&sizeof(uid_t)==4&&sizeof(gid_t)==4&&sizeof(mode_t)==4,"audited scalar widths");
_Static_assert(sizeof(void*)==4&&sizeof(size_t)==4&&sizeof(ssize_t)==4,"audited pointer widths");
_Static_assert(sizeof(off_t)==8&&sizeof(time_t)==8,"off64/time64 require explicit transport conversion");
