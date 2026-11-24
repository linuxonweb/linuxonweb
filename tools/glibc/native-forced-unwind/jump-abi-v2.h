/* Separate proposed coherent backend. Never include with frozen backend24. */
#ifndef GNU_WASM_JUMP_ABI_V2_H
#define GNU_WASM_JUMP_ABI_V2_H
typedef struct {
  void *__invocation;
  int __label;
  void *__env;
  int __value;
  unsigned __throw_version;
  void *__sp;
  void *__owner;
  unsigned __registration[9];
} nf_backend_jump_v2;
struct nf_tag1_payload_v2 {
  void *environment;
  int value;
  unsigned captured_registration_version;
  void *owner_tp;
  unsigned task_epoch;
  unsigned delivery_generation;
  unsigned phase;
  unsigned module_generation;
};
_Static_assert(sizeof(nf_backend_jump_v2) == 64, "backend64");
_Static_assert(__builtin_offsetof(nf_backend_jump_v2, __env) == 8, "payload start");
_Static_assert(__builtin_offsetof(nf_backend_jump_v2, __throw_version) == 16, "payload version");
_Static_assert(__builtin_offsetof(nf_backend_jump_v2, __registration) == 28, "embedded jump36");
_Static_assert(sizeof(struct nf_tag1_payload_v2) == 32, "immutable delivery32");
/* Coherent tag1 v2 carries a generation-bearing i32 handle, not an env pointer.
   Resolver authenticates it before any payload dereference. One primary shared
   generation counter is required across admitted modules/threads.
   Explicit bounded prerequisite. Exhaustion returns zero; the recorded genuine
   longjmp caller must invoke GNU abort. General dynamic growth is outstanding. */
enum { NF_DELIVERY_SLOTS_V2 = 64, NF_DELIVERY_LIVE_V2 = 1, NF_DELIVERY_RETIRED_V2 = 2 };
unsigned __wasm_gnu_jump_delivery_allocate_v2(void *, int);
const struct nf_tag1_payload_v2 *__wasm_gnu_jump_delivery_resolve_v2(unsigned);
int __wasm_gnu_jump_delivery_retire_v2(unsigned, void *, unsigned);
#endif
