#define _GNU_SOURCE
#include <sys/types.h>
#include <sys/wait.h>
#include <errno.h>
#include <signal.h>
#include <spawn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>
extern char **environ;
static double now(void){struct timespec t;if(clock_gettime(CLOCK_MONOTONIC,&t))_exit(5);return t.tv_sec+t.tv_nsec/1e9;}
static void pause_short(void){struct timespec t={0,10000000};while(nanosleep(&t,&t)&&errno==EINTR){}}
int main(int argc,char **argv){
 if(argc!=2||(strcmp(argv[1],"before-activate")&&strcmp(argv[1],"after-active-rename")))return 2;
 if(setenv("APK_PERSIST_TEST_STOP",argv[1],1))return 3;
 posix_spawnattr_t attr;if(posix_spawnattr_init(&attr))return 4;
 if(posix_spawnattr_setflags(&attr,POSIX_SPAWN_SETPGROUP)||posix_spawnattr_setpgroup(&attr,0))return 4;
 char *command[]={"/usr/sbin/apk-persist","save",NULL};pid_t child=-1;
 int rc=posix_spawn(&child,command[0],NULL,&attr,command,environ);posix_spawnattr_destroy(&attr);
 if(rc){fprintf(stderr,"PERSIST_INTERRUPT_FAIL spawn error=%d\n",rc);return 5;}
 double deadline=now()+25;int status=0;pid_t found=0;
 while(now()<deadline){found=waitpid(child,&status,WNOHANG|WUNTRACED);if(found==child)break;if(found<0&&errno!=EINTR)break;pause_short();}
 if(found==child&&WIFSTOPPED(status)&&WSTOPSIG(status)==SIGSTOP){
  printf("PERSIST_INTERRUPT_CHECKPOINT point=%s stopped=1 acknowledgement=not-reached\n",argv[1]);fflush(stdout);
  /* The stopped unreaped leader owns this isolated group identity. */
  if(kill(-child,SIGKILL)){perror("owned group kill");return 6;}
  while((found=waitpid(child,&status,0))<0&&errno==EINTR){}
  if(found==child&&WIFSIGNALED(status)&&WTERMSIG(status)==SIGKILL){printf("PERSIST_INTERRUPT_PASS point=%s killed=9 reaped=1\n",argv[1]);return 0;}
  fprintf(stderr,"PERSIST_INTERRUPT_FAIL unexpected killed-child status\n");return 7;
 }
 if(found==child&&!WIFSTOPPED(status)){
  fprintf(stderr,"PERSIST_INTERRUPT_FAIL helper exited before instrumented checkpoint status=%d\n",status);return 8;
 }
 /* Timeout cleanup owns the still-unreaped leader. TERM lets its ordinary
    cancellation handler stop the separate owned native APK process group. */
 kill(-child,SIGTERM);kill(-child,SIGCONT);deadline=now()+2;
 while(now()<deadline){found=waitpid(child,&status,WNOHANG);if(found==child)break;pause_short();}
 if(found!=child){kill(-child,SIGKILL);while(waitpid(child,&status,0)<0&&errno==EINTR){}}
 fprintf(stderr,"PERSIST_INTERRUPT_FAIL bounded checkpoint timeout\n");return 9;
}
