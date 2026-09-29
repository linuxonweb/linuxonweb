/* A3 bounded UNIFORM_BUFFER descriptor profile for graphics pipelines.
 * Opt-in (host HELLO "uniformProfile":1). At most 4 sets x 4 single-element
 * UNIFORM_BUFFER bindings, 8 bindings per pipeline layout, vertex/fragment
 * stages only. No dynamic offsets, arrays, immutable samplers, copies,
 * update templates, free/reset of individual sets or push descriptors.
 * Every snapshot is copied; no caller pointer survives a call. */
static int uniform_layout_equal(const struct uniform_set_layout *a,const struct uniform_set_layout *b) {
    if(a->count!=b->count)return 0;
    for(unsigned n=0;n<a->count;n++)if(a->bindings[n]!=b->bindings[n]||a->stages[n]!=b->stages[n])return 0;
    return 1;
}
static VkResult create_uniform_set_layout(const VkDescriptorSetLayoutCreateInfo *i,VkDescriptorSetLayout *out) {
    if(i->bindingCount>4||(i->bindingCount&&!i->pBindings))return VK_ERROR_INITIALIZATION_FAILED;
    struct uniform_set_layout l={0};
    for(unsigned n=0;n<i->bindingCount;n++) {
        const VkDescriptorSetLayoutBinding b=i->pBindings[n];
        if(b.binding>=16||b.descriptorType!=VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER||b.descriptorCount!=1||!b.stageFlags||
           (b.stageFlags&~(VkShaderStageFlags)(VK_SHADER_STAGE_VERTEX_BIT|VK_SHADER_STAGE_FRAGMENT_BIT))||b.pImmutableSamplers)
            return VK_ERROR_INITIALIZATION_FAILED;
        unsigned slot=l.count;
        while(slot&&l.bindings[slot-1]>b.binding){l.bindings[slot]=l.bindings[slot-1];l.stages[slot]=l.stages[slot-1];slot--;}
        if(slot&&l.bindings[slot-1]==b.binding)return VK_ERROR_INITIALIZATION_FAILED;
        l.bindings[slot]=b.binding;l.stages[slot]=b.stageFlags;l.count++;
    }
    struct resource *r=resource_new(R_SET_LAYOUT);if(!r)return VK_ERROR_OUT_OF_HOST_MEMORY;
    r->uniform=1;r->graphics.set_layout=l;*out=HANDLE(VkDescriptorSetLayout,r->id);return VK_SUCCESS;
}
static int uniform_pipeline_layout(const VkPipelineLayoutCreateInfo *i,struct uniform_pipeline_layout *out) {
    struct uniform_pipeline_layout l={0};unsigned total=0;
    if(!i->setLayoutCount||i->setLayoutCount>4||!i->pSetLayouts)return 0;
    for(unsigned n=0;n<i->setLayoutCount;n++) {
        struct resource *s=resource_get(RID(i->pSetLayouts[n]),R_SET_LAYOUT);
        if(!s||!s->uniform)return 0;
        l.sets[n]=s->graphics.set_layout;total+=l.sets[n].count;
    }
    if(total>8)return 0;
    l.set_count=i->setLayoutCount;*out=l;return 1;
}
static VkResult allocate_uniform_sets(const VkDescriptorSetAllocateInfo *i,VkDescriptorSet *out) {
    struct resource *p=resource_get(RID(i->descriptorPool),R_DESC_POOL);
    if(!p||!p->uniform||!i->descriptorSetCount||i->descriptorSetCount>4||!i->pSetLayouts)return VK_ERROR_INITIALIZATION_FAILED;
    for(unsigned n=0;n<i->descriptorSetCount;n++)out[n]=VK_NULL_HANDLE;
    unsigned sets=0,descriptors=0;
    for(unsigned n=0;n<MAX_RES;n++)if(resources[n].kind==R_DESC_SET&&resources[n].parent==p->id){sets++;descriptors+=resources[n].graphics.set.layout.count;}
    for(unsigned n=0;n<i->descriptorSetCount;n++) {
        struct resource *l=resource_get(RID(i->pSetLayouts[n]),R_SET_LAYOUT);
        if(!l||!l->uniform)return VK_ERROR_INITIALIZATION_FAILED;
        sets++;descriptors+=l->graphics.set_layout.count;
    }
    if(sets>p->width||descriptors>p->height)return VK_ERROR_OUT_OF_POOL_MEMORY;
    for(unsigned n=0;n<i->descriptorSetCount;n++) {
        struct resource *r=resource_new(R_DESC_SET);
        if(!r) {
            for(unsigned k=0;k<n;k++){resource_drop(resource_get(RID(out[k]),R_DESC_SET));out[k]=VK_NULL_HANDLE;}
            return VK_ERROR_OUT_OF_HOST_MEMORY;
        }
        r->uniform=1;r->parent=p->id;r->graphics.set.layout=resource_get(RID(i->pSetLayouts[n]),R_SET_LAYOUT)->graphics.set_layout;
        r->valid=!r->graphics.set.layout.count;out[n]=HANDLE(VkDescriptorSet,r->id);
    }
    return VK_SUCCESS;
}
/* An unsupported or invalid write clears every binding of the addressed set,
 * so a stale descriptor can never make a rejected update look successful. */
