/* Direct-call experimental command profile, deliberately NOT a conformant ICD.
 * One primary command buffer; whole rgba8 images; synchronous submission only.
 * Handles are monotonically allocated IDs, never guest addresses. */
#define MAX_RES 32
#define MAX_CMDS 16
#if VK_USE_64_BIT_PTR_DEFINES
#define RID(h) ((uint64_t)(uintptr_t)(h))
#define HANDLE(type, id) ((type)(uintptr_t)(id))
#else
#define RID(h) ((uint64_t)(h))
#define HANDLE(type, id) ((type)(id))
#endif
enum resource_kind { R_IMAGE=1, R_BUFFER, R_MEMORY, R_SHADER, R_SET_LAYOUT, R_PIPELINE_LAYOUT, R_DESC_POOL, R_DESC_SET, R_COMPUTE_PIPELINE,
    R_IMAGE_VIEW, R_RENDER_PASS, R_FRAMEBUFFER, R_GRAPHICS_PIPELINE, R_SAMPLER };
/* Inline owned graphics snapshots contain no caller pointers. Binding array
 * order is the normalized host slot order; binding numbers remain Vulkan IDs. */
struct graphics_view { uint64_t image; };
struct graphics_pass { VkFormat format; VkSampleCountFlagBits samples; VkAttachmentLoadOp load; VkAttachmentStoreOp store; VkImageLayout initial, final;
    /* A5: optional depth attachment 1; depth_format==0 means colour-only. */
    VkFormat depth_format; VkAttachmentLoadOp depth_load; VkAttachmentStoreOp depth_store; VkImageLayout depth_initial, depth_final; };
struct graphics_framebuffer { uint64_t view, image; unsigned width,height; struct graphics_pass pass; uint64_t depth_view, depth_image; };
struct graphics_binding { unsigned binding,stride,count; VkVertexInputAttributeDescription attributes[8]; };
/* A3 uniform-buffer descriptor shapes: at most 4 sets x 4 single-descriptor
 * UNIFORM_BUFFER bindings (8 per pipeline layout), vertex/fragment stages. */
/* A4 adds single COMBINED_IMAGE_SAMPLER bindings (types[]) to the same shape. */
struct uniform_set_layout { unsigned count; uint32_t bindings[4]; VkShaderStageFlags stages[4]; VkDescriptorType types[4]; };
struct uniform_pipeline_layout { unsigned set_count; struct uniform_set_layout sets[4]; };
struct uniform_set { struct uniform_set_layout layout; unsigned written; uint64_t buffers[4]; uint32_t offsets[4], ranges[4]; uint64_t views[4], samplers[4]; };
struct graphics_pipeline { unsigned binding_count; struct graphics_binding bindings[8]; VkViewport viewport; VkRect2D scissor; struct graphics_pass pass;
    struct uniform_pipeline_layout uniforms; unsigned uniform_count; uint32_t min_sizes[8]; unsigned depth_test, depth_write; VkCompareOp depth_compare; };
struct resource { uint64_t id, memory, link, parent; unsigned kind, host, width, height, type, mapped, bound, storage, valid;
    unsigned vertex, uniform, graphics_target, graphics_layout, graphics_initialized, sampled, staging, sampler_capacity, depth; VkShaderStageFlagBits shader_stage;
    size_t size, range; unsigned char *bytes; VkImageLayout layout;
    union { struct graphics_view view; struct graphics_pass pass; struct graphics_framebuffer framebuffer; struct graphics_pipeline pipeline;
        struct uniform_set_layout set_layout; struct uniform_pipeline_layout layout; struct uniform_set set; } graphics;
};
static struct resource resources[MAX_RES];
static uint64_t next_resource = 1;
enum graphics_command_kind { C_GRAPHICS_BEGIN=9, C_GRAPHICS_DRAW, C_GRAPHICS_END, C_VERTEX_BARRIER, C_UNIFORM_BARRIER, C_TEXTURE_COPY };
struct graphics_vertex_ref { uint64_t buffer; VkDeviceSize offset; };
struct graphics_begin_record { uint64_t framebuffer; struct graphics_pass pass; VkClearColorValue clear; float depth_clear; };
struct graphics_draw_record { uint64_t pipeline; struct graphics_vertex_ref vertices[8]; uint32_t count, first; uint64_t sets[4]; };
struct recorded { unsigned op; uint64_t image, buffer, pipeline, set; VkDeviceSize offset; VkImageLayout old_layout, new_layout; VkClearColorValue color;
    union { struct graphics_begin_record begin; struct graphics_draw_record draw; } graphics;
};
struct graphics_command_state { unsigned in_pass; uint64_t pipeline; struct graphics_vertex_ref vertices[8]; uint64_t sets[4]; };
struct VkCommandBuffer_T { VK_LOADER_DATA loader; unsigned state, count; uint64_t pipeline, set, pipeline_layout;
    struct graphics_command_state graphics; struct recorded commands[MAX_CMDS]; };
static struct VkCommandBuffer_T command;
static uint64_t pool, next_pool = 1000000;
static unsigned resource_count;
static size_t allocated_bytes;
unsigned guest_vk_live_resources(void) {return resource_count;}
VkDeviceSize guest_vk_allocated_bytes(void) {return allocated_bytes;}
static struct resource *resource_get(uint64_t id, unsigned kind) {
    for (unsigned i=0;i<MAX_RES;i++) if (id && resources[i].id==id && resources[i].kind==kind) return &resources[i];
    return NULL;
}
static struct resource *resource_new(unsigned kind) {
    if (next_resource == UINT64_MAX) return NULL;
    for (unsigned i=0;i<MAX_RES;i++) if (!resources[i].id) {
        resources[i]=(struct resource){.id=next_resource++, .kind=kind}; resource_count++; return &resources[i];
    }
    return NULL;
}
static VkResult host_call(enum gpu_op op, const void *data, uint32_t size, void *reply, uint32_t capacity, uint32_t *received) {
    if (live->failed || gpu_call(&live->session,op,data,size,reply,capacity,received)) { live->failed=1; return VK_ERROR_DEVICE_LOST; }
    return VK_SUCCESS;
}
/* Compute/graphics resource requests retain recoverable validation/allocation status. Only a
 * broken transport or device-lost response poisons the session. */
