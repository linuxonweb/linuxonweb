#ifndef GNU_WASM_JMPBUF_UNWIND_H
#define GNU_WASM_JMPBUF_UNWIND_H
#include <stdint.h>
#include <setjmp.h>
#define _JMPBUF_UNWINDS_ADJ(buf,address,adj) ((uintptr_t)(address)-(adj)<(uintptr_t)(buf)[0].__sp-(adj))
#define _JMPBUF_UNWINDS(buf,address,demangle) _JMPBUF_UNWINDS_ADJ(buf,address,0)
#define _JMPBUF_CFA_UNWINDS_ADJ(buf,context,adj) _JMPBUF_UNWINDS_ADJ(buf,(void*)_Unwind_GetCFA(context),adj)
#define __libc_unwind_longjmp(buf,val) __libc_longjmp(buf,val)
#endif
