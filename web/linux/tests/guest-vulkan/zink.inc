/* Zink B2a: bounded semantics behind the seven device extensions Zink needs at
 * startup (maintenance1, descriptor_update_template, maintenance5,
 * create_renderpass2, dynamic_rendering, EXT_robustness2, timeline_semaphore).
 * Built only with -DGUEST_VK_ZINK=1. Every entry point reuses the existing
 * validated A1-A6 paths; anything outside the bounded profile is rejected. */

/* ---- robustness2 nullDescriptor: shared zero UBO ------------------------- */
static VkResult zink_null_ubo(void) {
    if(zink_null_ubo_host)return VK_SUCCESS;
    uint32_t size=16384,host=0;
    VkResult result=compute_resource(GPU_UNIFORM_BUFFER,&size,4,&host);if(result!=VK_SUCCESS)return result;
    static unsigned char data[16384+12];
    uint32_t header[3]={host,0,16384};memset(data,0,sizeof(data));memcpy(data,header,12);
    if(host_empty(GPU_UNIFORM_UPLOAD,data,sizeof(data))!=VK_SUCCESS)return VK_ERROR_DEVICE_LOST;
    zink_null_ubo_host=host;return VK_SUCCESS;
}
/* ---- B2d: generic buffer ring --------------------------------------------
 * B2f generic buffers keep their bytes in guest memory only. At submit the
 * window each draw reads (vertex attributes / uniform range) is copied into a
 * per-device ring of host buffers (kind 0 GPU_VERTEX_BUFFER, 1
 * GPU_UNIFORM_BUFFER; 64 KiB chunks created lazily), which is uploaded once
 * before the passes execute. Identical windows in one submit share a slot. */
struct zink_ring {uint32_t host[ZINK_RING_CHUNKS],used[ZINK_RING_CHUNKS];unsigned chunk;unsigned char *bytes;};
struct zink_ring_entry {const unsigned char *src;uint32_t avail,size,host,offset;unsigned kind;};
static struct zink_ring zink_rings[2];
static struct zink_ring_entry zink_ring_entries[512];
static unsigned zink_ring_entry_count;
static void zink_ring_reset(void) {
    for(unsigned k=0;k<2;k++){zink_rings[k].chunk=0;memset(zink_rings[k].used,0,sizeof(zink_rings[k].used));}
    zink_ring_entry_count=0;
}
/* Reserves size bytes of ring chunk memory (uploaded at submit) without the
 * source-window sharing of zink_ring_stage; the caller fills them. */
static unsigned char *zink_ring_alloc(unsigned kind,uint32_t size,uint32_t *host,uint32_t *offset) {
    if(kind>1||size>ZINK_RING_CHUNK||!size)return NULL;
    struct zink_ring *r=&zink_rings[kind];uint32_t align=kind?256u:4u;
    if(!r->bytes&&!(r->bytes=calloc(ZINK_RING_CHUNKS,ZINK_RING_CHUNK)))return NULL;
    uint32_t at=(r->used[r->chunk]+align-1)&~(align-1);
    if(at+size>ZINK_RING_CHUNK){if(r->chunk+1>=ZINK_RING_CHUNKS){ZINK_TRACE("ring REJECT kind=%u full\n",kind);return NULL;}r->chunk++;at=0;}
    if(!r->host[r->chunk]){uint32_t chunk_size=ZINK_RING_CHUNK,h=0;
        if(compute_resource(kind?GPU_UNIFORM_BUFFER:GPU_VERTEX_BUFFER,&chunk_size,4,&h)!=VK_SUCCESS)return NULL;r->host[r->chunk]=h;}
    r->used[r->chunk]=at+size;*host=r->host[r->chunk];*offset=at;
    return r->bytes+(size_t)r->chunk*ZINK_RING_CHUNK+at;
}
static int zink_ring_stage(unsigned kind,const unsigned char *src,uint32_t avail,uint32_t size,uint32_t *host,uint32_t *offset) {
    if(kind>1||avail>size||size>ZINK_RING_CHUNK||!size)return 0;
    for(unsigned n=0;n<zink_ring_entry_count;n++){const struct zink_ring_entry *e=&zink_ring_entries[n];
        if(e->kind==kind&&e->src==src&&e->avail==avail&&e->size==size){*host=e->host;*offset=e->offset;return 1;}}
    unsigned char *dst=zink_ring_alloc(kind,size,host,offset);if(!dst)return 0;
    memcpy(dst,src,avail);memset(dst+avail,0,size-avail);
    if(zink_ring_entry_count<sizeof(zink_ring_entries)/sizeof(zink_ring_entries[0]))
        zink_ring_entries[zink_ring_entry_count++]=(struct zink_ring_entry){src,avail,size,*host,*offset,kind};
    return 1;
}
static VkResult zink_ring_upload(void) {
    static unsigned char data[ZINK_RING_CHUNK+12];
    for(unsigned k=0;k<2;k++){struct zink_ring *r=&zink_rings[k];
        for(unsigned c=0;c<=r->chunk&&c<ZINK_RING_CHUNKS;c++)if(r->used[c]){
            uint32_t size=(r->used[c]+3)&~3u,header[3]={r->host[c],0,size};
            memcpy(data,header,12);memcpy(data+12,r->bytes+(size_t)c*ZINK_RING_CHUNK,size);
            if(host_empty(k?GPU_UNIFORM_UPLOAD:GPU_VERTEX_UPLOAD,data,size+12)!=VK_SUCCESS)return VK_ERROR_DEVICE_LOST;
        }}
    return VK_SUCCESS;
}
/* ---- B2g: indexed draws -----------------------------------------------
 * The host protocol draws non-indexed triangle lists. vkCmdDrawIndexed is
 * expanded at submit: each vertex binding is gathered through the current
 * index buffer bytes into the vertex ring with the pipeline's own stride (so
 * the host pipeline is unchanged) and drawn with vertexCount=indexCount,
 * firstVertex=0. A draw whose gathered stream exceeds one ring chunk is split
 * on triangle boundaries. Stride-0 bindings are staged once per piece. */
static uint32_t zink_attribute_span(const struct graphics_binding *layout) {
    uint32_t span=0;
    for(unsigned k=0;k<layout->count;k++){const VkVertexInputAttributeDescription *a=&layout->attributes[k];
        uint32_t end=a->offset+graphics_format_components(a->format)*4;if(end>span)span=end;}
    return span;
}
#include "primitive-assembly.h"
static uint32_t zink_index_piece(const struct graphics_pipeline *p,uint32_t count) {
    uint32_t stride=0;
    for(unsigned n=0;n<p->binding_count;n++)if(p->bindings[n].stride>stride)stride=p->bindings[n].stride;
    if(!stride)return count>65535u?65535u:count;
    if((uint64_t)count*stride<=ZINK_RING_CHUNK)return count;
    return ZINK_RING_CHUNK/stride/3*3;
}
/* Validate all source indices/attributes and all piece allocations before
 * creating ring resources. Nothing has been uploaded or rendered at this point. */