static void update_uniform_set(struct resource *set,const VkWriteDescriptorSet *w,uint32_t copies) {
    struct uniform_set *s=&set->graphics.set;unsigned slot=0;
    while(slot<s->layout.count&&s->layout.bindings[slot]!=w->dstBinding)slot++;
    const VkDescriptorBufferInfo *b=w->pBufferInfo;
    struct resource *buffer=b?resource_get(RID(b->buffer),R_BUFFER):NULL;
    VkDeviceSize range=b&&buffer&&b->range==VK_WHOLE_SIZE&&b->offset<buffer->size?buffer->size-b->offset:b?b->range:0;
    if(copies||w->sType!=VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET||w->pNext||slot==s->layout.count||w->dstArrayElement||
       w->descriptorCount!=1||w->descriptorType!=VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER||!b||!buffer||!buffer->uniform||
       b->offset%256||b->offset>=buffer->size||range<16||range>16384||range%16||range>buffer->size-b->offset) {
        s->written=0;set->valid=0;return;
    }
    s->buffers[slot]=buffer->id;s->offsets[slot]=(uint32_t)b->offset;s->ranges[slot]=(uint32_t)range;s->written|=1u<<slot;
    set->valid=s->written==(1u<<s->layout.count)-1;
}
static void bind_uniform_sets(VkCommandBuffer cb,VkPipelineLayout layout,uint32_t first,uint32_t count,const VkDescriptorSet *sets,uint32_t dynamic_count) {
    struct resource *l=resource_get(RID(layout),R_PIPELINE_LAYOUT);
    if(!live->uniform_supported||!l||!l->graphics_layout||!count||!sets||dynamic_count||
       first>=l->graphics.layout.set_count||count>l->graphics.layout.set_count-first){invalid_command(cb);return;}
    for(unsigned n=0;n<count;n++) {
        struct resource *s=resource_get(RID(sets[n]),R_DESC_SET);
        if(!s||!s->uniform||!uniform_layout_equal(&s->graphics.set.layout,&l->graphics.layout.sets[first+n])){invalid_command(cb);return;}
    }
    for(unsigned n=0;n<count;n++)command.graphics.sets[first+n]=RID(sets[n]);
}
static int record_uniform_barrier(VkCommandBuffer cb,VkPipelineStageFlags src,VkPipelineStageFlags dst,const VkBufferMemoryBarrier *bb) {
    struct resource *b=resource_get(RID(bb->buffer),R_BUFFER);if(!b||!b->uniform)return 0;
    const VkPipelineStageFlags shaders=VK_PIPELINE_STAGE_VERTEX_SHADER_BIT|VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT;
    if(src!=VK_PIPELINE_STAGE_HOST_BIT||!dst||(dst&~shaders)||bb->srcAccessMask!=VK_ACCESS_HOST_WRITE_BIT||
       bb->dstAccessMask!=VK_ACCESS_UNIFORM_READ_BIT||bb->sType!=VK_STRUCTURE_TYPE_BUFFER_MEMORY_BARRIER||bb->pNext||
       bb->srcQueueFamilyIndex!=VK_QUEUE_FAMILY_IGNORED||bb->dstQueueFamilyIndex!=VK_QUEUE_FAMILY_IGNORED||
       bb->offset||bb->size!=VK_WHOLE_SIZE){invalid_command(cb);return 1;}
    struct recorded *r=record_command(cb,C_UNIFORM_BARRIER);if(r)r->buffer=b->id;return 1;
}
