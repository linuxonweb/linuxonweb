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
static int failures;static unsigned checks;
static void check(int ok,const char *name){checks++;printf("WB_CHECK %s %s errno=%d\n",ok?"PASS":"FAIL",name,errno);fflush(stdout);if(!ok)failures++;}
static double now(void){struct timespec t;clock_gettime(CLOCK_MONOTONIC,&t);return t.tv_sec+t.tv_nsec/1e9;}
int main(void){unsigned char a[4096],b[65536],got[4096];memset(a,0x61,sizeof a);memset(b,0x62,sizeof b);mkdir("/wb",0700);check(mount("writeback","/wb","virtiofs",0,NULL)==0,"mount-writeback");if(failures)return 1;
 int fd=open("/wb/read-for-write",O_CREAT|O_EXCL|O_RDWR,0600);check(fd>=0&&write(fd,a,sizeof a)==sizeof a&&fdatasync(fd)==0,"seed-fdatasync");close(fd);fd=open("/wb/read-for-write",O_WRONLY);check(fd>=0,"open-write-only");int advice=posix_fadvise(fd,0,0,POSIX_FADV_DONTNEED);printf("WB_OPTIONAL fadviseResult=%d\n",advice);check(pwrite(fd,"Z",1,101)==1&&fsync(fd)==0,"partial-write-with-kernel-read");close(fd);fd=open("/wb/read-for-write",O_RDONLY);check(fd>=0&&read(fd,got,sizeof got)==sizeof got&&got[101]=='Z'&&got[100]==0x61&&got[102]==0x61,"read-for-write-preserves-adjacent-data");close(fd);
 fd=open("/wb/bench",O_CREAT|O_EXCL|O_WRONLY,0600);double start=now();for(int i=0;i<256;i++)if(write(fd,a,sizeof a)!=sizeof a){failures++;break;}double writeSec=now()-start;check(fsync(fd)==0,"benchmark-fsync");double allSec=now()-start;close(fd);printf("WB_BENCH calls=256 bytes=1048576 writeSeconds=%.6f durableSeconds=%.6f\n",writeSec,allSec);fflush(stdout);
 fd=open("/wb/truncate",O_CREAT|O_EXCL|O_RDWR,0600);check(fd>=0&&write(fd,a,sizeof a)==sizeof a,"truncate-dirty-seed");check(ftruncate(fd,17)==0&&fsync(fd)==0,"truncate-dirty-fsync");check(ftruncate(fd,4096)==0&&fsync(fd)==0,"extend-after-truncate");check(pread(fd,got,sizeof got,0)==sizeof got,"truncate-read");int ok=1;for(int i=0;i<4096;i++)if(got[i]!=(i<17?0x61:0))ok=0;check(ok,"truncate-zero-tail");close(fd);
 fd=open("/wb/rename.tmp",O_CREAT|O_EXCL|O_WRONLY,0600);check(fd>=0&&write(fd,a,sizeof a)==sizeof a&&fsync(fd)==0,"rename-durable-source");close(fd);check(rename("/wb/rename.tmp","/wb/renamed")==0,"rename");fd=open("/wb",O_RDONLY|O_DIRECTORY);check(fd>=0&&fsync(fd)==0,"directory-fsync");close(fd);
 const char *names[]={"/wb/fault-quota","/wb/fault-abort"};for(int i=0;i<2;i++){fd=open(names[i],O_CREAT|O_EXCL|O_RDWR,0600);check(fd>=0&&write(fd,a,sizeof a)==sizeof a&&fsync(fd)==0,"fault-durable-seed");errno=0;ssize_t n=pwrite(fd,b,sizeof b,0);int we=errno;errno=0;int rc=fsync(fd),se=errno;printf("WB_FAULT kind=%s write=%zd writeErrno=%d fsync=%d syncErrno=%d\n",i?"abort":"quota",n,we,rc,se);check((n<0&&(we==EIO||we==ENOSPC))||(rc<0&&(se==EIO||se==ENOSPC)),"delayed-error-observed");close(fd);}
 fd=open("/wb/sync-open",O_CREAT|O_EXCL|O_WRONLY,0600);check(fd>=0&&write(fd,a,sizeof a)==sizeof a,"write-before-syncfs");errno=0;int barrier=syncfs(fd),barrierError=errno;check(barrier==-1&&(barrierError==EIO||barrierError==ENOSPC),"syncfs-propagates-prior-injected-write-error");
 fd=open("/wb/close-only",O_CREAT|O_EXCL|O_WRONLY,0600);check(fd>=0&&write(fd,a,sizeof a)==sizeof a&&close(fd)==0,"close-without-explicit-sync");
 fd=open("/wb/stop-open",O_CREAT|O_EXCL|O_WRONLY,0600);check(fd>=0&&write(fd,a,sizeof a)==sizeof a,"unsynced-write-before-stop");
 printf("WB_DONE checks=%u failures=%d\n",checks,failures);fflush(stdout);for(;;)sleep(60);}