static int zink_source_vertex(const struct graphics_draw_record *r,uint32_t ordinal,int64_t *vertex) {
    if(!r->index_size){*vertex=(int64_t)r->first+ordinal;return 1;}
    struct resource *ib=resource_get(r->index_buffer,R_BUFFER),*im=ib?resource_get(ib->memory,R_MEMORY):NULL;
    unsigned size=r->index_size;
    if((size!=2&&size!=4)||!ib||!ib->generic||!(ib->usage&VK_BUFFER_USAGE_INDEX_BUFFER_BIT)||!im||!im->bytes||
       r->index_offset>ib->size||((uint64_t)r->first+r->count)*size>ib->size-r->index_offset||ordinal>=r->count)return 0;
    const unsigned char *src=im->bytes+ib->offset+r->index_offset+((size_t)r->first+ordinal)*size;
    uint32_t index;if(size==2){uint16_t v;memcpy(&v,src,2);index=v;}else memcpy(&index,src,4);
    *vertex=(int64_t)index+r->vertex_offset;return *vertex>=0;
}
static int zink_gather_preflight(const struct graphics_draw_record *r,const struct graphics_pipeline *p,uint32_t total,uint32_t piece) {
    if(!total||!piece||total%3||piece%3||p->vertex_index)return 0;
    unsigned chunk=zink_rings[0].chunk;uint32_t used=zink_rings[0].used[chunk];
    for(unsigned n=0;n<p->binding_count;n++) {
        const struct graphics_binding *l=&p->bindings[n];const struct graphics_vertex_ref *ref=&r->vertices[l->binding];
        struct resource *b=resource_get(ref->buffer,R_BUFFER),*m=b?resource_get(b->memory,R_MEMORY):NULL;
        uint32_t span=zink_attribute_span(l);
        if(!b||!(b->vertex||(b->generic&&(b->usage&VK_BUFFER_USAGE_VERTEX_BUFFER_BIT)))||!m||!m->bytes||
           ref->offset>=b->size||!span||(l->stride&&span>l->stride))return 0;
        uint64_t remaining=b->size-ref->offset;
        for(uint32_t k=0;k<r->count;k++){int64_t vertex;
            if(!zink_source_vertex(r,k,&vertex)||(uint64_t)vertex*l->stride+span>remaining)return 0;}
    }
    /* Match allocator ordering: each piece, then its sorted vertex bindings. */
    for(uint32_t start=0;start<total;start+=piece) {
        uint32_t count=total-start<piece?total-start:piece;
        for(unsigned n=0;n<p->binding_count;n++) {
            const struct graphics_binding *l=&p->bindings[n];uint64_t bytes=((uint64_t)(count-1)*l->stride+zink_attribute_span(l)+3)&~3ull;
            if(!bytes||bytes>ZINK_RING_CHUNK)return 0;
            if(used+bytes>ZINK_RING_CHUNK){if(++chunk>=ZINK_RING_CHUNKS)return 0;used=0;}
            used+=(uint32_t)bytes;
        }
    }
    return 1;
}
static int zink_gather_indexed(const struct graphics_draw_record *r,const struct graphics_pipeline *p,uint32_t start,uint32_t count,struct graphics_json *j) {
    const int fan=p->topology==VK_PRIMITIVE_TOPOLOGY_TRIANGLE_FAN;
    const uint32_t total=guest_primitive_count(fan,r->count);
    if(!count||count%3||start>total||count>total-start)return 0;
    for(unsigned n=0;n<p->binding_count;n++) {
        const struct graphics_binding *layout=&p->bindings[n];const struct graphics_vertex_ref *binding=&r->vertices[layout->binding];
        struct resource *b=resource_get(binding->buffer,R_BUFFER),*m=b?resource_get(b->memory,R_MEMORY):NULL;
        const uint32_t span=zink_attribute_span(layout),stride=layout->stride;
        if(!b||!m||!m->bytes||binding->offset>=b->size)return 0;
        const unsigned char *src=m->bytes+b->offset+binding->offset;const uint64_t remaining=b->size-binding->offset;
        uint32_t host=0,offset=0,bytes=(uint32_t)(((uint64_t)(count-1)*stride+span+3)&~3ull);
        unsigned char *dst=bytes<=ZINK_RING_CHUNK?zink_ring_alloc(0,bytes,&host,&offset):NULL;
        if(!dst)return 0;
        memset(dst,0,bytes);
        for(uint32_t k=0;k<count;k++) {int64_t vertex;
            const uint32_t ordinal=guest_primitive_ordinal(fan,live->host_last_provoking,start+k);
            if(!zink_source_vertex(r,ordinal,&vertex)||(uint64_t)vertex*stride+span>remaining)return 0;
            memcpy(dst+(size_t)k*stride,src+(size_t)vertex*stride,span);
        }
        graphics_json_append(j,"%s{\"buffer\":%u,\"offset\":%u,\"size\":%u}",n?",":"",host,offset,bytes);
    }
    return !j->bad;
}
static VKAPI_ATTR void VKAPI_CALL zink_bind_index_buffer(VkCommandBuffer cb,VkBuffer buffer,VkDeviceSize offset,VkIndexType type) {
    SELECT_CB(cb);
    if(cb!=&command||command.state!=2)return;
    struct resource *b=resource_get(RID(buffer),R_BUFFER);
    unsigned size=type==VK_INDEX_TYPE_UINT16?2u:type==VK_INDEX_TYPE_UINT32?4u:0u;
    if(!live->graphics_supported||!b||!b->generic||!(b->usage&VK_BUFFER_USAGE_INDEX_BUFFER_BIT)||!size||offset>=b->size||offset%size) {
        ZINK_TRACE("bind_index_buffer REJECT type=%d offset=%llu generic=%u usage=0x%x\n",(int)type,(unsigned long long)offset,
            b?b->generic:0u,b?(unsigned)b->usage:0u);invalid_command(cb);return;
    }
    command.graphics.index_buffer=b->id;command.graphics.index_offset=offset;command.graphics.index_size=size;
}
static VKAPI_ATTR void VKAPI_CALL zink_bind_index_buffer2(VkCommandBuffer cb,VkBuffer buffer,VkDeviceSize offset,VkDeviceSize size,VkIndexType type) {
    (void)size;zink_bind_index_buffer(cb,buffer,offset,type); /* the submit-time bound check uses the whole buffer */
}
static VKAPI_ATTR void VKAPI_CALL zink_draw_indexed(VkCommandBuffer cb,uint32_t count,uint32_t instances,uint32_t first,int32_t vertex_offset,uint32_t first_instance) {
    SELECT_CB(cb);
    if(cb!=&command||command.state!=2)return;
    if(!command.graphics.index_size){ZINK_TRACE("draw_indexed REJECT no index buffer\n");invalid_command(cb);return;}
    struct recorded *r=draw_graphics_record(cb,count,instances,first,first_instance);
    if(r){r->graphics.draw.index_buffer=command.graphics.index_buffer;r->graphics.draw.index_offset=command.graphics.index_offset;
        r->graphics.draw.index_size=command.graphics.index_size;r->graphics.draw.vertex_offset=vertex_offset;}
}
static void zink_cleanup(void) {
    if(zink_null_ubo_host&&live&&!live->failed)(void)host_empty(GPU_DESTROY,&zink_null_ubo_host,4);
    zink_null_ubo_host=0;
    for(unsigned k=0;k<2;k++){struct zink_ring *r=&zink_rings[k];
        for(unsigned c=0;c<ZINK_RING_CHUNKS;c++)if(r->host[c]&&live&&!live->failed)(void)host_empty(GPU_DESTROY,&r->host[c],4);
        free(r->bytes);memset(r,0,sizeof(*r));}
    zink_ring_entry_count=0;
}

/* ---- timeline semaphores ------------------------------------------------- */
static VKAPI_ATTR VkResult VKAPI_CALL zink_get_semaphore_counter_value(VkDevice d,VkSemaphore h,uint64_t *value) {
    struct sync_object *s=device_valid(d)&&live->timeline?sync_get(RID(h),S_SEMAPHORE):NULL;
    if(!s||!s->timeline||!value)return VK_ERROR_INITIALIZATION_FAILED;
    *value=s->value;return VK_SUCCESS;
}
static VKAPI_ATTR VkResult VKAPI_CALL zink_signal_semaphore(VkDevice d,const VkSemaphoreSignalInfo *i) {
    struct sync_object *s=device_valid(d)&&live->timeline&&i&&i->sType==VK_STRUCTURE_TYPE_SEMAPHORE_SIGNAL_INFO&&!i->pNext?
        sync_get(RID(i->semaphore),S_SEMAPHORE):NULL;
    if(!s||!s->timeline||i->value<=s->value)return VK_ERROR_INITIALIZATION_FAILED;
    s->value=i->value;return VK_SUCCESS;
}
/* Non-blocking: every submission completes synchronously, so a value that is
 * not reached now can only be reached by a later host signal; report TIMEOUT. */
static VKAPI_ATTR VkResult VKAPI_CALL zink_wait_semaphores(VkDevice d,const VkSemaphoreWaitInfo *i,uint64_t timeout) {
    (void)timeout;
    if(!device_valid(d)||!live->timeline||!i||i->sType!=VK_STRUCTURE_TYPE_SEMAPHORE_WAIT_INFO||i->pNext||
       (i->flags&~(VkSemaphoreWaitFlags)VK_SEMAPHORE_WAIT_ANY_BIT)||!i->semaphoreCount||!i->pSemaphores||!i->pValues)
        return VK_ERROR_INITIALIZATION_FAILED;
    unsigned reached=0;
    for(uint32_t n=0;n<i->semaphoreCount;n++) {
        struct sync_object *s=sync_get(RID(i->pSemaphores[n]),S_SEMAPHORE);
        if(!s||!s->timeline)return VK_ERROR_INITIALIZATION_FAILED;
        if(s->value>=i->pValues[n])reached++;
    }
    if(i->flags&VK_SEMAPHORE_WAIT_ANY_BIT)return reached?VK_SUCCESS:VK_TIMEOUT;
    return reached==i->semaphoreCount?VK_SUCCESS:VK_TIMEOUT;
}

/* ---- create_renderpass2: translate to the v1 bounded shape --------------- */
static VKAPI_ATTR VkResult VKAPI_CALL zink_create_render_pass2(VkDevice d,const VkRenderPassCreateInfo2 *i,const VkAllocationCallbacks *a,VkRenderPass *out) {
    if(!out)return VK_ERROR_INITIALIZATION_FAILED;
    *out=VK_NULL_HANDLE;
    if(!device_valid(d)||!i||a||i->sType!=VK_STRUCTURE_TYPE_RENDER_PASS_CREATE_INFO_2||i->pNext||i->flags||
       !i->attachmentCount||i->attachmentCount>2||!i->pAttachments||i->subpassCount!=1||!i->pSubpasses||
       i->dependencyCount>2||(i->dependencyCount&&!i->pDependencies)||i->correlatedViewMaskCount)return VK_ERROR_INITIALIZATION_FAILED;
    /* Single-subpass external dependencies are satisfied by in-order synchronous execution. */
    for(uint32_t n=0;n<i->dependencyCount;n++) {
        const VkSubpassDependency2 *x=&i->pDependencies[n];
        if(x->sType!=VK_STRUCTURE_TYPE_SUBPASS_DEPENDENCY_2||x->pNext||x->viewOffset||
           (x->srcSubpass!=VK_SUBPASS_EXTERNAL&&x->srcSubpass)||(x->dstSubpass!=VK_SUBPASS_EXTERNAL&&x->dstSubpass)||
           x->srcSubpass==x->dstSubpass)return VK_ERROR_FEATURE_NOT_PRESENT;
    }
    VkAttachmentDescription att[2];
    for(uint32_t n=0;n<i->attachmentCount;n++) {
        const VkAttachmentDescription2 *x=&i->pAttachments[n];
        if(x->sType!=VK_STRUCTURE_TYPE_ATTACHMENT_DESCRIPTION_2||x->pNext)return VK_ERROR_FEATURE_NOT_PRESENT;
        att[n]=(VkAttachmentDescription){x->flags,x->format,x->samples,x->loadOp,x->storeOp,x->stencilLoadOp,x->stencilStoreOp,x->initialLayout,x->finalLayout};
    }
    const VkSubpassDescription2 *s=&i->pSubpasses[0];
    if(s->sType!=VK_STRUCTURE_TYPE_SUBPASS_DESCRIPTION_2||s->pNext||s->viewMask||s->inputAttachmentCount||
       s->colorAttachmentCount!=1||!s->pColorAttachments||s->pResolveAttachments||s->preserveAttachmentCount)return VK_ERROR_FEATURE_NOT_PRESENT;
    const VkAttachmentReference2 *c=&s->pColorAttachments[0],*z=s->pDepthStencilAttachment;
    if(c->sType!=VK_STRUCTURE_TYPE_ATTACHMENT_REFERENCE_2||c->pNext||(c->aspectMask&&c->aspectMask!=VK_IMAGE_ASPECT_COLOR_BIT)||
       (z&&(z->sType!=VK_STRUCTURE_TYPE_ATTACHMENT_REFERENCE_2||z->pNext||(z->aspectMask&&z->aspectMask!=VK_IMAGE_ASPECT_DEPTH_BIT))))
        return VK_ERROR_FEATURE_NOT_PRESENT;
    VkAttachmentReference color={c->attachment,c->layout},depth=z?(VkAttachmentReference){z->attachment,z->layout}:(VkAttachmentReference){0,0};
    VkSubpassDescription sub={s->flags,s->pipelineBindPoint,0,NULL,1,&color,NULL,z?&depth:NULL,0,NULL};
    VkRenderPassCreateInfo v1={VK_STRUCTURE_TYPE_RENDER_PASS_CREATE_INFO,NULL,0,i->attachmentCount,att,1,&sub,0,NULL};
    return create_render_pass(d,&v1,NULL,out);
}
static VKAPI_ATTR void VKAPI_CALL zink_begin_render_pass2(VkCommandBuffer cb,const VkRenderPassBeginInfo *b,const VkSubpassBeginInfo *s) {
    SELECT_CB(cb);
    if(cb!=&command||command.state!=2)return;
    if(!s||s->sType!=VK_STRUCTURE_TYPE_SUBPASS_BEGIN_INFO||s->pNext){invalid_command(cb);return;}
    begin_graphics_pass(cb,b,s->contents);
}
static VKAPI_ATTR void VKAPI_CALL zink_next_subpass2(VkCommandBuffer cb,const VkSubpassBeginInfo *b,const VkSubpassEndInfo *e) {
    SELECT_CB(cb);
    (void)b;(void)e;invalid_command(cb); /* only single-subpass passes exist */
}
static VKAPI_ATTR void VKAPI_CALL zink_end_render_pass2(VkCommandBuffer cb,const VkSubpassEndInfo *e) {
    SELECT_CB(cb);
    if(cb!=&command||command.state!=2)return;
    if(!e||e->sType!=VK_STRUCTURE_TYPE_SUBPASS_END_INFO||e->pNext){invalid_command(cb);return;}
    end_graphics_pass(cb);
}

