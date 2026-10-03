/* Native VM traversal with genuine GNU exception/context declarations.
   PREPARED SOURCE ONLY: requires the composed admitted frame/target runtime.
   No replacement cancellation, setjmp, cleanup-chain or VM stack walker. */
#include "forced-abi.h"
#include <stdint.h>
#include <stdlib.h>
#define FORCE_SLOTS 4u
#define MAX_ANCESTORS 4096u
#define NF_FORCE_JUMP_PENDING 1u
#define NF_FORCE_END_DELIVERED 2u
#define INLINE static __attribute__((always_inline)) inline
INLINE int linear(const void *p, nf_u32 bytes, nf_u32 alignment) {
  uint64_t n=(uint64_t)__builtin_wasm_memory_size(0)*65536u;
  uint64_t a=(uintptr_t)p;
  return p && !(a & (alignment-1u)) && a<=n && bytes<=n-a;
}
static _Thread_local struct nf_forced forced_slots[FORCE_SLOTS];
static __attribute__((noreturn)) void invalid(void) { abort(); }
static nf_u32 addr(const void *p) { return (nf_u32)(uintptr_t)p; }
static struct nf_thread *thread(void) {
  struct nf_thread *t = __wasm_gnu_frame_thread_v1();
  if (!t || t->version != NF_ABI_VERSION || !t->owner_tp || !t->task_epoch ||
      t->owner_tp != __wasm_gnu_frame_owner_tp_v1() || t->critical_depth ||
      !t->root_module || addr(t->stack_low) >= addr(t->stack_high)) invalid();
  return t;
}
INLINE int admitted(struct nf_thread *t,const struct nf_descriptor *wanted) {
  const struct nf_module *m=t->root_module;
  for(nf_u32 n=0;m && n<64;++n,m=m->next) {
    if(!linear(m,sizeof(*m),4) || m->version!=NF_ABI_VERSION ||
       m->flags!=NF_FORCED_ADMITTED || !m->generation || m->descriptor_count>4096 ||
       !linear(m->descriptors,m->descriptor_count*sizeof(*m->descriptors),4)) return 0;
    for(nf_u32 i=0;i<m->descriptor_count;++i) {
      const struct nf_descriptor *d=m->descriptors[i];
      if(!linear(d,sizeof(*d),4) || d->module!=m ||
         d->version!=NF_ABI_VERSION || d->bytes!=sizeof(*d) ||
         (d->flags!=NF_FORCED_ADMITTED && d->flags!=NF_PRIMITIVE_BRIDGE)) return 0;
      if(d==wanted) return d->flags==NF_FORCED_ADMITTED;
    }
  }
  return 0;
}
INLINE int frame_valid(struct nf_thread *t, const struct nf_frame *f) {
  nf_u32 p = addr(f), low = addr(t->stack_low), high = addr(t->stack_high);
  return f && !(p & 15u) && high >= sizeof(*f) && p >= low &&
      p <= high - sizeof(*f) && f->version == NF_ABI_VERSION &&
      f->phase == NF_PHASE_ACTIVE && f->owner_tp == t->owner_tp &&
      f->task_epoch == t->task_epoch && f->activation_id && linear(f->descriptor,sizeof(*f->descriptor),4) &&
      f->descriptor->version == NF_ABI_VERSION &&
      f->descriptor->bytes == sizeof(*f->descriptor) &&
      f->descriptor->flags == NF_FORCED_ADMITTED && admitted(t,f->descriptor) &&
      addr(f->active_sp) >= low && addr(f->active_sp) <= addr(f->fixed_sp) &&
      addr(f->fixed_sp) <= p && p + sizeof(*f) <= addr(f->caller_entry_sp) &&
      addr(f->caller_entry_sp) <= high;
}
/* Metadata authentication only. Native VM guards perform traversal. */
INLINE int ancestor(struct nf_thread *t, const struct nf_frame *older,
                    const struct nf_frame *younger) {
  for (nf_u32 depth = 0; younger && depth != MAX_ANCESTORS; ++depth) {
    if (!frame_valid(t, younger)) invalid();
    if (younger == older) return 1;
    const struct nf_frame *p = younger->previous;
    if (p && (!frame_valid(t, p) ||
        younger->caller_entry_sp != p->active_sp ||
        addr(younger) >= addr(p))) invalid();
    younger = p;
  }
  return 0;
}
INLINE struct nf_forced *active_force(struct nf_thread *t,
                                     struct _Unwind_Exception *e) {
  if (!linear(e,sizeof(*e),8)) invalid();
  /* Do not dereference unauthenticated private_1 as a state pointer. */
  struct nf_forced *s = t->forced;
  for (nf_u32 n = 0; s && n != FORCE_SLOTS; ++n, s = s->previous) {
    int slot = 0;
    for (nf_u32 i = 0; i != FORCE_SLOTS; ++i)
      if (s == &forced_slots[i]) slot = 1;
    if (!slot || s->phase != NF_FORCED_LIVE || s->owner_tp != t->owner_tp ||
        s->task_epoch != t->task_epoch || !s->epoch || !s->stop) invalid();
    if (s->exception == e) {
      if (e->private_1 != addr(s) || e->private_2 != s->epoch) invalid();
      return s;
    }
  }
  return 0;
}
static struct nf_context *context(struct _Unwind_Context *opaque) {
  struct nf_context *c = (struct nf_context *)opaque;
  struct nf_thread *t = thread();
  nf_u32 p = addr(c), low = addr(t->stack_low), high = addr(t->stack_high);
  if (!c || p & 3u || high < sizeof(*c) || p < low || p > high-sizeof(*c) ||
      c->version != NF_ABI_VERSION || !linear(c->exception,sizeof(*c->exception),8)) invalid();
  if(c->actions&_UA_END_OF_STACK) {
    struct nf_forced *s=active_force(t,c->exception);
    /* Tagged terminal context is not an invented application CFA/frame.
       Compiler reached the root escape after all application cleanup pads. */
    if(!s || !(s->flags&NF_FORCE_END_DELIVERED) || c->frame || c->cfa ||
       c->activation_id || c->forced_epoch!=s->epoch ||
       c->actions!=(_UA_CLEANUP_PHASE|_UA_FORCE_UNWIND|_UA_END_OF_STACK) ||
       !frame_valid(t,s->current) || s->current->previous ||
       !ancestor(t,s->current,t->head)) invalid();
  } else if(!frame_valid(t,c->frame) || c->activation_id!=c->frame->activation_id ||
      c->cfa!=c->frame->caller_entry_sp || !ancestor(t,c->frame,t->head)) invalid();
  return c;
}
static void init_context(struct nf_context *c, struct nf_frame *f,
                         struct _Unwind_Exception *e, struct nf_forced *s) {
  c->frame = f; c->cfa = f->caller_entry_sp; c->exception = e;
  c->actions = s ? (_UA_CLEANUP_PHASE | _UA_FORCE_UNWIND) : _UA_SEARCH_PHASE;
  c->forced_epoch = s ? s->epoch : 0;
  c->activation_id = f->activation_id; c->version = NF_ABI_VERSION;
}
void __wasm_gnu_unwind_guard_v1(struct nf_frame *f,
    struct _Unwind_Exception *e, struct nf_context *c) {
  struct nf_thread *t = thread();
  if (!frame_valid(t, f) || !ancestor(t, f, t->head)) invalid();
  if (!linear(c,sizeof(*c),4)) invalid();
  struct nf_forced *s = active_force(t, e);
  /* The caller has restored recorded activeSP before entering this function. */
  c->lpad_index=~0u; c->lsda=0; c->selector=0;
  init_context(c, f, e, s);
  (void)context((struct _Unwind_Context *)c);
  if (!s) return;
  if (s->suspended_depth) {
    if (!frame_valid(t,s->current) ||
        s->stopped_activation!=s->current->activation_id) invalid();
    if (f!=s->current && ancestor(t,s->current,f)) return;
    /* A same-E exception has returned to the actual suspended anchor after
       callback descendants escaped. Those records must already be popped. */
    if (f!=s->current || s->suspended_depth!=1) invalid();
    s->suspended_depth=0;
  }
  if (f->stopped_epoch == s->epoch) return;
  if (f->forced_epoch && f->forced_epoch != s->epoch) invalid();
  f->forced_epoch = f->stopped_epoch = s->epoch;
  s->current = f; s->stopped_activation = f->activation_id;
  /* Mark before callback: stop-produced native tag1 cannot repeat delivery.
     Callback/helper activations must be represented; same-E dispatch is
     suppressed while this authenticated stop is on its genuine call stack. */
  if(s->suspended_depth) invalid();
  s->suspended_depth=1;
  _Unwind_Reason_Code r = s->stop(1, c->actions, e->exception_class, e,
                                 (struct _Unwind_Context *)c, s->stop_parameter);
  if(s->phase!=NF_FORCED_LIVE || s->current!=f || s->suspended_depth!=1) invalid();
  s->suspended_depth=0;
  if (r != _URC_NO_REASON) invalid();
}
void __wasm_gnu_unwind_terminal_v1(struct nf_frame *f,
    struct _Unwind_Exception *e,struct nf_context *c) {
  struct nf_thread *t=thread();
  if(!frame_valid(t,f) || !ancestor(t,f,t->head) ||
     !linear(c,sizeof(*c),4)) invalid();
  struct nf_forced *s=active_force(t,e);
  if(!s || f->previous) return;
  if(s->suspended_depth || (s->flags&NF_FORCE_END_DELIVERED) ||
     f->stopped_epoch!=s->epoch) invalid();
  c->lpad_index=~0u;c->lsda=0;c->selector=0;
  init_context(c,f,e,s);c->actions|=_UA_END_OF_STACK;
  c->frame=0;c->cfa=0;c->activation_id=0;
  s->current=f;s->stopped_activation=f->activation_id;
  s->flags|=NF_FORCE_END_DELIVERED;s->suspended_depth=1;
  (void)context((struct _Unwind_Context *)c);
  (void)s->stop(1,c->actions,e->exception_class,e,
               (struct _Unwind_Context *)c,s->stop_parameter);
  /* Native VM has consumed the raising frame. GNU NPTL never returns from
     this stop; preserving its fatal contract needs genuine abort here. */
  invalid();
}
_Unwind_Reason_Code _Unwind_ForcedUnwind(struct _Unwind_Exception *e,
    _Unwind_Stop_Fn stop, void *parameter) {
  struct nf_thread *t = thread();
  if (!linear(e,sizeof(*e),8) || !stop || !frame_valid(t, t->head) ||
      active_force(t, e) || !t->next_forced_epoch ||
      t->next_forced_epoch == ~0u) return _URC_FATAL_PHASE2_ERROR;
  struct nf_forced *s = 0;
  for (nf_u32 i = 0; i != FORCE_SLOTS; ++i)
    if (forced_slots[i].phase != NF_FORCED_LIVE) { s=&forced_slots[i]; break; }
  if (!s) return _URC_FATAL_PHASE2_ERROR;
  s->previous=t->forced; s->owner_tp=t->owner_tp; s->task_epoch=t->task_epoch;
  s->epoch=t->next_forced_epoch++; s->exception=e; s->stop=stop;
  s->stop_parameter=parameter; s->current=0; s->stopped_activation=0;
  s->phase=NF_FORCED_LIVE; s->suspended_depth=0; s->flags=0;
  e->private_1=addr(s); e->private_2=s->epoch; t->forced=s;
  __builtin_wasm_throw(0, e);
}
_Unwind_Reason_Code _Unwind_RaiseException(struct _Unwind_Exception *e) {
  /* __cxa_rethrow reaches this entry too; do not retire/reset authenticated E. */
  struct nf_thread *t = thread();
  (void)active_force(t, e);
  __builtin_wasm_throw(0, e);
}
void _Unwind_Resume(struct _Unwind_Exception *e) {
  (void)_Unwind_RaiseException(e); __builtin_unreachable();
}
_Unwind_Reason_Code _Unwind_Resume_or_Rethrow(struct _Unwind_Exception *e) {
  return _Unwind_RaiseException(e);
}
_Unwind_Reason_Code _Unwind_CallPersonality(struct _Unwind_Exception *e,
                                          struct nf_context *c) {
  struct nf_thread *t = thread();
  if(!linear(c,sizeof(*c),4) || !frame_valid(t,c->frame)) invalid();
  struct nf_forced *s = active_force(t, e);
  init_context(c, c->frame, e, s); c->selector=0;
  (void)context((struct _Unwind_Context *)c);
  if (!c->frame->descriptor->personality) invalid();
  if (s && s->suspended_depth) {
    if(!frame_valid(t,s->current) || s->stopped_activation!=s->current->activation_id ||
       (c->frame!=s->current && !ancestor(t,s->current,c->frame))) invalid();
    if(c->frame==s->current) s->suspended_depth=0;
  } else if (s && c->frame->stopped_epoch != s->epoch) invalid();
  return c->frame->descriptor->personality(1,c->actions,e->exception_class,e,
                                          (struct _Unwind_Context *)c);
}
_Unwind_Word _Unwind_GetCFA(struct _Unwind_Context *c) {
  return (_Unwind_Word)(uintptr_t)context(c)->cfa;
}
void *_Unwind_GetLanguageSpecificData(struct _Unwind_Context *c) {
  return (void *)context(c)->lsda;
}
_Unwind_Ptr _Unwind_GetIP(struct _Unwind_Context *c) {
  /* Existing Wasm LSDA landing-pad index convention; never a native PC. */
  struct nf_context *v=context(c);
  if(v->lpad_index==~0u) invalid(); /* Stop contexts have no language pad. */
  return v->lpad_index + 2u;
}
void _Unwind_SetGR(struct _Unwind_Context *c, int index, _Unwind_Word value) {
  struct nf_context *v=context(c);
  if (index==1) v->selector=value;
  else if (index!=0 || value!=addr(v->exception)) invalid();
}
void _Unwind_SetIP(struct _Unwind_Context *c, _Unwind_Ptr ip) {
  (void)context(c); (void)ip; /* Wasm VM selects the real pad, as upstream. */
}
_Unwind_Ptr _Unwind_GetRegionStart(struct _Unwind_Context *c) {
  (void)context(c); return 0; /* Existing Wasm LSDA base, not invented PC. */
}
void _Unwind_DeleteException(struct _Unwind_Exception *e) {
  struct nf_thread *t=thread(); struct nf_forced *s=active_force(t,e);
  if (e->exception_cleanup)
    e->exception_cleanup(_URC_FOREIGN_EXCEPTION_CAUGHT,e);
  if (s) invalid(); /* Genuine GNU unwind_cleanup must not return on swallow. */
}
/* Ancestry only, not traversal: GNU unwind_stop retains its own algorithms. */
int __wasm_gnu_unwind_cfa_descendant_v1(void *environment,
    struct _Unwind_Context *opaque, nf_u32 adjustment) {
  struct nf_context *c=context(opaque);struct nf_thread *t=thread();
  if(c->actions&_UA_END_OF_STACK) return 0; /* No application frame remains. */
  nf_u32 depth=0;
  for(struct nf_frame *f=t->head;f;f=f->previous) {
    if(++depth>MAX_ANCESTORS) invalid();
    if(!frame_valid(t,f)) invalid();
    nf_u32 jumps=0;
    for(struct nf_jump *j=f->jump_top;j;j=j->previous) {
      if(++jumps>MAX_ANCESTORS || !linear(j,sizeof(*j),4)) invalid();
      if(j->environment!=environment) continue;
      if(j->target!=f || j->owner_tp!=t->owner_tp || j->task_epoch!=t->task_epoch ||
          j->activation_id!=f->activation_id || !j->registration_version ||
          addr(j->saved_sp)<addr(t->stack_low) ||
          addr(j->saved_sp)>addr(f->caller_entry_sp)) invalid();
      (void)adjustment; /* Bounds/identity apply before modular GNU adjustment. */
      return c->frame!=f && ancestor(t,f,c->frame);
    }
  }
  invalid();
}

