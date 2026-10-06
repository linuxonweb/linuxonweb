/* Bounded triangle assembly shared by the ICD and native source controls.
 * Fan triangles rotate cyclically to preserve winding and FIRST_VERTEX flat
 * interpolation: (i+1, i+2, 0). Primitive restart is intentionally unsupported. */
#ifndef GUEST_PRIMITIVE_ASSEMBLY_H
#define GUEST_PRIMITIVE_ASSEMBLY_H
#include <stdint.h>
static inline uint32_t guest_primitive_count(int fan,uint32_t source_count) {
    if(source_count<3||source_count>65536)return 0;
    return fan?3u*(source_count-2u):(source_count%3?0:source_count);
}
static inline uint32_t guest_primitive_ordinal(int fan,int last_provoking,uint32_t output) {
    uint32_t corner=(output%3u+(last_provoking?1u:0u))%3u;
    return fan?(corner==2u?0u:output/3u+1u+corner):output/3u*3u+corner;
}
#endif
