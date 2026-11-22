/* Compiler controls only; genuine GNU/public runtime gates remain separate. */
extern void consumer_throw(void);
extern void consumer_cleanup(unsigned *);
extern int setjmp(void *) __attribute__((returns_twice));
extern void consumer_jump(void *);
unsigned consumer_leaf(unsigned x) { return x + 7; }
unsigned consumer_normal(unsigned x) {
  volatile unsigned words[17]; words[0] = x; words[16] = x + 3;
  return words[0] + words[16];
}
void consumer_pad(unsigned n) {
  unsigned x __attribute__((cleanup(consumer_cleanup))) = n;
  volatile unsigned char *p = __builtin_alloca(n + 31);
  p[0] = 29; p[n + 30] = 41;
  consumer_throw();
  x += p[0] + p[n + 30];
}
int consumer_target(void *actual_environment) {
  int result = setjmp(actual_environment);
  if (!result) consumer_jump(actual_environment);
  return result;
}
