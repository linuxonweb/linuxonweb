/* Deliberately bounded compute profile: one set/binding/storage buffer, one
 * 64x1x1 workgroup. This is not a conformant general Vulkan implementation. */
static VKAPI_ATTR VkResult VKAPI_CALL create_shader(VkDevice d,const VkShaderModuleCreateInfo *i,const VkAllocationCallbacks *a,VkShaderModule *out) {
    if(!out)return VK_ERROR_INITIALIZATION_FAILED;
    *out=VK_NULL_HANDLE;
    if(!device_valid(d)||!live->compute_supported||!i||a||i->sType!=VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO||i->pNext||i->flags||
       !i->pCode||i->codeSize<20||i->codeSize>65536||i->codeSize%4)return VK_ERROR_INITIALIZATION_FAILED;
    struct resource *r=resource_new(R_SHADER);if(!r)return VK_ERROR_OUT_OF_HOST_MEMORY;
    r->bytes=malloc(i->codeSize);if(!r->bytes){resource_drop(r);return VK_ERROR_OUT_OF_HOST_MEMORY;}
    r->size=i->codeSize;memcpy(r->bytes,i->pCode,i->codeSize);
    VkResult result=compute_resource(GPU_SPIRV_SHADER,r->bytes,(uint32_t)r->size,&r->host);
    if(result!=VK_SUCCESS){resource_drop(r);return result;}
    *out=HANDLE(VkShaderModule,r->id);return VK_SUCCESS;
}
static void destroy_compute_resource(VkDevice d,uint64_t id,unsigned kind,const VkAllocationCallbacks *a) {
    (void)a;struct resource *r=resource_get(id,kind);if(device_valid(d)&&r)resource_drop(r);
}
static VKAPI_ATTR void VKAPI_CALL destroy_shader(VkDevice d,VkShaderModule h,const VkAllocationCallbacks *a){destroy_compute_resource(d,RID(h),R_SHADER,a);}
static VKAPI_ATTR VkResult VKAPI_CALL create_set_layout(VkDevice d,const VkDescriptorSetLayoutCreateInfo *i,const VkAllocationCallbacks *a,VkDescriptorSetLayout *out) {
    if(!out)return VK_ERROR_INITIALIZATION_FAILED;
    *out=VK_NULL_HANDLE;
    if(!device_valid(d)||!i||a||i->sType!=VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO||i->pNext||i->flags||i->bindingCount!=1||!i->pBindings)return VK_ERROR_INITIALIZATION_FAILED;
    const VkDescriptorSetLayoutBinding b=*i->pBindings;
    if(b.binding||b.descriptorType!=VK_DESCRIPTOR_TYPE_STORAGE_BUFFER||b.descriptorCount!=1||b.stageFlags!=VK_SHADER_STAGE_COMPUTE_BIT||b.pImmutableSamplers)return VK_ERROR_INITIALIZATION_FAILED;
    struct resource *r=resource_new(R_SET_LAYOUT);if(!r)return VK_ERROR_OUT_OF_HOST_MEMORY;
    *out=HANDLE(VkDescriptorSetLayout,r->id);return VK_SUCCESS;
}
static VKAPI_ATTR void VKAPI_CALL destroy_set_layout(VkDevice d,VkDescriptorSetLayout h,const VkAllocationCallbacks *a){destroy_compute_resource(d,RID(h),R_SET_LAYOUT,a);}
static VKAPI_ATTR VkResult VKAPI_CALL create_pipeline_layout(VkDevice d,const VkPipelineLayoutCreateInfo *i,const VkAllocationCallbacks *a,VkPipelineLayout *out) {
    if(!out)return VK_ERROR_INITIALIZATION_FAILED;
    *out=VK_NULL_HANDLE;
    if(!device_valid(d)||!i||a||i->sType!=VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO||i->pNext||i->flags||i->setLayoutCount!=1||!i->pSetLayouts||
       !resource_get(RID(i->pSetLayouts[0]),R_SET_LAYOUT)||i->pushConstantRangeCount)return VK_ERROR_INITIALIZATION_FAILED;
    struct resource *r=resource_new(R_PIPELINE_LAYOUT);if(!r)return VK_ERROR_OUT_OF_HOST_MEMORY;
    /* All supported layouts have exactly the same immutable binding shape. */
    *out=HANDLE(VkPipelineLayout,r->id);return VK_SUCCESS;
}
static VKAPI_ATTR void VKAPI_CALL destroy_pipeline_layout(VkDevice d,VkPipelineLayout h,const VkAllocationCallbacks *a){destroy_compute_resource(d,RID(h),R_PIPELINE_LAYOUT,a);}
static VKAPI_ATTR VkResult VKAPI_CALL create_compute_pipelines(VkDevice d,VkPipelineCache cache,uint32_t count,const VkComputePipelineCreateInfo *i,const VkAllocationCallbacks *a,VkPipeline *out) {
    if(!out||count!=1)return VK_ERROR_INITIALIZATION_FAILED;
    *out=VK_NULL_HANDLE;
    if(!device_valid(d)||cache||!i||a||i->sType!=VK_STRUCTURE_TYPE_COMPUTE_PIPELINE_CREATE_INFO||i->pNext||i->flags||
       !resource_get(RID(i->layout),R_PIPELINE_LAYOUT)||i->basePipelineHandle||i->basePipelineIndex!=-1)return VK_ERROR_INITIALIZATION_FAILED;
    const VkPipelineShaderStageCreateInfo stage=i->stage;
    struct resource *shader=resource_get(RID(stage.module),R_SHADER);
    if(stage.sType!=VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO||stage.pNext||stage.flags||stage.stage!=VK_SHADER_STAGE_COMPUTE_BIT||
       !shader||!shader->host||!stage.pName||strcmp(stage.pName,"main")||stage.pSpecializationInfo)return VK_ERROR_INITIALIZATION_FAILED;
    struct resource *r=resource_new(R_COMPUTE_PIPELINE);if(!r)return VK_ERROR_OUT_OF_HOST_MEMORY;
    VkResult result=compute_resource(GPU_COMPUTE_PIPELINE,&shader->host,4,&r->host);
    if(result!=VK_SUCCESS){resource_drop(r);return result;}
    r->link=RID(i->layout);*out=HANDLE(VkPipeline,r->id);return VK_SUCCESS;
}
static VKAPI_ATTR void VKAPI_CALL destroy_pipeline(VkDevice d,VkPipeline h,const VkAllocationCallbacks *a){destroy_compute_resource(d,RID(h),R_COMPUTE_PIPELINE,a);}
static VKAPI_ATTR VkResult VKAPI_CALL create_descriptor_pool(VkDevice d,const VkDescriptorPoolCreateInfo *i,const VkAllocationCallbacks *a,VkDescriptorPool *out) {
    if(!out)return VK_ERROR_INITIALIZATION_FAILED;
    *out=VK_NULL_HANDLE;
    if(!device_valid(d)||!i||a||i->sType!=VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO||i->pNext||i->flags||i->maxSets!=1||i->poolSizeCount!=1||
       !i->pPoolSizes||i->pPoolSizes[0].type!=VK_DESCRIPTOR_TYPE_STORAGE_BUFFER||i->pPoolSizes[0].descriptorCount!=1)return VK_ERROR_INITIALIZATION_FAILED;
    struct resource *r=resource_new(R_DESC_POOL);if(!r)return VK_ERROR_OUT_OF_HOST_MEMORY;
    *out=HANDLE(VkDescriptorPool,r->id);return VK_SUCCESS;
}
static VKAPI_ATTR void VKAPI_CALL destroy_descriptor_pool(VkDevice d,VkDescriptorPool h,const VkAllocationCallbacks *a) {
    (void)a;struct resource *r=resource_get(RID(h),R_DESC_POOL);if(!device_valid(d)||!r)return;
    for(unsigned n=0;n<MAX_RES;n++)if(resources[n].kind==R_DESC_SET&&resources[n].parent==r->id)resource_drop(&resources[n]);
    resource_drop(r);
}
static VKAPI_ATTR VkResult VKAPI_CALL allocate_descriptor_sets(VkDevice d,const VkDescriptorSetAllocateInfo *i,VkDescriptorSet *out) {
    if(!out)return VK_ERROR_INITIALIZATION_FAILED;
    *out=VK_NULL_HANDLE;
    if(!device_valid(d)||!i||i->sType!=VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO||i->pNext||i->descriptorSetCount!=1||!i->pSetLayouts||
       !resource_get(RID(i->pSetLayouts[0]),R_SET_LAYOUT))return VK_ERROR_INITIALIZATION_FAILED;
    struct resource *p=resource_get(RID(i->descriptorPool),R_DESC_POOL);if(!p)return VK_ERROR_INITIALIZATION_FAILED;
    for(unsigned n=0;n<MAX_RES;n++)if(resources[n].kind==R_DESC_SET&&resources[n].parent==p->id)return VK_ERROR_OUT_OF_POOL_MEMORY;
    struct resource *r=resource_new(R_DESC_SET);if(!r)return VK_ERROR_OUT_OF_HOST_MEMORY;
    r->parent=p->id;*out=HANDLE(VkDescriptorSet,r->id);return VK_SUCCESS;
}
static VKAPI_ATTR void VKAPI_CALL update_descriptor_sets(VkDevice d,uint32_t count,const VkWriteDescriptorSet *writes,uint32_t copies,const VkCopyDescriptorSet *copy) {
    (void)copy;if(!device_valid(d))return;
    /* Invalid updates invalidate addressed sets instead of retaining a stale
     * binding that could make an unsupported write appear successful. */
    if(count>32 || (count&&!writes)){for(unsigned n=0;n<MAX_RES;n++)if(resources[n].kind==R_DESC_SET)resources[n].valid=0;return;}
    for(uint32_t n=0;n<count;n++) {
        const VkWriteDescriptorSet w=writes[n];struct resource *set=resource_get(RID(w.dstSet),R_DESC_SET);if(!set)continue;
        set->valid=0;
        if(copies||w.sType!=VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET||w.pNext||w.dstBinding||w.dstArrayElement||w.descriptorCount!=1||
           w.descriptorType!=VK_DESCRIPTOR_TYPE_STORAGE_BUFFER||!w.pBufferInfo)continue;
        const VkDescriptorBufferInfo b=*w.pBufferInfo;struct resource *buffer=resource_get(RID(b.buffer),R_BUFFER);
        VkDeviceSize range=b.range==VK_WHOLE_SIZE&&buffer?buffer->size:b.range;
        if(!buffer||!buffer->storage||b.offset||range<256||range>buffer->size||range%4)continue;
        set->link=buffer->id;set->range=(size_t)range;set->valid=1;
    }
    if(copies)for(unsigned n=0;n<MAX_RES;n++)if(resources[n].kind==R_DESC_SET)resources[n].valid=0;
}
static VKAPI_ATTR void VKAPI_CALL bind_compute_pipeline(VkCommandBuffer cb,VkPipelineBindPoint point,VkPipeline pipeline) {
    if(cb!=&command||command.state!=2)return;
    if(point!=VK_PIPELINE_BIND_POINT_COMPUTE||!resource_get(RID(pipeline),R_COMPUTE_PIPELINE)){invalid_command(cb);return;}
    command.pipeline=RID(pipeline);
}
static VKAPI_ATTR void VKAPI_CALL bind_descriptor_sets(VkCommandBuffer cb,VkPipelineBindPoint point,VkPipelineLayout layout,uint32_t first,uint32_t count,const VkDescriptorSet *sets,uint32_t dynamic_count,const uint32_t *offsets) {
    (void)offsets;if(cb!=&command||command.state!=2)return;
    if(point!=VK_PIPELINE_BIND_POINT_COMPUTE||!resource_get(RID(layout),R_PIPELINE_LAYOUT)||first||count!=1||!sets||dynamic_count||
       !resource_get(RID(sets[0]),R_DESC_SET)){invalid_command(cb);return;}
    command.set=RID(sets[0]);command.pipeline_layout=RID(layout);
}
static VKAPI_ATTR void VKAPI_CALL dispatch_compute(VkCommandBuffer cb,uint32_t x,uint32_t y,uint32_t z) {
    if(cb!=&command||command.state!=2)return;
    struct resource *pipeline=resource_get(command.pipeline,R_COMPUTE_PIPELINE);
    if(x!=1||y!=1||z!=1||!pipeline||!command.set||pipeline->link!=command.pipeline_layout){invalid_command(cb);return;}
    struct recorded *r=record_command(cb,8);if(r){r->pipeline=command.pipeline;r->set=command.set;}
}
static int record_compute_barrier(VkCommandBuffer cb,VkPipelineStageFlags src,VkPipelineStageFlags dst,const VkBufferMemoryBarrier *bb) {
    struct resource *b=resource_get(RID(bb->buffer),R_BUFFER);if(!b||!b->storage)return 0;
    unsigned op=0;
    if(src==VK_PIPELINE_STAGE_HOST_BIT&&dst==VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT&&bb->srcAccessMask==VK_ACCESS_HOST_WRITE_BIT&&
       bb->dstAccessMask==(VK_ACCESS_SHADER_READ_BIT|VK_ACCESS_SHADER_WRITE_BIT))op=5;
    if(src==VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT&&dst==VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT&&bb->srcAccessMask==VK_ACCESS_SHADER_WRITE_BIT&&
       bb->dstAccessMask==(VK_ACCESS_SHADER_READ_BIT|VK_ACCESS_SHADER_WRITE_BIT))op=6;
    if(src==VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT&&dst==VK_PIPELINE_STAGE_HOST_BIT&&bb->srcAccessMask==VK_ACCESS_SHADER_WRITE_BIT&&bb->dstAccessMask==VK_ACCESS_HOST_READ_BIT)op=7;
    if(!op||bb->sType!=VK_STRUCTURE_TYPE_BUFFER_MEMORY_BARRIER||bb->pNext||bb->srcQueueFamilyIndex!=VK_QUEUE_FAMILY_IGNORED||
       bb->dstQueueFamilyIndex!=VK_QUEUE_FAMILY_IGNORED||bb->offset||bb->size!=VK_WHOLE_SIZE){invalid_command(cb);return 1;}
    struct recorded *r=record_command(cb,op);if(r)r->buffer=b->id;return 1;
}
static VkResult execute_compute(const struct recorded *c) {
    struct resource *b=resource_get(c->buffer,R_BUFFER);
    if(c->op==5){unsigned char data[65548];uint32_t h[3]={b->host,0,(uint32_t)b->size};struct resource *m=resource_get(b->memory,R_MEMORY);
        memcpy(data,h,12);memcpy(data+12,m->bytes,b->size);return compute_empty(GPU_STORAGE_UPLOAD,data,(uint32_t)b->size+12);}
    if(c->op==6)return VK_SUCCESS;
    if(c->op==7){unsigned char data[65536];uint32_t h[3]={b->host,0,(uint32_t)b->size},size=0;
        VkResult result=compute_call(GPU_STORAGE_READBACK,h,12,data,sizeof(data),&size);if(result!=VK_SUCCESS)return result;
        if(size!=b->size){live->failed=1;return VK_ERROR_DEVICE_LOST;}
        struct resource *m=resource_get(b->memory,R_MEMORY);memcpy(m->bytes,data,size);return VK_SUCCESS;}
    if(c->op==8){struct resource *pipeline=resource_get(c->pipeline,R_COMPUTE_PIPELINE),*set=resource_get(c->set,R_DESC_SET);b=resource_get(set->link,R_BUFFER);
        uint32_t h[7]={pipeline->host,b->host,0,(uint32_t)set->range,1,1,1};return compute_empty(GPU_COMPUTE_DISPATCH,h,sizeof(h));}
    return VK_ERROR_INITIALIZATION_FAILED;
}
static PFN_vkVoidFunction compute_proc(const char *name) {
#define P(api,fn) if(!strcmp(name,#api))return (PFN_vkVoidFunction)fn;
    P(vkCreateShaderModule,create_shader) P(vkDestroyShaderModule,destroy_shader)
    P(vkCreateDescriptorSetLayout,create_set_layout) P(vkDestroyDescriptorSetLayout,destroy_set_layout)
    P(vkCreatePipelineLayout,create_pipeline_layout) P(vkDestroyPipelineLayout,destroy_pipeline_layout)
    P(vkCreateComputePipelines,create_compute_pipelines) P(vkDestroyPipeline,destroy_pipeline)
    P(vkCreateDescriptorPool,create_descriptor_pool) P(vkDestroyDescriptorPool,destroy_descriptor_pool)
    P(vkAllocateDescriptorSets,allocate_descriptor_sets) P(vkUpdateDescriptorSets,update_descriptor_sets)
    P(vkCmdBindPipeline,bind_compute_pipeline) P(vkCmdBindDescriptorSets,bind_descriptor_sets) P(vkCmdDispatch,dispatch_compute)
#undef P
    return NULL;
}
