/* Candidate sealed primitives; requires actual emitted no-stack/call audit.
   No imports/polls/callbacks. Never reuse a live token, including host queued
   delivery. Epoch invalidation must happen at the actual owned exit/exec boundary. */
#include "frame-abi.h"
#include "jump-abi-v2.h"
typedef unsigned long long delivery_u64;
struct delivery_slot {
  struct nf_tag1_payload_v2 payload;
  const struct nf_module *root_module;
};
static _Thread_local struct delivery_slot slots[NF_DELIVERY_SLOTS_V2];
/* Singleton primary native provider; shared across real GNU threads/modules.
   Never reset while any native exception or boundary token can refer to it. */
static unsigned next_delivery = 1;
static unsigned address(const void *p) { return (unsigned)p; }
static int linear(const void *p, unsigned bytes, unsigned alignment) {
  return p && !(address(p) & (alignment - 1u)) &&
      (delivery_u64)address(p) + bytes <=
          (delivery_u64)__builtin_wasm_memory_size(0) * 65536u;
}
static struct nf_thread *thread(void) {
  struct nf_thread *t = __wasm_gnu_frame_thread_v1();
  if (!linear(t, sizeof(*t), 4) || t->version != NF_ABI_VERSION ||
      address(t->stack_low) >= address(t->stack_high) ||
      (delivery_u64)address(t->stack_high) > (delivery_u64)__builtin_wasm_memory_size(0) * 65536u ||
      !t->owner_tp || t->owner_tp != __wasm_gnu_frame_owner_tp_v1() || !t->task_epoch ||
      !linear(t->root_module, sizeof(*t->root_module), 4) ||
      t->root_module->version != NF_ABI_VERSION || t->root_module->flags != 4 ||
      !t->root_module->generation) return 0;
  return t;
}
static int descriptor_valid(struct nf_thread *t, const struct nf_descriptor *d) {
  unsigned count = 0;
  for (const struct nf_module *m = t->root_module; m; m = m->next) {
    if (++count > 64 || !linear(m, sizeof(*m), 4) ||
        m->version != NF_ABI_VERSION || m->flags != 4 || !m->generation ||
        !m->descriptor_count || m->descriptor_count > 4096 ||
        !linear(m->descriptors, m->descriptor_count * 4, 4)) return 0;
    for (unsigned i = 0; i < m->descriptor_count; ++i) {
      const struct nf_descriptor *p = m->descriptors[i];
      if (!linear(p, sizeof(*p), 4) || p->version != NF_ABI_VERSION ||
          p->bytes != sizeof(*p) || p->module != m || !p->function_identity ||
          (p->flags != 4 && p->flags != NF_PRIMITIVE_BRIDGE)) return 0;
      if (p == d) return p->flags == 4;
    }
  }
  return 0;
}
static int frame_valid(struct nf_thread *t, struct nf_frame *f) {
  return linear(f, sizeof(*f), 16) && address(f) >= address(t->stack_low) &&
      address(t->stack_high) >= sizeof(*f) &&
      address(f) <= address(t->stack_high) - sizeof(*f) &&
      f->version == NF_ABI_VERSION && f->flags == 4 && f->phase == NF_PHASE_ACTIVE &&
      f->owner_tp == t->owner_tp && f->task_epoch == t->task_epoch &&
      f->activation_id && f->activation_id < t->next_activation &&
      address(f->active_sp) >= address(t->stack_low) &&
      address(f->active_sp) <= address(f->fixed_sp) && address(f->fixed_sp) <= address(f) &&
      address(f->caller_entry_sp) <= address(t->stack_high) &&
      (delivery_u64)address(f) + sizeof(*f) <= address(f->caller_entry_sp) &&
      descriptor_valid(t, f->descriptor);
}
unsigned __wasm_gnu_jump_delivery_allocate_v2(void *env, int value) {
  struct nf_thread *t = thread();
  if (!t || t->critical_depth || !linear(env, 64, 4))
    return 0;
  struct nf_jump *j = (struct nf_jump *)((unsigned char *)env + 28);
  if (j->environment != env || !j->registration_version ||
      j->registration_version >= t->next_jump_version || j->owner_tp != t->owner_tp ||
      j->task_epoch != t->task_epoch) return 0;
  unsigned found = 0, count = 0;
  for (struct nf_frame *f = t->head; f; f = f->previous) {
    if (++count > 4096 || !frame_valid(t, f)) return 0;
    if (f->previous && (!frame_valid(t, f->previous) ||
        f->caller_entry_sp != f->previous->active_sp)) return 0;
    unsigned jumps = 0;
    for (struct nf_jump *p = f->jump_top; p; p = p->previous) {
      if (++jumps > 4096 || !linear(p, sizeof(*p), 4) ||
          !linear(p->environment, 64, 4) ||
          (delivery_u64)address(p->environment) + 28 != address(p) ||
          p->target != f || p->owner_tp != t->owner_tp || p->task_epoch != t->task_epoch ||
          p->activation_id != f->activation_id || !p->label || !p->registration_version ||
          p->registration_version >= t->next_jump_version ||
          address(p->saved_sp) < address(t->stack_low) ||
          address(p->saved_sp) > address(f->fixed_sp)) return 0;
      if (p == j) ++found;
    }
  }
  if (found != 1) return 0;
  for (unsigned i = 0; i != NF_DELIVERY_SLOTS_V2; ++i) {
    struct delivery_slot *s = &slots[i];
    if (s->payload.phase == NF_DELIVERY_LIVE_V2) continue;
    unsigned generation = __atomic_load_n(&next_delivery, __ATOMIC_RELAXED);
    do {
      /* Six slot bits, twenty-six monotonically unique generation bits. */
      if (!generation || generation >= 0x04000000u) return 0;
    } while (!__atomic_compare_exchange_n(&next_delivery, &generation,
              generation + 1, 0, __ATOMIC_RELAXED, __ATOMIC_RELAXED));
    /* No calls/imports/polls after entering this publication interval. */
    ++t->critical_depth;
    s->payload.environment = env; s->payload.value = value ? value : 1;
    s->payload.captured_registration_version = j->registration_version;
    s->payload.owner_tp = t->owner_tp; s->payload.task_epoch = t->task_epoch;
    s->payload.delivery_generation = generation;
    s->payload.module_generation = t->root_module->generation;
    s->root_module = t->root_module;
    __atomic_store_n(&s->payload.phase, NF_DELIVERY_LIVE_V2, __ATOMIC_RELEASE);
    --t->critical_depth;
    return (generation << 6) | i;
  }
  return 0;
}
const struct nf_tag1_payload_v2 *__wasm_gnu_jump_delivery_resolve_v2(unsigned handle) {
  struct nf_thread *t = thread();
  if (!t || t->critical_depth) return 0;
  unsigned generation = handle >> 6;
  if (!generation) return 0;
  /* Select only an actual owned TLS slot, never dereference the incoming word. */
  struct delivery_slot *s = &slots[handle & 63u];
  if (__atomic_load_n(&s->payload.phase, __ATOMIC_ACQUIRE) == NF_DELIVERY_LIVE_V2 &&
      s->payload.owner_tp == t->owner_tp && s->payload.task_epoch == t->task_epoch &&
      s->payload.delivery_generation == generation &&
      s->root_module == t->root_module &&
      s->payload.module_generation == t->root_module->generation &&
      linear(s->payload.environment, 64, 4)) {
    const struct nf_jump *j = (const struct nf_jump *)
        ((const unsigned char *)s->payload.environment + 28);
    if (j->environment != s->payload.environment ||
        j->registration_version != s->payload.captured_registration_version ||
        j->owner_tp != t->owner_tp || j->task_epoch != t->task_epoch) return 0;
    return &s->payload;
  }
  return 0;
}
int __wasm_gnu_jump_delivery_retire_v2(unsigned handle, void *env, unsigned version) {
  const struct nf_tag1_payload_v2 *payload = __wasm_gnu_jump_delivery_resolve_v2(handle);
  struct nf_thread *t = thread();
  if (!payload || !t || payload->environment != env ||
      payload->captured_registration_version != version || !linear(env, 64, 4)) return 0;
  struct nf_jump *j = (struct nf_jump *)((unsigned char *)env + 28);
  if (j->target != t->head || !frame_valid(t, t->head) ||
      j->environment != env || j->registration_version != version ||
      j->owner_tp != t->owner_tp || j->task_epoch != t->task_epoch ||
      j->activation_id != t->head->activation_id) return 0;
  /* Matching target authenticates registration/head/version before this call.
     It cannot silently retire a token from an unmatched outer escape. */
  __atomic_store_n(&((struct nf_tag1_payload_v2 *)payload)->phase,
                   NF_DELIVERY_RETIRED_V2, __ATOMIC_RELEASE);
  return 1;
}
