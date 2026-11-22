/* Bounded guest gate: real generated GNU wrappers and real kernel results. */
#include <unistd.h>
#include <fcntl.h>
#include <sys/stat.h>
extern int __open64_nocancel(const char *,int,...),__close_nocancel(int);
extern int __wasm_probe_close_regular(int),__wasm_probe_close_raw(int),__wasm_probe_close_errval(int);
extern pid_t __getppid(void),__gettid(void);
extern uid_t __getuid(void),__geteuid(void);
extern gid_t __getgid(void),__getegid(void);
extern int __kill(pid_t,int),__dup(int);
static volatile unsigned generated_signal_count;
static void generated_signal(int n){if(n==SIGUSR2)generated_signal_count++;}
static void generated_syscall_tests(void){
 int before=failures;errno=181;
 check("generated-getpid",getpid()==sc(172,0,0,0,0,0,0)&&__getpid()==getpid());
 check("generated-getppid",getppid()==sc(173,0,0,0,0,0,0)&&__getppid()==getppid());
 check("generated-gettid",gettid()==sc(178,0,0,0,0,0,0)&&__gettid()==gettid());
 check("generated-identities",getuid()==startup.uid&&geteuid()==startup.euid&&getgid()==startup.gid&&getegid()==startup.egid);
 check("generated-identity-aliases",__getuid()==getuid()&&__geteuid()==geteuid()&&__getgid()==getgid()&&__getegid()==getegid());
 check("generated-NOERRNO-success-preserves-errno",errno==181);
 check("generated-kill-zero-public",kill(getpid(),0)==0&&errno==181);
 check("generated-kill-zero-internal",__kill(getpid(),0)==0&&errno==181);
 check("generated-kill-invalid-signal",kill(getpid(),999)==-1&&errno==EINVAL);
 struct sigaction a,old;memset(&a,0,sizeof(a));a.sa_handler=generated_signal;
 check("generated-install-handler",sigaction(SIGUSR2,&a,&old)==0);
 errno=183;check("generated-kill-handler",kill(getpid(),SIGUSR2)==0&&generated_signal_count==1&&errno==183);
 check("generated-raise-handler",raise(SIGUSR2)==0&&generated_signal_count==2&&errno==183);
 check("generated-restore-handler",sigaction(SIGUSR2,&old,0)==0);
 errno=184;check("generated-dup-invalid",dup(-1)==-1&&errno==EBADF);
 errno=185;check("generated-internal-dup-invalid",__dup(-1)==-1&&errno==EBADF);
 errno=186;check("generated-fchdir-invalid",fchdir(-1)==-1&&errno==EBADF);
 errno=187;check("generated-fchmod-invalid",fchmod(-1,0600)==-1&&errno==EBADF);
 errno=188;check("generated-fchown-invalid",fchown(-1,0,0)==-1&&errno==EBADF);
 errno=189;check("private-regular-close-invalid",__wasm_probe_close_regular(-1)==-1&&errno==EBADF);
 errno=190;check("private-NOERRNO-close-invalid",__wasm_probe_close_raw(-1)==-EBADF&&errno==190);
 errno=191;check("private-ERRVAL-close-invalid",__wasm_probe_close_errval(-1)==EBADF&&errno==191);
 errno=192;check("generated-chdir",chdir("/")==0&&errno==192);
 int fd=__open64_nocancel("/init",O_RDONLY,0);check("fixture-real-file-open",fd>=0);
 if(fd>=0){
  errno=193;int copy=dup(fd);check("generated-dup-valid",copy>=0&&errno==193);
  if(copy>=0)check("private-ERRVAL-close-valid",__wasm_probe_close_errval(copy)==0&&errno==193);
  copy=dup(fd);if(copy>=0)check("private-NOERRNO-close-valid",__wasm_probe_close_raw(copy)==0&&errno==193);else check("generated-second-dup",0);
  copy=dup(fd);if(copy>=0)check("private-regular-close-valid",__wasm_probe_close_regular(copy)==0&&errno==193);else check("generated-third-dup",0);
  char b[4]={0};check("fixture-real-file-read",sc(63,fd,(int)b,2,0,0,0)==2&&b[0]=='#'&&b[1]=='!');
  check("fixture-real-file-close",__close_nocancel(fd)==0);
 }
 errno=194;char link[32];check("generated-readlinkat-missing",readlinkat(AT_FDCWD,"/gnu-no-such-generated-link",link,sizeof(link))==-1&&errno==ENOENT);
 errno=195;check("generated-unlinkat-missing",unlinkat(AT_FDCWD,"/gnu-no-such-generated-file",0)==-1&&errno==ENOENT);
 errno=196;check("generated-mkdirat-invalid-fd",mkdirat(-1,"gnu-relative",0700)==-1&&errno==EBADF);
 put("GNU_GENERATED_SYSCALLS tested=typed errno=regular,NOERRNO,ERRVAL result=");put(failures==before?"PASS\n":"FAIL\n");
 errno=0;
}
