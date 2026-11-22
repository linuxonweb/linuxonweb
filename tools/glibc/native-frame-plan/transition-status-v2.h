/* Source proposal only. No compiler consumer or fatal bridge is accepted. */
#ifndef WASM_GNU_TRANSITION_STATUS_V2_H
#define WASM_GNU_TRANSITION_STATUS_V2_H
#include "forced-abi.h"
enum nf_transition_status_v2 {
  NF_TRANSITION_CORRUPT = 0,
  NF_TRANSITION_OK = 1,
  /* Existing published activation/owner/chain remain authenticated. The
     compiler must enter an authenticated fatal critical scope before calling
     genuine recorded GNU abort. This bridge is not implemented yet. */
  NF_TRANSITION_PUBLISHED_FATAL_REQUIRED = 2,
  /* Current entering activation is not published. Its real frame cannot be
     omitted when calling abort; truthful fatal admission remains unresolved. */
  NF_TRANSITION_ENTER_FATAL_ADMISSION_REQUIRED = 3
};
enum nf_transition_status_v2 __wasm_gnu_frame_enter_status_v2(
    struct nf_frame *, const struct nf_descriptor *, nf_u32, nf_u32);
enum nf_transition_status_v2 __wasm_gnu_frame_leave_status_v2(struct nf_frame *);
enum nf_transition_status_v2 __wasm_gnu_frame_admit_status_v2(void (*)(void));
#endif
