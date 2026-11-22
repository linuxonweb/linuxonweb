/* Next independently pinned diagnostic positive; real compiler throw uses
   genuine libc++abi allocation and configured GNU malloc initialization. */
static unsigned trace[16],used,wrong,identity;
struct TypedScope {unsigned n;~TypedScope(){if(used<16)trace[used++]=n;}};
extern "C" unsigned native_int_rethrow(unsigned value){
 used=wrong=identity=0;int *first=nullptr;
 try{try{TypedScope a{1};throw int(value);}catch(int &n){
  first=&n;if((unsigned)n!=value)wrong++;trace[used++]=2;throw;
 }catch(...){wrong++;}}
 catch(int &n){identity=first==&n;if((unsigned)n!=value)wrong++;trace[used++]=3;}
 catch(...){wrong++;}
 return !wrong&&identity&&used==3&&trace[0]==1&&trace[1]==2&&trace[2]==3?0:1;
}
extern "C" unsigned native_int_query(unsigned n){if(n==0)return used;if(n==1)return wrong;if(n==2)return identity;return n-3<used?trace[n-3]:0;}
