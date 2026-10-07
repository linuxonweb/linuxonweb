/* A3 bounded UNIFORM_BUFFER descriptor profile for graphics pipelines.
 * Opt-in (host HELLO "uniformProfile":1). At most 4 sets x 4 single-element
 * UNIFORM_BUFFER bindings, 8 bindings per pipeline layout, vertex/fragment
 * stages only. No dynamic offsets, arrays, immutable samplers, copies,
 * update templates, free/reset of individual sets or push descriptors.
 * Every snapshot is copied; no caller pointer survives a call. */
#ifdef GUEST_VK_ZINK
/* B2d: Zink (Mesa 26.2.3) binds per-stage push UBOs at the stage index (0..4),
 * other UBOs at 2*n(+1) and samplers at stage*32+n (fragment: 128+n), with
 * UBOs and samplers in different sets. The host accepts bindings 0..15, so the
 * guest keeps Vulkan binding numbers and maps them monotonically (order
 * preserved) when talking to the host: UBOs 0..11 stay; samplers 0..3 (vertex)
 * stay and 128..139 (fragment) become 4..15; anything else is unsupported. */
static inline int zink_host_binding(uint32_t b,int sampler) {
    if(!sampler)return b<12?(int)b:-1;
    return b<4?(int)b:b>=128&&b<140?(int)(b-124):-1;
}
#define HOST_BINDING(b,sampler) ((unsigned)zink_host_binding(b,sampler))
#define BINDING_SUPPORTED(b,sampler) (zink_host_binding(b,sampler)>=0)
#else
#define HOST_BINDING(b,sampler) (b)
#define BINDING_SUPPORTED(b,sampler) ((b)<16)
#endif
/* Host stage bits (bit0 vertex, bit1 fragment). Zink's push set also declares
 * geometry/tessellation/compute stage bindings: those have no host stage and
 * are omitted from host pipelines and draws (the profile has no such stages). */
static inline unsigned uniform_host_stages(VkShaderStageFlags st) {
    return ((st&VK_SHADER_STAGE_VERTEX_BIT)?1u:0u)|((st&VK_SHADER_STAGE_FRAGMENT_BIT)?2u:0u);
}
/* Combined image samplers per pipeline layout: 16 (vertex 4 + fragment 12)
 * when the host advertises 16 sampled textures, else the original 4. */
