static unsigned trace[8],used;
extern void raw_raise(unsigned,unsigned);
void delegate_record(unsigned n){if(used<8)trace[used++]=n;}
void delegate_reset(void){used=0;}
unsigned delegate_query(unsigned n){return n?trace[n-1]:used;}
__attribute__((noinline)) unsigned delegate_step(unsigned selected,unsigned stage,unsigned tag,volatile char *frame){
 volatile char local[53];local[0]=frame[0];local[52]=11;
 if(selected==stage)raw_raise(tag,731);
 frame[0]=local[0]+local[52];return stage?42:1;
}

extern unsigned delegate_entry(unsigned,unsigned);
static void nested_cleanup(unsigned *n){delegate_record(*n);}
__attribute__((noinline)) unsigned nested_delegate_entry(unsigned selected,unsigned tag){
 unsigned c __attribute__((cleanup(nested_cleanup)))=71;
 volatile char a[81];a[0]=7;
 return delegate_entry(selected,tag)+a[0]-7;
}