/* ---- dynamic rendering --------------------------------------------------- */
static VKAPI_ATTR void VKAPI_CALL zink_begin_rendering(VkCommandBuffer cb,const VkRenderingInfo *r) {
    SELECT_CB(cb);
    if(cb!=&command||command.state!=2)return;
    if(!live->graphics_supported||!live->dynamic_rendering||command.graphics.in_pass||!r||r->sType!=VK_STRUCTURE_TYPE_RENDERING_INFO||
       r->pNext||r->flags||r->layerCount!=1||r->viewMask||r->colorAttachmentCount!=1||!r->pColorAttachments||
       (r->pStencilAttachment&&r->pStencilAttachment->imageView)){invalid_command(cb);return;}
    const VkRenderingAttachmentInfo *c=&r->pColorAttachments[0];
    struct resource *v=resource_get(RID(c->imageView),R_IMAGE_VIEW),*i=v?resource_get(v->graphics.view.image,R_IMAGE):NULL;
    if(c->sType!=VK_STRUCTURE_TYPE_RENDERING_ATTACHMENT_INFO||c->pNext||!i||!i->graphics_target||
       c->imageLayout!=VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL||c->resolveMode!=VK_RESOLVE_MODE_NONE||
       (c->loadOp!=VK_ATTACHMENT_LOAD_OP_CLEAR&&c->loadOp!=VK_ATTACHMENT_LOAD_OP_LOAD)||c->storeOp!=VK_ATTACHMENT_STORE_OP_STORE||
       r->renderArea.offset.x||r->renderArea.offset.y||r->renderArea.extent.width!=i->width||r->renderArea.extent.height!=i->height){invalid_command(cb);return;}
    ZINK_TRACE("begin_rendering load=%d %ux%u clear=%g,%g,%g,%g depth=%d\n",(int)c->loadOp,i->width,i->height,
        c->clearValue.color.float32[0],c->clearValue.color.float32[1],c->clearValue.color.float32[2],c->clearValue.color.float32[3],
        r->pDepthAttachment&&r->pDepthAttachment->imageView?1:0);
    struct graphics_begin_record b={0};
    b.pass=(struct graphics_pass){.format=image_color_format(i),.samples=VK_SAMPLE_COUNT_1_BIT,.load=c->loadOp,.store=c->storeOp,
        .initial=c->imageLayout,.final=c->imageLayout};
    b.view=v->id;b.depth_clear=1.0f;
    if(c->loadOp==VK_ATTACHMENT_LOAD_OP_CLEAR) {
        b.clear=c->clearValue.color;
        for(unsigned n=0;n<4;n++)if(!(b.clear.float32[n]>=0&&b.clear.float32[n]<=1)){invalid_command(cb);return;}
    }
    const VkRenderingAttachmentInfo *z=r->pDepthAttachment;
    if(z&&z->imageView) {
        struct resource *dv=resource_get(RID(z->imageView),R_IMAGE_VIEW),*di=dv?resource_get(dv->graphics.view.image,R_IMAGE):NULL;
        if(!live->depth_supported||z->sType!=VK_STRUCTURE_TYPE_RENDERING_ATTACHMENT_INFO||z->pNext||!di||!di->depth||
           z->imageLayout!=VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL||z->resolveMode!=VK_RESOLVE_MODE_NONE||
           (z->loadOp!=VK_ATTACHMENT_LOAD_OP_CLEAR&&z->loadOp!=VK_ATTACHMENT_LOAD_OP_LOAD&&z->loadOp!=VK_ATTACHMENT_LOAD_OP_DONT_CARE)||
           (z->storeOp!=VK_ATTACHMENT_STORE_OP_STORE&&z->storeOp!=VK_ATTACHMENT_STORE_OP_DONT_CARE)){invalid_command(cb);return;}
        b.pass.depth_format=di->depth==1?VK_FORMAT_D32_SFLOAT:VK_FORMAT_D16_UNORM;
        b.pass.depth_load=z->loadOp;b.pass.depth_store=z->storeOp;b.pass.depth_initial=b.pass.depth_final=z->imageLayout;
        b.depth_view=dv->id;
        if(z->loadOp==VK_ATTACHMENT_LOAD_OP_CLEAR) {
            b.depth_clear=z->clearValue.depthStencil.depth;
            if(!(b.depth_clear>=0&&b.depth_clear<=1)){invalid_command(cb);return;}
        }
        if(!graphics_begin_depth(&b)){invalid_command(cb);return;}
    }
    if(!graphics_begin_image(&b)){invalid_command(cb);return;}
    struct recorded *rec=record_command(cb,C_GRAPHICS_BEGIN);
    if(rec){rec->graphics.begin=b;command.graphics.in_pass=1;}
}
static VKAPI_ATTR void VKAPI_CALL zink_end_rendering(VkCommandBuffer cb) {
    SELECT_CB(cb);
    if(cb!=&command||command.state!=2)return;
    end_graphics_pass(cb);
}

/* ---- descriptor update templates ----------------------------------------- */
/* Zink's gfx push template has one UBO entry per graphics stage (5), plus one
 * for fbfetch; per-type program sets stay within UNIFORM_SET_BINDINGS (8). */
#define ZINK_TEMPLATE_ENTRIES 8
static struct { unsigned count; VkDescriptorUpdateTemplateEntry e[ZINK_TEMPLATE_ENTRIES]; } zink_templates[MAX_RES];
static VKAPI_ATTR VkResult VKAPI_CALL zink_create_update_template(VkDevice d,const VkDescriptorUpdateTemplateCreateInfo *i,
        const VkAllocationCallbacks *a,VkDescriptorUpdateTemplate *out) {
    if(!out)return VK_ERROR_INITIALIZATION_FAILED;
    *out=VK_NULL_HANDLE;
    if(!device_valid(d)||!live->uniform_supported||!i||a||i->sType!=VK_STRUCTURE_TYPE_DESCRIPTOR_UPDATE_TEMPLATE_CREATE_INFO||i->pNext||i->flags||
       !i->descriptorUpdateEntryCount||i->descriptorUpdateEntryCount>ZINK_TEMPLATE_ENTRIES||!i->pDescriptorUpdateEntries||
       i->templateType!=VK_DESCRIPTOR_UPDATE_TEMPLATE_TYPE_DESCRIPTOR_SET||!resource_get(RID(i->descriptorSetLayout),R_SET_LAYOUT)){
        ZINK_TRACE("update_template REJECT entries=%u type=%d flags=0x%x pnext=%d\n",i?i->descriptorUpdateEntryCount:0,i?(int)i->templateType:-1,i?(unsigned)i->flags:0,i&&i->pNext);
        return VK_ERROR_INITIALIZATION_FAILED;}
    for(uint32_t n=0;n<i->descriptorUpdateEntryCount;n++) {
        const VkDescriptorUpdateTemplateEntry *e=&i->pDescriptorUpdateEntries[n];
        if(e->dstArrayElement||e->descriptorCount!=1||(e->descriptorType!=VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER&&
           e->descriptorType!=VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER)){
            ZINK_TRACE("update_template REJECT entry=%u binding=%u type=%d count=%u elem=%u\n",n,e->dstBinding,(int)e->descriptorType,e->descriptorCount,e->dstArrayElement);
            return VK_ERROR_FEATURE_NOT_PRESENT;}
    }
    struct resource *r=resource_new(R_UPDATE_TEMPLATE);if(!r)return VK_ERROR_OUT_OF_HOST_MEMORY;
    zink_templates[r-resources].count=i->descriptorUpdateEntryCount;
    memcpy(zink_templates[r-resources].e,i->pDescriptorUpdateEntries,i->descriptorUpdateEntryCount*sizeof(VkDescriptorUpdateTemplateEntry));
    *out=HANDLE(VkDescriptorUpdateTemplate,r->id);return VK_SUCCESS;
}
static VKAPI_ATTR void VKAPI_CALL zink_destroy_update_template(VkDevice d,VkDescriptorUpdateTemplate h,const VkAllocationCallbacks *a) {
    (void)a;struct resource *r=device_valid(d)?resource_get(RID(h),R_UPDATE_TEMPLATE):NULL;
    if(r){memset(&zink_templates[r-resources],0,sizeof(zink_templates[0]));resource_drop(r);}
}
/* Each entry becomes one VkWriteDescriptorSet on the A3/A4 update path. */
static VKAPI_ATTR void VKAPI_CALL zink_update_with_template(VkDevice d,VkDescriptorSet set,VkDescriptorUpdateTemplate h,const void *data) {
    struct resource *r=device_valid(d)?resource_get(RID(h),R_UPDATE_TEMPLATE):NULL;
    struct resource *s=resource_get(RID(set),R_DESC_SET);
    if(!r||!data){if(s){s->valid=0;s->graphics.set.written=0;}return;}
    for(unsigned n=0;n<zink_templates[r-resources].count;n++) {
        const VkDescriptorUpdateTemplateEntry *e=&zink_templates[r-resources].e[n];
        const unsigned char *p=(const unsigned char *)data+e->offset;
        VkWriteDescriptorSet w={VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET,NULL,set,e->dstBinding,0,1,e->descriptorType,NULL,NULL,NULL};
        if(e->descriptorType==VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER)w.pBufferInfo=(const VkDescriptorBufferInfo *)p;
        else w.pImageInfo=(const VkDescriptorImageInfo *)p;
        update_descriptor_sets(d,1,&w,0,NULL);
    }
}

