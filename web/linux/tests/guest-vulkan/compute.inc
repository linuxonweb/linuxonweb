/* Deliberately bounded compute profile: one set/binding/storage buffer, one
 * 64x1x1 workgroup. This is not a conformant general Vulkan implementation. */
/* This bounded raw walk selects a translator; it does not substitute for the
 * host's SPIR-V validation, reflection or authoritative stage check. */
static VkShaderStageFlagBits shader_execution_stage(const unsigned char *bytes,size_t size) {
    const uint32_t *words=(const uint32_t *)bytes;size_t count=size/4;unsigned entries=0;VkShaderStageFlagBits stage=0;
    if(count<5||words[0]!=0x07230203)return 0;
    for(size_t at=5;at<count;) {
        unsigned length=words[at]>>16,op=words[at]&65535;
        if(!length||length>count-at)return 0;
        if(op==15) {
            if(++entries!=1||length<4)return 0;
            const char *name=(const char *)&words[at+3];size_t capacity=(length-3)*4;
            const char *end=memchr(name,0,capacity);
            if(!end||end==name||(size_t)(end-name)>128)return 0;
            switch(words[at+1]) {case 0:stage=VK_SHADER_STAGE_VERTEX_BIT;break;case 4:stage=VK_SHADER_STAGE_FRAGMENT_BIT;break;
                case 5:stage=VK_SHADER_STAGE_COMPUTE_BIT;break;default:return 0;}
        }
        at+=length;
    }
    return entries==1?stage:0;
}
#include "uniform.inc"
static int compute_layout_valid(uint64_t id) {
    struct resource *r=resource_get(id,R_PIPELINE_LAYOUT);return r&&!r->graphics_layout;
}
static VKAPI_ATTR VkResult VKAPI_CALL create_shader(VkDevice d,const VkShaderModuleCreateInfo *i,const VkAllocationCallbacks *a,VkShaderModule *out) {
    if(!out)return VK_ERROR_INITIALIZATION_FAILED;
    *out=VK_NULL_HANDLE;
    if(!device_valid(d)||(!live->compute_supported&&!live->graphics_supported)||!i||a||i->sType!=VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO||i->pNext||i->flags||
       !i->pCode||i->codeSize<20||i->codeSize>65536||i->codeSize%4)return VK_ERROR_INITIALIZATION_FAILED;
    struct resource *r=resource_new(R_SHADER);if(!r)return VK_ERROR_OUT_OF_HOST_MEMORY;
    r->bytes=malloc(i->codeSize);if(!r->bytes){resource_drop(r);return VK_ERROR_OUT_OF_HOST_MEMORY;}
    r->size=i->codeSize;memcpy(r->bytes,i->pCode,i->codeSize);
    r->shader_stage=shader_execution_stage(r->bytes,r->size);
    if(!r->shader_stage||(r->shader_stage==VK_SHADER_STAGE_COMPUTE_BIT?!live->compute_supported:!live->graphics_supported)) {
        resource_drop(r);return VK_ERROR_INITIALIZATION_FAILED;
    }
    VkResult result=compute_resource(r->shader_stage==VK_SHADER_STAGE_COMPUTE_BIT?GPU_SPIRV_SHADER:GPU_GRAPHICS_SHADER,r->bytes,(uint32_t)r->size,&r->host);
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
    if(!device_valid(d)||!i||a||i->sType!=VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO||i->pNext||i->flags){
        if(i)ZINK_TRACE("set_layout REJECT flags=0x%x pNext=%d bindings=%u\n",(unsigned)i->flags,i->pNext?(int)((const VkBaseInStructure*)i->pNext)->sType:0,i->bindingCount);
        return VK_ERROR_INITIALIZATION_FAILED;}
    if(live->uniform_supported&&(i->bindingCount!=1||(i->pBindings&&i->pBindings[0].descriptorType!=VK_DESCRIPTOR_TYPE_STORAGE_BUFFER)))
        return create_uniform_set_layout(i,out);
    if(i->bindingCount!=1||!i->pBindings)return VK_ERROR_INITIALIZATION_FAILED;
    const VkDescriptorSetLayoutBinding b=*i->pBindings;
    if(b.binding||b.descriptorType!=VK_DESCRIPTOR_TYPE_STORAGE_BUFFER||b.descriptorCount!=1||b.stageFlags!=VK_SHADER_STAGE_COMPUTE_BIT||b.pImmutableSamplers)return VK_ERROR_INITIALIZATION_FAILED;
    struct resource *r=resource_new(R_SET_LAYOUT);if(!r)return VK_ERROR_OUT_OF_HOST_MEMORY;
    *out=HANDLE(VkDescriptorSetLayout,r->id);return VK_SUCCESS;
}
static VKAPI_ATTR void VKAPI_CALL destroy_set_layout(VkDevice d,VkDescriptorSetLayout h,const VkAllocationCallbacks *a){destroy_compute_resource(d,RID(h),R_SET_LAYOUT,a);}
static VKAPI_ATTR VkResult VKAPI_CALL create_pipeline_layout(VkDevice d,const VkPipelineLayoutCreateInfo *i,const VkAllocationCallbacks *a,VkPipelineLayout *out) {
    if(!out)return VK_ERROR_INITIALIZATION_FAILED;
    *out=VK_NULL_HANDLE;
#ifdef GUEST_VK_ZINK
    /* B2a: graphics layouts may declare push-constant ranges within the
     * advertised 128 bytes (Zink's gfx_push_constant layout, 52 bytes). The
     * range is recorded only; vkCmdPushConstants and shader push-constant
     * blocks are not implemented yet (B2c), so pipelines that read them fail. */
    unsigned push_size=0;
    if(i&&i->pushConstantRangeCount){
        if(!i->pPushConstantRanges||i->pushConstantRangeCount>2)return VK_ERROR_INITIALIZATION_FAILED;
        for(unsigned n=0;n<i->pushConstantRangeCount;n++){
            const VkPushConstantRange *pr=&i->pPushConstantRanges[n];
            if(!pr->stageFlags||(pr->stageFlags&~(VkShaderStageFlags)VK_SHADER_STAGE_ALL_GRAPHICS)||
               !pr->size||(pr->offset&3)||(pr->size&3)||pr->offset>128||pr->size>128-pr->offset)return VK_ERROR_INITIALIZATION_FAILED;
            if(pr->offset+pr->size>push_size)push_size=pr->offset+pr->size;
        }
    }
    if(!device_valid(d)||!i||a||i->sType!=VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO||i->pNext||i->flags)return VK_ERROR_INITIALIZATION_FAILED;
    int graphics=live->graphics_supported&&!i->setLayoutCount;
    if(push_size&&!live->graphics_supported)return VK_ERROR_INITIALIZATION_FAILED;
#else
    if(!device_valid(d)||!i||a||i->sType!=VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO||i->pNext||i->flags||i->pushConstantRangeCount)return VK_ERROR_INITIALIZATION_FAILED;
    int graphics=live->graphics_supported&&!i->setLayoutCount;
#endif
    struct uniform_pipeline_layout uniforms={0};
    if(!graphics&&live->uniform_supported&&i->setLayoutCount&&i->pSetLayouts&&uniform_pipeline_layout(i,&uniforms))graphics=1;
    else if(!graphics&&(!live->compute_supported||i->setLayoutCount!=1||!i->pSetLayouts||
       !resource_get(RID(i->pSetLayouts[0]),R_SET_LAYOUT)||resource_get(RID(i->pSetLayouts[0]),R_SET_LAYOUT)->uniform))return VK_ERROR_INITIALIZATION_FAILED;
#ifdef GUEST_VK_ZINK
    if(push_size&&!graphics)return VK_ERROR_INITIALIZATION_FAILED;
#endif
    struct resource *r=resource_new(R_PIPELINE_LAYOUT);if(!r)return VK_ERROR_OUT_OF_HOST_MEMORY;
    r->graphics_layout=graphics;r->graphics.layout=uniforms;
#ifdef GUEST_VK_ZINK
    r->push_size=push_size;
#endif
    /* All supported layouts have exactly the same immutable binding shape. */
    *out=HANDLE(VkPipelineLayout,r->id);return VK_SUCCESS;
}
static VKAPI_ATTR void VKAPI_CALL destroy_pipeline_layout(VkDevice d,VkPipelineLayout h,const VkAllocationCallbacks *a){destroy_compute_resource(d,RID(h),R_PIPELINE_LAYOUT,a);}
static VKAPI_ATTR VkResult VKAPI_CALL create_compute_pipelines(VkDevice d,VkPipelineCache cache,uint32_t count,const VkComputePipelineCreateInfo *i,const VkAllocationCallbacks *a,VkPipeline *out) {
    if(!out||count!=1)return VK_ERROR_INITIALIZATION_FAILED;
    *out=VK_NULL_HANDLE;
    if(!device_valid(d)||cache||!i||a||i->sType!=VK_STRUCTURE_TYPE_COMPUTE_PIPELINE_CREATE_INFO||i->pNext||i->flags||
       !compute_layout_valid(RID(i->layout))||i->basePipelineHandle||i->basePipelineIndex!=-1)return VK_ERROR_INITIALIZATION_FAILED;
    const VkPipelineShaderStageCreateInfo stage=i->stage;
    struct resource *shader=resource_get(RID(stage.module),R_SHADER);
    if(stage.sType!=VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO||stage.pNext||stage.flags||stage.stage!=VK_SHADER_STAGE_COMPUTE_BIT||
       !shader||shader->shader_stage!=VK_SHADER_STAGE_COMPUTE_BIT||!shader->host||!stage.pName||strcmp(stage.pName,"main")||stage.pSpecializationInfo)return VK_ERROR_INITIALIZATION_FAILED;
    struct resource *r=resource_new(R_COMPUTE_PIPELINE);if(!r)return VK_ERROR_OUT_OF_HOST_MEMORY;
    VkResult result=compute_resource(GPU_COMPUTE_PIPELINE,&shader->host,4,&r->host);
    if(result!=VK_SUCCESS){resource_drop(r);return result;}
    r->link=RID(i->layout);*out=HANDLE(VkPipeline,r->id);return VK_SUCCESS;
}
static VKAPI_ATTR void VKAPI_CALL destroy_pipeline(VkDevice d,VkPipeline h,const VkAllocationCallbacks *a){
    destroy_compute_resource(d,RID(h),R_COMPUTE_PIPELINE,a);destroy_compute_resource(d,RID(h),R_GRAPHICS_PIPELINE,a);
}
static VKAPI_ATTR VkResult VKAPI_CALL create_descriptor_pool(VkDevice d,const VkDescriptorPoolCreateInfo *i,const VkAllocationCallbacks *a,VkDescriptorPool *out) {
    if(!out)return VK_ERROR_INITIALIZATION_FAILED;
    *out=VK_NULL_HANDLE;
    if(!device_valid(d)||!i||a||i->sType!=VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO||i->pNext||i->flags)return VK_ERROR_INITIALIZATION_FAILED;
    int uniform=live->uniform_supported&&i->poolSizeCount==1&&i->pPoolSizes&&i->pPoolSizes[0].type==VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER&&
        i->maxSets>=1&&i->maxSets<=8&&i->pPoolSizes[0].descriptorCount>=1&&i->pPoolSizes[0].descriptorCount<=32;
    unsigned uniform_count=uniform?i->pPoolSizes[0].descriptorCount:0,sampler_count=0;
    /* A4: one or two distinct UNIFORM_BUFFER/COMBINED_IMAGE_SAMPLER sizes. */
    if(!uniform&&live->texture_supported&&i->poolSizeCount>=1&&i->poolSizeCount<=2&&i->pPoolSizes&&i->maxSets>=1&&i->maxSets<=8) {
        int ok=1;
        for(uint32_t n=0;n<i->poolSizeCount&&ok;n++) {
            const VkDescriptorPoolSize z=i->pPoolSizes[n];
            if(z.descriptorCount<1||z.descriptorCount>32)ok=0;
            else if(z.type==VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER&&!uniform_count)uniform_count=z.descriptorCount;
            else if(z.type==VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER&&!sampler_count)sampler_count=z.descriptorCount;
            else ok=0;
        }
        if(ok&&sampler_count)uniform=1;else uniform_count=sampler_count=0;
    }
#ifdef GUEST_VK_ZINK
    /* B2f: Zink's push/lazy pools size UNIFORM_BUFFER by ZINK_GFX_SHADER_COUNT*
     * MAX_LAZY_DESCRIPTORS and add INPUT_ATTACHMENT etc.; record them as
     * capacity only (sets still only hold layouts the ICD accepted). */
    if(!uniform&&live->uniform_supported&&i->maxSets>=1&&i->poolSizeCount>=1&&i->poolSizeCount<=16&&i->pPoolSizes){
        unsigned ub=0,cis=0;int ok=1;
        for(uint32_t n=0;n<i->poolSizeCount&&ok;n++){
            const VkDescriptorPoolSize z=i->pPoolSizes[n];
            if(!z.descriptorCount)ok=0;
            else if(z.type==VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER)ub+=z.descriptorCount;
            else if(z.type==VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER)cis+=z.descriptorCount;
            else if(z.type>VK_DESCRIPTOR_TYPE_INPUT_ATTACHMENT)ok=0; /* other core types: capacity ignored */
        }
        if(ok){uniform=1;uniform_count=ub;sampler_count=cis;}
        else ZINK_TRACE("create_descriptor_pool REJECT maxSets=%u sizes=%u\n",i->maxSets,i->poolSizeCount);
    }
#endif
    if(!uniform&&(i->maxSets!=1||i->poolSizeCount!=1||
       !i->pPoolSizes||i->pPoolSizes[0].type!=VK_DESCRIPTOR_TYPE_STORAGE_BUFFER||i->pPoolSizes[0].descriptorCount!=1))return VK_ERROR_INITIALIZATION_FAILED;
    struct resource *r=resource_new(R_DESC_POOL);if(!r)return VK_ERROR_OUT_OF_HOST_MEMORY;
    /* Uniform pools record capacity: width=max sets, height=descriptors. */
    if(uniform){r->uniform=1;r->width=i->maxSets;r->height=uniform_count;r->sampler_capacity=sampler_count;}
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
    if(device_valid(d)&&i&&i->sType==VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO&&!i->pNext&&
       resource_get(RID(i->descriptorPool),R_DESC_POOL)&&resource_get(RID(i->descriptorPool),R_DESC_POOL)->uniform)
        return allocate_uniform_sets(i,out);
    if(!device_valid(d)||!i||i->sType!=VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO||i->pNext||i->descriptorSetCount!=1||!i->pSetLayouts||
       !resource_get(RID(i->pSetLayouts[0]),R_SET_LAYOUT)||resource_get(RID(i->pSetLayouts[0]),R_SET_LAYOUT)->uniform)return VK_ERROR_INITIALIZATION_FAILED;
    struct resource *p=resource_get(RID(i->descriptorPool),R_DESC_POOL);if(!p)return VK_ERROR_INITIALIZATION_FAILED;
    for(unsigned n=0;n<MAX_RES;n++)if(resources[n].kind==R_DESC_SET&&resources[n].parent==p->id)return VK_ERROR_OUT_OF_POOL_MEMORY;
    struct resource *r=resource_new(R_DESC_SET);if(!r)return VK_ERROR_OUT_OF_HOST_MEMORY;
    r->parent=p->id;*out=HANDLE(VkDescriptorSet,r->id);return VK_SUCCESS;
}
static VKAPI_ATTR void VKAPI_CALL update_descriptor_sets(VkDevice d,uint32_t count,const VkWriteDescriptorSet *writes,uint32_t copies,const VkCopyDescriptorSet *copy) {
    (void)copy;if(!device_valid(d))return;
    /* Invalid updates invalidate addressed sets instead of retaining a stale
     * binding that could make an unsupported write appear successful. */
    if(count>32 || (count&&!writes)){for(unsigned n=0;n<MAX_RES;n++)if(resources[n].kind==R_DESC_SET){resources[n].valid=0;resources[n].graphics.set.written=0;}return;}
    for(uint32_t n=0;n<count;n++) {
        const VkWriteDescriptorSet w=writes[n];struct resource *set=resource_get(RID(w.dstSet),R_DESC_SET);if(!set)continue;
        if(set->uniform){update_uniform_set(set,&w,copies);continue;}
        set->valid=0;
        if(copies||w.sType!=VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET||w.pNext||w.dstBinding||w.dstArrayElement||w.descriptorCount!=1||
           w.descriptorType!=VK_DESCRIPTOR_TYPE_STORAGE_BUFFER||!w.pBufferInfo)continue;
        const VkDescriptorBufferInfo b=*w.pBufferInfo;struct resource *buffer=resource_get(RID(b.buffer),R_BUFFER);
        VkDeviceSize range=b.range==VK_WHOLE_SIZE&&buffer?buffer->size:b.range;
        if(!buffer||!buffer->storage||b.offset||range<256||range>buffer->size||range%4)continue;
        set->link=buffer->id;set->range=(size_t)range;set->valid=1;
    }
    if(copies)for(unsigned n=0;n<MAX_RES;n++)if(resources[n].kind==R_DESC_SET){resources[n].valid=0;resources[n].graphics.set.written=0;}
}
static VKAPI_ATTR void VKAPI_CALL bind_compute_pipeline(VkCommandBuffer cb,VkPipelineBindPoint point,VkPipeline pipeline) {
    SELECT_CB(cb);
    if(cb!=&command||command.state!=2)return;
    if(command.graphics.in_pass||!live->compute_supported||point!=VK_PIPELINE_BIND_POINT_COMPUTE||!resource_get(RID(pipeline),R_COMPUTE_PIPELINE)){invalid_command(cb);return;}
    command.pipeline=RID(pipeline);
}
static VKAPI_ATTR void VKAPI_CALL bind_descriptor_sets(VkCommandBuffer cb,VkPipelineBindPoint point,VkPipelineLayout layout,uint32_t first,uint32_t count,const VkDescriptorSet *sets,uint32_t dynamic_count,const uint32_t *offsets) {
    SELECT_CB(cb);
    (void)offsets;if(cb!=&command||command.state!=2)return;
    if(point==VK_PIPELINE_BIND_POINT_GRAPHICS){bind_uniform_sets(cb,layout,first,count,sets,dynamic_count);return;}
    if(command.graphics.in_pass||point!=VK_PIPELINE_BIND_POINT_COMPUTE||!compute_layout_valid(RID(layout))||first||count!=1||!sets||dynamic_count||
       !resource_get(RID(sets[0]),R_DESC_SET)){invalid_command(cb);return;}
    command.set=RID(sets[0]);command.pipeline_layout=RID(layout);
}
static VKAPI_ATTR void VKAPI_CALL dispatch_compute(VkCommandBuffer cb,uint32_t x,uint32_t y,uint32_t z) {
    SELECT_CB(cb);
    if(cb!=&command||command.state!=2)return;
    struct resource *pipeline=resource_get(command.pipeline,R_COMPUTE_PIPELINE);
    if(command.graphics.in_pass||x!=1||y!=1||z!=1||!pipeline||!command.set||pipeline->link!=command.pipeline_layout){invalid_command(cb);return;}
    struct recorded *r=record_command(cb,8);if(r){r->pipeline=command.pipeline;r->set=command.set;}
}
static int record_compute_barrier(VkCommandBuffer cb,VkPipelineStageFlags src,VkPipelineStageFlags dst,const VkBufferMemoryBarrier *bb) {
    SELECT_CB(cb);
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
        memcpy(data,h,12);memcpy(data+12,m->bytes+b->offset,b->size);return compute_empty(GPU_STORAGE_UPLOAD,data,(uint32_t)b->size+12);}
    if(c->op==6)return VK_SUCCESS;
    if(c->op==7){unsigned char data[65536];uint32_t h[3]={b->host,0,(uint32_t)b->size},size=0;
        VkResult result=compute_call(GPU_STORAGE_READBACK,h,12,data,sizeof(data),&size);if(result!=VK_SUCCESS)return result;
        if(size!=b->size){live->failed=1;return VK_ERROR_DEVICE_LOST;}
        struct resource *m=resource_get(b->memory,R_MEMORY);memcpy(m->bytes+b->offset,data,size);return VK_SUCCESS;}
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
