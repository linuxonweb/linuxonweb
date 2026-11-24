/* Honest kernel ENOSYS and unchanged GNU stub runtime acceptance. */
#include <stddef.h>
extern int __sigaltstack(const stack_t *,stack_t *);
extern int __revoke(const char *),revoke(const char *);
extern int __sigreturn(struct sigcontext *),sigreturn(struct sigcontext *);
_Static_assert(sizeof(stack_t)==12 && _Alignof(stack_t)==4,"stack_t ABI");
_Static_assert(offsetof(stack_t,ss_sp)==0 && offsetof(stack_t,ss_flags)==4 && offsetof(stack_t,ss_size)==8,"selected Linux stack_t layout");
static void fullmake_tests(void){
 int before=failures;stack_t ss={0},old;memset(&old,0x5a,sizeof(old));
 errno=201;check("sigaltstack-public-ENOSYS",sigaltstack(&ss,&old)==-1&&errno==ENOSYS);
 unsigned char *p=(unsigned char *)&old;int intact=1;for(unsigned i=0;i<sizeof(old);i++)if(p[i]!=0x5a)intact=0;
 check("sigaltstack-no-output-write",intact);
 errno=202;check("sigaltstack-hidden-ENOSYS",__sigaltstack(0,0)==-1&&errno==ENOSYS);
 errno=203;check("sigaltstack-invalid-pointer-ENOSYS",sigaltstack((const stack_t *)1,(stack_t *)1)==-1&&errno==ENOSYS);
 struct sigstack a={0},b;memset(&b,0x5a,sizeof(b));
 errno=204;check("GNU-sigstack-runtime-preserved",sigstack(&a,&b)==-1&&errno==ENOSYS);
 p=(unsigned char *)&b;intact=1;for(unsigned i=0;i<sizeof(b);i++)if(p[i]!=0x5a)intact=0;
 check("GNU-sigstack-no-output-write",intact);
 errno=205;check("GNU-revoke-stub-public",revoke("/init")==-1&&errno==ENOSYS);
 errno=206;check("GNU-revoke-stub-internal",__revoke("/init")==-1&&errno==ENOSYS);
 errno=207;check("GNU-sigreturn-stub-public",sigreturn(0)==-1&&errno==ENOSYS);
 errno=208;check("GNU-sigreturn-stub-internal",__sigreturn(0)==-1&&errno==ENOSYS);
 if(failures==before)put("GNU_WARNING_SYSCALLS metadata=preserved stub=GNU sigaltstack=ENOSYS result=PASS\n");
}
