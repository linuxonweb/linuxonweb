/* Source proposal. Status0/3 and nested fatal failure policy remain unresolved. */
#ifndef WASM_GNU_FATAL_STATUS_V3_H
#define WASM_GNU_FATAL_STATUS_V3_H
#include "transition-status-v2.h"
enum nf_transition_status_v2 __wasm_gnu_frame_enter_status_v3(
    struct nf_frame *, const struct nf_descriptor *, nf_u32, nf_u32);
enum nf_transition_status_v2 __wasm_gnu_frame_leave_status_v3(struct nf_frame *);
enum nf_transition_status_v2 __wasm_gnu_frame_admit_status_v3(void (*)(void));
/* Begin requires the authentic status2 token minted by the preceding actual
   transition. Returns0 without mutation on rejection; it never calls abort. */
int __wasm_gnu_fatal_begin_v3(struct nf_frame *);
/* Caller has authenticated exact native head and escape reason/token. */
int __wasm_gnu_fatal_escape_v3(struct nf_frame *);
/* Caller has authenticated real target registration, delivery, version and
   native retained head before this hook. No jump-buffer reconstruction. */
int __wasm_gnu_fatal_target_v3(struct nf_frame *);
#endif