/* Concrete metadata transitions. These are not yet machine-audited and cannot
   be admitted as primitive bridges until that audit passes. They never perform
   VM traversal or execute a cleanup; the native outer/retained-target paths
   supply the actual record/payload after native dispatch. */
INLINE int states_valid(struct nf_thread *t) {
  if(!linear(t,sizeof(*t),4) || t->version!=NF_ABI_VERSION ||
     !t->owner_tp || !t->task_epoch ||
     t->owner_tp!=__wasm_gnu_frame_owner_tp_v1()) return 0;
  struct nf_forced *s=t->forced; nf_u32 seen=0;
  for(nf_u32 n=0;s && n<FORCE_SLOTS;++n,s=s->previous) {
    nf_u32 index=FORCE_SLOTS;
    for(nf_u32 i=0;i<FORCE_SLOTS;++i) if(s==&forced_slots[i]) index=i;
    if(index==FORCE_SLOTS || (seen&(1u<<index))) return 0;
    seen|=1u<<index;
    if(s->phase!=NF_FORCED_LIVE || s->owner_tp!=t->owner_tp ||
       s->task_epoch!=t->task_epoch || !s->epoch || !s->stop ||
       !linear(s->exception,sizeof(*s->exception),8) ||
       s->exception->private_1!=addr(s) || s->exception->private_2!=s->epoch ||
       s->suspended_depth>1 || (s->flags&~(NF_FORCE_JUMP_PENDING|NF_FORCE_END_DELIVERED))) return 0;
    if(s->current && (!frame_valid(t,s->current) ||
       s->stopped_activation!=s->current->activation_id)) return 0;
    if(!s->current && (s->suspended_depth || s->stopped_activation)) return 0;
  }
  return !s;
}
int __wasm_gnu_unwind_state_valid_v1(struct nf_thread *t) {
  return states_valid(t);
}
INLINE int jump_valid(struct nf_thread *t,struct nf_frame *f,struct nf_jump *j) {
  return linear(j,sizeof(*j),4) && j->target==f &&
    j->owner_tp==t->owner_tp && j->task_epoch==t->task_epoch &&
    j->activation_id==f->activation_id && j->registration_version &&
    j->registration_version<t->next_jump_version && j->environment &&
    addr(j->saved_sp)>=addr(t->stack_low) &&
    addr(j->saved_sp)<=addr(f->fixed_sp);
}
int __wasm_gnu_unwind_escape_v2(struct nf_frame *f,nf_u32 reason,
    struct _Unwind_Exception *actual_tag0,nf_u32 caught_handle) {
  /* Resolve the caught value as a handle before any incoming payload/env
     dereference. It must name a still-live retained target strictly older than
     this escaping frame; tag1 may never retire that target via this hook. */
  const struct nf_tag1_payload_v2 *delivery=0;
  if(reason==NF_ESCAPE_TAG1) {
    delivery=__wasm_gnu_jump_delivery_resolve_v2(caught_handle);
    if(!delivery) return 0;
  } else if(caught_handle) return 0;
  struct nf_thread *t=__wasm_gnu_frame_thread_v1();
  if(!states_valid(t) || t->critical_depth || t->head!=f || !frame_valid(t,f) ||
     reason>NF_ESCAPE_TAG0 || (reason==NF_ESCAPE_TAG0 &&
     !linear(actual_tag0,sizeof(*actual_tag0),8))) return 0;
  if(f->previous && (!frame_valid(t,f->previous) ||
     f->caller_entry_sp!=f->previous->active_sp)) return 0;
  nf_u32 count=0;
  for(struct nf_jump *j=f->jump_top;j;j=j->previous)
    if(++count>MAX_ANCESTORS || !jump_valid(t,f,j)) return 0;
  if(delivery) {
    if(!linear(delivery->environment,64,4)) return 0;
    struct nf_jump *wanted=(struct nf_jump *)((unsigned char *)delivery->environment+28);
    int found=0;nf_u32 depth=0;
    for(struct nf_frame *a=f->previous;a;a=a->previous) {
      if(++depth>MAX_ANCESTORS || !frame_valid(t,a)) return 0;
      nf_u32 jumps=0;
      for(struct nf_jump *j=a->jump_top;j;j=j->previous) {
        if(++jumps>MAX_ANCESTORS || !jump_valid(t,a,j)) return 0;
        if(j==wanted && j->environment==delivery->environment &&
           j->registration_version==delivery->captured_registration_version) found=1;
      }
    }
    if(!found) return 0;
  }
  for(struct nf_forced *s=t->forced;s;s=s->previous)
    if(s->current==f && reason!=NF_ESCAPE_TAG1 &&
       !(reason==NF_ESCAPE_TAG0 && actual_tag0==s->exception)) return 0;
  /* Validation is complete before the first mutation. */
  for(struct nf_forced *s=t->forced;s;s=s->previous) if(s->current==f) {
    s->current=f->previous;
    s->stopped_activation=f->previous?f->previous->activation_id:0;
    s->suspended_depth=0;
    if(reason==NF_ESCAPE_TAG1) s->flags|=NF_FORCE_JUMP_PENDING;
  }
  while(f->jump_top) {
    struct nf_jump *j=f->jump_top; f->jump_top=j->previous;
    j->environment=0;j->target=0;j->registration_version=0;
  }
  f->forced_epoch=f->stopped_epoch=0; f->phase=NF_PHASE_RETIRED;
  __atomic_store_n(&t->head,f->previous,__ATOMIC_RELEASE);
  return 1;
}
int __wasm_gnu_unwind_target_v2(struct nf_jump *target,void *environment,
    nf_u32 version,nf_u32 caught_handle) {
  const struct nf_tag1_payload_v2 *delivery=
      __wasm_gnu_jump_delivery_resolve_v2(caught_handle);
  if(!delivery || delivery->environment!=environment ||
      delivery->captured_registration_version!=version) return 0;
  struct nf_thread *t=__wasm_gnu_frame_thread_v1();
  if(!states_valid(t) || t->critical_depth || !frame_valid(t,t->head) ||
     !linear(target,sizeof(*target),4) || !jump_valid(t,t->head,target) ||
     target->environment!=environment || target->registration_version!=version)
    return 0;
  int found=0;nf_u32 count=0;
  for(struct nf_jump *j=t->head->jump_top;j;j=j->previous) {
    if(++count>MAX_ANCESTORS || !jump_valid(t,t->head,j)) return 0;
    if(j==target) found=1;
  }
  if(!found) return 0;
  /* Authenticate all state/epoch metadata before changing anything. A pending
     force has followed every skipped activation to this exact retained head. */
  int retained_live=0;
  for(struct nf_forced *s=t->forced;s;s=s->previous) {
    if(s->flags&NF_FORCE_JUMP_PENDING) {
      if(retained_live || s->current!=t->head) return 0;
    } else retained_live=1;
  }
  nf_u32 frames=0;
  for(struct nf_frame *f=t->head;f;f=f->previous) {
    if(++frames>MAX_ANCESTORS || !frame_valid(t,f)) return 0;
  }
  /* Every target/jump/forced-state check is complete. Retire only this exact
     authenticated native delivery; failure still leaves all frame/force state
     unchanged. No callbacks/imports/polls may intervene in sealed primitives. */
  if(!__wasm_gnu_jump_delivery_retire_v2(caught_handle,environment,version)) return 0;
  while(t->forced && (t->forced->flags&NF_FORCE_JUMP_PENDING)) {
    struct nf_forced *s=t->forced;nf_u32 epoch=s->epoch;
    t->forced=s->previous;
    for(struct nf_frame *f=t->head;f;f=f->previous) {
      if(f->forced_epoch==epoch) f->forced_epoch=0;
      if(f->stopped_epoch==epoch) f->stopped_epoch=0;
    }
    s->exception->private_1=s->exception->private_2=0;
    s->current=0;s->stopped_activation=0;s->suspended_depth=0;
    s->phase=NF_FORCED_RETIRED;s->flags=0;s->previous=0;
  }
  t->head->active_sp=target->saved_sp;
  return 1; /* Native target restores registered SP; retained scope stays live. */
}

