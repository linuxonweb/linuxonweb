#define _GNU_SOURCE 1
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cerrno>
#include <pthread.h>
#include "prenv.h"
extern "C" char* __secure_getenv(const char*);
extern "C" int fixture_secure(int);
static int passes,failures,ctor_status=-1;
static char startup_env[]="NO_AT_BRIDGE=1";
__attribute__((constructor)) static void early_env() {
 std::puts("GUEST_ENV EARLY PR_SetEnv NO_AT_BRIDGE=1");std::fflush(stdout);
 ctor_status=PR_SetEnv(startup_env);
}
static void check(bool ok,const char* name) {
 std::printf("GUEST_ENV %s %s\n",ok?"PASS":"FAIL",name);
 ok?++passes:++failures;
}
static bool equals(const char* key,const char* val) { const char* p=getenv(key);return p&&std::strcmp(p,val)==0; }
static pthread_barrier_t phase;
struct Work { int id; bool ok; };
static void* concurrent(void* raw) {
 auto* w=static_cast<Work*>(raw);w->ok=true;
 char key[32],alias[64],remove[32];
 std::snprintf(key,sizeof(key),"ENV_THREAD_%d",w->id);
 for(int i=0;i<128;++i) {
  int barrier=pthread_barrier_wait(&phase);if(barrier!=0&&barrier!=PTHREAD_BARRIER_SERIAL_THREAD)w->ok=false;
  if(w->id<2) {
   const char* p=getenv("ENV_STABLE");
   if(!p||std::strcmp(p,"constant"))w->ok=false;
   if(secure_getenv("ENV_STABLE")!=p||__secure_getenv("ENV_STABLE")!=p)w->ok=false;
  } else {
   std::snprintf(alias,sizeof(alias),"%s=value",key);
   if(putenv(alias)!=0||getenv(key)!=alias+std::strlen(key)+1)w->ok=false;
   if(setenv(key,"ignored",0)!=0||!equals(key,"value"))w->ok=false;
   if(setenv(key,"replacement",1)!=0||!equals(key,"replacement"))w->ok=false;
   std::snprintf(remove,sizeof(remove),"%s",key);
   if(putenv(remove)!=0||getenv(key)!=nullptr)w->ok=false;
  }
  barrier=pthread_barrier_wait(&phase);if(barrier!=0&&barrier!=PTHREAD_BARRIER_SERIAL_THREAD)w->ok=false;
 }
 return w;
}
int main() {
 check(ctor_status==0&&equals("NO_AT_BRIDGE","1"),"actual NSPR environment call before main");
 char alias[]="ENV_ALIAS=first";
 check(putenv(alias)==0,"putenv caller buffer installed");
 check(getenv("ENV_ALIAS")==alias+10,"putenv preserves caller pointer ownership");
 alias[10]='F';check(equals("ENV_ALIAS","First"),"caller mutation remains visible");
 check(setenv("ENV_ALIAS","ignored",0)==0&&getenv("ENV_ALIAS")==alias+10,"overwrite0 recursive getter preserves original pointer");
 check(setenv("ENV_ALIAS","copied",1)==0&&equals("ENV_ALIAS","copied")&&getenv("ENV_ALIAS")!=alias+10,"overwrite1 copies replacement value");
 char direct[]="ENV_DIRECT=owned";
 check(putenv(direct)==0&&getenv("ENV_DIRECT")==direct+11,"second caller-owned alias installed");
 char direct_remove[]="ENV_DIRECT";check(putenv(direct_remove)==0&&getenv("ENV_DIRECT")==nullptr,"direct caller-owned alias removed by name-only putenv");
 char remove[]="ENV_ALIAS";check(putenv(remove)==0&&getenv("ENV_ALIAS")==nullptr,"putenv removal recursively invokes real unsetenv");
 check(setenv("ENV_EMPTY","",1)==0&&equals("ENV_EMPTY",""),"empty value supported");
 errno=0;check(setenv("","x",1)==-1&&errno==EINVAL,"empty setenv name rejected");
 errno=0;check(setenv("BAD=NAME","x",1)==-1&&errno==EINVAL,"equals in setenv name rejected");
 errno=0;check(unsetenv("")==-1&&errno==EINVAL,"empty unsetenv name rejected");
 errno=0;check(unsetenv("BAD=NAME")==-1&&errno==EINVAL,"equals in unsetenv name rejected");
 check(unsetenv("ENV_ABSENT")==0&&getenv("ENV_ABSENT")==nullptr,"missing unsetenv succeeds");
 check(getenv("")==nullptr&&getenv("ENV_ABSENT")==nullptr,"getter empty and absent behavior");
 check(setenv("ENV_SECURE","visible",1)==0,"secure test value installed");
 int saved=fixture_secure(0);
 check(equals("ENV_SECURE","visible")&&secure_getenv("ENV_SECURE")==getenv("ENV_SECURE"),"real musl insecure secure_getenv nested getter");
 check(__secure_getenv("ENV_SECURE")==getenv("ENV_SECURE"),"compatibility secure alias uses real musl");
 fixture_secure(1);
 check(secure_getenv("ENV_SECURE")==nullptr,"real musl secure flag suppresses secure_getenv");
 check(__secure_getenv("ENV_SECURE")==nullptr,"real musl secure flag suppresses compatibility alias");
 check(equals("ENV_SECURE","visible"),"ordinary getter unaffected by secure flag");
 fixture_secure(saved);check(fixture_secure(saved)==saved,"controlled libc secure state restored");
 // Above checks control libc.secure only, not kernel AT_SECURE admission.
 check(clearenv()==0&&getenv("NO_AT_BRIDGE")==nullptr&&getenv("ENV_EMPTY")==nullptr,"clearenv clears actual libc environment");
 char after[]="ENV_AFTER=live";check(putenv(after)==0&&getenv("ENV_AFTER")==after+10,"putenv works after clearenv");
 check(setenv("ENV_STABLE","constant",1)==0,"stable reader key installed");
 bool phase_ready=pthread_barrier_init(&phase,nullptr,4)==0;
 check(phase_ready,"real pthread phase rendezvous initialized");if(!phase_ready){std::fflush(stdout);std::_Exit(1);}
 pthread_t threads[4];Work work[4];bool started[4]={};
 for(int i=0;i<4;++i) {work[i]={i,false};started[i]=pthread_create(&threads[i],nullptr,concurrent,&work[i])==0;check(started[i],"real pthread created");if(!started[i]){std::fflush(stdout);std::_Exit(1);}}
 for(int i=0;i<4;++i) {void* result=nullptr;bool joined=started[i]&&pthread_join(threads[i],&result)==0;check(joined&&result==&work[i]&&work[i].ok,"concurrent actual environment operations and join");}
 check(pthread_barrier_destroy(&phase)==0,"real pthread phase rendezvous destroyed");
 check(equals("ENV_STABLE","constant"),"stable value survived concurrent mutations");
 check(getenv("ENV_THREAD_2")==nullptr&&getenv("ENV_THREAD_3")==nullptr,"thread owned buffers removed before return");
 char later[]="NO_AT_BRIDGE=2";check(PR_SetEnv(later)==0&&getenv("NO_AT_BRIDGE")==later+13,"actual NSPR call preserves caller buffer after threads");
 check(clearenv()==0&&getenv("NO_AT_BRIDGE")==nullptr,"final real environment cleanup");
 std::printf("GUEST_ENV_RESULT pass=%d fail=%d\n",passes,failures);return failures?1:0;
}
