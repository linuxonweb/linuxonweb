/* Actual libc exit/fork and ICD lifetime logic; counted transport doubles.
 * This establishes no guest GPU or Firefox cleanup acceptance. */
#include <stdlib.h>
#include <unistd.h>
#include <sys/wait.h>
#include <assert.h>
static int registration_failure,registration_calls;
static int checked_registration(void (*fn)(void)) {
    registration_calls++;
    return registration_failure?-1:atexit(fn);
}
#define atexit checked_registration
#define GUEST_VK_ZINK 1
#include "../guest-vulkan/icd.c"
#undef atexit
static unsigned accepts,closes,disconnects,destroys;
static int accept_failure,hello_failure;
static pid_t parent_pid;
static const char *mode;
int gpu_accept(struct gpu_session *s,unsigned p){(void)p;accepts++;s->fd=7;return accept_failure?-1:0;}
void gpu_close(struct gpu_session *s){disconnects++;s->fd=-1;}
int gpu_resource(struct gpu_session *s,enum gpu_op op,const void *b,uint32_t n,uint32_t *id){(void)s;(void)op;(void)b;(void)n;(void)id;return -1;}
int gpu_call(struct gpu_session *s,enum gpu_op op,const void *b,uint32_t n,void *out,uint32_t cap,uint32_t *received){
    (void)s;(void)b;(void)n;*received=0;
    if(op==GPU_HELLO){const char json[]="{\"sourceControlTransportDouble\":true}";if(hello_failure)return -1;assert(cap>=sizeof(json)-1);memcpy(out,json,sizeof(json)-1);*received=sizeof(json)-1;return 0;}
    if(op==GPU_CLOSE){closes++;return 0;}
    if(op==GPU_DESTROY){destroys++;return 0;}
    return -1;
}
static void check_exit(void){
    if(getpid()!=parent_pid){assert(live&&live->process_pid==parent_pid&&!closes&&!disconnects);puts("LIFECYCLE_FORK_WRONG_PID_PASS closes=0");fflush(stdout);return;}
    assert(!live);
    if(!strcmp(mode,"register-fail")){assert(registration_calls==1&&!accepts&&!closes&&!disconnects);}
    else if(!strcmp(mode,"accept-fail")||!strcmp(mode,"hello-fail")){assert(registration_calls==1&&accepts==1&&!closes&&disconnects==1);}
    else{assert(registration_calls==1&&accepts==1&&closes==1&&disconnects==1&&destroys==1);assert(!audit.live_instances&&!audit.live_devices&&audit.instances_destroyed==1&&audit.devices_destroyed==1&&!resource_count&&!allocated_bytes);for(unsigned k=0;k<MAX_RES;k++)assert(!resources[k].kind);}
    printf("LIFECYCLE_NATIVE_PASS mode=%s closes=%u disconnects=%u destroys=%u registrations=%d\n",mode,closes,disconnects,destroys,registration_calls);fflush(stdout);
}
int main(int argc,char **argv){
    assert(argc==2);mode=argv[1];parent_pid=getpid();assert(!atexit(check_exit));
    registration_failure=!strcmp(mode,"register-fail");accept_failure=!strcmp(mode,"accept-fail");hello_failure=!strcmp(mode,"hello-fail");
    VkInstanceCreateInfo ci={.sType=VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO};VkInstance instance=NULL;VkResult result=create_instance(&ci,NULL,&instance);
    if(registration_failure||accept_failure||hello_failure){assert(result==VK_ERROR_INITIALIZATION_FAILED&&!instance&&!live);return 0;}
    assert(result==VK_SUCCESS&&instance==live&&live->process_pid==parent_pid);
    live->device=calloc(1,sizeof(*live->device));assert(live->device);audit.devices_created++;audit.live_devices++;
    struct resource *r=resource_new(R_MEMORY);assert(r);r->bytes=malloc(32);assert(r->bytes);r->size=32;allocated_bytes+=32;
    struct resource *host=resource_new(R_IMAGE);assert(host);host->host=99;
    if(!strcmp(mode,"fork")){pid_t child=fork();assert(child>=0);if(!child){instance_process_exit();assert(live&&!closes&&!disconnects);exit(0);}int status;assert(waitpid(child,&status,0)==child&&WIFEXITED(status)&&WEXITSTATUS(status)==0);assert(live&&!closes&&!disconnects);}
    else if(!strcmp(mode,"explicit")){destroy_instance(instance,NULL);instance_process_exit();assert(closes==1);}
    else assert(!strcmp(mode,"normal"));
    return 0; /* Registered real libc callback performs normal-exit cleanup. */
}
