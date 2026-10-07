/* Bounded primitive assembly shared by the ICD and native source controls.
 * Modes: 0=list, 1=fan, 2=strip emit triangle lists preserving Vulkan's
 * FIRST_VERTEX provoking value and winding; 3=line list, 4=line strip emit
 * line lists. LAST host backends rotate each primitive cyclically. Restart and
 * original VertexIndex gathering unsupported. */
#ifndef GUEST_PRIMITIVE_ASSEMBLY_H
#define GUEST_PRIMITIVE_ASSEMBLY_H
#include <stdint.h>
#ifndef GUEST_PRIMITIVE_MAX_SOURCE
#define GUEST_PRIMITIVE_MAX_SOURCE 65536u
#endif
static inline uint32_t guest_primitive_count(int mode,uint32_t source_count) {
    if(mode>=3&&mode<=4&&source_count>=2&&source_count<=GUEST_PRIMITIVE_MAX_SOURCE)
        return mode==4?2u*(source_count-1u):(source_count%2?0:source_count);
    if(source_count<3||source_count>GUEST_PRIMITIVE_MAX_SOURCE||mode<0||mode>2)return 0;
    return mode?3u*(source_count-2u):(source_count%3?0:source_count);
}
static inline uint32_t guest_primitive_ordinal(int mode,int last_provoking,uint32_t output) {
    if(mode>=3){uint32_t line=output/2u,end=(output%2u+(last_provoking?1u:0u))%2u;return mode==4?line+end:line*2u+end;}
    uint32_t triangle=output/3u,corner=(output%3u+(last_provoking?1u:0u))%3u;
    if(mode==1)return corner==2u?0u:triangle+1u+corner;
    if(mode==2)return triangle+(corner&&triangle%2u?3u-corner:corner);
    return triangle*3u+corner;
}
#endif