static VkResult compute_call(enum gpu_op op,const void *data,uint32_t size,void *reply,uint32_t capacity,uint32_t *received) {
    if(live->failed)return VK_ERROR_DEVICE_LOST;
    int status=gpu_call(&live->session,op,data,size,reply,capacity,received);
    if(!status)return VK_SUCCESS;
    if(status==-22)return VK_ERROR_INITIALIZATION_FAILED;
    if(status==-12)return VK_ERROR_OUT_OF_DEVICE_MEMORY;
    live->failed=1;return VK_ERROR_DEVICE_LOST;
}
static VkResult compute_empty(enum gpu_op op,const void *data,uint32_t size) {
    unsigned char reply[512];uint32_t n=0;VkResult result=compute_call(op,data,size,reply,sizeof(reply),&n);
    if(result!=VK_SUCCESS)return result;
    if(n){live->failed=1;return VK_ERROR_DEVICE_LOST;}return VK_SUCCESS;
}
static VkResult compute_resource(enum gpu_op op,const void *data,uint32_t size,uint32_t *id) {
    unsigned char reply[512];uint32_t n=0;VkResult result=compute_call(op,data,size,reply,sizeof(reply),&n);
    if(result!=VK_SUCCESS)return result;
    if(n!=4){live->failed=1;return VK_ERROR_DEVICE_LOST;}
    memcpy(id,reply,4);if(!*id){live->failed=1;return VK_ERROR_DEVICE_LOST;}return VK_SUCCESS;
}
static VkResult host_empty(enum gpu_op op, const void *data, uint32_t size) {
    unsigned char reply[512]; uint32_t n=0;
    if (host_call(op,data,size,reply,sizeof(reply),&n)!=VK_SUCCESS || n) {live->failed=1; return VK_ERROR_DEVICE_LOST;}
    return VK_SUCCESS;
}
static void resource_drop(struct resource *r) {
    if (r->host && live && !live->failed) (void)host_empty(GPU_DESTROY,&r->host,4);
    struct resource *m=resource_get(r->memory,R_MEMORY); if (m && m->bound) m->bound--;
    if (r->kind==R_MEMORY) allocated_bytes-=r->size;
    free(r->bytes); memset(r,0,sizeof(*r)); resource_count--;
}
static void sync_cleanup(void);
static void transfer_cleanup(void) {
    sync_cleanup();
    for (unsigned i=0;i<MAX_RES;i++) if (resources[i].id && resources[i].kind!=R_MEMORY) resource_drop(&resources[i]);
    for (unsigned i=0;i<MAX_RES;i++) if (resources[i].id) resource_drop(&resources[i]);
    memset(&command,0,sizeof(command)); pool=0;
    printf("GUEST_VK_RESOURCES live=%u allocated_bytes=%zu\n",resource_count,allocated_bytes); fflush(stdout);
}
static VKAPI_ATTR void VKAPI_CALL memory_properties(VkPhysicalDevice p, VkPhysicalDeviceMemoryProperties *out) {
    if (!out) return;
    memset(out,0,sizeof(*out)); if (!physical_valid(p) || (!live->clear_supported && !live->compute_supported && !live->graphics_supported)) return;
    out->memoryHeapCount=1; out->memoryHeaps[0].size=1024*1024;
    out->memoryTypeCount=2; out->memoryTypes[0].propertyFlags=VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT;
    out->memoryTypes[1].propertyFlags=VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT|VK_MEMORY_PROPERTY_HOST_COHERENT_BIT;
}
/* A5 depth format code shared with the host DEPTH_TARGET request: 1=depth32float, 2=depth16unorm. */
static unsigned depth_code(VkFormat f) {return f==VK_FORMAT_D32_SFLOAT?1:f==VK_FORMAT_D16_UNORM?2:0;}
static VKAPI_ATTR VkResult VKAPI_CALL create_image(VkDevice d,const VkImageCreateInfo *i,const VkAllocationCallbacks *a,VkImage *out) {
    if (!out) return VK_ERROR_INITIALIZATION_FAILED;
    *out=VK_NULL_HANDLE;
    if (!device_valid(d)||!i||a||i->sType!=VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO||i->pNext||i->flags||
        i->imageType!=VK_IMAGE_TYPE_2D||!i->extent.width||!i->extent.height||
        i->extent.width>128||i->extent.height>128||i->extent.depth!=1||i->mipLevels!=1||i->arrayLayers!=1||
        i->samples!=VK_SAMPLE_COUNT_1_BIT||i->tiling!=VK_IMAGE_TILING_OPTIMAL||
        !((i->format==VK_FORMAT_R8G8B8A8_UNORM && ((live->clear_supported && i->usage==(VK_IMAGE_USAGE_TRANSFER_SRC_BIT|VK_IMAGE_USAGE_TRANSFER_DST_BIT)) ||
          (live->graphics_supported && i->usage==(VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT|VK_IMAGE_USAGE_TRANSFER_SRC_BIT)) ||
          (live->texture_supported && i->usage==(VK_IMAGE_USAGE_SAMPLED_BIT|VK_IMAGE_USAGE_TRANSFER_DST_BIT)))) ||
          (live->depth_supported && depth_code(i->format) && i->usage==VK_IMAGE_USAGE_DEPTH_STENCIL_ATTACHMENT_BIT))||
        i->sharingMode!=VK_SHARING_MODE_EXCLUSIVE||i->queueFamilyIndexCount||i->initialLayout!=VK_IMAGE_LAYOUT_UNDEFINED)
        return VK_ERROR_FORMAT_NOT_SUPPORTED;
    struct resource *r=resource_new(R_IMAGE); if (!r) return VK_ERROR_OUT_OF_HOST_MEMORY;
    r->width=i->extent.width;r->height=i->extent.height;r->size=(size_t)r->width*r->height*4;r->layout=VK_IMAGE_LAYOUT_UNDEFINED;
    r->graphics_target=(i->usage & VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT)!=0;r->sampled=(i->usage & VK_IMAGE_USAGE_SAMPLED_BIT)!=0;
    /* A5: depth images are host-only attachments; 4 or 2 bytes per texel is the
     * reported (never mapped) size. Contents are not readable by the guest. */
    r->depth=depth_code(i->format);if(r->depth==2)r->size=(size_t)r->width*r->height*2;
    *out=HANDLE(VkImage,r->id);return VK_SUCCESS;
}
static VKAPI_ATTR VkResult VKAPI_CALL create_buffer(VkDevice d,const VkBufferCreateInfo *i,const VkAllocationCallbacks *a,VkBuffer *out) {
    if (!out) return VK_ERROR_INITIALIZATION_FAILED;
    *out=VK_NULL_HANDLE;
    if (!device_valid(d)||!i||a||i->sType!=VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO||i->pNext||i->flags||
        !i->size||i->size>65536||(i->usage!=VK_BUFFER_USAGE_TRANSFER_DST_BIT &&
          !(live->compute_supported && i->usage==VK_BUFFER_USAGE_STORAGE_BUFFER_BIT && !(i->size%4)) &&
          !(live->graphics_supported && i->usage==VK_BUFFER_USAGE_VERTEX_BUFFER_BIT && !(i->size%4)) &&
          !(live->uniform_supported && i->usage==VK_BUFFER_USAGE_UNIFORM_BUFFER_BIT && !(i->size%16)) &&
          !(live->texture_supported && i->usage==VK_BUFFER_USAGE_TRANSFER_SRC_BIT && !(i->size%4)))||
        i->sharingMode!=VK_SHARING_MODE_EXCLUSIVE||i->queueFamilyIndexCount) return VK_ERROR_FEATURE_NOT_PRESENT;
    struct resource *r=resource_new(R_BUFFER);if (!r) return VK_ERROR_OUT_OF_HOST_MEMORY;
    r->size=(size_t)i->size;r->storage=i->usage==VK_BUFFER_USAGE_STORAGE_BUFFER_BIT;r->vertex=i->usage==VK_BUFFER_USAGE_VERTEX_BUFFER_BIT;
    r->uniform=i->usage==VK_BUFFER_USAGE_UNIFORM_BUFFER_BIT;r->staging=i->usage==VK_BUFFER_USAGE_TRANSFER_SRC_BIT;
    *out=HANDLE(VkBuffer,r->id);return VK_SUCCESS;
}
static VKAPI_ATTR void VKAPI_CALL destroy_image(VkDevice d,VkImage h,const VkAllocationCallbacks *a) {
    (void)a;struct resource *r=resource_get(RID(h),R_IMAGE);if (device_valid(d)&&r) resource_drop(r);
}
static VKAPI_ATTR void VKAPI_CALL destroy_buffer(VkDevice d,VkBuffer h,const VkAllocationCallbacks *a) {
    (void)a;struct resource *r=resource_get(RID(h),R_BUFFER);if (device_valid(d)&&r) resource_drop(r);
}
static void requirements(VkDevice d,uint64_t id,unsigned kind,VkMemoryRequirements *out) {
    if (!out) return;
    memset(out,0,sizeof(*out));struct resource *r=resource_get(id,kind);
    if (device_valid(d)&&r) {out->size=r->size;out->alignment=kind==R_BUFFER&&r->uniform?256:4;out->memoryTypeBits=kind==R_IMAGE?1:2;}
}
static VKAPI_ATTR void VKAPI_CALL image_requirements(VkDevice d,VkImage h,VkMemoryRequirements *out) {requirements(d,RID(h),R_IMAGE,out);}
static VKAPI_ATTR void VKAPI_CALL buffer_requirements(VkDevice d,VkBuffer h,VkMemoryRequirements *out) {requirements(d,RID(h),R_BUFFER,out);}
static VKAPI_ATTR VkResult VKAPI_CALL allocate_memory(VkDevice d,const VkMemoryAllocateInfo *i,const VkAllocationCallbacks *a,VkDeviceMemory *out) {
    if (!out) return VK_ERROR_INITIALIZATION_FAILED;
    *out=VK_NULL_HANDLE;
    if (!device_valid(d)||!i||a||i->sType!=VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO||i->pNext||
        !i->allocationSize||i->allocationSize>65536||i->memoryTypeIndex>1||i->allocationSize>1024*1024-allocated_bytes) return VK_ERROR_OUT_OF_DEVICE_MEMORY;
    struct resource *r=resource_new(R_MEMORY); if (!r) return VK_ERROR_OUT_OF_HOST_MEMORY;
    r->size=(size_t)i->allocationSize;r->type=i->memoryTypeIndex;allocated_bytes+=r->size;
    if (r->type==1 && !(r->bytes=calloc(1,r->size))) {resource_drop(r);return VK_ERROR_OUT_OF_HOST_MEMORY;}
    *out=HANDLE(VkDeviceMemory,r->id);return VK_SUCCESS;
}
static VKAPI_ATTR void VKAPI_CALL free_memory(VkDevice d,VkDeviceMemory h,const VkAllocationCallbacks *a) {
    (void)a;struct resource *r=resource_get(RID(h),R_MEMORY);
    if (device_valid(d)&&r&&!r->bound) resource_drop(r);
}
static VkResult bind_memory(VkDevice d,uint64_t id,unsigned kind,VkDeviceMemory h,VkDeviceSize offset) {
    struct resource *r=resource_get(id,kind),*m=resource_get(RID(h),R_MEMORY);
    if (!device_valid(d)||!r||!m||offset||r->memory||m->bound||m->size<r->size||m->type!=(kind==R_BUFFER)) return VK_ERROR_INITIALIZATION_FAILED;
    if (kind==R_IMAGE) {
        uint32_t dimensions[2]={r->width,r->height};
        if (r->depth) {uint32_t d3[3]={r->width,r->height,r->depth};VkResult result=compute_resource(GPU_DEPTH_TARGET,d3,12,&r->host);if(result!=VK_SUCCESS)return result;}
        else if (r->graphics_target) {VkResult result=compute_resource(GPU_GRAPHICS_TARGET,dimensions,8,&r->host);if(result!=VK_SUCCESS)return result;}
        else if (r->sampled) {VkResult result=compute_resource(GPU_TEXTURE,dimensions,8,&r->host);if(result!=VK_SUCCESS)return result;}
        else if (live->failed||gpu_resource(&live->session,GPU_TARGET,dimensions,8,&r->host)) {live->failed=1;return VK_ERROR_DEVICE_LOST;}
    }
    if(kind==R_BUFFER && r->storage) {uint32_t size=(uint32_t)r->size;VkResult result=compute_resource(GPU_STORAGE_BUFFER,&size,4,&r->host);if(result!=VK_SUCCESS)return result;}
    if(kind==R_BUFFER && r->vertex) {uint32_t size=(uint32_t)r->size;VkResult result=compute_resource(GPU_VERTEX_BUFFER,&size,4,&r->host);if(result!=VK_SUCCESS)return result;}
    if(kind==R_BUFFER && r->uniform) {uint32_t size=(uint32_t)r->size;VkResult result=compute_resource(GPU_UNIFORM_BUFFER,&size,4,&r->host);if(result!=VK_SUCCESS)return result;}
    r->memory=m->id;m->bound++;return VK_SUCCESS;
}
static VKAPI_ATTR VkResult VKAPI_CALL bind_image(VkDevice d,VkImage h,VkDeviceMemory m,VkDeviceSize o) {return bind_memory(d,RID(h),R_IMAGE,m,o);}
static VKAPI_ATTR VkResult VKAPI_CALL bind_buffer(VkDevice d,VkBuffer h,VkDeviceMemory m,VkDeviceSize o) {return bind_memory(d,RID(h),R_BUFFER,m,o);}
static VKAPI_ATTR VkResult VKAPI_CALL map_memory(VkDevice d,VkDeviceMemory h,VkDeviceSize o,VkDeviceSize size,VkMemoryMapFlags flags,void **out) {
    if (!out) return VK_ERROR_MEMORY_MAP_FAILED;
    *out=NULL;struct resource *m=resource_get(RID(h),R_MEMORY);
    if (!device_valid(d)||!m||m->type!=1||m->mapped||flags||o>=m->size||
        (size!=VK_WHOLE_SIZE&&(!size||size>m->size-o))) return VK_ERROR_MEMORY_MAP_FAILED;
    m->mapped=1;*out=m->bytes+(size_t)o;return VK_SUCCESS;
}
static VKAPI_ATTR void VKAPI_CALL unmap_memory(VkDevice d,VkDeviceMemory h) {struct resource *m=resource_get(RID(h),R_MEMORY);if(device_valid(d)&&m)m->mapped=0;}
static VKAPI_ATTR VkResult VKAPI_CALL create_pool(VkDevice d,const VkCommandPoolCreateInfo *i,const VkAllocationCallbacks *a,VkCommandPool *out) {
    if (!out) return VK_ERROR_INITIALIZATION_FAILED;
    *out=VK_NULL_HANDLE;
    if (!device_valid(d)||!i||a||pool||i->sType!=VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO||i->pNext||
        i->queueFamilyIndex||i->flags!=VK_COMMAND_POOL_CREATE_RESET_COMMAND_BUFFER_BIT) return VK_ERROR_INITIALIZATION_FAILED;
    pool=next_pool++;*out=HANDLE(VkCommandPool,pool);return VK_SUCCESS;
}
static VKAPI_ATTR void VKAPI_CALL destroy_pool(VkDevice d,VkCommandPool h,const VkAllocationCallbacks *a) {
    (void)a;if (device_valid(d)&&pool&&RID(h)==pool) {pool=0;memset(&command,0,sizeof(command));}
}
static VKAPI_ATTR VkResult VKAPI_CALL allocate_commands(VkDevice d,const VkCommandBufferAllocateInfo *i,VkCommandBuffer *out) {
    if (!out) return VK_ERROR_INITIALIZATION_FAILED;
    *out=VK_NULL_HANDLE;
    if (!device_valid(d)||!i||i->sType!=VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO||i->pNext||!pool||RID(i->commandPool)!=pool||
        command.state||i->level!=VK_COMMAND_BUFFER_LEVEL_PRIMARY||i->commandBufferCount!=1) return VK_ERROR_INITIALIZATION_FAILED;
    memset(&command,0,sizeof(command));set_loader_magic_value(&command);command.state=1;*out=&command;return VK_SUCCESS;
}
static VKAPI_ATTR void VKAPI_CALL free_commands(VkDevice d,VkCommandPool p,uint32_t count,const VkCommandBuffer *items) {
    if(device_valid(d)&&pool&&RID(p)==pool&&count==1&&items&&items[0]==&command)memset(&command,0,sizeof(command));
}
static VKAPI_ATTR VkResult VKAPI_CALL reset_command(VkCommandBuffer cb,VkCommandBufferResetFlags flags) {
    if(cb!=&command||!pool||!command.state||command.state==5||flags) return VK_ERROR_INITIALIZATION_FAILED;
    command.state=1;command.count=0;command.pipeline=command.set=command.pipeline_layout=0;
    memset(&command.graphics,0,sizeof(command.graphics));memset(command.commands,0,sizeof(command.commands));return VK_SUCCESS;
}
static VKAPI_ATTR VkResult VKAPI_CALL begin_command(VkCommandBuffer cb,const VkCommandBufferBeginInfo *i) {
    if(cb!=&command||!pool||command.state!=1||!i||i->sType!=VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO||i->pNext||i->flags||i->pInheritanceInfo)return VK_ERROR_INITIALIZATION_FAILED;
    command.state=2;command.count=0;command.pipeline=command.set=command.pipeline_layout=0;
    memset(&command.graphics,0,sizeof(command.graphics));memset(command.commands,0,sizeof(command.commands));return VK_SUCCESS;
}
static struct recorded *record_command(VkCommandBuffer cb,unsigned op) {
    if(cb!=&command||command.state!=2)return NULL;
    if(command.count>=MAX_CMDS){command.state=4;return NULL;}
    struct recorded *r=&command.commands[command.count++];memset(r,0,sizeof(*r));r->op=op;return r;
}
static int full_range(const VkImageSubresourceRange *r) {return r&&r->aspectMask==VK_IMAGE_ASPECT_COLOR_BIT&&!r->baseMipLevel&&r->levelCount==1&&!r->baseArrayLayer&&r->layerCount==1;}
static int depth_range(const VkImageSubresourceRange *r) {return r&&r->aspectMask==VK_IMAGE_ASPECT_DEPTH_BIT&&!r->baseMipLevel&&r->levelCount==1&&!r->baseArrayLayer&&r->layerCount==1;}
static void invalid_command(VkCommandBuffer cb) {if(cb==&command&&command.state)command.state=4;}
#include "compute.inc"
#include "graphics.inc"
#include "texture.inc"
static VKAPI_ATTR void VKAPI_CALL pipeline_barrier(VkCommandBuffer cb,VkPipelineStageFlags src,VkPipelineStageFlags dst,VkDependencyFlags flags,
        uint32_t mc,const VkMemoryBarrier *mb,uint32_t bc,const VkBufferMemoryBarrier *bb,uint32_t ic,const VkImageMemoryBarrier *ib) {
    (void)mb;
    if(command.graphics.in_pass||flags||mc||!((ic==1&&ib&&!bc)||(bc==1&&bb&&!ic))){invalid_command(cb);return;}
    struct recorded *r;
    if(ic) {
        struct resource *image=resource_get(RID(ib->image),R_IMAGE);
        if(ib->sType!=VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER||ib->pNext||!(image&&image->depth?depth_range(&ib->subresourceRange):full_range(&ib->subresourceRange))||
           ib->srcQueueFamilyIndex!=VK_QUEUE_FAMILY_IGNORED||ib->dstQueueFamilyIndex!=VK_QUEUE_FAMILY_IGNORED){invalid_command(cb);return;}
        int to_dst=ib->newLayout==VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL&&dst==VK_PIPELINE_STAGE_TRANSFER_BIT&&ib->dstAccessMask==VK_ACCESS_TRANSFER_WRITE_BIT&&
          ((ib->oldLayout==VK_IMAGE_LAYOUT_UNDEFINED&&src==VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT&&!ib->srcAccessMask)||
           (ib->oldLayout==VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL&&src==VK_PIPELINE_STAGE_TRANSFER_BIT&&ib->srcAccessMask==VK_ACCESS_TRANSFER_READ_BIT));
        int to_src=ib->oldLayout==VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL&&ib->newLayout==VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL&&
          src==VK_PIPELINE_STAGE_TRANSFER_BIT&&dst==VK_PIPELINE_STAGE_TRANSFER_BIT&&ib->srcAccessMask==VK_ACCESS_TRANSFER_WRITE_BIT&&ib->dstAccessMask==VK_ACCESS_TRANSFER_READ_BIT;
        if(!image||(image->depth?!depth_image_barrier(src,dst,ib):image->sampled?!texture_image_barrier(src,dst,ib):image->graphics_target?!graphics_image_barrier(src,dst,ib):(!to_dst&&!to_src))){invalid_command(cb);return;}
        r=record_command(cb,1);if(r){r->image=RID(ib->image);r->old_layout=ib->oldLayout;r->new_layout=ib->newLayout;}
    } else {
        if(live->graphics_supported && record_vertex_barrier(cb,src,dst,bb))return;
        if(live->uniform_supported && record_uniform_barrier(cb,src,dst,bb))return;
        if(live->compute_supported && record_compute_barrier(cb,src,dst,bb))return;
        if(bb->sType!=VK_STRUCTURE_TYPE_BUFFER_MEMORY_BARRIER||bb->pNext||src!=VK_PIPELINE_STAGE_TRANSFER_BIT||dst!=VK_PIPELINE_STAGE_HOST_BIT||
          bb->srcAccessMask!=VK_ACCESS_TRANSFER_WRITE_BIT||bb->dstAccessMask!=VK_ACCESS_HOST_READ_BIT||bb->srcQueueFamilyIndex!=VK_QUEUE_FAMILY_IGNORED||
          bb->dstQueueFamilyIndex!=VK_QUEUE_FAMILY_IGNORED||bb->offset||bb->size!=VK_WHOLE_SIZE){invalid_command(cb);return;}
        r=record_command(cb,4);if(r)r->buffer=RID(bb->buffer);
    }
}
static VKAPI_ATTR void VKAPI_CALL clear_image(VkCommandBuffer cb,VkImage image,VkImageLayout layout,const VkClearColorValue *color,uint32_t count,const VkImageSubresourceRange *range) {
    if(command.graphics.in_pass||layout!=VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL||!color||count!=1||!full_range(range)){invalid_command(cb);return;}
    for(unsigned i=0;i<4;i++)if(!(color->float32[i]>=0&&color->float32[i]<=1)){invalid_command(cb);return;}
    struct recorded *r=record_command(cb,2);if(r){r->image=RID(image);r->color=*color;}
}
static VKAPI_ATTR void VKAPI_CALL copy_image(VkCommandBuffer cb,VkImage image,VkImageLayout layout,VkBuffer buffer,uint32_t count,const VkBufferImageCopy *region) {
    struct resource *i=resource_get(RID(image),R_IMAGE);
    if(command.graphics.in_pass||!i||layout!=VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL||count!=1||!region||region->bufferOffset||region->bufferRowLength||region->bufferImageHeight||
       region->imageSubresource.aspectMask!=VK_IMAGE_ASPECT_COLOR_BIT||region->imageSubresource.mipLevel||region->imageSubresource.baseArrayLayer||region->imageSubresource.layerCount!=1||
       region->imageOffset.x||region->imageOffset.y||region->imageOffset.z||region->imageExtent.width!=i->width||region->imageExtent.height!=i->height||region->imageExtent.depth!=1){invalid_command(cb);return;}
    struct recorded *r=record_command(cb,3);if(r){r->image=RID(image);r->buffer=RID(buffer);}
}
static VKAPI_ATTR VkResult VKAPI_CALL end_command(VkCommandBuffer cb) {
    if(cb!=&command||command.state!=2||!command.count||command.graphics.in_pass)return VK_ERROR_INITIALIZATION_FAILED;
    command.state=3;return VK_SUCCESS;
}
/* Executes the single recorded primary buffer. The public queue_submit wrapper
 * validates batches/semaphores/fence first and commits sync state only after
 * this returns VK_SUCCESS. */
