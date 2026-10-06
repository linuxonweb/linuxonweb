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
    struct graphics_pipeline p={.binding_count=1,.topology=VK_PRIMITIVE_TOPOLOGY_TRIANGLE_FAN};
    p.bindings[0]=(struct graphics_binding){.binding=0,.stride=20,.count=1,.attributes={{.location=0,.format=VK_FORMAT_R32G32B32A32_SFLOAT}}};
    struct graphics_draw_record r={.count=5,.first=2};r.vertices[0].buffer=buffer->id;r.vertices[0].offset=4;
    for(unsigned i=0;i<12000;i++)memcpy(memory->bytes+4+i*20,&i,4);
    TEST(guest_primitive_count(1,5)==9);TEST(guest_primitive_count(0,5)==0);TEST(guest_primitive_count(1,65537)==0);
    const unsigned expected[9]={3,4,2,4,5,2,5,6,2};
    for(unsigned mode=0;mode<3;mode++){
        reset_ring();r.first=2;r.count=5;r.index_size=mode?mode==1?2:4:0;r.index_buffer=indices->id;r.index_offset=8;r.vertex_offset=mode?-3:0;
        for(unsigned i=0;i<5;i++){uint32_t v=5+i;if(mode==1){uint16_t q=v;memcpy(im->bytes+8+(2+i)*2,&q,2);}else memcpy(im->bytes+8+(2+i)*4,&v,4);}
        TEST(zink_gather_preflight(&r,&p,9,9));TEST(calls==0);
        struct graphics_json j={0};TEST(zink_gather_indexed(&r,&p,0,9,&j));
        for(unsigned k=0;k<9;k++){unsigned got;memcpy(&got,zink_rings[0].bytes+k*20,4);TEST(got==expected[k]);}
        /* A late invalid index must refuse the entire gather before allocation. */
        if(mode){uint32_t bad=UINT32_MAX;if(mode==1){uint16_t q=65535;memcpy(im->bytes+8+6*2,&q,2);}else memcpy(im->bytes+8+6*4,&bad,4);
            reset_ring();TEST(!zink_gather_preflight(&r,&p,9,9));TEST(calls==0);}
    }
    reset_ring();r.index_size=0;r.first=0;r.count=4097;p.bindings[0].stride=20;
    uint32_t total=guest_primitive_count(1,r.count),piece=zink_index_piece(&p,total);TEST(piece%3==0&&piece<total);TEST(zink_gather_preflight(&r,&p,total,piece));TEST(calls==0);
    for(unsigned start=0;start<total;start+=piece){unsigned n=total-start<piece?total-start:piece;struct graphics_json j={0};TEST(zink_gather_indexed(&r,&p,start,n,&j));
        unsigned c=zink_rings[0].chunk,at=zink_rings[0].used[c]-((n-1)*20+16+3)/4*4;
        for(unsigned k=0;k<n;k++){unsigned got;memcpy(&got,zink_rings[0].bytes+c*ZINK_RING_CHUNK+at+k*20,4);TEST(got==guest_primitive_ordinal(1,0,start+k));}}
    reset_ring();r.count=65536;TEST(!zink_gather_preflight(&r,&p,guest_primitive_count(1,r.count),zink_index_piece(&p,guest_primitive_count(1,r.count))));TEST(calls==0);
    r.count=5;p.vertex_index=1;TEST(!zink_gather_preflight(&r,&p,9,9));TEST(calls==0);p.vertex_index=0;
    r.index_size=1;TEST(!zink_gather_preflight(&r,&p,9,9));TEST(calls==0);r.index_size=4;r.index_offset=indices->size-4;TEST(!zink_gather_preflight(&r,&p,9,9));TEST(calls==0);
    uint32_t words[]={0x07230203,0,0,3,0,(4u<<16)|71,2,11,42};struct resource shader={.bytes=(unsigned char *)words,.size=sizeof(words)};
    TEST(graphics_shader_vertex_index(&shader));words[8]=0;TEST(!graphics_shader_vertex_index(&shader));words[5]=0;TEST(graphics_shader_vertex_index(&shader));
    reset_ring();free(memory->bytes);free(im->bytes);puts("SOURCE_CONTROL_SCOPE transport double; no GPU acceptance");printf("PIPELINE_NATIVE_CONTROLS_PASS checks=%u\n",checks);return 0;
}