static unsigned uniform_max_textures(void) {return live&&live->wide_texture_supported?16u:4u;}
static int uniform_layout_equal(const struct uniform_set_layout *a,const struct uniform_set_layout *b) {
    if(a->count!=b->count)return 0;
    for(unsigned n=0;n<a->count;n++)if(a->bindings[n]!=b->bindings[n]||a->stages[n]!=b->stages[n]||a->types[n]!=b->types[n])return 0;
    return 1;
}
static VkResult create_uniform_set_layout(const VkDescriptorSetLayoutCreateInfo *i,VkDescriptorSetLayout *out) {
#ifdef GUEST_VK_ZINK
    /* B2f: Zink set layouts (5-binding gfx push set, per-type program sets)
     * may use every graphics stage and compute (the compute push set); draws
     * still validate the bounded shape. */
    const VkShaderStageFlags stage_mask=VK_SHADER_STAGE_ALL_GRAPHICS|VK_SHADER_STAGE_COMPUTE_BIT;
#else
    const VkShaderStageFlags stage_mask=VK_SHADER_STAGE_VERTEX_BIT|VK_SHADER_STAGE_FRAGMENT_BIT;
#endif
    if(i->bindingCount>UNIFORM_SET_BINDINGS||(i->bindingCount&&!i->pBindings)){
        ZREJ("set_layout REJECT bindings=%u\n",i->bindingCount);return VK_ERROR_INITIALIZATION_FAILED;}
    struct uniform_set_layout l={0};
    for(unsigned n=0;n<i->bindingCount;n++) {
        const VkDescriptorSetLayoutBinding b=i->pBindings[n];
        int sampler=live->texture_supported&&b.descriptorType==VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER;
        if(!BINDING_SUPPORTED(b.binding,b.descriptorType==VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER)||(b.descriptorType!=VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER&&!sampler)||b.descriptorCount!=1||!b.stageFlags||
           (b.stageFlags&~stage_mask)||b.pImmutableSamplers){
            ZREJ("set_layout REJECT binding=%u type=%d count=%u stages=0x%x immutable=%d\n",b.binding,(int)b.descriptorType,b.descriptorCount,(unsigned)b.stageFlags,b.pImmutableSamplers!=NULL);
            return VK_ERROR_INITIALIZATION_FAILED;}
        unsigned slot=l.count;
        while(slot&&l.bindings[slot-1]>b.binding){l.bindings[slot]=l.bindings[slot-1];l.stages[slot]=l.stages[slot-1];l.types[slot]=l.types[slot-1];slot--;}
        if(slot&&l.bindings[slot-1]==b.binding)return VK_ERROR_INITIALIZATION_FAILED;
        l.bindings[slot]=b.binding;l.stages[slot]=b.stageFlags;l.types[slot]=b.descriptorType;l.count++;
    }
    struct resource *r=resource_new(R_SET_LAYOUT);if(!r)return VK_ERROR_OUT_OF_HOST_MEMORY;
    r->uniform=1;r->graphics.set_layout=l;*out=HANDLE(VkDescriptorSetLayout,r->id);return VK_SUCCESS;
}
static int uniform_pipeline_layout(const VkPipelineLayoutCreateInfo *i,struct uniform_pipeline_layout *out) {
    struct uniform_pipeline_layout l={0};unsigned total=0,textures=0;
    if(!i->setLayoutCount||i->setLayoutCount>4||!i->pSetLayouts)return 0;
    for(unsigned n=0;n<i->setLayoutCount;n++) {
        struct resource *s=resource_get(RID(i->pSetLayouts[n]),R_SET_LAYOUT);
        if(!s||!s->uniform)return 0;
        l.sets[n]=s->graphics.set_layout;total+=l.sets[n].count;
        for(unsigned k=0;k<l.sets[n].count;k++)textures+=l.sets[n].types[k]==VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER;
    }
    if(total>8+uniform_max_textures()||textures>uniform_max_textures())return 0;
    l.set_count=i->setLayoutCount;*out=l;return 1;
}
static VkResult allocate_uniform_sets(const VkDescriptorSetAllocateInfo *i,VkDescriptorSet *out) {
    struct resource *p=resource_get(RID(i->descriptorPool),R_DESC_POOL);
#ifdef GUEST_VK_ZINK
    const unsigned max_sets=100; /* Zink's per-call batch (zink_descriptors.c sets_to_alloc) */
#else
    const unsigned max_sets=4;
#endif
    if(!p||!p->uniform||!i->descriptorSetCount||i->descriptorSetCount>max_sets||!i->pSetLayouts){
        ZREJ("allocate_sets REJECT count=%u pool=%d\n",i->descriptorSetCount,p!=NULL);return VK_ERROR_INITIALIZATION_FAILED;}
    for(unsigned n=0;n<i->descriptorSetCount;n++)out[n]=VK_NULL_HANDLE;
    unsigned sets=0,descriptors=0,samplers=0;
    for(unsigned n=0;n<MAX_RES;n++)if(resources[n].kind==R_DESC_SET&&resources[n].parent==p->id){
        const struct uniform_set_layout *l=&resources[n].graphics.set.layout;sets++;
        for(unsigned k=0;k<l->count;k++){if(l->types[k]==VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER)samplers++;else descriptors++;}
    }
    for(unsigned n=0;n<i->descriptorSetCount;n++) {
        struct resource *l=resource_get(RID(i->pSetLayouts[n]),R_SET_LAYOUT);
        if(!l||!l->uniform)return VK_ERROR_INITIALIZATION_FAILED;
        sets++;
        for(unsigned k=0;k<l->graphics.set_layout.count;k++){if(l->graphics.set_layout.types[k]==VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER)samplers++;else descriptors++;}
    }
    if(sets>p->width||descriptors>p->height||samplers>p->sampler_capacity){
        ZINK_TRACE("allocate_sets OUT_OF_POOL sets=%u/%u ubo=%u/%u samplers=%u/%u\n",sets,p->width,descriptors,p->height,samplers,p->sampler_capacity);return VK_ERROR_OUT_OF_POOL_MEMORY;}
    for(unsigned n=0;n<i->descriptorSetCount;n++) {
        struct resource *r=resource_new(R_DESC_SET);
        if(!r) {
            ZINK_FAIL("allocate_sets resource_new failed at %u/%u\n",n,i->descriptorSetCount);
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
    if(slot<s->layout.count&&s->layout.types[slot]==VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER) {
        /* A4: whole sampled image view + profile sampler, SHADER_READ_ONLY. */
        const VkDescriptorImageInfo *t=w->pImageInfo;
        struct resource *sampler=t?resource_get(RID(t->sampler),R_SAMPLER):NULL,*view=t?resource_get(RID(t->imageView),R_IMAGE_VIEW):NULL;
        struct resource *image=view?resource_get(view->graphics.view.image,R_IMAGE):NULL;
        if(copies||w->sType!=VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET||w->pNext||w->dstArrayElement||w->descriptorCount!=1||
           w->descriptorType!=VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER||!t||!sampler||!sampler->host||!view||!image||!image->sampled||
           (t->imageLayout!=VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL&&!(image->depth&&(t->imageLayout==VK_IMAGE_LAYOUT_DEPTH_STENCIL_READ_ONLY_OPTIMAL||
            t->imageLayout==VK_IMAGE_LAYOUT_DEPTH_READ_ONLY_OPTIMAL)))){s->written=0;set->valid=0;return;}
        s->views[slot]=view->id;s->samplers[slot]=sampler->id;s->written|=1u<<slot;
        set->valid=s->written==(1u<<s->layout.count)-1;return;
    }
#ifdef GUEST_VK_ZINK
    /* B2a robustness2 nullDescriptor: a VK_NULL_HANDLE uniform buffer (offset 0,
     * range WHOLE_SIZE) binds a shared host buffer of 16384 zero bytes. */
    if(live->null_descriptor&&!copies&&slot<s->layout.count&&w->sType==VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET&&!w->pNext&&
       !w->dstArrayElement&&w->descriptorCount==1&&w->descriptorType==VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER&&
       s->layout.types[slot]==VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER&&w->pBufferInfo&&w->pBufferInfo->buffer==VK_NULL_HANDLE) {
        if(w->pBufferInfo->offset||w->pBufferInfo->range!=VK_WHOLE_SIZE||zink_null_ubo()!=VK_SUCCESS){s->written=0;set->valid=0;return;}
        s->buffers[slot]=0;s->offsets[slot]=0;s->ranges[slot]=16384;s->written|=1u<<slot;
        set->valid=s->written==(1u<<s->layout.count)-1;return;
    }
#endif
    const VkDescriptorBufferInfo *b=w->pBufferInfo;
    struct resource *buffer=b?resource_get(RID(b->buffer),R_BUFFER):NULL;
    VkDeviceSize range=b&&buffer&&b->range==VK_WHOLE_SIZE&&b->offset<buffer->size?buffer->size-b->offset:b?b->range:0;
#ifdef GUEST_VK_ZINK
    /* B2d: generic uniform buffers; the bound window is staged through the ring
     * at submit, so source offset alignment and range granularity are free. */
    if(!copies&&buffer&&buffer->generic&&(buffer->usage&VK_BUFFER_USAGE_UNIFORM_BUFFER_BIT)&&w->sType==VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET&&
       !w->pNext&&slot<s->layout.count&&!w->dstArrayElement&&w->descriptorCount==1&&w->descriptorType==VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER&&
       s->layout.types[slot]==VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER&&b->offset<buffer->size&&range) {
        s->buffers[slot]=buffer->id;s->offsets[slot]=(uint32_t)b->offset;s->ranges[slot]=(uint32_t)(range>16384?16384:range);
        s->written|=1u<<slot;set->valid=s->written==(1u<<s->layout.count)-1;return;
    }
#endif
    if(copies||w->sType!=VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET||w->pNext||slot==s->layout.count||w->dstArrayElement||
       w->descriptorCount!=1||w->descriptorType!=VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER||s->layout.types[slot]!=VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER||!b||!buffer||!buffer->uniform||
       b->offset%256||b->offset>=buffer->size||range<16||range>16384||range%16||range>buffer->size-b->offset) {
        s->written=0;set->valid=0;return;
    }
    s->buffers[slot]=buffer->id;s->offsets[slot]=(uint32_t)b->offset;s->ranges[slot]=(uint32_t)range;s->written|=1u<<slot;
    set->valid=s->written==(1u<<s->layout.count)-1;
}
static void bind_uniform_sets(VkCommandBuffer cb,VkPipelineLayout layout,uint32_t first,uint32_t count,const VkDescriptorSet *sets,uint32_t dynamic_count) {
    SELECT_CB(cb);
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
    SELECT_CB(cb);
    struct resource *b=resource_get(RID(bb->buffer),R_BUFFER);if(!b||!b->uniform)return 0;
    const VkPipelineStageFlags shaders=VK_PIPELINE_STAGE_VERTEX_SHADER_BIT|VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT;
    if(src!=VK_PIPELINE_STAGE_HOST_BIT||!dst||(dst&~shaders)||bb->srcAccessMask!=VK_ACCESS_HOST_WRITE_BIT||
       bb->dstAccessMask!=VK_ACCESS_UNIFORM_READ_BIT||bb->sType!=VK_STRUCTURE_TYPE_BUFFER_MEMORY_BARRIER||bb->pNext||
       bb->srcQueueFamilyIndex!=VK_QUEUE_FAMILY_IGNORED||bb->dstQueueFamilyIndex!=VK_QUEUE_FAMILY_IGNORED||
       bb->offset||bb->size!=VK_WHOLE_SIZE){invalid_command(cb);return 1;}
    struct recorded *r=record_command(cb,C_UNIFORM_BARRIER);if(r)r->buffer=b->id;return 1;
}