static VkResult execute_submit(void) {
    if(command.state!=3)return VK_ERROR_INITIALIZATION_FAILED;
    /* Heap-owned, bounded prepared passes avoid exceeding the 256 KiB guest
     * stack. All allocation/serialization/validation completes before effects.
     * The single cleanup path covers every validation/execution failure. */
    struct graphics_json *prepared=live->graphics_supported?calloc(MAX_CMDS,sizeof(*prepared)):NULL;
    if(live->graphics_supported&&!prepared)return VK_ERROR_OUT_OF_HOST_MEMORY;
    VkResult result=VK_ERROR_INITIALIZATION_FAILED;
    VkImageLayout layouts[MAX_RES];unsigned initialized[MAX_RES],used_vertices[MAX_RES]={0},used_uniforms[MAX_RES]={0};
    unsigned written[MAX_RES]={0},ready[MAX_RES]={0},dirty[MAX_RES]={0};
    struct resource *pass_image=NULL,*pass_depth=NULL;const struct graphics_pass *pass=NULL;
    unsigned pass_start=0,pass_draws=0;
    for(unsigned i=0;i<MAX_RES;i++){layouts[i]=resources[i].layout;initialized[i]=resources[i].graphics_initialized;}
    for(unsigned n=0;n<command.count;n++) {
        struct recorded *c=&command.commands[n];struct resource *i=resource_get(c->image,R_IMAGE),*b=resource_get(c->buffer,R_BUFFER);
        if(pass_image&&c->op!=C_GRAPHICS_DRAW&&c->op!=C_GRAPHICS_END)goto submit_done;
        switch(c->op) {
        case 1: case 2: case 3:
            if(!i||!i->host||!resource_get(i->memory,R_MEMORY))goto submit_done;
            if(c->op==1){
                if(c->old_layout!=VK_IMAGE_LAYOUT_UNDEFINED&&layouts[i-resources]!=c->old_layout)goto submit_done;
                if(i->depth) {
                    if(c->new_layout!=VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL)goto submit_done;
                    if(c->old_layout==VK_IMAGE_LAYOUT_UNDEFINED)initialized[i-resources]=0;
                } else if(i->graphics_target) {
                    if(c->new_layout!=VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL&&c->new_layout!=VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL)goto submit_done;
                    if(c->old_layout==VK_IMAGE_LAYOUT_UNDEFINED)initialized[i-resources]=0;
                } else if(i->sampled) {
                    if(c->new_layout!=VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL&&c->new_layout!=VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL)goto submit_done;
                    if(c->old_layout==VK_IMAGE_LAYOUT_UNDEFINED)initialized[i-resources]=0;
                } else if(c->new_layout!=VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL&&c->new_layout!=VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL)goto submit_done;
                layouts[i-resources]=c->new_layout;break;
            }
            if(c->op==2){if(i->depth||i->graphics_target||i->sampled||layouts[i-resources]!=VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL)goto submit_done;break;}
            if(i->depth||i->sampled||!b||b->storage||b->vertex||b->uniform||b->staging||!resource_get(b->memory,R_MEMORY)||layouts[i-resources]!=VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL||
               b->size<i->size||(i->graphics_target&&!initialized[i-resources]))goto submit_done;
            written[b-resources]=1;break;
        case 4:
            if(!b||b->storage||b->vertex||b->uniform||b->staging||!resource_get(b->memory,R_MEMORY)||!written[b-resources])goto submit_done;
            written[b-resources]=0;break;
        case 5: case 6: case 7:
            if(!live->compute_supported||!b||!b->storage||!b->host||!resource_get(b->memory,R_MEMORY))goto submit_done;
            if(c->op==5){if(dirty[b-resources])goto submit_done;ready[b-resources]=1;}
            if(c->op==6){if(!dirty[b-resources])goto submit_done;ready[b-resources]=1;}
            if(c->op==7){if(!dirty[b-resources])goto submit_done;dirty[b-resources]=0;ready[b-resources]=0;}
            break;
        case 8: {
            struct resource *pipeline=resource_get(c->pipeline,R_COMPUTE_PIPELINE),*set=resource_get(c->set,R_DESC_SET);
            b=set?resource_get(set->link,R_BUFFER):NULL;
            if(!live->compute_supported||!pipeline||!pipeline->host||!resource_get(pipeline->link,R_PIPELINE_LAYOUT)||
               !set||!set->valid||!resource_get(set->parent,R_DESC_POOL)||!b||!b->storage||!b->host||!resource_get(b->memory,R_MEMORY)||
               set->range<256||set->range>b->size||!ready[b-resources])goto submit_done;
            ready[b-resources]=0;dirty[b-resources]=1;break;
        }
        case C_GRAPHICS_BEGIN:
            if(!live->graphics_supported||pass_image)goto submit_done;
            pass=&c->graphics.begin.pass;
            pass_image=graphics_framebuffer_image(c->graphics.begin.framebuffer,pass);
            if(!pass_image||layouts[pass_image-resources]!=pass->initial||
               (pass->load==VK_ATTACHMENT_LOAD_OP_LOAD&&!initialized[pass_image-resources]))goto submit_done;
            pass_depth=NULL;
            if(pass->depth_format) {
                pass_depth=graphics_framebuffer_depth(c->graphics.begin.framebuffer,pass);
                if(!pass_depth||layouts[pass_depth-resources]!=pass->depth_initial||
                   (pass->depth_load==VK_ATTACHMENT_LOAD_OP_LOAD&&!initialized[pass_depth-resources]))goto submit_done;
            }
            pass_start=n;pass_draws=0;
            if(!graphics_prepare_begin(&c->graphics.begin,pass_image,pass_depth,&prepared[n]))goto submit_done;
            break;
        case C_GRAPHICS_DRAW:
            if(!pass_image||!graphics_prepare_draw(&c->graphics.draw,pass,pass_image,&prepared[pass_start],pass_draws++,used_vertices,used_uniforms,layouts,initialized))goto submit_done;
            break;
        case C_GRAPHICS_END:
            if(!pass_image)goto submit_done;
            graphics_json_append(&prepared[pass_start],"]}");if(prepared[pass_start].bad)goto submit_done;
            layouts[pass_image-resources]=pass->final;initialized[pass_image-resources]=1;
            if(pass_depth){layouts[pass_depth-resources]=pass->depth_final;initialized[pass_depth-resources]=pass->depth_store==VK_ATTACHMENT_STORE_OP_STORE;}
            pass_image=NULL;pass_depth=NULL;pass=NULL;
            break;
        case C_VERTEX_BARRIER:
            if(!live->graphics_supported||!b||!b->vertex||!b->host||!resource_get(b->memory,R_MEMORY))goto submit_done;
            break;
        case C_UNIFORM_BARRIER:
            if(!live->uniform_supported||!b||!b->uniform||!b->host||!resource_get(b->memory,R_MEMORY))goto submit_done;
            break;
        case C_TEXTURE_COPY:
            if(!texture_prepare_copy(c,layouts,initialized))goto submit_done;
            break;
        default:goto submit_done;
        }
    }
    if(pass_image)goto submit_done;
    for(unsigned i=0;i<MAX_RES;i++)if(written[i]||dirty[i])goto submit_done;
    command.state=5; /* Pending, even though this transport completes synchronously. */
    if(graphics_upload_vertices(used_vertices)!=VK_SUCCESS||graphics_upload_uniforms(used_uniforms)!=VK_SUCCESS)goto submit_lost;
    for(unsigned n=0;n<command.count;n++) {
        struct recorded *c=&command.commands[n];struct resource *i=resource_get(c->image,R_IMAGE),*b=resource_get(c->buffer,R_BUFFER);
        if(c->op==1){i->layout=c->new_layout;if((i->graphics_target||i->sampled||i->depth)&&c->old_layout==VK_IMAGE_LAYOUT_UNDEFINED)i->graphics_initialized=0;}
        if(c->op==C_TEXTURE_COPY&&texture_execute_copy(c)!=VK_SUCCESS)goto submit_lost;
        if(c->op==2){unsigned char payload[20];memcpy(payload,&i->host,4);memcpy(payload+4,c->color.float32,16);if(host_empty(GPU_CLEAR,payload,20)!=VK_SUCCESS)goto submit_lost;}
        if(c->op>=5 && c->op<=8){if(execute_compute(c)!=VK_SUCCESS)goto submit_lost;}
        if(c->op==C_GRAPHICS_BEGIN) {
            const struct graphics_pass *bp=&c->graphics.begin.pass;
            i=graphics_framebuffer_image(c->graphics.begin.framebuffer,bp);
            struct resource *depth=bp->depth_format?graphics_framebuffer_depth(c->graphics.begin.framebuffer,bp):NULL;
            /* Once native submission starts, even allocation errors cannot
             * promise unchanged application resources. Poison on all failures. */
            if(host_empty(GPU_GRAPHICS_PASS,prepared[n].bytes,(uint32_t)prepared[n].used)!=VK_SUCCESS) {
                i->graphics_initialized=0;if(depth)depth->graphics_initialized=0;goto submit_lost;
            }
            i->graphics_initialized=1;i->layout=bp->final;
            if(depth){depth->graphics_initialized=bp->depth_store==VK_ATTACHMENT_STORE_OP_STORE;depth->layout=bp->depth_final;}
        }
        if(c->op==3){unsigned char data[65536];uint32_t size=0;struct resource *m=resource_get(b->memory,R_MEMORY);
            if(host_call(i->graphics_target?GPU_GRAPHICS_READBACK:GPU_READBACK,&i->host,4,data,sizeof(data),&size)!=VK_SUCCESS||size!=i->size)goto submit_lost;
            memcpy(m->bytes,data,size);
        }
    }
    command.state=3;result=VK_SUCCESS;goto submit_done;
submit_lost:
    live->failed=1;command.state=4;result=VK_ERROR_DEVICE_LOST;
submit_done:
    free(prepared);return result;
}
/* Guest-only synchronization objects. Submission completes synchronously, so
 * semaphores/fences are signaled at completion and never involve the host.
 * They use a separate table so resource/exhaustion accounting is unchanged. */
