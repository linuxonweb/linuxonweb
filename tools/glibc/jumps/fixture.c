/* Direct public GNU declarations: compiler adapter preserves genuine GNU route. */
#include <setjmp/setjmp.h>
static volatile unsigned cleanup_count,cleanup_order;
static _Thread_local unsigned jump_tls=0x5132;
static void cleanup_record(void *p){cleanup_count++;cleanup_order=cleanup_order*10+(unsigned)(uintptr_t)p;}
static __attribute__((noinline)) void deeper(sigjmp_buf b,int val){
 struct _pthread_cleanup_buffer a={cleanup_record,(void*)1,0,THREAD_SELF->cleanup};
 struct _pthread_cleanup_buffer c={cleanup_record,(void*)2,0,&a};
 THREAD_SELF->cleanup=&c;
 volatile unsigned canary[16];for(unsigned i=0;i<16;i++)canary[i]=i+31;
 siglongjmp(b,val);
}
static __attribute__((noinline)) void jump_case(int save,int value){
 sigjmp_buf b;sigset_t initial={0},changed={0},actual={0};
 initial.__val[0]=1UL<<(SIGUSR1-1);changed.__val[0]=1UL<<(SIGUSR2-1);
 check("jump-mask-initial",sigprocmask(SIG_SETMASK,&initial,0)==0);
 errno=713;volatile unsigned local=0x9182;unsigned before=(unsigned)__builtin_frame_address(0);
 struct _pthread_cleanup_buffer same={cleanup_record,(void*)9,0,THREAD_SELF->cleanup};THREAD_SELF->cleanup=&same;
 int r=sigsetjmp(b,save);
 if(!r){check("jump-mask-change",sigprocmask(SIG_SETMASK,&changed,0)==0);deeper(b,value);}
 check("jump-value",r==(value?value:1));check("jump-errno-TLS",errno==713&&jump_tls==0x5132);
 check("jump-local-stack",local==0x9182&&before==(unsigned)__builtin_frame_address(0));
 check("jump-cleanup-order",cleanup_count==2&&cleanup_order==21&&THREAD_SELF->cleanup==&same);
 check("jump-mask-query",sigprocmask(SIG_SETMASK,0,&actual)==0);
 check("jump-mask-restored",actual.__val[0]==(save?initial.__val[0]:changed.__val[0]));
 THREAD_SELF->cleanup=same.__prev;cleanup_count=cleanup_order=0;
}
static __attribute__((noinline)) void nested_inner(sigjmp_buf outer){
 sigjmp_buf inner;sigset_t mask={0};mask.__val[0]=1UL<<(SIGUSR2-1);sigprocmask(SIG_SETMASK,&mask,0);
 int n=sigsetjmp(inner,1);if(!n){mask.__val[0]=0;sigprocmask(SIG_SETMASK,&mask,0);siglongjmp(inner,7);}
 sigset_t got={0};sigprocmask(SIG_SETMASK,0,&got);check("nested-inner-mask-value",n==7&&got.__val[0]==(1UL<<(SIGUSR2-1)));
 siglongjmp(outer,11);
}
static void jump_tests(void){
 const char *mode=startup.argv[1];
 if(startup.argc>1&&!strncmp(mode,"jump-",5)){
  sigjmp_buf bad;if(!sigsetjmp(bad,1)){
   if(!strcmp(mode,"jump-owner"))bad[0].__jmpbuf[0].__owner=0;
   else if(!strcmp(mode,"jump-bounds"))bad[0].__jmpbuf[0].__sp=(void*)0;
   else if(!strcmp(mode,"jump-past"))bad[0].__jmpbuf[0].__sp=(void*)((uintptr_t)__builtin_frame_address(0)-4096);
   siglongjmp(bad,1);
  }check("negative-jump-must-abort",0);
 }
 for(int save=0;save<2;save++)for(int val=0;val<3;val++)jump_case(save,val?val*17:0);
 sigjmp_buf outer;sigset_t mask={0},got={0};mask.__val[0]=1UL<<(SIGUSR1-1);sigprocmask(SIG_SETMASK,&mask,0);
 int n=sigsetjmp(outer,1);if(!n)nested_inner(outer);
 sigprocmask(SIG_SETMASK,0,&got);check("nested-outer-mask-value",n==11&&got.__val[0]==mask.__val[0]);
 sigjmp_buf ordinary;
 int o=(setjmp)(ordinary);if(!o){mask.__val[0]=0;sigprocmask(SIG_SETMASK,&mask,0);void (*volatile jump_ptr)(sigjmp_buf,int)=siglongjmp;jump_ptr(ordinary,19);}
 sigprocmask(SIG_SETMASK,0,&got);check("setjmp-function-saves-mask-indirect-longjmp",o==19&&got.__val[0]==(1UL<<(SIGUSR1-1)));
 int z=_setjmp(ordinary);if(!z){check("setjmp-save0-clears-reused-mask",ordinary[0].__mask_was_saved==0);siglongjmp(ordinary,23);}
 check("ordinary-setjmp-value",z==23);
 mask.__val[0]=0;sigprocmask(SIG_SETMASK,&mask,0);errno=0;
 put("GNU_NATIVE_JUMPS masks=save0,save1 nested=pass cleanup=actualGNU\n");
}
