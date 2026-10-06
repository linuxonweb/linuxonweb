/* Source controls execute the actual ICD's assembly/range logic with a counted
 * transport double. They establish no host GPU, guest or Firefox acceptance. */
#define GUEST_VK_ZINK 1
#include "../guest-vulkan/icd.c"
#include <assert.h>
static unsigned calls,next_host=100;
int gpu_accept(struct gpu_session *s,unsigned p){(void)s;(void)p;return -1;}
void gpu_close(struct gpu_session *s){(void)s;}
int gpu_resource(struct gpu_session *s,enum gpu_op op,const void *b,uint32_t n,uint32_t *id){(void)s;(void)op;(void)b;(void)n;calls++;*id=next_host++;return 0;}
int gpu_call(struct gpu_session *s,enum gpu_op op,const void *b,uint32_t n,void *out,uint32_t cap,uint32_t *received){
    (void)s;(void)b;(void)n;calls++;*received=0;
    if(op==GPU_VERTEX_BUFFER&&cap>=4){uint32_t id=next_host++;memcpy(out,&id,4);*received=4;return 0;}
    return op==GPU_DESTROY?0:-1;
}
static unsigned checks;
#define TEST(x) do{checks++;assert(x);}while(0)
static void reset_ring(void){for(unsigned k=0;k<2;k++){free(zink_rings[k].bytes);memset(&zink_rings[k],0,sizeof(zink_rings[k]));}zink_ring_reset();calls=0;}
int main(void){
    struct VkInstance_T instance={0};live=&instance;
    struct resource *memory=resource_new(R_MEMORY),*buffer=resource_new(R_BUFFER),*indices=resource_new(R_BUFFER),*im=resource_new(R_MEMORY);
    memory->size=300000;memory->bytes=calloc(1,memory->size);im->size=300000;im->bytes=calloc(1,im->size);
    buffer->memory=memory->id;buffer->generic=1;buffer->usage=VK_BUFFER_USAGE_VERTEX_BUFFER_BIT;buffer->size=memory->size;
    indices->memory=im->id;indices->generic=1;indices->usage=VK_BUFFER_USAGE_INDEX_BUFFER_BIT;indices->size=im->size;
    struct graphics_pipeline p={.binding_count=1,.topology=VK_PRIMITIVE_TOPOLOGY_TRIANGLE_STRIP};
    p.bindings[0]=(struct graphics_binding){.binding=0,.stride=20,.count=1,.attributes={{.location=0,.format=VK_FORMAT_R32G32B32A32_SFLOAT}}};
    struct graphics_draw_record r={.count=6,.first=2};r.vertices[0].buffer=buffer->id;r.vertices[0].offset=4;
    for(unsigned i=0;i<12000;i++)memcpy(memory->bytes+4+i*20,&i,4);
    /* Independent Vulkan table rows, translated by firstVertex=2. Odd rows
     * swap their last two vertices; Gl rotates cyclically to put FIRST last. */
    const unsigned expected[2][12]={{2,3,4,3,5,4,4,5,6,5,7,6},{3,4,2,5,4,3,5,6,4,7,6,5}};
    TEST(guest_primitive_count(2,6)==12);TEST(guest_primitive_count(2,65536)==196602);
    TEST(!guest_primitive_count(2,2));TEST(!guest_primitive_count(2,65537));TEST(!guest_primitive_count(3,6));
    for(unsigned provoking=0;provoking<2;provoking++)for(unsigned mode=0;mode<3;mode++){
        reset_ring();live->host_last_provoking=provoking;r.first=2;r.count=6;r.index_size=mode?mode==1?2:4:0;r.index_buffer=indices->id;r.index_offset=8;r.vertex_offset=mode==1?-3:mode==2?2:0;
        for(unsigned i=0;i<6;i++){uint32_t v=(uint32_t)((int64_t)2+i-r.vertex_offset);if(mode==1){uint16_t q=v;memcpy(im->bytes+8+(2+i)*2,&q,2);}else memcpy(im->bytes+8+(2+i)*4,&v,4);}
        TEST(zink_gather_preflight(&r,&p,12,12));TEST(calls==0);
        struct graphics_json j={0};TEST(zink_gather_indexed(&r,&p,0,12,&j));
        for(unsigned k=0;k<12;k++){unsigned got;memcpy(&got,zink_rings[0].bytes+k*20,4);TEST(got==expected[provoking][k]);}
        if(mode){unsigned size=mode==1?2:4;memset(im->bytes+8+7*size,0xff,size);reset_ring();TEST(!zink_gather_preflight(&r,&p,12,12));TEST(calls==0);}
    }
    for(unsigned provoking=0;provoking<2;provoking++){
        reset_ring();live->host_last_provoking=provoking;r.index_size=0;r.first=0;r.count=4098;
        uint32_t total=guest_primitive_count(2,r.count),piece=zink_index_piece(&p,total),pieces=0;TEST(total==12288&&piece==3276);TEST(zink_gather_preflight(&r,&p,total,piece));TEST(calls==0);
        for(unsigned start=0;start<total;start+=piece){unsigned n=total-start<piece?total-start:piece;struct graphics_json j={0};TEST(zink_gather_indexed(&r,&p,start,n,&j));pieces++;
            unsigned c=zink_rings[0].chunk,at=zink_rings[0].used[c]-((n-1)*20+16+3)/4*4;
            for(unsigned k=0;k<n;k++){unsigned got;memcpy(&got,zink_rings[0].bytes+c*ZINK_RING_CHUNK+at+k*20,4);
                unsigned triangle=(start+k)/3,corner=((start+k)%3+provoking)%3;
                /* Source spec parity expression, independent expected table. */
                unsigned want=triangle+((triangle&1)&&corner?3-corner:corner);TEST(got==want);}
        }TEST(pieces==4);
    }
    reset_ring();r.count=65536;TEST(!zink_gather_preflight(&r,&p,196602,zink_index_piece(&p,196602)));TEST(calls==0);
    r.count=6;p.vertex_index=1;TEST(!zink_gather_preflight(&r,&p,12,12));TEST(calls==0);p.vertex_index=0;
    r.index_size=1;TEST(!zink_gather_preflight(&r,&p,12,12));TEST(calls==0);r.index_size=4;r.index_offset=indices->size-4;TEST(!zink_gather_preflight(&r,&p,12,12));TEST(calls==0);
    reset_ring();free(memory->bytes);free(im->bytes);puts("SOURCE_CONTROL_SCOPE transport double; no GPU acceptance");printf("STRIP_NATIVE_CONTROLS_PASS checks=%u\n",checks);return 0;
}