#define MAX_SYNC 32
enum sync_kind { S_FENCE=1, S_SEMAPHORE };
struct sync_object { uint64_t id; unsigned kind, signaled; };
static struct sync_object syncs[MAX_SYNC];
static uint64_t next_sync = 2000000;
static unsigned sync_count;
unsigned guest_vk_live_sync(void) {return sync_count;}
static struct sync_object *sync_get(uint64_t id,unsigned kind) {
    for(unsigned i=0;i<MAX_SYNC;i++)if(id&&syncs[i].id==id&&syncs[i].kind==kind)return &syncs[i];
    return NULL;
}
static struct sync_object *sync_new(unsigned kind,unsigned signaled) {
    if(next_sync==UINT64_MAX)return NULL;
    for(unsigned i=0;i<MAX_SYNC;i++)if(!syncs[i].id){syncs[i]=(struct sync_object){.id=next_sync++,.kind=kind,.signaled=signaled};sync_count++;return &syncs[i];}
    return NULL;
}
static void sync_cleanup(void) {
    printf("GUEST_VK_SYNC teardown_released=%u\n",sync_count);fflush(stdout);
    memset(syncs,0,sizeof(syncs));sync_count=0;
}
static VKAPI_ATTR VkResult VKAPI_CALL create_fence(VkDevice d,const VkFenceCreateInfo *i,const VkAllocationCallbacks *a,VkFence *out) {
    if(!out)return VK_ERROR_INITIALIZATION_FAILED;
    *out=VK_NULL_HANDLE;
    if(!device_valid(d)||!i||a||i->sType!=VK_STRUCTURE_TYPE_FENCE_CREATE_INFO||!chain_valid(i->pNext,NULL,0)||
       (i->flags&~(VkFenceCreateFlags)VK_FENCE_CREATE_SIGNALED_BIT))return VK_ERROR_INITIALIZATION_FAILED;
    struct sync_object *f=sync_new(S_FENCE,(i->flags&VK_FENCE_CREATE_SIGNALED_BIT)!=0);if(!f)return VK_ERROR_OUT_OF_HOST_MEMORY;
    *out=HANDLE(VkFence,f->id);return VK_SUCCESS;
}
static VKAPI_ATTR void VKAPI_CALL destroy_fence(VkDevice d,VkFence h,const VkAllocationCallbacks *a) {
    (void)a;struct sync_object *f=device_valid(d)?sync_get(RID(h),S_FENCE):NULL;
    if(f){memset(f,0,sizeof(*f));sync_count--;}
}
static VKAPI_ATTR VkResult VKAPI_CALL reset_fences(VkDevice d,uint32_t count,const VkFence *fences) {
    if(!device_valid(d)||!count||!fences)return VK_ERROR_INITIALIZATION_FAILED;
    for(uint32_t n=0;n<count;n++)if(!sync_get(RID(fences[n]),S_FENCE))return VK_ERROR_INITIALIZATION_FAILED;
    for(uint32_t n=0;n<count;n++)sync_get(RID(fences[n]),S_FENCE)->signaled=0;
    return VK_SUCCESS;
}
static VKAPI_ATTR VkResult VKAPI_CALL fence_status(VkDevice d,VkFence h) {
    if(!device_valid(d)||live->failed)return VK_ERROR_DEVICE_LOST;
    struct sync_object *f=sync_get(RID(h),S_FENCE);if(!f)return VK_ERROR_INITIALIZATION_FAILED;
    return f->signaled?VK_SUCCESS:VK_NOT_READY;
}
/* Nothing is ever pending, so an unsignaled fence cannot become signaled
 * while this single-threaded profile waits: return VK_TIMEOUT immediately. */
