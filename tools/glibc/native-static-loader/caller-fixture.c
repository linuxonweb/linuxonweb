typedef unsigned uint32_t;
struct descriptor {uint32_t id,module,kind;};
extern const struct descriptor *__native_token_table[];
extern const uint32_t __native_token_count;
__attribute__((noinline)) static int identify_token(void *token) {
 for(unsigned i=0;i<__native_token_count;++i)if(__native_token_table[i]==token)return __native_token_table[i]->module;
 return -1;
}
__attribute__((noinline)) int mod_a_identify(void) {return identify_token(__builtin_return_address(0));}
__attribute__((noinline)) int mod_b_identify(void) {return identify_token(__builtin_return_address(0));}
__attribute__((noinline)) int mod_a_bridge(void) {return mod_b_identify();}
__attribute__((noinline)) static int mod_b_bridge(void) {return mod_a_identify();}
__attribute__((noinline)) static int mod_a_recursive(unsigned n) {
 void *token=__builtin_return_address(0);int own=identify_token(token);
 if(n==0)return own;int nested=mod_a_recursive(n-1);return own*10+nested;
}
typedef int (*callback)(void);
extern int uncovered_nonnull(void);
__attribute__((noinline)) static int mod_b_callback(callback f) {return f();}
static callback volatile pick=mod_a_identify;
__attribute__((noinline,visibility("default"))) int unseeded_entry(void) {
 return identify_token(__builtin_return_address(0));
}
__attribute__((noinline,visibility("default"))) int caller_entry(int mode) {
 switch(mode){
 case 0:return mod_a_identify();
 case 1:return mod_a_bridge();
 case 2:return mod_b_bridge();
 case 3:return pick();
 case 4:return mod_b_callback(pick);
 case 5:return mod_a_recursive(2);
 case 6:pick=uncovered_nonnull;return pick();
 default:return -7;
 }
}
