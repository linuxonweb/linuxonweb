#define _GNU_SOURCE
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <spawn.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mount.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>
extern char **environ;
struct identity {pid_t pid;unsigned long long start;unsigned long flags;char state;};
struct paused {struct identity id;int pidfd;};
static struct paused paused[512];static int paused_count;
static double seconds(void){struct timespec t;clock_gettime(CLOCK_MONOTONIC,&t);return t.tv_sec+t.tv_nsec/1e9;}
static int info_path(const char *path,struct identity *id){char b[4096];int fd=open(path,O_RDONLY);if(fd<0)return -1;ssize_t n=read(fd,b,sizeof(b)-1);close(fd);if(n<=0)return -1;b[n]=0;char *p=strrchr(b,')');if(!p||p[1]!=' ')return -1;id->pid=(pid_t)strtol(b,NULL,10);char *save=NULL,*token=strtok_r(p+2," ",&save);for(int i=0;token;i++,token=strtok_r(NULL," ",&save)){if(i==0)id->state=*token;if(i==6)id->flags=strtoul(token,NULL,10);if(i==19){id->start=strtoull(token,NULL,10);return 0;}}return -1;}
static int info(pid_t pid,struct identity *id){char path[64];snprintf(path,sizeof path,"/proc/%d/stat",pid);return info_path(path,id);}
static int same(const struct identity *id){struct identity now;return info(id->pid,&now)==0&&now.start==id->start;}
static int signal_owned(const struct paused *p,int sig){if(!same(&p->id)){errno=ESRCH;return -1;}return (int)syscall(SYS_pidfd_send_signal,p->pidfd,sig,NULL,0);}
static void resume(void){for(int i=paused_count-1;i>=0;i--){signal_owned(&paused[i],SIGCONT);close(paused[i].pidfd);}paused_count=0;}
static int all_threads_stopped(pid_t pid){char path[96];snprintf(path,sizeof path,"/proc/%d/task",pid);DIR *d=opendir(path);if(!d)return errno==ENOENT;struct dirent *e;int okay=1;while((e=readdir(d))){char *end;long tid=strtol(e->d_name,&end,10);if(*end||tid<1)continue;snprintf(path,sizeof path,"/proc/%d/task/%ld/stat",pid,tid);struct identity t;if(info_path(path,&t)==0&&t.state!='T'&&t.state!='t'&&t.state!='Z'&&t.state!='X'){okay=0;break;}}closedir(d);return okay;}
static int stop_users(void){double deadline=seconds()+5;int stable=0;while(seconds()<deadline){DIR *d=opendir("/proc");if(!d)return -1;struct dirent *e;int all=1,added=0;while((e=readdir(d))){char *end;long n=strtol(e->d_name,&end,10);if(*end||n<=1||n==getpid())continue;struct identity id;if(info((pid_t)n,&id)||id.flags&0x00200000UL||id.state=='Z'||id.state=='X')continue;int known=0;for(int i=0;i<paused_count;i++)if(paused[i].id.pid==id.pid&&paused[i].id.start==id.start){known=1;break;}if(!known&&id.state!='T'&&id.state!='t'){if(paused_count==512){closedir(d);errno=E2BIG;return -1;}int pidfd=(int)syscall(SYS_pidfd_open,id.pid,0);if(pidfd<0){if(errno==ESRCH)continue;closedir(d);return -1;}struct paused p={id,pidfd};if(signal_owned(&p,SIGSTOP)){int error=errno;close(pidfd);if(error==ESRCH)continue;closedir(d);errno=error;return -1;}paused[paused_count++]=p;added=1;}if(!all_threads_stopped(id.pid))all=0;}closedir(d);if(all&&!added){if(++stable==2)return 0;}else stable=0;usleep(10000);}errno=ETIMEDOUT;return -1;}
static int valid_token(const char *s){if(strlen(s)!=32)return 0;for(int i=0;i<32;i++)if(!((s[i]>='0'&&s[i]<='9')||(s[i]>='a'&&s[i]<='f')))return 0;return 1;}
static int barrier(const char *token){if(!valid_token(token))return 2;int dir=open("/home",O_RDONLY|O_DIRECTORY);if(dir<0)return 2;if(stop_users()!=0){int e=errno;resume();printf("HOME_BARRIER ERROR %s quiesce %d\n",token,e);fflush(stdout);close(dir);return 1;}if(syncfs(dir)!=0){int e=errno;resume();printf("HOME_BARRIER ERROR %s syncfs %d\n",token,e);fflush(stdout);close(dir);return 1;}printf("HOME_BARRIER PREPARED %s stopped=%d\n",token,paused_count);fflush(stdout);double deadline=seconds()+5;char line[128];int committed=0;while(seconds()<deadline){struct pollfd p={0,POLLIN,0};int rc=poll(&p,1,100);if(rc<0&&errno!=EINTR)break;if(rc<=0)continue;if(!fgets(line,sizeof line,stdin))break;char command[24],received[40],extra;if(sscanf(line,"%23s %39s %c",command,received,&extra)!=2||strcmp(received,token))continue;if(!strcmp(command,"CANCEL"))break;if(!strcmp(command,"COMMIT")&&!committed){committed=1;printf("HOME_BARRIER COMMITTED %s\n",token);fflush(stdout);deadline=seconds()+5;}}
 resume();printf("HOME_BARRIER RESUMED %s reason=%s\n",token,committed?"commit-timeout":"cancel-or-timeout");fflush(stdout);close(dir);return committed?1:0;}
static int writer(void){unsigned char b[65536];memset(b,0x61,sizeof b);int fd=open("/home/active",O_CREAT|O_RDWR,0600);if(fd<0)return 2;uint32_t counter=0;for(;;){counter++;memcpy(b,&counter,sizeof counter);if(pwrite(fd,b,sizeof b,0)!=(ssize_t)sizeof b)return 3;printf("HOME_WRITER %u\n",counter);fflush(stdout);usleep(100000);}}
int main(int argc,char **argv){if(argc==3&&!strcmp(argv[1],"--barrier"))return barrier(argv[2]);if(argc==2&&!strcmp(argv[1],"--writer"))return writer();mkdir("/home",0700);if(mount("writeback","/home","virtiofs",0,NULL)){perror("mount");return 2;}unsigned char b[4096];memset(b,0x63,sizeof b);int fd=open("/home/acknowledged-open",O_CREAT|O_RDWR,0600);if(fd<0||write(fd,b,sizeof b)!=(ssize_t)sizeof b)return 2;pid_t child;char *writer_args[]={"/check","--writer",NULL};int rc=posix_spawn(&child,"/check",NULL,NULL,writer_args,environ);if(rc){printf("HOME_CONTROL_ERROR spawn=%d\n",rc);return 2;}printf("HOME_CONTROL_READY writer=%d\n",child);fflush(stdout);char line[128];while(fgets(line,sizeof line,stdin)){char command[24],token[40],extra;if(sscanf(line,"%23s %39s %c",command,token,&extra)!=2||strcmp(command,"PREPARE")||!valid_token(token))continue;pid_t helper;char *args[]={"/check","--barrier",token,NULL};rc=posix_spawn(&helper,"/check",NULL,NULL,args,environ);if(rc){printf("HOME_CONTROL_ERROR spawn=%d\n",rc);fflush(stdout);continue;}int status;while(waitpid(helper,&status,0)<0&&errno==EINTR){}printf("HOME_CONTROL_RETURN status=%d\n",status);fflush(stdout);}for(;;)sleep(60);}