static VKAPI_ATTR VkResult VKAPI_CALL wait_fences(VkDevice d,uint32_t count,const VkFence *fences,VkBool32 all,uint64_t timeout) {
    (void)timeout;
    if(!device_valid(d)||live->failed)return VK_ERROR_DEVICE_LOST;
    if(!count||!fences)return VK_ERROR_INITIALIZATION_FAILED;
    unsigned signaled=0;
    for(uint32_t n=0;n<count;n++){struct sync_object *f=sync_get(RID(fences[n]),S_FENCE);if(!f)return VK_ERROR_INITIALIZATION_FAILED;signaled+=f->signaled!=0;}
    return (all?signaled==count:signaled>0)?VK_SUCCESS:VK_TIMEOUT;
}
static VKAPI_ATTR VkResult VKAPI_CALL create_semaphore(VkDevice d,const VkSemaphoreCreateInfo *i,const VkAllocationCallbacks *a,VkSemaphore *out) {
    if(!out)return VK_ERROR_INITIALIZATION_FAILED;
    *out=VK_NULL_HANDLE;
    if(!device_valid(d)||!i||a||i->sType!=VK_STRUCTURE_TYPE_SEMAPHORE_CREATE_INFO||!chain_valid(i->pNext,NULL,0)||i->flags)return VK_ERROR_INITIALIZATION_FAILED;
    const VkSemaphoreTypeCreateInfo *type=chain_find(i->pNext,VK_STRUCTURE_TYPE_SEMAPHORE_TYPE_CREATE_INFO);
    if(type&&type->semaphoreType!=VK_SEMAPHORE_TYPE_BINARY)return VK_ERROR_INITIALIZATION_FAILED; /* timeline is not a 1.1 feature */
    struct sync_object *s=sync_new(S_SEMAPHORE,0);if(!s)return VK_ERROR_OUT_OF_HOST_MEMORY;
    *out=HANDLE(VkSemaphore,s->id);return VK_SUCCESS;
}
static VKAPI_ATTR void VKAPI_CALL destroy_semaphore(VkDevice d,VkSemaphore h,const VkAllocationCallbacks *a) {
    (void)a;struct sync_object *s=device_valid(d)?sync_get(RID(h),S_SEMAPHORE):NULL;
    if(s){memset(s,0,sizeof(*s));sync_count--;}
}
/* Batches are validated in order against simulated binary-semaphore state:
 * waits consume a signaled semaphore, signals require an unsignaled one. At
 * most one command buffer (the single primary) per call. Nothing commits
 * unless execution succeeds; DEVICE_LOST leaves semaphores/fence unchanged. */
