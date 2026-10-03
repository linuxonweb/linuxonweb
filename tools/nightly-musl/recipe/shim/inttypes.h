/* The native ILP32 musl port uses long for intptr_t and uintptr_t. */
#ifndef MOZ_NATIVE_WASM_INTTYPES_ADAPTER_H
#define MOZ_NATIVE_WASM_INTTYPES_ADAPTER_H
#include_next <inttypes.h>
#if defined(__wasm__) && defined(__linux__) && !defined(__wasi__)
#  undef __PRIPTR
#  define __PRIPTR "l"
#endif
#endif
