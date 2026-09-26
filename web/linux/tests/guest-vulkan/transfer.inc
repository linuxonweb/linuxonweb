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
enum resource_kind { R_IMAGE=1, R_BUFFER, R_MEMORY };
struct resource { uint64_t id, memory; unsigned kind, host, width, height, type, mapped, bound; size_t size; unsigned char *bytes; VkImageLayout layout; };
static struct resource resources[MAX_RES];
static uint64_t next_resource = 1;
struct recorded { unsigned op; uint64_t image, buffer; VkImageLayout old_layout, new_layout; VkClearColorValue color; };
struct VkCommandBuffer_T { VK_LOADER_DATA loader; unsigned state, count; struct recorded commands[MAX_CMDS]; };
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
static void transfer_cleanup(void) {
    for (unsigned i=0;i<MAX_RES;i++) if (resources[i].id && resources[i].kind!=R_MEMORY) resource_drop(&resources[i]);
    for (unsigned i=0;i<MAX_RES;i++) if (resources[i].id) resource_drop(&resources[i]);
    memset(&command,0,sizeof(command)); pool=0;
    printf("GUEST_VK_RESOURCES live=%u allocated_bytes=%zu\n",resource_count,allocated_bytes); fflush(stdout);
}
static VKAPI_ATTR void VKAPI_CALL memory_properties(VkPhysicalDevice p, VkPhysicalDeviceMemoryProperties *out) {
    if (!out) return;
    memset(out,0,sizeof(*out)); if (!physical_valid(p) || !live->clear_supported) return;
    out->memoryHeapCount=1; out->memoryHeaps[0].size=1024*1024;
    out->memoryTypeCount=2; out->memoryTypes[0].propertyFlags=VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT;
    out->memoryTypes[1].propertyFlags=VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT|VK_MEMORY_PROPERTY_HOST_COHERENT_BIT;
}
static VKAPI_ATTR VkResult VKAPI_CALL create_image(VkDevice d,const VkImageCreateInfo *i,const VkAllocationCallbacks *a,VkImage *out) {
    if (!out) return VK_ERROR_INITIALIZATION_FAILED;
    *out=VK_NULL_HANDLE;
    if (!device_valid(d)||!i||a||i->sType!=VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO||i->pNext||i->flags||
        i->imageType!=VK_IMAGE_TYPE_2D||i->format!=VK_FORMAT_R8G8B8A8_UNORM||!i->extent.width||!i->extent.height||
        i->extent.width>128||i->extent.height>128||i->extent.depth!=1||i->mipLevels!=1||i->arrayLayers!=1||
        i->samples!=VK_SAMPLE_COUNT_1_BIT||i->tiling!=VK_IMAGE_TILING_OPTIMAL||
        i->usage!=(VK_IMAGE_USAGE_TRANSFER_SRC_BIT|VK_IMAGE_USAGE_TRANSFER_DST_BIT)||
        i->sharingMode!=VK_SHARING_MODE_EXCLUSIVE||i->queueFamilyIndexCount||i->initialLayout!=VK_IMAGE_LAYOUT_UNDEFINED)
        return VK_ERROR_FORMAT_NOT_SUPPORTED;
    struct resource *r=resource_new(R_IMAGE); if (!r) return VK_ERROR_OUT_OF_HOST_MEMORY;
    r->width=i->extent.width;r->height=i->extent.height;r->size=(size_t)r->width*r->height*4;r->layout=VK_IMAGE_LAYOUT_UNDEFINED;
    *out=HANDLE(VkImage,r->id);return VK_SUCCESS;
}
static VKAPI_ATTR VkResult VKAPI_CALL create_buffer(VkDevice d,const VkBufferCreateInfo *i,const VkAllocationCallbacks *a,VkBuffer *out) {
    if (!out) return VK_ERROR_INITIALIZATION_FAILED;
    *out=VK_NULL_HANDLE;
    if (!device_valid(d)||!i||a||i->sType!=VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO||i->pNext||i->flags||
        !i->size||i->size>65536||i->usage!=VK_BUFFER_USAGE_TRANSFER_DST_BIT||
        i->sharingMode!=VK_SHARING_MODE_EXCLUSIVE||i->queueFamilyIndexCount) return VK_ERROR_FEATURE_NOT_PRESENT;
    struct resource *r=resource_new(R_BUFFER);if (!r) return VK_ERROR_OUT_OF_HOST_MEMORY;
    r->size=(size_t)i->size;*out=HANDLE(VkBuffer,r->id);return VK_SUCCESS;
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
    if (device_valid(d)&&r) {out->size=r->size;out->alignment=4;out->memoryTypeBits=kind==R_IMAGE?1:2;}
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
        if (live->failed||gpu_resource(&live->session,GPU_TARGET,dimensions,8,&r->host)) {live->failed=1;return VK_ERROR_DEVICE_LOST;}
    }
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
    command.state=1;command.count=0;return VK_SUCCESS;
}
static VKAPI_ATTR VkResult VKAPI_CALL begin_command(VkCommandBuffer cb,const VkCommandBufferBeginInfo *i) {
    if(cb!=&command||!pool||command.state!=1||!i||i->sType!=VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO||i->pNext||i->flags||i->pInheritanceInfo)return VK_ERROR_INITIALIZATION_FAILED;
    command.state=2;command.count=0;return VK_SUCCESS;
}
static struct recorded *record_command(VkCommandBuffer cb,unsigned op) {
    if(cb!=&command||command.state!=2)return NULL;
    if(command.count>=MAX_CMDS){command.state=4;return NULL;}
    struct recorded *r=&command.commands[command.count++];memset(r,0,sizeof(*r));r->op=op;return r;
}
static int full_range(const VkImageSubresourceRange *r) {return r&&r->aspectMask==VK_IMAGE_ASPECT_COLOR_BIT&&!r->baseMipLevel&&r->levelCount==1&&!r->baseArrayLayer&&r->layerCount==1;}
static void invalid_command(VkCommandBuffer cb) {if(cb==&command&&command.state)command.state=4;}
static VKAPI_ATTR void VKAPI_CALL pipeline_barrier(VkCommandBuffer cb,VkPipelineStageFlags src,VkPipelineStageFlags dst,VkDependencyFlags flags,
        uint32_t mc,const VkMemoryBarrier *mb,uint32_t bc,const VkBufferMemoryBarrier *bb,uint32_t ic,const VkImageMemoryBarrier *ib) {
    (void)mb;
    if(flags||mc||!((ic==1&&ib&&!bc)||(bc==1&&bb&&!ic))){invalid_command(cb);return;}
    struct recorded *r;
    if(ic) {
        if(ib->sType!=VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER||ib->pNext||!full_range(&ib->subresourceRange)||
           ib->srcQueueFamilyIndex!=VK_QUEUE_FAMILY_IGNORED||ib->dstQueueFamilyIndex!=VK_QUEUE_FAMILY_IGNORED){invalid_command(cb);return;}
        int to_dst=ib->newLayout==VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL&&dst==VK_PIPELINE_STAGE_TRANSFER_BIT&&ib->dstAccessMask==VK_ACCESS_TRANSFER_WRITE_BIT&&
          ((ib->oldLayout==VK_IMAGE_LAYOUT_UNDEFINED&&src==VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT&&!ib->srcAccessMask)||
           (ib->oldLayout==VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL&&src==VK_PIPELINE_STAGE_TRANSFER_BIT&&ib->srcAccessMask==VK_ACCESS_TRANSFER_READ_BIT));
        int to_src=ib->oldLayout==VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL&&ib->newLayout==VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL&&
          src==VK_PIPELINE_STAGE_TRANSFER_BIT&&dst==VK_PIPELINE_STAGE_TRANSFER_BIT&&ib->srcAccessMask==VK_ACCESS_TRANSFER_WRITE_BIT&&ib->dstAccessMask==VK_ACCESS_TRANSFER_READ_BIT;
        if(!to_dst&&!to_src){invalid_command(cb);return;}
        r=record_command(cb,1);if(r){r->image=RID(ib->image);r->old_layout=ib->oldLayout;r->new_layout=ib->newLayout;}
    } else {
        if(bb->sType!=VK_STRUCTURE_TYPE_BUFFER_MEMORY_BARRIER||bb->pNext||src!=VK_PIPELINE_STAGE_TRANSFER_BIT||dst!=VK_PIPELINE_STAGE_HOST_BIT||
          bb->srcAccessMask!=VK_ACCESS_TRANSFER_WRITE_BIT||bb->dstAccessMask!=VK_ACCESS_HOST_READ_BIT||bb->srcQueueFamilyIndex!=VK_QUEUE_FAMILY_IGNORED||
          bb->dstQueueFamilyIndex!=VK_QUEUE_FAMILY_IGNORED||bb->offset||bb->size!=VK_WHOLE_SIZE){invalid_command(cb);return;}
        r=record_command(cb,4);if(r)r->buffer=RID(bb->buffer);
    }
}
static VKAPI_ATTR void VKAPI_CALL clear_image(VkCommandBuffer cb,VkImage image,VkImageLayout layout,const VkClearColorValue *color,uint32_t count,const VkImageSubresourceRange *range) {
    if(layout!=VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL||!color||count!=1||!full_range(range)){invalid_command(cb);return;}
    for(unsigned i=0;i<4;i++)if(!(color->float32[i]>=0&&color->float32[i]<=1)){invalid_command(cb);return;}
    struct recorded *r=record_command(cb,2);if(r){r->image=RID(image);r->color=*color;}
}
static VKAPI_ATTR void VKAPI_CALL copy_image(VkCommandBuffer cb,VkImage image,VkImageLayout layout,VkBuffer buffer,uint32_t count,const VkBufferImageCopy *region) {
    struct resource *i=resource_get(RID(image),R_IMAGE);
    if(!i||layout!=VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL||count!=1||!region||region->bufferOffset||region->bufferRowLength||region->bufferImageHeight||
       region->imageSubresource.aspectMask!=VK_IMAGE_ASPECT_COLOR_BIT||region->imageSubresource.mipLevel||region->imageSubresource.baseArrayLayer||region->imageSubresource.layerCount!=1||
       region->imageOffset.x||region->imageOffset.y||region->imageOffset.z||region->imageExtent.width!=i->width||region->imageExtent.height!=i->height||region->imageExtent.depth!=1){invalid_command(cb);return;}
    struct recorded *r=record_command(cb,3);if(r){r->image=RID(image);r->buffer=RID(buffer);}
}
static VKAPI_ATTR VkResult VKAPI_CALL end_command(VkCommandBuffer cb) {
    if(cb!=&command||command.state!=2||!command.count)return VK_ERROR_INITIALIZATION_FAILED;
    command.state=3;return VK_SUCCESS;
}
static VKAPI_ATTR VkResult VKAPI_CALL queue_submit(VkQueue q,uint32_t count,const VkSubmitInfo *info,VkFence fence) {
    if(!live||!live->device||q!=&live->device->queue||live->failed)return VK_ERROR_DEVICE_LOST;
    if(count!=1||!info||fence||info->sType!=VK_STRUCTURE_TYPE_SUBMIT_INFO||info->pNext||info->waitSemaphoreCount||info->signalSemaphoreCount||
       info->commandBufferCount!=1||!info->pCommandBuffers||info->pCommandBuffers[0]!=&command||command.state!=3)return VK_ERROR_INITIALIZATION_FAILED;
    /* Validate every command and reference before issuing any host side effects. */
    VkImageLayout layouts[MAX_RES];unsigned written[MAX_RES]={0};
    for(unsigned i=0;i<MAX_RES;i++)layouts[i]=resources[i].layout;
    for(unsigned n=0;n<command.count;n++) {
        struct recorded *c=&command.commands[n];struct resource *i=resource_get(c->image,R_IMAGE),*b=resource_get(c->buffer,R_BUFFER);
        if(c->op<=3&&(!i||!i->host||!resource_get(i->memory,R_MEMORY)))return VK_ERROR_INITIALIZATION_FAILED;
        if(c->op>=3&&(!b||!resource_get(b->memory,R_MEMORY)))return VK_ERROR_INITIALIZATION_FAILED;
        if(c->op==1){if(c->old_layout!=VK_IMAGE_LAYOUT_UNDEFINED&&layouts[i-resources]!=c->old_layout)return VK_ERROR_INITIALIZATION_FAILED;layouts[i-resources]=c->new_layout;}
        if(c->op==2&&layouts[i-resources]!=VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL)return VK_ERROR_INITIALIZATION_FAILED;
        if(c->op==3){if(layouts[i-resources]!=VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL||b->size<i->size)return VK_ERROR_INITIALIZATION_FAILED;written[b-resources]=1;}
        if(c->op==4){if(!written[b-resources])return VK_ERROR_INITIALIZATION_FAILED;written[b-resources]=0;}
    }
    for(unsigned i=0;i<MAX_RES;i++)if(written[i])return VK_ERROR_INITIALIZATION_FAILED;
    command.state=5; /* Pending, even though this transport completes synchronously. */
    for(unsigned n=0;n<command.count;n++) {
        struct recorded *c=&command.commands[n];struct resource *i=resource_get(c->image,R_IMAGE),*b=resource_get(c->buffer,R_BUFFER);
        if(c->op==1)i->layout=c->new_layout;
        if(c->op==2){unsigned char payload[20];memcpy(payload,&i->host,4);memcpy(payload+4,c->color.float32,16);if(host_empty(GPU_CLEAR,payload,20)!=VK_SUCCESS){command.state=4;return VK_ERROR_DEVICE_LOST;}}
        if(c->op==3){unsigned char data[65536];uint32_t size=0;struct resource *m=resource_get(b->memory,R_MEMORY);
            if(host_call(GPU_READBACK,&i->host,4,data,sizeof(data),&size)!=VK_SUCCESS||size!=i->size){live->failed=1;command.state=4;return VK_ERROR_DEVICE_LOST;}
            memcpy(m->bytes,data,size);
        }
    }
    command.state=3;return VK_SUCCESS;
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
#undef P
    return NULL;
}
