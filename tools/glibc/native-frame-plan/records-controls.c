/* Source functions are all materialized automatically; no manual frame chain. */
typedef unsigned u32;
extern u32 record_observe(u32);
static volatile u32 sink;
u32 record_zero(u32 n) { return n * 7u + 3u; }
u32 record_static(u32 n) {
  volatile u32 words[31];
  words[0] = n; words[30] = n ^ 0x57u;
  u32 sp = record_observe(1);
  sink = words[0] ^ words[30];
  return sp != 0 && sink == 0x57u;
}
u32 record_dynamic(u32 n) {
  if (n < 8 || n > 2048) return 0;
  volatile unsigned char *p = __builtin_alloca(n);
  for (u32 i = 0; i != n; ++i) p[i] = (unsigned char)(i ^ n);
  u32 before = record_observe(2);
  if (record_static(n) != 1) return 0;
  for (u32 i = 0; i != n; ++i)
    if (p[i] != (unsigned char)(i ^ n)) return 0;
  return before == record_observe(3);
}
u32 record_stackrestore(u32 n) {
  u32 allocated, sum;
  {
    volatile unsigned char p[n + 32];
    p[0] = 19; p[n + 31] = 41;
    allocated = record_observe(4);
    sum = p[0] + p[n + 31];
  }
  u32 restored = record_observe(5);
  return sum == 60 && allocated < restored;
}
u32 record_recursive(u32 n) {
  volatile u32 own = n;
  record_observe(6);
  if (!n) return 1;
  u32 child = record_recursive(n - 1);
  return child + own;
}
typedef u32 (*callback)(u32);
u32 record_indirect(callback fn, u32 n) {
  record_observe(7);
  return fn(n);
}
u32 record_nested(u32 n) {
  callback volatile fn = record_dynamic;
  u32 result = record_indirect(fn, n);
  record_observe(8);
  return result;
}
