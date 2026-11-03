#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <fcntl.h>
#include <errno.h>
#include <string.h>
#include <unistd.h>
#include <sys/mount.h>
#include <sys/stat.h>
#include <time.h>
static int failures;
static double now(void){struct timespec ts;clock_gettime(CLOCK_MONOTONIC,&ts);return ts.tv_sec+ts.tv_nsec/1e9;}
static void check(int ok,const char *what){if(!ok){failures++;printf("LOOKUP_FAIL %s errno=%d\n",what,errno);}}
static void prepare(const char *tag,const char *root){
 char file[128],link[128];mkdir(root,0755);check(mount(tag,root,"virtiofs",0,NULL)==0,"mount");
 snprintf(file,sizeof file,"%s/file",root);int fd=open(file,O_CREAT|O_RDWR,0640);check(fd>=0,"create");
 check(write(fd,"snapshot metadata",17)==17,"write");check(fchown(fd,1000,1001)==0,"chown");check(fchmod(fd,0640)==0,"chmod");check(fsync(fd)==0,"fsync");check(close(fd)==0,"close");
 snprintf(link,sizeof link,"%s/link",root);check(symlink("file",link)==0,"symlink");struct stat s;check(lstat(link,&s)==0&&S_ISLNK(s.st_mode)&&s.st_size==4,"lstat link");
 check(stat(link,&s)==0&&s.st_size==17&&s.st_uid==1000&&s.st_gid==1001&&(s.st_mode&0777)==0640,"follow link attrs");
 snprintf(link,sizeof link,"%s/missing",root);errno=0;check(stat(link,&s)<0&&errno==ENOENT,"missing ENOENT");
}
static void bench(const char *label,const char *root){char file[128];snprintf(file,sizeof file,"%s/file",root);double t=now();struct stat s;for(int i=0;i<128;i++)if(stat(file,&s)||s.st_size!=17||s.st_uid!=1000||s.st_gid!=1001||(s.st_mode&0777)!=0640){check(0,"bench attrs");break;}printf("LOOKUP_BENCH %s count=128 ms=%.3f\n",label,(now()-t)*1000);}
int main(void){setvbuf(stdout,NULL,_IONBF,0);prepare("baseline","/baseline");prepare("candidate","/candidate");bench("baseline","/baseline");bench("candidate","/candidate");bench("candidate","/candidate");bench("baseline","/baseline");printf("LOOKUP_DONE failures=%d\n",failures);for(;;)pause();}
