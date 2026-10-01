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
static void zink_cleanup(void) {
    if(zink_null_ubo_host&&live&&!live->failed)(void)host_empty(GPU_DESTROY,&zink_null_ubo_host,4);
    zink_null_ubo_host=0;
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
    if(cb!=&command||command.state!=2)return;
    if(!s||s->sType!=VK_STRUCTURE_TYPE_SUBPASS_BEGIN_INFO||s->pNext){invalid_command(cb);return;}
    begin_graphics_pass(cb,b,s->contents);
}
static VKAPI_ATTR void VKAPI_CALL zink_next_subpass2(VkCommandBuffer cb,const VkSubpassBeginInfo *b,const VkSubpassEndInfo *e) {
    (void)b;(void)e;invalid_command(cb); /* only single-subpass passes exist */
}
static VKAPI_ATTR void VKAPI_CALL zink_end_render_pass2(VkCommandBuffer cb,const VkSubpassEndInfo *e) {
    if(cb!=&command||command.state!=2)return;
    if(!e||e->sType!=VK_STRUCTURE_TYPE_SUBPASS_END_INFO||e->pNext){invalid_command(cb);return;}
    end_graphics_pass(cb);
}

/* ---- dynamic rendering --------------------------------------------------- */
static VKAPI_ATTR void VKAPI_CALL zink_begin_rendering(VkCommandBuffer cb,const VkRenderingInfo *r) {
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
    struct graphics_begin_record b={0};
    b.pass=(struct graphics_pass){.format=VK_FORMAT_R8G8B8A8_UNORM,.samples=VK_SAMPLE_COUNT_1_BIT,.load=c->loadOp,.store=c->storeOp,
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
    if(cb!=&command||command.state!=2)return;
    end_graphics_pass(cb);
}

/* ---- descriptor update templates ----------------------------------------- */
#define ZINK_TEMPLATE_ENTRIES 4
static struct { unsigned count; VkDescriptorUpdateTemplateEntry e[ZINK_TEMPLATE_ENTRIES]; } zink_templates[MAX_RES];
static VKAPI_ATTR VkResult VKAPI_CALL zink_create_update_template(VkDevice d,const VkDescriptorUpdateTemplateCreateInfo *i,
        const VkAllocationCallbacks *a,VkDescriptorUpdateTemplate *out) {
    if(!out)return VK_ERROR_INITIALIZATION_FAILED;
    *out=VK_NULL_HANDLE;
    if(!device_valid(d)||!live->uniform_supported||!i||a||i->sType!=VK_STRUCTURE_TYPE_DESCRIPTOR_UPDATE_TEMPLATE_CREATE_INFO||i->pNext||i->flags||
       !i->descriptorUpdateEntryCount||i->descriptorUpdateEntryCount>ZINK_TEMPLATE_ENTRIES||!i->pDescriptorUpdateEntries||
       i->templateType!=VK_DESCRIPTOR_UPDATE_TEMPLATE_TYPE_DESCRIPTOR_SET||!resource_get(RID(i->descriptorSetLayout),R_SET_LAYOUT))
        return VK_ERROR_INITIALIZATION_FAILED;
    for(uint32_t n=0;n<i->descriptorUpdateEntryCount;n++) {
        const VkDescriptorUpdateTemplateEntry *e=&i->pDescriptorUpdateEntries[n];
        if(e->dstArrayElement||e->descriptorCount!=1||(e->descriptorType!=VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER&&
           e->descriptorType!=VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER))return VK_ERROR_FEATURE_NOT_PRESENT;
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

static PFN_vkVoidFunction zink_proc(const char *name) {
#define Z(api,fn) if(!strcmp(name,#api))return (PFN_vkVoidFunction)fn;
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