/* ---- maintenance1 / maintenance5 small entry points ---------------------- */
static VKAPI_ATTR void VKAPI_CALL zink_trim_command_pool(VkDevice d,VkCommandPool p,VkCommandPoolTrimFlags f) {
    (void)d;(void)p;(void)f; /* single static command buffer: nothing to trim */
}
static VKAPI_ATTR void VKAPI_CALL zink_rendering_area_granularity(VkDevice d,const VkRenderingAreaInfoKHR *i,VkExtent2D *g) {
    (void)d;(void)i;if(g)*g=(VkExtent2D){1,1};
}

/* ---- B2f: core 1.0/1.1 entry points Zink loads at apiVersion 1.1 --------- */
static VKAPI_ATTR VkResult VKAPI_CALL zink_mapped_ranges(VkDevice d,uint32_t n,const VkMappedMemoryRange *r) {
    (void)d;(void)n;(void)r; return VK_SUCCESS; /* memory bytes stay guest-side and are read at submit */
}
static uint64_t zink_next_cache=0x7a000000;
static VKAPI_ATTR VkResult VKAPI_CALL zink_create_pipeline_cache(VkDevice d,const VkPipelineCacheCreateInfo *i,const VkAllocationCallbacks *a,VkPipelineCache *out) {
    (void)a; if(!device_valid(d)||!i||!out||i->sType!=VK_STRUCTURE_TYPE_PIPELINE_CACHE_CREATE_INFO)return VK_ERROR_INITIALIZATION_FAILED;
    *out=(VkPipelineCache)(uintptr_t)(++zink_next_cache); return VK_SUCCESS; /* empty cache: nothing is serialized */
}
static VKAPI_ATTR void VKAPI_CALL zink_destroy_pipeline_cache(VkDevice d,VkPipelineCache c,const VkAllocationCallbacks *a) {(void)d;(void)c;(void)a;}
static VKAPI_ATTR VkResult VKAPI_CALL zink_pipeline_cache_data(VkDevice d,VkPipelineCache c,size_t *size,void *data) {
    (void)d;(void)c;(void)data; if(size)*size=0; return VK_SUCCESS;
}
static VKAPI_ATTR VkResult VKAPI_CALL zink_merge_pipeline_caches(VkDevice d,VkPipelineCache c,uint32_t n,const VkPipelineCache *s) {(void)d;(void)c;(void)n;(void)s;return VK_SUCCESS;}
static VKAPI_ATTR void VKAPI_CALL zink_set_layout_support(VkDevice d,const VkDescriptorSetLayoutCreateInfo *i,VkDescriptorSetLayoutSupport *out) {
    if(!out)return; VkDescriptorSetLayout l=VK_NULL_HANDLE; /* answer by trying the real (bounded) create */
    out->supported=create_set_layout(d,i,NULL,&l)==VK_SUCCESS?VK_TRUE:VK_FALSE;
    if(l)destroy_set_layout(d,l,NULL);
    for(VkBaseOutStructure *e=out->pNext;e;e=e->pNext)if(e->sType==VK_STRUCTURE_TYPE_DESCRIPTOR_SET_VARIABLE_DESCRIPTOR_COUNT_LAYOUT_SUPPORT)
        ((VkDescriptorSetVariableDescriptorCountLayoutSupport *)e)->maxVariableDescriptorCount=0;
    if(!out->supported)ZINK_TRACE("set_layout_support -> unsupported bindings=%u\n",i?i->bindingCount:0);
}
static void zink_no_dedicated(void *next) {
    for(VkBaseOutStructure *e=next;e;e=e->pNext)if(e->sType==VK_STRUCTURE_TYPE_MEMORY_DEDICATED_REQUIREMENTS){
        VkMemoryDedicatedRequirements *r=(VkMemoryDedicatedRequirements *)e;r->prefersDedicatedAllocation=VK_FALSE;r->requiresDedicatedAllocation=VK_FALSE;}
}
static VKAPI_ATTR void VKAPI_CALL zink_buffer_requirements2(VkDevice d,const VkBufferMemoryRequirementsInfo2 *i,VkMemoryRequirements2 *out) {
    if(!i||!out)return; buffer_requirements(d,i->buffer,&out->memoryRequirements); zink_no_dedicated(out->pNext);
}
static VKAPI_ATTR void VKAPI_CALL zink_image_requirements2(VkDevice d,const VkImageMemoryRequirementsInfo2 *i,VkMemoryRequirements2 *out) {
    if(!i||!out)return; if(i->pNext){ZINK_TRACE("image_requirements2 REJECT pNext\n");memset(&out->memoryRequirements,0,sizeof(out->memoryRequirements));return;}
    image_requirements(d,i->image,&out->memoryRequirements); zink_no_dedicated(out->pNext);
}
static VKAPI_ATTR VkResult VKAPI_CALL zink_bind_buffer2(VkDevice d,uint32_t n,const VkBindBufferMemoryInfo *b) {
    for(uint32_t k=0;k<n;k++){if(!b||b[k].pNext)return VK_ERROR_INITIALIZATION_FAILED;VkResult r=bind_buffer(d,b[k].buffer,b[k].memory,b[k].memoryOffset);if(r!=VK_SUCCESS)return r;}
    return VK_SUCCESS;
}
static VKAPI_ATTR VkResult VKAPI_CALL zink_bind_image2(VkDevice d,uint32_t n,const VkBindImageMemoryInfo *b) {
    for(uint32_t k=0;k<n;k++){if(!b||b[k].pNext)return VK_ERROR_INITIALIZATION_FAILED;VkResult r=bind_image(d,b[k].image,b[k].memory,b[k].memoryOffset);if(r!=VK_SUCCESS)return r;}
    return VK_SUCCESS;
}
/* B2c: Mesa 26 Zink binds vertex buffers only through vkCmdBindVertexBuffers2
 * (core 1.3 / EXT_extended_dynamic_state), even with no dynamic state. Before
 * this entry point existed Zink's void() not-loaded stub trapped in wasm
 * (call_indirect signature mismatch). Sizes are advisory; dynamic strides are
 * not supported (the pipeline stride applies) and NULL slots are rejected. */
static VKAPI_ATTR void VKAPI_CALL zink_bind_vertex_buffers2(VkCommandBuffer cb,uint32_t first,uint32_t count,const VkBuffer *buffers,
        const VkDeviceSize *offsets,const VkDeviceSize *sizes,const VkDeviceSize *strides) {
    (void)sizes;
    if(strides){ZINK_TRACE("bind_vertex_buffers2 REJECT dynamic strides\n");invalid_command(cb);return;}
    for(uint32_t n=0;buffers&&n<count;n++)if(!buffers[n]){ZINK_TRACE("bind_vertex_buffers2 REJECT null slot %u\n",first+n);invalid_command(cb);return;}
    for(uint32_t n=0;buffers&&n<count;n++){struct resource *b=resource_get(RID(buffers[n]),R_BUFFER);
        if(b&&b->generic&&!(b->usage&VK_BUFFER_USAGE_VERTEX_BUFFER_BIT))ZINK_TRACE("bind_vertex_buffers2 REJECT generic buffer usage=0x%x\n",(unsigned)b->usage);}
    bind_vertex_buffers(cb,first,count,buffers,offsets);
}
static VKAPI_ATTR void VKAPI_CALL zink_memory_commitment(VkDevice d,VkDeviceMemory m,VkDeviceSize *out) {(void)d;(void)m;if(out)*out=0;}

/* ---- B2d: Zink graphics pipelines ----------------------------------------
 * Mesa 26 Zink (zink_pipeline.c zink_create_gfx_pipeline) builds every
 * pipeline the same way: SPIR-V inline (module NULL + VkShaderModuleCreateInfo
 * in the stage pNext, maintenance5), dynamic VIEWPORT/SCISSOR/LINE_WIDTH/
 * DEPTH_BIAS/BLEND_CONSTANTS/STENCIL_REFERENCE, depthBiasEnable=TRUE with zero
 * factors, a non-NULL sample mask and a depth-stencil state even without a
 * depth attachment. This adapter normalises that shape onto the bounded A1-A6
 * create_graphics_pipelines: temporary shader modules (descriptor Binding
 * decorations remapped like HOST_BINDING), a placeholder static viewport with
 * the real one taken from vkCmdSetViewport/Scissor at draw time, and the
 * fixed-state equivalents. Anything with an effect the host cannot reproduce
 * is rejected with a trace instead of being approximated. */
static unsigned zink_depth_bias_traced; /* nonzero depth bias seen (traced once) */
/* Is word k of instruction `at` (opcode op) an id operand that may name a
 * global variable? Debug/annotation/type/constant instructions and the
 * OpExtInst instruction number carry literals and are skipped; any other
 * match counts as a use (a coincident literal only causes a traced reject). */
static int zink_spirv_may_use(unsigned op,unsigned k) {
    if(op<=39||op==43||op==50||(op>=71&&op<=75))return 0;
    return !(op==12&&k==4);
}
/* Rewrites SPIR-V for the host profile and returns the new word count
 * (0 = unsupported): descriptor Binding decorations go through
 * zink_host_binding; PushConstant variables (Zink's gfx_pushconst block,
 * declared by every shader) are removed together with their names,
 * decorations and entry-point interface slots when nothing reads them; and
 * fragment outputs at Location >= 1 are removed with their stores. The host
 * has one colour attachment, and Vulkan discards outputs without one; Zink
 * lowers GLES2 gl_FragColor to writes of all eight gl_FragData outputs.
 * Uniform buffers then go through zink_rewrite_ubos. */
