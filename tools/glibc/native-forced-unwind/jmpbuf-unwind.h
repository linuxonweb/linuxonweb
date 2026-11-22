#ifndef GNU_WASM_FORCED_JMPBUF_UNWIND_H
#define GNU_WASM_FORCED_JMPBUF_UNWIND_H
#include <stdint.h>
#include <setjmp.h>
#include "forced-abi.h"
/* Real local-address predicate remains the accepted numeric GNU port route. */
#define _JMPBUF_UNWINDS_ADJ(buf,address,adj) ((uintptr_t)(address)-(adj)<(uintptr_t)(buf)[0].__sp-(adj))
#define _JMPBUF_UNWINDS(buf,address,demangle) _JMPBUF_UNWINDS_ADJ(buf,address,0)
/* Equal-SP immediate children require authenticated actual activation ancestry. */
#define _JMPBUF_CFA_UNWINDS_ADJ(buf,context,adj) __wasm_gnu_unwind_cfa_descendant_v1((void *)(buf),(context),(nf_u32)(adj))
#define __libc_unwind_longjmp(buf,val) __libc_longjmp(buf,val)
#endif
