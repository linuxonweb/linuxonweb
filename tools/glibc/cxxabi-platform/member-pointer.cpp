// Native GNU-target ABI diagnostic. No libc, C++ runtime or host callbacks.
struct Plain {
  int value;
  __attribute__((noinline)) int first(int n) { return value + n + 11; }
  __attribute__((noinline)) int second(int n) { return value - n - 23; }
};
using PlainMember = int (Plain::*)(int);
static PlainMember plainMembers[] = {&Plain::first, &Plain::second};
__attribute__((noinline)) static int apply(Plain &p, PlainMember m, int n) {
  return (p.*m)(n);
}

struct Base {
  int value;
  virtual int method(int n) { return value + n; }
};
struct Derived : Base {
  int method(int n) override { return value + n + 71; }
};
using VirtualMember = int (Base::*)(int);
static VirtualMember virtualMember = &Base::method;
__attribute__((noinline)) static int applyVirtual(Base &p, VirtualMember m, int n) {
  return (p.*m)(n);
}

struct Left { int left; };
struct Right {
  int right;
  __attribute__((noinline)) int method(int n) { return right + n + 101; }
};
struct Both : Left, Right {};
using AdjustedMember = int (Both::*)(int);
static AdjustedMember adjustedMember = &Right::method;
__attribute__((noinline)) static int applyAdjusted(Both &p, AdjustedMember m, int n) {
  return (p.*m)(n);
}

extern "C" {
int plain(int which, int value, int n) {
  Plain p{value};
  return apply(p, plainMembers[which], n);
}
int polymorphic(int value, int n) {
  Derived p;
  p.value = value;
  return applyVirtual(p, virtualMember, n);
}
int adjusted(int value, int n) {
  Both p;
  p.left = -999;
  p.right = value;
  return applyAdjusted(p, adjustedMember, n);
}
int member_size() { return sizeof(PlainMember); }
int member_word(int which, int word) {
  static_assert(sizeof(PlainMember) == 2 * sizeof(int));
  int words[2];
  __builtin_memcpy(words, &plainMembers[which], sizeof(words));
  return words[word];
}
int adjusted_word(int word) {
  int words[2];
  __builtin_memcpy(words, &adjustedMember, sizeof(words));
  return words[word];
}
}