/* Prepared per-environment backend64 registration. No delivery/match consumer
   is admitted until the versioned immutable tag1 handle schema is reviewed. */
nf_u32 __wasm_gnu_unwind_register_v1(struct nf_frame *f,void *environment,
    nf_u32 label,void *invocation,struct nf_jump *registration,nf_u32 actual_sp) {
  struct nf_thread *t=__wasm_gnu_frame_thread_v1();
  if(!states_valid(t) || t->critical_depth || t->head!=f || !frame_valid(t,f) ||
     !linear(environment,64,4) || !label || !invocation ||
     (uint64_t)addr(environment)+28u!=addr(registration) ||
     actual_sp!=addr(f->active_sp) || actual_sp<addr(t->stack_low) ||
     actual_sp>addr(f->fixed_sp) || addr(invocation)<addr(f->fixed_sp) ||
     addr(invocation)>=addr(f->caller_entry_sp) ||
     !t->next_jump_version || t->next_jump_version==~0u) return 0;
  /* Prefix values were written by the actual canonical __wasm_setjmp. They
     are compared with its compiler-owned SSA arguments, never inferred. */
  const nf_u32 *prefix=(const nf_u32 *)environment;
  if(prefix[0]!=addr(invocation) || prefix[1]!=label) return 0;
  struct nf_jump **old_link=0;nf_u32 frames=0;
  for(struct nf_frame *a=t->head;a;a=a->previous) {
    if(++frames>MAX_ANCESTORS || !frame_valid(t,a)) return 0;
    if(a->previous && (!frame_valid(t,a->previous) ||
       a->caller_entry_sp!=a->previous->active_sp ||
       addr(a)>=addr(a->previous))) return 0;
    nf_u32 jumps=0;
    for(struct nf_jump **link=&a->jump_top;*link;link=&(*link)->previous) {
      struct nf_jump *j=*link;
      if(++jumps>MAX_ANCESTORS || !jump_valid(t,a,j)) return 0;
      if(j==registration) {
        if(old_link || j->environment!=environment) return 0;
        old_link=link;
      }
    }
  }
  /* All checks precede mutation. Re-execution of a site with the same actual
     env replaces its old registration; other live envs remain linked. */
  if(old_link) *old_link=registration->previous;
  nf_u32 version=t->next_jump_version++;
  registration->previous=f->jump_top;registration->environment=environment;
  registration->target=f;registration->saved_sp=(void *)(uintptr_t)actual_sp;
  registration->owner_tp=t->owner_tp;registration->task_epoch=t->task_epoch;
  registration->activation_id=f->activation_id;registration->label=label;
  registration->registration_version=version;
  f->jump_top=registration;
  return version;
}