#define ZINK_SPIRV_DROP_VARS 16
static size_t zink_rewrite_ubos(uint32_t **pw,size_t count);
static size_t zink_remap_spirv(uint32_t **pw,size_t count) {
    uint32_t *w=*pw;
    if(count<5||w[0]!=0x07230203)return 0;
    uint32_t drop[ZINK_SPIRV_DROP_VARS];unsigned drops=0,pushes;
    uint32_t outputs[ZINK_SPIRV_DROP_VARS];unsigned output_count=0;int fragment=0;
    for(size_t at=5;at<count;) {
        unsigned length=w[at]>>16,op=w[at]&65535;
        if(!length||length>count-at)return 0;
        if(op==71&&length==4&&w[at+2]==33) { /* OpDecorate target Binding n */
            int b=zink_host_binding(w[at+3]);
            if(b<0){ZINK_TRACE("pipeline REJECT shader binding %u has no host slot\n",w[at+3]);return 0;}
            w[at+3]=(uint32_t)b;
        }
        if(op==15&&length>=3&&w[at+1]==4)fragment=1;
        if(op==59&&length>=4&&w[at+3]==9) { /* OpVariable StorageClass PushConstant */
            if(drops==ZINK_SPIRV_DROP_VARS)return 0;
            drop[drops++]=w[at+2];
        }
        at+=length;
    }
    pushes=drops;
    if(fragment)for(size_t at=5;at<count;at+=w[at]>>16) { /* OpDecorate var Location n>=1 */
        unsigned length=w[at]>>16,op=w[at]&65535;
        if(op==71&&length==4&&w[at+2]==30&&w[at+3]>=1&&output_count<ZINK_SPIRV_DROP_VARS)outputs[output_count++]=w[at+1];
    }
    for(size_t at=5;at<count&&output_count;at+=w[at]>>16) { /* ...that is an Output variable */
        unsigned length=w[at]>>16,op=w[at]&65535;
        if(op==59&&length>=4&&w[at+3]==3)for(unsigned v=0;v<output_count;v++)if(outputs[v]==w[at+2]){
            if(drops==ZINK_SPIRV_DROP_VARS)return 0;
            drop[drops++]=w[at+2];
        }
    }
    if(!drops)return zink_rewrite_ubos(pw,count);
    for(size_t at=5;at<count;at+=w[at]>>16) {
        unsigned length=w[at]>>16,op=w[at]&65535;
        if(op==15||op==59)continue; /* entry point interface / the definitions */
        for(unsigned k=1;k<length;k++)if(zink_spirv_may_use(op,k))for(unsigned v=0;v<drops;v++)if(w[at+k]==drop[v]){
            if(v>=pushes&&op==62&&k==1)continue; /* OpStore to a dropped output */
            ZINK_TRACE("pipeline REJECT %s %%%u used (op %u)\n",v<pushes?"push constant block":"extra fragment output",drop[v],op);return 0;}
    }
    size_t o=5;
    for(size_t at=5;at<count;) {
        unsigned length=w[at]>>16,op=w[at]&65535,skip_instruction=0;
        for(unsigned v=0;v<drops;v++)
            if((op==59&&w[at+2]==drop[v])||((op==5||op==71||op==62)&&length>=2&&w[at+1]==drop[v]))skip_instruction=1;
        if(skip_instruction){at+=length;continue;}
        if(op==15&&length>=4) { /* OpEntryPoint model id name... interface... */
            unsigned k=3;while(k<length&&(w[at+k]>>24))k++; /* last name word has a zero top byte */
            k++;
            size_t head=o;
            for(unsigned n=0;n<length;n++) {
                int skip=0;
                if(n>=k)for(unsigned v=0;v<drops;v++)if(w[at+n]==drop[v])skip=1;
                if(!skip)w[o++]=w[at+n];
            }
            w[head]=(uint32_t)((o-head)<<16)|op;at+=length;continue;
        }
        if(o!=at)memmove(&w[o],&w[at],length*4);
        o+=length;at+=length;
    }
    return zink_rewrite_ubos(pw,o);
}
/* Zink declares every uniform buffer as a 32-bit word view, an Aliased
 * `array[1] of Block struct { uint[N] (stride 4) }` (`uniform_0@32` for the GL
 * default block), and reads it one uint at a time through access chains. The
 * host profile only accepts a block struct of vec4<f32> arrays (WGSL/GLSL
 * uniform arrays need a 16-byte stride). Each such variable keeps its id,
 * descriptor set and binding but is re-declared as `Block struct { vec4[ceil(N/4)]
 * stride 16 }`; element access chains become `[0][i>>2][i&3]` over float, and
 * each uint load becomes a float load plus OpBitcast (same bits; only moves,
 * no float arithmetic, touch them). Intermediate chains (array[1] / struct /
 * uint[N] pointers) are dropped. Other uses of those pointers are rejected. */
#define ZINK_UBO_VARS 16
#define ZINK_UBO_MAX_WORDS 4096
enum {ZU_NONE,ZU_ARRAY,ZU_STRUCT,ZU_WORDS,ZU_ELEMENT};
static size_t zink_rewrite_ubos(uint32_t **pw,size_t count) {
    uint32_t *w=*pw,bound=w[3];
    if(bound<2||bound>(1u<<20))return 0;
    struct {uint32_t var,type,words,m,cm,arr,st,ptr;int wrapped;} ubo[ZINK_UBO_VARS];unsigned ubos=0;
    uint32_t *info=calloc((size_t)bound*4,sizeof *info); /* per id: kind/a/b/c */
    uint8_t *level=calloc(bound,1);uint8_t *owner=calloc(bound,1);
    uint32_t *element=calloc(bound,sizeof *element);
    uint8_t need[ZINK_UBO_MAX_WORDS/4+4]={0};
    uint32_t *out=NULL;size_t o=0,result=0;
    if(!info||!level||!owner||!element)goto done;
    enum {K_INT32=1,K_FLOAT32,K_VEC4F,K_CONST,K_ARRAY,K_STRUCT1,K_PTR_UNIFORM};
#define ZI(id,f) info[(size_t)(id)*4+(f)]
    uint32_t f32=0,v4f=0,u32=0;
    for(size_t at=5;at<count;at+=w[at]>>16) {
        unsigned length=w[at]>>16,op=w[at]&65535;
        if(op==21&&length==4&&w[at+1]<bound&&w[at+2]==32){ZI(w[at+1],0)=K_INT32;if(!w[at+3]&&!u32)u32=w[at+1];}
        else if(op==22&&length==3&&w[at+1]<bound&&w[at+2]==32){ZI(w[at+1],0)=K_FLOAT32;if(!f32)f32=w[at+1];}
        else if(op==23&&length==4&&w[at+1]<bound&&w[at+3]==4&&f32&&w[at+2]==f32){if(!v4f)v4f=w[at+1];}
        else if(op==43&&length==4&&w[at+2]<bound&&w[at+1]<bound&&ZI(w[at+1],0)==K_INT32){ZI(w[at+2],0)=K_CONST;ZI(w[at+2],1)=w[at+3];}
        else if(op==28&&length==4&&w[at+1]<bound&&w[at+3]<bound&&ZI(w[at+3],0)==K_CONST){ZI(w[at+1],0)=K_ARRAY;ZI(w[at+1],1)=w[at+2];ZI(w[at+1],2)=ZI(w[at+3],1);}
        else if(op==30&&length==3&&w[at+1]<bound){ZI(w[at+1],0)=K_STRUCT1;ZI(w[at+1],1)=w[at+2];}
        else if(op==32&&length==4&&w[at+1]<bound&&w[at+2]==2){ZI(w[at+1],0)=K_PTR_UNIFORM;ZI(w[at+1],1)=w[at+3];}
        else if(op==59&&length==4&&w[at+3]==2&&w[at+1]<bound&&w[at+2]<bound&&ZI(w[at+1],0)==K_PTR_UNIFORM) {
            uint32_t pointee=ZI(w[at+1],1),block=pointee;int wrapped=0;
            if(pointee>=bound)continue;
            if(ZI(pointee,0)==K_ARRAY&&ZI(pointee,2)==1){block=ZI(pointee,1);wrapped=1;}
            if(block>=bound||ZI(block,0)!=K_STRUCT1)continue;
            uint32_t words=ZI(block,1);
            if(words>=bound||ZI(words,0)!=K_ARRAY||ZI(words,1)>=bound||ZI(ZI(words,1),0)!=K_INT32)continue;
            uint32_t n=ZI(words,2);
            if(!n||n>ZINK_UBO_MAX_WORDS){ZINK_TRACE("spirv REJECT uniform %%%u words=%u\n",w[at+2],n);goto done;}
            if(ubos==ZINK_UBO_VARS)goto done;
            ubo[ubos].var=w[at+2];ubo[ubos].type=ZI(words,1);ubo[ubos].words=n;ubo[ubos].m=(n+3)/4;ubo[ubos].wrapped=wrapped;
            level[w[at+2]]=wrapped?ZU_ARRAY:ZU_STRUCT;owner[w[at+2]]=(uint8_t)ubos;ubos++;
        }
    }
    if(!ubos){result=count;goto done;}
    if(!u32){ZINK_TRACE("spirv REJECT uniform rewrite without uint32 type\n");goto done;}
    /* Pass 2: classify access chains and loads; anything else touching a
     * rewritten pointer is rejected. */
    unsigned extra=0; /* new instructions inside functions */
    need[0]=need[2]=need[3]=1;
    for(size_t at=5;at<count;at+=w[at]>>16) {
        unsigned length=w[at]>>16,op=w[at]&65535;
        if((op==65||op==66)&&length>=4&&w[at+3]<bound&&level[w[at+3]]) {
            uint32_t res=w[at+2];unsigned lv=level[w[at+3]];uint32_t el=0;
            if(res>=bound)goto done;
            for(unsigned k=4;k<length;k++) {
                uint32_t idx=w[at+k];int constant=idx<bound&&ZI(idx,0)==K_CONST;
                if(lv==ZU_ARRAY)lv=ZU_STRUCT;
                else if(lv==ZU_STRUCT){if(!constant||ZI(idx,1)){ZINK_TRACE("spirv REJECT uniform member index\n");goto done;}lv=ZU_WORDS;}
                else if(lv==ZU_WORDS){lv=ZU_ELEMENT;el=idx;
                    if(constant){uint32_t v=ZI(idx,1);if(v>=ubo[owner[w[at+3]]].words){ZINK_TRACE("spirv REJECT uniform index %u\n",v);goto done;}need[v/4]=1;}
                    else extra+=10;}
                else {ZINK_TRACE("spirv REJECT uniform chain too deep\n");goto done;}
            }
            level[res]=(uint8_t)lv;owner[res]=owner[w[at+3]];element[res]=el;
            if(lv==ZU_ELEMENT)extra+=4;
            continue;
        }
        if(op==61&&length>=4&&w[at+3]<bound&&level[w[at+3]]) {
            if(level[w[at+3]]!=ZU_ELEMENT||w[at+1]>=bound||ZI(w[at+1],0)!=K_INT32){ZINK_TRACE("spirv REJECT uniform load of a non-element\n");goto done;}
            extra+=4;continue;
        }
        if(op==59||op==15)continue;
        for(unsigned k=1;k<length;k++)if(zink_spirv_may_use(op,k)&&w[at+k]<bound&&level[w[at+k]]){
            ZINK_TRACE("spirv REJECT uniform pointer %%%u used by op %u\n",w[at+k],op);goto done;}
    }
    for(unsigned u=0;u<ubos;u++)need[ubo[u].m]=1;
    /* New ids. */
    uint32_t next=bound,cid[ZINK_UBO_MAX_WORDS/4+4]={0},pf;
    uint32_t new_f32=f32?0:(f32=next++),new_v4f=v4f?0:(v4f=next++);
    for(unsigned v=0;v<sizeof need;v++)if(need[v])cid[v]=next++;
    for(unsigned u=0;u<ubos;u++){ubo[u].cm=cid[ubo[u].m];ubo[u].arr=next++;ubo[u].st=next++;ubo[u].ptr=next++;}
    pf=next++;
    size_t cap=count+extra+16*ubos+3*(sizeof need)+16;
    out=malloc(cap*4);if(!out)goto done;
    memcpy(out,w,20);out[3]=next;o=5;
    int annotated=0,declared=0;
#define ZE(...) do{const uint32_t ins_[]={__VA_ARGS__};if(o+sizeof ins_/4>cap)goto done;memcpy(&out[o],ins_,sizeof ins_);o+=sizeof ins_/4;}while(0)
    for(size_t at=5;at<count;) {
        unsigned length=w[at]>>16,op=w[at]&65535;
        if(!annotated&&((op>=19&&op<=39)||(op>=41&&op<=46)||op==59||op==54)) {
            annotated=1;
            for(unsigned u=0;u<ubos;u++) {
                ZE(4u<<16|71,ubo[u].arr,6,16);       /* ArrayStride 16 */
                ZE(3u<<16|71,ubo[u].st,2);           /* Block */
                ZE(5u<<16|72,ubo[u].st,0,35,0);      /* member 0 Offset 0 */
            }
        }
        if(op==54&&!declared) {
            declared=1;
            if(new_f32)ZE(3u<<16|22,new_f32,32);
            if(new_v4f)ZE(4u<<16|23,new_v4f,f32,4);
            for(unsigned v=0;v<sizeof need;v++)if(need[v])ZE(4u<<16|43,u32,cid[v],v);
            for(unsigned u=0;u<ubos;u++) {
                ZE(4u<<16|28,ubo[u].arr,v4f,ubo[u].cm);
                ZE(3u<<16|30,ubo[u].st,ubo[u].arr);
                ZE(4u<<16|32,ubo[u].ptr,2,ubo[u].st);
                ZE(4u<<16|59,ubo[u].ptr,ubo[u].var,2);
            }
            ZE(4u<<16|32,pf,2,f32);
        }
        if(op==59&&length==4&&w[at+2]<bound&&level[w[at+2]]&&(level[w[at+2]]==ZU_ARRAY||level[w[at+2]]==ZU_STRUCT)&&ubo[owner[w[at+2]]].var==w[at+2]){at+=length;continue;}
        if((op==65||op==66)&&length>=4&&w[at+3]<bound&&level[w[at+3]]) {
            uint32_t res=w[at+2];
            if(level[res]==ZU_ELEMENT) {
                uint32_t idx=element[res],var=ubo[owner[res]].var,q,r;
                if(idx<bound&&ZI(idx,0)==K_CONST){q=cid[ZI(idx,1)/4];r=cid[ZI(idx,1)%4];}
                else {
                    if(!cid[2]||!cid[3])goto done;
                    q=next++;r=next++;out[3]=next;
                    ZE(5u<<16|194,u32,q,idx,cid[2]);   /* OpShiftRightLogical */
                    ZE(5u<<16|199,u32,r,idx,cid[3]);   /* OpBitwiseAnd */
                }
                ZE(7u<<16|65,pf,res,var,cid[0],q,r);
            }
            at+=length;continue;
        }
        if(op==61&&length>=4&&w[at+3]<bound&&level[w[at+3]]==ZU_ELEMENT) {
            uint32_t value=next++;out[3]=next;
            if(o+length+4>cap)goto done;
            out[o++]=w[at];out[o++]=f32;out[o++]=value;
            for(unsigned k=3;k<length;k++)out[o++]=w[at+k];
            ZE(4u<<16|124,w[at+1],w[at+2],value); /* OpBitcast */
            at+=length;continue;
        }
        if(o+length>cap)goto done;
        memcpy(&out[o],&w[at],length*4);o+=length;at+=length;
    }
#undef ZE
#undef ZI
    if(!declared)goto done;
    free(*pw);*pw=out;out=NULL;result=o;
    ZINK_TRACE("spirv uniform rewrite vars=%u words=%zu->%zu\n",ubos,count,result);
done:
    free(out);free(info);free(level);free(owner);free(element);
    return result;
}
static void zink_trace_spirv(const char *stage,const uint32_t *w,size_t count) {
    if(!zink_trace_enabled())return;
    fprintf(stderr,"GUEST_VK_TRACE spirv %s words=%zu\n",stage,count);
    for(size_t at=0;at<count;at+=16) {
        fprintf(stderr,"GUEST_VK_SPIRV %s %05zu",stage,at);
        for(size_t k=at;k<count&&k<at+16;k++)fprintf(stderr," %08x",w[k]);
        fputc('\n',stderr);
    }
}
/* B2g: Vulkan takes varying interpolation (Flat/NoPerspective/Centroid/
 * Sample) from the fragment input alone; WGSL/GLSL ES require the vertex
 * output to match. Zink decorates only the fragment side (GL flat shading),
 * so the vertex module is re-created with the fragment's decorations on the
 * outputs at the same Location. Returns the new word count (0 = unchanged or
 * unsupported; *out is malloc'd only on success). */
