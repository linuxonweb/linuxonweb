#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mount.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>
static int failed;
static unsigned checks;
static void check(int ok,const char *name){checks++;printf("HOME_CHECK %s %s errno=%d\n",ok?"PASS":"FAIL",name,errno);fflush(stdout);if(!ok)failed++;}
static double now(void){struct timespec t;clock_gettime(CLOCK_MONOTONIC,&t);return t.tv_sec+t.tv_nsec/1e9;}
static void path(char *out,const char *root,const char *name){snprintf(out,256,"%s/%s",root,name);}
static void filecheck(const char *root){
 char p[256],q[256];unsigned char a[4096],b[65536],got[4096];memset(a,0x61,sizeof a);memset(b,0x62,sizeof b);
 path(p,root,"durable");int fd=open(p,O_CREAT|O_EXCL|O_RDWR,0600);check(fd>=0,"create");if(fd<0)return;
 check(write(fd,a,sizeof a)==sizeof a,"write-return");check(fdatasync(fd)==0,"fdatasync");check(pwrite(fd,a,sizeof a,4096)==sizeof a,"pwrite-return");check(fsync(fd)==0,"fsync");check(close(fd)==0,"close");
 fd=open(p,O_RDONLY);struct stat st;check(fd>=0&&fstat(fd,&st)==0&&st.st_size==8192,"reopen-size");check(pread(fd,got,sizeof got,4096)==sizeof got&&!memcmp(got,a,sizeof a),"reopen-bytes");close(fd);
 path(p,root,"replace.tmp");path(q,root,"replace");fd=open(p,O_CREAT|O_EXCL|O_WRONLY,0600);check(fd>=0&&write(fd,a,sizeof a)==sizeof a&&fsync(fd)==0,"rename-source-durable");close(fd);check(rename(p,q)==0,"atomic-rename");fd=open(root,O_RDONLY|O_DIRECTORY);check(fd>=0&&fsync(fd)==0,"directory-fsync");close(fd);check(access(p,F_OK)<0&&errno==ENOENT,"rename-old-absent");fd=open(q,O_RDONLY);check(fd>=0&&read(fd,got,sizeof got)==sizeof got&&!memcmp(got,a,sizeof a),"rename-new-exact");close(fd);
 const char *faults[]={"fault-quota","fault-abort"};int errors[]={ENOSPC,EIO};for(int i=0;i<2;i++){
 path(p,root,faults[i]);fd=open(p,O_CREAT|O_EXCL|O_RDWR,0600);check(fd>=0&&write(fd,a,sizeof a)==sizeof a&&fsync(fd)==0,"fault-seed");errno=0;ssize_t n=pwrite(fd,b,sizeof b,0);int e=errno;check(n==-1&&e==errors[i],i?"abort-EIO":"quota-ENOSPC");check(fstat(fd,&st)==0&&st.st_size==4096,"failed-write-size");close(fd);
 }
 path(p,root,"bench");fd=open(p,O_CREAT|O_EXCL|O_WRONLY,0600);double start=now();for(int i=0;i<256;i++){if(write(fd,a,sizeof a)!=sizeof a){failed++;break;}}double writes=now()-start;int sync=fsync(fd),closed=close(fd);check(sync==0&&closed==0,"benchmark-final-sync-close");printf("HOME_BENCH root=%s calls=256 bytes=1048576 writeSeconds=%.6f\n",root,writes);fflush(stdout);
 path(p,root,"close-only");fd=open(p,O_CREAT|O_EXCL|O_WRONLY,0600);check(fd>=0&&write(fd,a,sizeof a)==sizeof a&&close(fd)==0,"close-without-explicit-fsync");
 path(p,root,"stop-open");fd=open(p,O_CREAT|O_EXCL|O_WRONLY,0600);check(fd>=0&&write(fd,a,sizeof a)==sizeof a,"stop-with-open-file-write-return");/* Intentionally retain descriptor until controlled machine Stop. */
}
int main(void){mkdir("/sync",0700);mkdir("/async",0700);check(mount("sync","/sync","virtiofs",MS_SYNCHRONOUS|MS_DIRSYNC,NULL)==0,"mount-sync-dirsync");check(mount("async","/async","virtiofs",0,NULL)==0,"mount-standard");if(failed)return 1;puts("HOME_MODE sync");filecheck("/sync");puts("HOME_MODE async");filecheck("/async");printf("HOME_DONE checks=%u failures=%d\n",checks,failed);fflush(stdout);for(;;)sleep(60);}
