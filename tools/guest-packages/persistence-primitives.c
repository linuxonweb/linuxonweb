#define _GNU_SOURCE
#include <sys/types.h>
#include <sys/stat.h>
#include <sys/file.h>
#include <sys/wait.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <signal.h>
#include <spawn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
extern char **environ;
static unsigned failures, checks;
static void check(const char *name, int ok) { ++checks; if (!ok) ++failures; printf("PERSIST_PRIMITIVE_%s %s errno=%d\n",ok?"PASS":"FAIL",name,errno); fflush(stdout); }
static int child_status(pid_t pid) {int status=0;pid_t r;do{r=waitpid(pid,&status,0);}while(r<0&&errno==EINTR);return r==pid&&WIFEXITED(status)?WEXITSTATUS(status):-1;}
int main(int argc,char **argv) {
 if(argc==3&&!strcmp(argv[1],"--locked-child")){int f=open(argv[2],O_RDWR|O_CLOEXEC);if(f<0)return 31;errno=0;int r=flock(f,LOCK_EX|LOCK_NB),e=errno;close(f);return r<0&&(e==EWOULDBLOCK||e==EAGAIN)?0:32;}
 if(argc==2&&!strcmp(argv[1],"--group-child"))return getpgrp()==getpid()?7:33;
 char dir[]="/home/.persist-primitives-XXXXXX";check("persistent-directory",mkdtemp(dir)!=NULL);if(failures)return 1;
 char a[PATH_MAX],b[PATH_MAX],lock[]="/run/persist-primitives.lock";snprintf(a,sizeof a,"%s/a",dir);snprintf(b,sizeof b,"%s/b",dir);
 int f=open(a,O_RDWR|O_CREAT|O_EXCL|O_CLOEXEC,0600);check("exclusive-create",f>=0);
 if(f>=0){check("checked-file-write",write(f,"old",3)==3);check("file-fsync",fsync(f)==0);check("seek-old-inode",lseek(f,0,SEEK_SET)==0);}
 int g=open(b,O_RDWR|O_CREAT|O_EXCL|O_CLOEXEC,0600);check("second-create",g>=0);if(g>=0){check("second-write",write(g,"new",3)==3);check("second-fsync",fsync(g)==0);check("second-close",close(g)==0);}
 int d=open(dir,O_RDONLY|O_DIRECTORY|O_CLOEXEC);check("directory-open",d>=0);if(d>=0)check("directory-fsync-before-rename",fsync(d)==0);
 check("atomic-rename-replacement",rename(b,a)==0);if(d>=0)check("directory-fsync-after-rename",fsync(d)==0);
 char value[4]={0};if(f>=0){check("old-open-inode-retained",read(f,value,3)==3&&!strcmp(value,"old"));check("old-close",close(f)==0);}
 f=open(a,O_RDONLY|O_CLOEXEC);check("new-open",f>=0);if(f>=0){memset(value,0,sizeof value);check("new-name-visible",read(f,value,3)==3&&!strcmp(value,"new"));errno=0;check("write-error-not-success",write(f,"x",1)==-1&&errno==EBADF);check("new-close",close(f)==0);}
 errno=0;f=open(a,O_WRONLY|O_CREAT|O_EXCL|O_CLOEXEC,0600);check("exclusive-conflict",f<0&&errno==EEXIST);if(f>=0)close(f);
 int p[2];int pr=pipe2(p,O_NONBLOCK|O_CLOEXEC);check("nonblocking-pipe",pr==0);if(pr==0){int capacity=fcntl(p[1],F_GETPIPE_SZ);size_t request=capacity>0&&capacity<=4194304?(size_t)capacity*2:8388608;char *buf=malloc(request);if(!buf)return 4;memset(buf,0x35,request);ssize_t n=write(p[1],buf,request);printf("PERSIST_PIPE capacity=%d requested=%zu written=%zd\n",capacity,request,n);check("positive-short-write-observed",n>0&&(size_t)n<request);size_t total=0;while(n>0&&total<(size_t)n){ssize_t r=read(p[0],buf,request);if(r<=0)break;total+=(size_t)r;}check("partial-write-byte-count",n>0&&total==(size_t)n);free(buf);close(p[0]);close(p[1]);}
 f=open(lock,O_RDWR|O_CREAT|O_CLOEXEC,0600);check("native-lock-open",f>=0);if(f>=0)check("nonblocking-native-lock",flock(f,LOCK_EX|LOCK_NB)==0);
 pid_t pid=-1;char *locked[]={argv[0],"--locked-child",lock,NULL};int rc=posix_spawn(&pid,argv[0],NULL,NULL,locked,environ);check("checked-native-spawn",rc==0);if(rc==0)check("concurrent-lock-exclusion",child_status(pid)==0);
 if(f>=0){check("native-lock-unlock",flock(f,LOCK_UN)==0);close(f);}
 char *missing[]={"/no-owned-probe-program",NULL};pid=-1;rc=posix_spawn(&pid,missing[0],NULL,NULL,missing,environ);check("spawn-enoent-propagated",rc==ENOENT);if(rc==0)child_status(pid);
 posix_spawnattr_t attr;check("spawn-attributes-init",posix_spawnattr_init(&attr)==0);check("spawn-group-flag",posix_spawnattr_setflags(&attr,POSIX_SPAWN_SETPGROUP)==0);check("spawn-group-id",posix_spawnattr_setpgroup(&attr,0)==0);
 char *group[]={argv[0],"--group-child",NULL};pid=-1;rc=posix_spawn(&pid,argv[0],NULL,&attr,group,environ);check("owned-process-group-spawn",rc==0);if(rc==0)check("child-group-and-wait-status",child_status(pid)==7);posix_spawnattr_destroy(&attr);
 if(d>=0)close(d);
 if(!failures){unlink(a);unlink(lock);rmdir(dir);}else printf("PERSIST_PRIMITIVE_EVIDENCE %s\n",dir);
 printf("PERSIST_PRIMITIVES_DONE checks=%u failures=%u\n",checks,failures);fflush(stdout);return failures?1:0;
}
