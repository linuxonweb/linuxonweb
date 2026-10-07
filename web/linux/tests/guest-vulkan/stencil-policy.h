#ifndef GUEST_STENCIL_POLICY_H
#define GUEST_STENCIL_POLICY_H
#include <stdint.h>
/* The attachment has eight stencil bits. High mask bits have no effect;
 * reference values remain separately checked and are never silently wrapped. */
static inline uint32_t stencil_effective_mask(uint32_t mask) { return mask & 255u; }
#endif