static VKAPI_ATTR VkResult VKAPI_CALL queue_submit(VkQueue q,uint32_t count,const VkSubmitInfo *info,VkFence fence) {
    if(!live||!live->device||q!=&live->device->queue||live->failed)return VK_ERROR_DEVICE_LOST;
    struct sync_object *f=NULL;
    if(fence){f=sync_get(RID(fence),S_FENCE);if(!f||f->signaled)return VK_ERROR_INITIALIZATION_FAILED;}
    if(count&&!info)return VK_ERROR_INITIALIZATION_FAILED;
    unsigned state[MAX_SYNC],commands=0;
    for(unsigned i=0;i<MAX_SYNC;i++)state[i]=syncs[i].signaled;
    for(uint32_t b=0;b<count;b++) {
        const VkSubmitInfo *s=&info[b];
        if(s->sType!=VK_STRUCTURE_TYPE_SUBMIT_INFO||!chain_valid(s->pNext,NULL,0)||
           (s->waitSemaphoreCount&&(!s->pWaitSemaphores||!s->pWaitDstStageMask))||
           (s->signalSemaphoreCount&&!s->pSignalSemaphores)||(s->commandBufferCount&&!s->pCommandBuffers))return VK_ERROR_INITIALIZATION_FAILED;
        for(uint32_t w=0;w<s->waitSemaphoreCount;w++){struct sync_object *x=sync_get(RID(s->pWaitSemaphores[w]),S_SEMAPHORE);
            if(!x||!state[x-syncs]||!s->pWaitDstStageMask[w])return VK_ERROR_INITIALIZATION_FAILED;state[x-syncs]=0;}
        for(uint32_t c=0;c<s->commandBufferCount;c++)if(s->pCommandBuffers[c]!=&command||++commands>1)return VK_ERROR_INITIALIZATION_FAILED;
        for(uint32_t g=0;g<s->signalSemaphoreCount;g++){struct sync_object *x=sync_get(RID(s->pSignalSemaphores[g]),S_SEMAPHORE);
            if(!x||state[x-syncs])return VK_ERROR_INITIALIZATION_FAILED;state[x-syncs]=1;}
    }
    if(commands){VkResult result=execute_submit();if(result!=VK_SUCCESS)return result;}
    for(unsigned i=0;i<MAX_SYNC;i++)if(syncs[i].kind==S_SEMAPHORE)syncs[i].signaled=state[i];
    if(f)f->signaled=1;
    return VK_SUCCESS;
}
static VKAPI_ATTR VkResult VKAPI_CALL queue_idle(VkQueue q) {return live&&live->device&&q==&live->device->queue&&!live->failed?VK_SUCCESS:VK_ERROR_DEVICE_LOST;}
static VKAPI_ATTR VkResult VKAPI_CALL device_idle(VkDevice d) {return device_valid(d)&&!live->failed?VK_SUCCESS:VK_ERROR_DEVICE_LOST;}
static PFN_vkVoidFunction transfer_proc(const char *name) {
#define P(api,fn) if(!strcmp(name,#api))return (PFN_vkVoidFunction)fn;
    P(vkCreateImage,create_image) P(vkDestroyImage,destroy_image) P(vkGetImageMemoryRequirements,image_requirements)
    P(vkCreateBuffer,create_buffer) P(vkDestroyBuffer,destroy_buffer) P(vkGetBufferMemoryRequirements,buffer_requirements)
    P(vkAllocateMemory,allocate_memory) P(vkFreeMemory,free_memory) P(vkBindImageMemory,bind_image) P(vkBindBufferMemory,bind_buffer)
    P(vkMapMemory,map_memory) P(vkUnmapMemory,unmap_memory) P(vkCreateCommandPool,create_pool) P(vkDestroyCommandPool,destroy_pool)
    P(vkAllocateCommandBuffers,allocate_commands) P(vkFreeCommandBuffers,free_commands) P(vkResetCommandBuffer,reset_command)
    P(vkBeginCommandBuffer,begin_command) P(vkEndCommandBuffer,end_command) P(vkCmdPipelineBarrier,pipeline_barrier)
    P(vkCmdClearColorImage,clear_image) P(vkCmdCopyImageToBuffer,copy_image) P(vkQueueSubmit,queue_submit)
    P(vkQueueWaitIdle,queue_idle) P(vkDeviceWaitIdle,device_idle)
    P(vkCreateFence,create_fence) P(vkDestroyFence,destroy_fence) P(vkResetFences,reset_fences) P(vkGetFenceStatus,fence_status)
    P(vkWaitForFences,wait_fences) P(vkCreateSemaphore,create_semaphore) P(vkDestroySemaphore,destroy_semaphore)
    if(live->texture_supported){P(vkCreateSampler,create_sampler) P(vkDestroySampler,destroy_sampler) P(vkCmdCopyBufferToImage,copy_buffer_to_image)}
#undef P
    return NULL;
}
