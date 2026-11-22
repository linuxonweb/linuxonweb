static volatile unsigned sink;
__attribute__((noinline)) int leaf_i32(int n){return n+11;}
__attribute__((noinline)) long long leaf_i64(long long n){return n+0x123456789LL;}
__attribute__((noinline)) float leaf_f32(float n){return n+0.5f;}
__attribute__((noinline)) double leaf_f64(double n){return n+0.25;}
__attribute__((noinline)) void leaf_void(void){sink++;}
__attribute__((noinline)) int branch_i32(int n){volatile char a[71];a[0]=n;if(n<0)return a[0]-7;return a[0]+13;}
__attribute__((noinline)) long long branch_i64(int n){volatile long long a[5];a[0]=n;return n<0?a[0]-21:a[0]+37;}
__attribute__((noinline)) float branch_f32(int n){volatile float a[7];a[0]=n;return n<0?a[0]-0.5f:a[0]+0.75f;}
__attribute__((noinline)) double branch_f64(int n){volatile double a[11];a[0]=n;return n<0?a[0]-0.25:a[0]+0.125;}
__attribute__((noinline)) void branch_void(int n){volatile char a[69];a[0]=n;sink+=a[0];}
unsigned sink_get(void){return sink;}
