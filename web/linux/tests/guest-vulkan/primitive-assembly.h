/* Bounded triangle assembly shared by the ICD and native source controls.
 * Modes: 0=list, 1=fan, 2=strip. All emit triangle lists preserving Vulkan's
 * FIRST_VERTEX provoking value and winding. LAST host backends rotate each
 * triangle cyclically. Restart and original VertexIndex gathering unsupported. */
#ifndef GUEST_PRIMITIVE_ASSEMBLY_H
#define GUEST_PRIMITIVE_ASSEMBLY_H
#include <stdint.h>
static inline uint32_t guest_primitive_count(int mode,uint32_t source_count) {
    if(source_count<3||source_count>65536||mode<0||mode>2)return 0;
    return mode?3u*(source_count-2u):(source_count%3?0:source_count);
}
static inline uint32_t guest_primitive_ordinal(int mode,int last_provoking,uint32_t output) {
    uint32_t triangle=output/3u,corner=(output%3u+(last_provoking?1u:0u))%3u;
    if(mode==1)return corner==2u?0u:triangle+1u+corner;
    if(mode==2)return triangle+(corner&&triangle%2u?3u-corner:corner);
    return triangle*3u+corner;
}
#endif