#define ZINK_VARYINGS 32
static unsigned zink_interp_bit(uint32_t decoration) {
    return decoration==14?1u:decoration==13?2u:decoration==16?4u:decoration==17?8u:0u;
}
static unsigned zink_varyings(const uint32_t *w,size_t count,uint32_t storage,uint32_t *vars,uint32_t *locations,unsigned *masks) {
    unsigned n=0;
    for(size_t at=5;at<count&&w[at]>>16;at+=w[at]>>16)
        if((w[at]&65535)==59&&(w[at]>>16)>=4&&w[at+3]==storage&&n<ZINK_VARYINGS){vars[n]=w[at+2];locations[n]=~0u;masks[n]=0;n++;}
    for(size_t at=5;at<count&&w[at]>>16;at+=w[at]>>16) {
        unsigned length=w[at]>>16;
        if((w[at]&65535)!=71||length<3)continue;
        for(unsigned v=0;v<n;v++)if(vars[v]==w[at+1]) {
            if(w[at+2]==30&&length==4)locations[v]=w[at+3];
            else masks[v]|=zink_interp_bit(w[at+2]);
        }
    }
    return n;
}
static size_t zink_match_interpolation(const uint32_t *vw,size_t vcount,const uint32_t *fw,size_t fcount,uint32_t **out) {
    uint32_t vv[ZINK_VARYINGS],vl[ZINK_VARYINGS],fv[ZINK_VARYINGS],fl[ZINK_VARYINGS];unsigned vm[ZINK_VARYINGS],fm[ZINK_VARYINGS],want[ZINK_VARYINGS];
    const unsigned vn=zink_varyings(vw,vcount,3,vv,vl,vm),fn=zink_varyings(fw,fcount,1,fv,fl,fm);
    unsigned changed=0,added=0;
    for(unsigned v=0;v<vn;v++) {
        want[v]=vm[v];
        if(vl[v]==~0u)continue;
        for(unsigned f=0;f<fn;f++)if(fl[f]==vl[v])want[v]=fm[f];
        if(want[v]!=vm[v])changed=1;
        for(unsigned b=1;b<16;b<<=1)added+=!!(want[v]&b);
    }
    if(!changed)return 0;
    uint32_t *w=malloc((vcount+added*3)*4);if(!w)return 0;
    size_t o=0;int inserted=0;
    memcpy(w,vw,5*4);o=5;
    for(size_t at=5;at<vcount;) {
        unsigned length=vw[at]>>16,op=vw[at]&65535,skip=0;
        if(!length||length>vcount-at){free(w);return 0;}
        if(op==71&&!inserted) {
            for(unsigned v=0;v<vn;v++)for(unsigned b=1,d;b<16;b<<=1)
                if(want[v]&b){d=b==1?14:b==2?13:b==4?16:17;w[o++]=(3u<<16)|71;w[o++]=vv[v];w[o++]=d;}
            inserted=1;
        }
        if(op==71&&length==3&&zink_interp_bit(vw[at+2]))for(unsigned v=0;v<vn;v++)if(vv[v]==vw[at+1])skip=1;
        if(!skip){memcpy(&w[o],&vw[at],length*4);o+=length;}
        at+=length;
    }
    if(!inserted){free(w);return 0;}
    *out=w;return o;
}
static VKAPI_ATTR VkResult VKAPI_CALL zink_create_graphics_pipelines(VkDevice d,VkPipelineCache cache,uint32_t count,
        const VkGraphicsPipelineCreateInfo *i,const VkAllocationCallbacks *a,VkPipeline *out) {
    (void)cache; /* zink_create_pipeline_cache handles are empty placeholders */
    if(!out||count!=1||!i||a||i->stageCount!=2||!i->pStages){if(out&&count)*out=VK_NULL_HANDLE;
        ZINK_TRACE("pipeline REJECT count=%u a=%p i=%p\n",count,(const void *)a,(const void *)i);
        if(i){const uint32_t *w=(const uint32_t *)i;ZINK_TRACE("pipeline REJECT ci words %08x %08x %08x %08x %08x %08x %08x %08x %08x %08x %08x %08x %08x %08x %08x %08x %08x %08x %08x\n",
            w[0],w[1],w[2],w[3],w[4],w[5],w[6],w[7],w[8],w[9],w[10],w[11],w[12],w[13],w[14],w[15],w[16],w[17],w[18]);}return VK_ERROR_INITIALIZATION_FAILED;}
    *out=VK_NULL_HANDLE;
    VkGraphicsPipelineCreateInfo c=*i;c.flags&=~(VkPipelineCreateFlags)VK_PIPELINE_CREATE_DISABLE_OPTIMIZATION_BIT;
    /* Zink zero-initialises the create info: base index 0 without the
     * DERIVATIVE flag means "no base", which this ICD spells -1. */
    if(!c.basePipelineHandle&&!(c.flags&VK_PIPELINE_CREATE_DERIVATIVE_BIT))c.basePipelineIndex=-1;
    ZINK_TRACE("pipeline ci flags=0x%x base=%d tess=%d layout=%llu pass=%llu subpass=%u\n",(unsigned)c.flags,c.basePipelineIndex,
        c.pTessellationState!=NULL,(unsigned long long)c.layout,(unsigned long long)c.renderPass,c.subpass);
    /* Dynamic state: only the six fixed Zink states (no extended dynamic state is advertised). */
    unsigned dynamic=0;
    if(i->pDynamicState) {
        const VkPipelineDynamicStateCreateInfo *ds=i->pDynamicState;
        if(ds->sType!=VK_STRUCTURE_TYPE_PIPELINE_DYNAMIC_STATE_CREATE_INFO||ds->pNext||ds->flags||(ds->dynamicStateCount&&!ds->pDynamicStates)){
            ZINK_TRACE("pipeline REJECT dynamic state info\n");return VK_ERROR_FEATURE_NOT_PRESENT;}
        for(uint32_t n=0;n<ds->dynamicStateCount;n++)switch(ds->pDynamicStates[n]) {
            case VK_DYNAMIC_STATE_VIEWPORT:dynamic|=1;break;
            case VK_DYNAMIC_STATE_SCISSOR:dynamic|=2;break;
            case VK_DYNAMIC_STATE_LINE_WIDTH:case VK_DYNAMIC_STATE_DEPTH_BIAS:
            case VK_DYNAMIC_STATE_BLEND_CONSTANTS:case VK_DYNAMIC_STATE_STENCIL_REFERENCE:break;
            default:ZINK_TRACE("pipeline REJECT dynamic state %d\n",(int)ds->pDynamicStates[n]);return VK_ERROR_FEATURE_NOT_PRESENT;
        }
        if(dynamic&&dynamic!=3){ZINK_TRACE("pipeline REJECT viewport/scissor not both dynamic\n");return VK_ERROR_FEATURE_NOT_PRESENT;}
        c.pDynamicState=NULL;
    }
    static const VkViewport placeholder_viewport={0,0,1,1,0,1};
    static const VkRect2D placeholder_scissor={{0,0},{1,1}};
    VkPipelineViewportStateCreateInfo viewport;
    if(dynamic&&i->pViewportState) {
        viewport=*i->pViewportState;
        if(viewport.viewportCount!=1||viewport.scissorCount!=1){ZINK_TRACE("pipeline REJECT viewports=%u scissors=%u\n",viewport.viewportCount,viewport.scissorCount);
            return VK_ERROR_FEATURE_NOT_PRESENT;}
        viewport.pViewports=&placeholder_viewport;viewport.pScissors=&placeholder_scissor;c.pViewportState=&viewport;
    }
    /* depthBiasEnable with zero constant/slope factors and a dynamic bias: the
     * bias values come from vkCmdSetDepthBias, which must keep them zero. */
    VkPipelineRasterizationStateCreateInfo raster;
    if(i->pRasterizationState) {
        raster=*i->pRasterizationState;
        if(raster.depthBiasEnable&&!raster.depthBiasConstantFactor&&!raster.depthBiasSlopeFactor&&!raster.depthBiasClamp)raster.depthBiasEnable=VK_FALSE;
        if(raster.cullMode==VK_CULL_MODE_NONE)raster.frontFace=VK_FRONT_FACE_COUNTER_CLOCKWISE; /* no effect without culling */
        if(raster.lineWidth!=1)ZINK_TRACE("pipeline note lineWidth=%g\n",(double)raster.lineWidth);
        c.pRasterizationState=&raster;
        ZINK_TRACE("pipeline raster clamp=%u discard=%u poly=%d cull=%u front=%d bias=%u pNext=%d\n",raster.depthClampEnable,
            raster.rasterizerDiscardEnable,(int)raster.polygonMode,(unsigned)raster.cullMode,(int)raster.frontFace,raster.depthBiasEnable,raster.pNext!=NULL);
    }
    VkPipelineMultisampleStateCreateInfo samples;
    if(i->pMultisampleState) {
        samples=*i->pMultisampleState;
        if(samples.pSampleMask&&(samples.pSampleMask[0]&1u))samples.pSampleMask=NULL; /* one sample: bit 0 is the whole mask */
        c.pMultisampleState=&samples;
    }
    /* A disabled depth-stencil state without a depth attachment has no effect. */
    const VkPipelineRenderingCreateInfo *rendering=i->pNext&&!i->renderPass?i->pNext:NULL;
    VkFormat depth_format=rendering&&rendering->sType==VK_STRUCTURE_TYPE_PIPELINE_RENDERING_CREATE_INFO?rendering->depthAttachmentFormat:VK_FORMAT_UNDEFINED;
    if(i->renderPass){struct resource *pass=resource_get(RID(i->renderPass),R_RENDER_PASS);if(pass)depth_format=pass->graphics.pass.depth_format;}
    const VkPipelineDepthStencilStateCreateInfo *dss=i->pDepthStencilState;
    if(dss&&!depth_format) {
        if(dss->depthTestEnable||dss->depthWriteEnable||dss->stencilTestEnable||dss->depthBoundsTestEnable){
            ZINK_TRACE("pipeline REJECT depth/stencil state enabled without a depth attachment\n");return VK_ERROR_FEATURE_NOT_PRESENT;}
        c.pDepthStencilState=NULL;
    }
    const VkPipelineColorBlendStateCreateInfo *blend=i->pColorBlendState;
    if(blend)ZINK_TRACE("pipeline blend attachments=%u logic=%u enable=%u mask=0x%x topology=%d vbindings=%u vattrs=%u\n",blend->attachmentCount,blend->logicOpEnable,
        blend->attachmentCount&&blend->pAttachments?blend->pAttachments[0].blendEnable:0,blend->attachmentCount&&blend->pAttachments?blend->pAttachments[0].colorWriteMask:0,
        i->pInputAssemblyState?(int)i->pInputAssemblyState->topology:-1,i->pVertexInputState?i->pVertexInputState->vertexBindingDescriptionCount:0,
        i->pVertexInputState?i->pVertexInputState->vertexAttributeDescriptionCount:0);
    /* Inline SPIR-V -> temporary modules with host binding numbers. */
    VkPipelineShaderStageCreateInfo stages[2];VkShaderModule temp[2]={VK_NULL_HANDLE,VK_NULL_HANDLE};
    VkResult result=VK_SUCCESS;
    for(unsigned n=0;n<2;n++) {
        stages[n]=i->pStages[n];
        const VkShaderModuleCreateInfo *inline_code=stages[n].pNext;
        if(stages[n].module)continue;
        if(!inline_code||inline_code->sType!=VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO||inline_code->pNext||!inline_code->pCode||
           inline_code->codeSize<20||inline_code->codeSize>65536||inline_code->codeSize%4){
            ZINK_TRACE("pipeline REJECT stage %u inline code\n",n);result=VK_ERROR_INITIALIZATION_FAILED;break;}
        uint32_t *words=malloc(inline_code->codeSize);if(!words){result=VK_ERROR_OUT_OF_HOST_MEMORY;break;}
        memcpy(words,inline_code->pCode,inline_code->codeSize);
        const char *name=stages[n].stage==VK_SHADER_STAGE_VERTEX_BIT?"vs":stages[n].stage==VK_SHADER_STAGE_FRAGMENT_BIT?"fs":"other";
        size_t words_count=zink_remap_spirv(&words,inline_code->codeSize/4);
        if(!words_count){free(words);result=VK_ERROR_FEATURE_NOT_PRESENT;break;}
        zink_trace_spirv(name,words,words_count);
        VkShaderModuleCreateInfo info={VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO,NULL,0,words_count*4,words};
        result=create_shader(d,&info,NULL,&temp[n]);free(words);
        if(result!=VK_SUCCESS){ZINK_TRACE("pipeline REJECT %s shader module result=%d (host translation)\n",name,(int)result);break;}
        stages[n].module=temp[n];stages[n].pNext=NULL;
    }
    for(unsigned n=0;n<2&&result==VK_SUCCESS;n++)if(stages[n].stage==VK_SHADER_STAGE_VERTEX_BIT) {
        struct resource *vs=resource_get(RID(stages[n].module),R_SHADER),*fs=resource_get(RID(stages[!n].module),R_SHADER);
        uint32_t *words=NULL;size_t words_count;VkShaderModule patched=VK_NULL_HANDLE;
        if(!vs||!fs||!vs->bytes||!fs->bytes||!(words_count=zink_match_interpolation((const uint32_t *)vs->bytes,vs->size/4,(const uint32_t *)fs->bytes,fs->size/4,&words)))break;
        zink_trace_spirv("vs-interp",words,words_count);
        VkShaderModuleCreateInfo info={VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO,NULL,0,words_count*4,words};
        result=create_shader(d,&info,NULL,&patched);free(words);
        if(result!=VK_SUCCESS){ZINK_TRACE("pipeline REJECT interpolation-matched vs result=%d\n",(int)result);break;}
        if(temp[n])destroy_shader(d,temp[n],NULL);
        temp[n]=patched;stages[n].module=patched;
    }
    if(result==VK_SUCCESS) {
        c.pStages=stages;
        result=create_graphics_pipelines(d,VK_NULL_HANDLE,1,&c,NULL,out);
        if(result!=VK_SUCCESS)ZINK_TRACE("pipeline REJECT create_graphics_pipelines result=%d\n",(int)result);
        else if(dynamic){struct resource *r=resource_get(RID(*out),R_GRAPHICS_PIPELINE);if(r)r->graphics.pipeline.dynamic_viewport=1;}
    }
    for(unsigned n=0;n<2;n++)if(temp[n])destroy_shader(d,temp[n],NULL);
    return result;
}
/* Standalone modules get the same host rewrite as inline pipeline SPIR-V. */
static VKAPI_ATTR VkResult VKAPI_CALL zink_create_shader_module(VkDevice d,const VkShaderModuleCreateInfo *i,const VkAllocationCallbacks *a,VkShaderModule *out) {
    if(!i||i->sType!=VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO||!i->pCode||i->codeSize<20||i->codeSize>65536||i->codeSize%4)return create_shader(d,i,a,out);
    uint32_t *words=malloc(i->codeSize);if(!words){if(out)*out=VK_NULL_HANDLE;return VK_ERROR_OUT_OF_HOST_MEMORY;}
    memcpy(words,i->pCode,i->codeSize);
    size_t count=zink_remap_spirv(&words,i->codeSize/4);
    if(!count){free(words);if(out)*out=VK_NULL_HANDLE;return VK_ERROR_FEATURE_NOT_PRESENT;}
    zink_trace_spirv("module",words,count);
    VkShaderModuleCreateInfo info=*i;info.codeSize=count*4;info.pCode=words;
    VkResult result=create_shader(d,&info,a,out);free(words);
    if(result!=VK_SUCCESS)ZINK_TRACE("create_shader_module REJECT result=%d words=%zu\n",(int)result,count);
    return result;
}
static VKAPI_ATTR void VKAPI_CALL zink_set_viewport(VkCommandBuffer cb,uint32_t first,uint32_t count,const VkViewport *v) {
    SELECT_CB(cb);
    if(cb!=&command||command.state!=2)return;
    if(first||count!=1||!v){ZINK_TRACE("set_viewport REJECT first=%u count=%u\n",first,count);invalid_command(cb);return;}
    if(v->height<=0||v->width<=0||(live->webgl_backend&&(v->x!=(float)(int)v->x||v->y!=(float)(int)v->y||
       v->width!=(float)(int)v->width||v->height!=(float)(int)v->height))) {
        ZINK_TRACE("set_viewport REJECT %g,%g %gx%g depth %g..%g\n",(double)v->x,(double)v->y,(double)v->width,(double)v->height,(double)v->minDepth,(double)v->maxDepth);
        invalid_command(cb);return;
    }
    command.graphics.viewport=*v;command.graphics.dynamic_set|=1u;
}
static VKAPI_ATTR void VKAPI_CALL zink_set_scissor(VkCommandBuffer cb,uint32_t first,uint32_t count,const VkRect2D *s) {
    SELECT_CB(cb);
    if(cb!=&command||command.state!=2)return;
    if(first||count!=1||!s||s->offset.x<0||s->offset.y<0){ZINK_TRACE("set_scissor REJECT first=%u count=%u\n",first,count);invalid_command(cb);return;}
    command.graphics.scissor=*s;command.graphics.dynamic_set|=2u;
}
/* Fixed-function values the profile cannot express are only accepted at their
 * neutral settings (nonzero depth bias is rejected; line width only affects
 * lines, which the host does not draw; blend constants without blending and
 * a stencil reference without stencil have no effect). */
