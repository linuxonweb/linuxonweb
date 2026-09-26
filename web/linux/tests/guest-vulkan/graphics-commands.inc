/* Copied graphics command state. The bounded submission preparer runs before
 * any upload, native pass, or mapped readback. No caller pointers survive a
 * recording call, and Vulkan binding numbers are normalized only at submit. */
static int graphics_pass_compatible(const struct graphics_pass *a,const struct graphics_pass *b) {
    /* Creation restricts both to the same single-color, single-subpass shape.
     * Load/store operations and initial/final layouts are not compatibility. */
    return a->format==b->format&&a->samples==b->samples;
}
static struct resource *graphics_framebuffer_image(uint64_t id,const struct graphics_pass *pass) {
    struct resource *f=resource_get(id,R_FRAMEBUFFER);
    if(!f||!graphics_pass_compatible(&f->graphics.framebuffer.pass,pass))return NULL;
    const struct graphics_framebuffer *fb=&f->graphics.framebuffer;
    struct resource *v=resource_get(fb->view,R_IMAGE_VIEW),*i=resource_get(fb->image,R_IMAGE);
    if(!v||v->graphics.view.image!=fb->image||!i||!i->graphics_target||!i->host||
       !resource_get(i->memory,R_MEMORY)||i->width!=fb->width||i->height!=fb->height)return NULL;
    return i;
}
static VKAPI_ATTR void VKAPI_CALL begin_graphics_pass(VkCommandBuffer cb,const VkRenderPassBeginInfo *info,VkSubpassContents contents) {
    if(cb!=&command||command.state!=2)return;
    if(!live->graphics_supported||command.graphics.in_pass||!info||info->sType!=VK_STRUCTURE_TYPE_RENDER_PASS_BEGIN_INFO||
       info->pNext||contents!=VK_SUBPASS_CONTENTS_INLINE){invalid_command(cb);return;}
    struct resource *p=resource_get(RID(info->renderPass),R_RENDER_PASS);
    struct resource *i=p?graphics_framebuffer_image(RID(info->framebuffer),&p->graphics.pass):NULL;
    if(!i||info->renderArea.offset.x||info->renderArea.offset.y||info->renderArea.extent.width!=i->width||
       info->renderArea.extent.height!=i->height||info->clearValueCount>1||
       (info->clearValueCount&&!info->pClearValues)||
       (p->graphics.pass.load==VK_ATTACHMENT_LOAD_OP_CLEAR&&info->clearValueCount!=1)){invalid_command(cb);return;}
    VkClearColorValue clear={{0}};
    if(p->graphics.pass.load==VK_ATTACHMENT_LOAD_OP_CLEAR) {
        clear=info->pClearValues[0].color;
        for(unsigned n=0;n<4;n++)if(!(clear.float32[n]>=0&&clear.float32[n]<=1)){invalid_command(cb);return;}
    }
    struct recorded *r=record_command(cb,C_GRAPHICS_BEGIN);
    if(r){r->graphics.begin=(struct graphics_begin_record){RID(info->framebuffer),p->graphics.pass,clear};command.graphics.in_pass=1;}
}
static VKAPI_ATTR void VKAPI_CALL end_graphics_pass(VkCommandBuffer cb) {
    if(cb!=&command||command.state!=2)return;
    if(!command.graphics.in_pass){invalid_command(cb);return;}
    if(record_command(cb,C_GRAPHICS_END))command.graphics.in_pass=0;
}
static VKAPI_ATTR void VKAPI_CALL bind_pipeline(VkCommandBuffer cb,VkPipelineBindPoint point,VkPipeline pipeline) {
    if(cb!=&command||command.state!=2)return;
    if(point==VK_PIPELINE_BIND_POINT_COMPUTE){bind_compute_pipeline(cb,point,pipeline);return;}
    if(!live->graphics_supported||point!=VK_PIPELINE_BIND_POINT_GRAPHICS||!resource_get(RID(pipeline),R_GRAPHICS_PIPELINE)) {
        invalid_command(cb);return;
    }
    command.graphics.pipeline=RID(pipeline);
}
static VKAPI_ATTR void VKAPI_CALL bind_vertex_buffers(VkCommandBuffer cb,uint32_t first,uint32_t count,const VkBuffer *buffers,const VkDeviceSize *offsets) {
    if(cb!=&command||command.state!=2)return;
    if(!live->graphics_supported||first>=8||!count||count>8-first||!buffers||!offsets){invalid_command(cb);return;}
    for(unsigned n=0;n<count;n++) {
        struct resource *b=resource_get(RID(buffers[n]),R_BUFFER);
        if(!b||!b->vertex||offsets[n]>=b->size||offsets[n]%4){invalid_command(cb);return;}
    }
    for(unsigned n=0;n<count;n++)command.graphics.vertices[first+n]=(struct graphics_vertex_ref){RID(buffers[n]),offsets[n]};
}
static VKAPI_ATTR void VKAPI_CALL draw_graphics(VkCommandBuffer cb,uint32_t count,uint32_t instances,uint32_t first,uint32_t first_instance) {
    if(cb!=&command||command.state!=2)return;
    if(!command.graphics.in_pass||!command.graphics.pipeline||count<3||count>65536||count%3||first>65536||instances!=1||first_instance) {
        invalid_command(cb);return;
    }
    struct recorded *r=record_command(cb,C_GRAPHICS_DRAW);
    if(r){r->graphics.draw.pipeline=command.graphics.pipeline;r->graphics.draw.count=count;r->graphics.draw.first=first;
        memcpy(r->graphics.draw.vertices,command.graphics.vertices,sizeof(r->graphics.draw.vertices));}
}
static int record_vertex_barrier(VkCommandBuffer cb,VkPipelineStageFlags src,VkPipelineStageFlags dst,const VkBufferMemoryBarrier *bb) {
    struct resource *b=resource_get(RID(bb->buffer),R_BUFFER);if(!b||!b->vertex)return 0;
    if(src!=VK_PIPELINE_STAGE_HOST_BIT||dst!=VK_PIPELINE_STAGE_VERTEX_INPUT_BIT||bb->srcAccessMask!=VK_ACCESS_HOST_WRITE_BIT||
       bb->dstAccessMask!=VK_ACCESS_VERTEX_ATTRIBUTE_READ_BIT||bb->sType!=VK_STRUCTURE_TYPE_BUFFER_MEMORY_BARRIER||bb->pNext||
       bb->srcQueueFamilyIndex!=VK_QUEUE_FAMILY_IGNORED||bb->dstQueueFamilyIndex!=VK_QUEUE_FAMILY_IGNORED||
       bb->offset||bb->size!=VK_WHOLE_SIZE){invalid_command(cb);return 1;}
    struct recorded *r=record_command(cb,C_VERTEX_BARRIER);if(r)r->buffer=b->id;return 1;
}
static int graphics_image_barrier(VkPipelineStageFlags src,VkPipelineStageFlags dst,const VkImageMemoryBarrier *b) {
    int color_destination=dst==VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT&&
        (b->dstAccessMask==VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT||
         b->dstAccessMask==(VK_ACCESS_COLOR_ATTACHMENT_READ_BIT|VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT));
    if(b->newLayout==VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL&&color_destination) {
        if(b->oldLayout==VK_IMAGE_LAYOUT_UNDEFINED&&src==VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT&&!b->srcAccessMask)return 1;
        if(b->oldLayout==VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL&&src==VK_PIPELINE_STAGE_TRANSFER_BIT&&b->srcAccessMask==VK_ACCESS_TRANSFER_READ_BIT)return 1;
        if(b->oldLayout==VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL&&src==VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT&&
           b->srcAccessMask==VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT&&
           b->dstAccessMask==(VK_ACCESS_COLOR_ATTACHMENT_READ_BIT|VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT))return 1;
    }
    return b->oldLayout==VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL&&b->newLayout==VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL&&
        src==VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT&&dst==VK_PIPELINE_STAGE_TRANSFER_BIT&&
        b->srcAccessMask==VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT&&b->dstAccessMask==VK_ACCESS_TRANSFER_READ_BIT;
}
static int graphics_prepare_begin(const struct graphics_begin_record *r,struct resource *image,struct graphics_json *j) {
    graphics_json_append(j,"{\"target\":%u,\"loadOp\":\"%s\",\"storeOp\":\"store\"",image->host,
        r->pass.load==VK_ATTACHMENT_LOAD_OP_CLEAR?"clear":"load");
    if(r->pass.load==VK_ATTACHMENT_LOAD_OP_CLEAR)graphics_json_append(j,",\"clearColor\":[%.9g,%.9g,%.9g,%.9g]",
        r->clear.float32[0],r->clear.float32[1],r->clear.float32[2],r->clear.float32[3]);
    graphics_json_append(j,",\"draws\":[");return !j->bad;
}
static int graphics_prepare_draw(const struct graphics_draw_record *r,const struct graphics_pass *pass,
        struct resource *image,struct graphics_json *j,unsigned draw_index,unsigned used[MAX_RES]) {
    struct resource *pipeline=resource_get(r->pipeline,R_GRAPHICS_PIPELINE);
    if(!pipeline||!pipeline->host||!graphics_pass_compatible(&pipeline->graphics.pipeline.pass,pass))return 0;
    const struct graphics_pipeline *p=&pipeline->graphics.pipeline;
    const VkViewport v=p->viewport;const VkRect2D s=p->scissor;
    if(!(v.x>=0&&v.y>=0&&v.width>0&&v.height>0&&v.x+v.width<=image->width&&v.y+v.height<=image->height&&
       v.minDepth>=0&&v.maxDepth<=1&&v.minDepth<=v.maxDepth)||s.offset.x<0||s.offset.y<0||
       (unsigned)s.offset.x>image->width||(unsigned)s.offset.y>image->height||
       s.extent.width>image->width-(unsigned)s.offset.x||s.extent.height>image->height-(unsigned)s.offset.y||
       r->count<3||r->count>65536||r->count%3||r->first>65536)return 0;
    graphics_json_append(j,"%s{\"pipeline\":%u,\"vertexBuffers\":[",draw_index?",":"",pipeline->host);
    for(unsigned n=0;n<p->binding_count;n++) {
        const struct graphics_binding *layout=&p->bindings[n];const struct graphics_vertex_ref *binding=&r->vertices[layout->binding];
        struct resource *b=resource_get(binding->buffer,R_BUFFER),*m=b?resource_get(b->memory,R_MEMORY):NULL;
        if(!b||!b->vertex||!b->host||!m||!m->bytes||binding->offset>=b->size||binding->offset%4)return 0;
        uint64_t remaining=b->size-binding->offset,last=(uint64_t)r->first+r->count-1;
        for(unsigned k=0;k<layout->count;k++) {
            const VkVertexInputAttributeDescription *a=&layout->attributes[k];
            if(last*layout->stride+a->offset+graphics_format_components(a->format)*4>remaining)return 0;
        }
        used[b-resources]=1;
        graphics_json_append(j,"%s{\"buffer\":%u,\"offset\":%u,\"size\":%u}",n?",":"",b->host,(unsigned)binding->offset,(unsigned)remaining);
    }
    graphics_json_append(j,"],\"vertexCount\":%u,\"firstVertex\":%u,\"instanceCount\":1,\"firstInstance\":0,"
        "\"viewport\":{\"x\":%.9g,\"y\":%.9g,\"width\":%.9g,\"height\":%.9g,\"minDepth\":%.9g,\"maxDepth\":%.9g},"
        "\"scissor\":{\"x\":%u,\"y\":%u,\"width\":%u,\"height\":%u}}",
        r->count,r->first,v.x,v.y,v.width,v.height,v.minDepth,v.maxDepth,
        (unsigned)s.offset.x,(unsigned)s.offset.y,s.extent.width,s.extent.height);
    return !j->bad;
}
static VkResult graphics_upload_vertices(const unsigned used[MAX_RES]) {
    /* Separate usage/memory bindings prohibit GPU writes or copy destinations
     * aliasing these buffers in this profile. One upload per used buffer per
     * submit observes coherent host writes made even after command recording. */
    unsigned char data[65548];
    for(unsigned n=0;n<MAX_RES;n++)if(used[n]) {
        struct resource *b=&resources[n],*m=resource_get(b->memory,R_MEMORY);
        uint32_t header[3]={b->host,0,(uint32_t)b->size};memcpy(data,header,12);memcpy(data+12,m->bytes,b->size);
        if(host_empty(GPU_VERTEX_UPLOAD,data,(uint32_t)b->size+12)!=VK_SUCCESS)return VK_ERROR_DEVICE_LOST;
    }
    return VK_SUCCESS;
}
