/* Compiler-provenance controls; not public GNU longjmp or cancellation. */
#define _SETJMP_H 1
#include <bits/setjmp.h>
extern int setjmp(__jmp_buf) __attribute__((returns_twice));
extern void eh_raise(unsigned);
extern void route_jump(__jmp_buf,int) __attribute__((noreturn));
struct descriptor {unsigned id,module,kind;};
extern const struct descriptor *const __native_token_table[];
extern const unsigned __native_token_count;
static __jmp_buf env;
static unsigned sequence[8],modules[8],used;
__attribute__((noinline)) static int identify(void *token){
 for(unsigned i=0;i<__native_token_count;i++)if(token==__native_token_table[i])return __native_token_table[i]->module;
 return -1;
}
__attribute__((noinline)) static void cleanup(unsigned *value){
 if(used<8){sequence[used]=*value;modules[used]=identify(__builtin_return_address(0));used++;}
}
__attribute__((noinline)) static void a_eh(void){
 volatile char local[97];local[0]=1;
 unsigned value __attribute__((cleanup(cleanup)))=1;eh_raise(731+local[0]-1);
}
__attribute__((noinline)) static void b_eh(void){
 volatile char local[59];local[0]=2;
 unsigned value __attribute__((cleanup(cleanup)))=2;a_eh();
}
__attribute__((noinline)) static void a_jump(void){
 unsigned value __attribute__((cleanup(cleanup)))=1;route_jump(env,37);
}
__attribute__((noinline)) unsigned route_entry(unsigned mode){
 if(mode==2)return used;
 if(mode>=3&&mode<11)return mode-3<used?sequence[mode-3]:~0u;
 if(mode>=16&&mode<24)return mode-16<used?modules[mode-16]:~0u;
 used=0;
 if(mode==0){b_eh();return 999;}
 unsigned retained __attribute__((cleanup(cleanup)))=9;
 int value=setjmp(env);
 if(!value)a_jump();
 return value==37&&identify(__builtin_return_address(0))==0?37:998;
}