static VKAPI_ATTR void VKAPI_CALL zink_set_line_width(VkCommandBuffer cb,float w){(void)cb;(void)w;}
static VKAPI_ATTR void VKAPI_CALL zink_set_depth_bias(VkCommandBuffer cb,float c,float clamp,float slope) {
    if(c||clamp||slope){if(!zink_depth_bias_traced++)ZINK_TRACE("set_depth_bias REJECT %g %g %g\n",(double)c,(double)clamp,(double)slope);invalid_command(cb);}
}
static VKAPI_ATTR void VKAPI_CALL zink_set_blend_constants(VkCommandBuffer cb,const float c[4]){(void)cb;(void)c;}
static VKAPI_ATTR void VKAPI_CALL zink_set_stencil_reference(VkCommandBuffer cb,VkStencilFaceFlags f,uint32_t r){(void)cb;(void)f;(void)r;}

/* B2g: Zink recycles its descriptor pools (reset when a batch completes) and
 * frees sets on context teardown; without these every pool fills up. */
static VKAPI_ATTR VkResult VKAPI_CALL zink_reset_descriptor_pool(VkDevice d,VkDescriptorPool h,VkDescriptorPoolResetFlags f) {
    (void)f;struct resource *p=resource_get(RID(h),R_DESC_POOL);if(!device_valid(d)||!p)return VK_ERROR_INITIALIZATION_FAILED;
    for(unsigned n=0;n<MAX_RES;n++)if(resources[n].kind==R_DESC_SET&&resources[n].parent==p->id)resource_drop(&resources[n]);
    return VK_SUCCESS;
}
static VKAPI_ATTR VkResult VKAPI_CALL zink_free_descriptor_sets(VkDevice d,VkDescriptorPool h,uint32_t count,const VkDescriptorSet *sets) {
    struct resource *p=resource_get(RID(h),R_DESC_POOL);if(!device_valid(d)||!p||(count&&!sets))return VK_ERROR_INITIALIZATION_FAILED;
    for(uint32_t n=0;n<count;n++) {
        if(sets[n]==VK_NULL_HANDLE)continue;
        struct resource *s=resource_get(RID(sets[n]),R_DESC_SET);
        if(s&&s->parent==p->id)resource_drop(s);
    }
    return VK_SUCCESS;
}

static PFN_vkVoidFunction zink_proc(const char *name) {
#define Z(api,fn) if(!strcmp(name,#api))return (PFN_vkVoidFunction)fn;
    Z(vkFlushMappedMemoryRanges,zink_mapped_ranges) Z(vkInvalidateMappedMemoryRanges,zink_mapped_ranges)
    Z(vkCreatePipelineCache,zink_create_pipeline_cache) Z(vkDestroyPipelineCache,zink_destroy_pipeline_cache)
    Z(vkGetPipelineCacheData,zink_pipeline_cache_data) Z(vkMergePipelineCaches,zink_merge_pipeline_caches)
    Z(vkGetBufferMemoryRequirements2,zink_buffer_requirements2) Z(vkGetBufferMemoryRequirements2KHR,zink_buffer_requirements2)
    Z(vkGetImageMemoryRequirements2,zink_image_requirements2) Z(vkGetImageMemoryRequirements2KHR,zink_image_requirements2)
    Z(vkBindBufferMemory2,zink_bind_buffer2) Z(vkBindBufferMemory2KHR,zink_bind_buffer2)
    Z(vkBindImageMemory2,zink_bind_image2) Z(vkBindImageMemory2KHR,zink_bind_image2)
    Z(vkGetDeviceMemoryCommitment,zink_memory_commitment)
    Z(vkCmdBindVertexBuffers2,zink_bind_vertex_buffers2) Z(vkCmdBindVertexBuffers2EXT,zink_bind_vertex_buffers2)
    Z(vkCmdBindIndexBuffer,zink_bind_index_buffer) Z(vkCmdDrawIndexed,zink_draw_indexed)
    Z(vkCmdBindIndexBuffer2,zink_bind_index_buffer2) Z(vkCmdBindIndexBuffer2KHR,zink_bind_index_buffer2)
    Z(vkResetDescriptorPool,zink_reset_descriptor_pool) Z(vkFreeDescriptorSets,zink_free_descriptor_sets)
    Z(vkGetDescriptorSetLayoutSupport,zink_set_layout_support) Z(vkGetDescriptorSetLayoutSupportKHR,zink_set_layout_support)
    Z(vkCreateGraphicsPipelines,zink_create_graphics_pipelines) Z(vkCreateShaderModule,zink_create_shader_module)
    Z(vkCmdSetViewport,zink_set_viewport) Z(vkCmdSetScissor,zink_set_scissor) Z(vkCmdSetLineWidth,zink_set_line_width)
    Z(vkCmdSetDepthBias,zink_set_depth_bias) Z(vkCmdSetBlendConstants,zink_set_blend_constants) Z(vkCmdSetStencilReference,zink_set_stencil_reference)
    if(device_ext_enabled(VK_KHR_TIMELINE_SEMAPHORE_EXTENSION_NAME)) {
        Z(vkGetSemaphoreCounterValueKHR,zink_get_semaphore_counter_value) Z(vkGetSemaphoreCounterValue,zink_get_semaphore_counter_value)
        Z(vkSignalSemaphoreKHR,zink_signal_semaphore) Z(vkSignalSemaphore,zink_signal_semaphore)
        Z(vkWaitSemaphoresKHR,zink_wait_semaphores) Z(vkWaitSemaphores,zink_wait_semaphores)
    }
    if(device_ext_enabled(VK_KHR_CREATE_RENDERPASS_2_EXTENSION_NAME)) {
        Z(vkCreateRenderPass2KHR,zink_create_render_pass2) Z(vkCreateRenderPass2,zink_create_render_pass2)
        Z(vkCmdBeginRenderPass2KHR,zink_begin_render_pass2) Z(vkCmdBeginRenderPass2,zink_begin_render_pass2)
        Z(vkCmdNextSubpass2KHR,zink_next_subpass2) Z(vkCmdNextSubpass2,zink_next_subpass2)
        Z(vkCmdEndRenderPass2KHR,zink_end_render_pass2) Z(vkCmdEndRenderPass2,zink_end_render_pass2)
    }
    if(device_ext_enabled(VK_KHR_DYNAMIC_RENDERING_EXTENSION_NAME)) {
        Z(vkCmdBeginRenderingKHR,zink_begin_rendering) Z(vkCmdBeginRendering,zink_begin_rendering)
        Z(vkCmdEndRenderingKHR,zink_end_rendering) Z(vkCmdEndRendering,zink_end_rendering)
    }
    if(device_ext_enabled(VK_KHR_DESCRIPTOR_UPDATE_TEMPLATE_EXTENSION_NAME)) {
        Z(vkCreateDescriptorUpdateTemplateKHR,zink_create_update_template) Z(vkCreateDescriptorUpdateTemplate,zink_create_update_template)
        Z(vkDestroyDescriptorUpdateTemplateKHR,zink_destroy_update_template) Z(vkDestroyDescriptorUpdateTemplate,zink_destroy_update_template)
        Z(vkUpdateDescriptorSetWithTemplateKHR,zink_update_with_template) Z(vkUpdateDescriptorSetWithTemplate,zink_update_with_template)
    }
    if(device_ext_enabled(VK_KHR_MAINTENANCE1_EXTENSION_NAME)) {
        Z(vkTrimCommandPoolKHR,zink_trim_command_pool) Z(vkTrimCommandPool,zink_trim_command_pool)
    }
    if(device_ext_enabled(VK_KHR_MAINTENANCE_5_EXTENSION_NAME)) {
        Z(vkGetRenderingAreaGranularityKHR,zink_rendering_area_granularity)
    }
#undef Z
    return NULL;
}
