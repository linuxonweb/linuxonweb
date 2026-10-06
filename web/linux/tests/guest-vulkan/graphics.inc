/* Bounded resources for an explicitly NONCONFORMANT graphics profile.
 * All state is copied, typed and bounded; host translation validates real SPIR-V. */
#include <stdarg.h>

static VKAPI_ATTR VkResult VKAPI_CALL create_image_view(VkDevice d,const VkImageViewCreateInfo *i,const VkAllocationCallbacks *a,VkImageView *out) {
    if(!out)return VK_ERROR_INITIALIZATION_FAILED;
    *out=VK_NULL_HANDLE;
    if(!device_valid(d)||!live->graphics_supported||!i||a||i->sType!=VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO||i->pNext||i->flags||
       i->viewType!=VK_IMAGE_VIEW_TYPE_2D)return VK_ERROR_INITIALIZATION_FAILED;
    /* A5: depth views must name the image's own depth format and DEPTH aspect. */
    int depth_view=live->depth_supported&&depth_code(i->format);
    if(depth_view?!depth_range(&i->subresourceRange):(!color_format(i->format)||!full_range(&i->subresourceRange)))return VK_ERROR_INITIALIZATION_FAILED;
    const VkComponentMapping c=i->components;
    if((c.r!=VK_COMPONENT_SWIZZLE_IDENTITY&&c.r!=VK_COMPONENT_SWIZZLE_R)||
       (c.g!=VK_COMPONENT_SWIZZLE_IDENTITY&&c.g!=VK_COMPONENT_SWIZZLE_G)||
       (c.b!=VK_COMPONENT_SWIZZLE_IDENTITY&&c.b!=VK_COMPONENT_SWIZZLE_B)||
       (c.a!=VK_COMPONENT_SWIZZLE_IDENTITY&&c.a!=VK_COMPONENT_SWIZZLE_A))return VK_ERROR_FEATURE_NOT_PRESENT;
    struct resource *image=resource_get(RID(i->image),R_IMAGE);
    if(!image||!(depth_view?image->depth==depth_code(i->format):((image->graphics_target||image->sampled)&&i->format==image_color_format(image)))||!image->host||
       !resource_get(image->memory,R_MEMORY))return VK_ERROR_INITIALIZATION_FAILED;
    struct resource *r=resource_new(R_IMAGE_VIEW);if(!r)return VK_ERROR_OUT_OF_HOST_MEMORY;
    r->graphics.view.image=image->id;*out=HANDLE(VkImageView,r->id);return VK_SUCCESS;
}
static VKAPI_ATTR void VKAPI_CALL destroy_image_view(VkDevice d,VkImageView h,const VkAllocationCallbacks *a){destroy_compute_resource(d,RID(h),R_IMAGE_VIEW,a);}

static VKAPI_ATTR VkResult VKAPI_CALL create_render_pass(VkDevice d,const VkRenderPassCreateInfo *i,const VkAllocationCallbacks *a,VkRenderPass *out) {
    if(!out)return VK_ERROR_INITIALIZATION_FAILED;
    *out=VK_NULL_HANDLE;
    if(!device_valid(d)||!live->graphics_supported||!i||a||i->sType!=VK_STRUCTURE_TYPE_RENDER_PASS_CREATE_INFO||i->pNext||i->flags||
       !i->attachmentCount||i->attachmentCount>(live->depth_supported?2u:1u)||!i->pAttachments||i->subpassCount!=1||!i->pSubpasses||i->dependencyCount)return VK_ERROR_INITIALIZATION_FAILED;
    const VkAttachmentDescription attachment=i->pAttachments[0];const VkSubpassDescription subpass=i->pSubpasses[0];
    if(attachment.flags||!color_format(attachment.format)||attachment.samples!=VK_SAMPLE_COUNT_1_BIT||
       (attachment.loadOp!=VK_ATTACHMENT_LOAD_OP_CLEAR&&attachment.loadOp!=VK_ATTACHMENT_LOAD_OP_LOAD)||
       attachment.storeOp!=VK_ATTACHMENT_STORE_OP_STORE||attachment.stencilLoadOp!=VK_ATTACHMENT_LOAD_OP_DONT_CARE||
       attachment.stencilStoreOp!=VK_ATTACHMENT_STORE_OP_DONT_CARE||attachment.initialLayout!=VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL||
       attachment.finalLayout!=VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL||subpass.flags||subpass.pipelineBindPoint!=VK_PIPELINE_BIND_POINT_GRAPHICS||
       subpass.inputAttachmentCount||subpass.colorAttachmentCount!=1||!subpass.pColorAttachments||subpass.pResolveAttachments||
       (i->attachmentCount==2)!=(subpass.pDepthStencilAttachment!=NULL)||subpass.preserveAttachmentCount||subpass.pColorAttachments[0].attachment||
       subpass.pColorAttachments[0].layout!=VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL)return VK_ERROR_FEATURE_NOT_PRESENT;
    struct graphics_pass pass={.format=attachment.format,.samples=attachment.samples,.load=attachment.loadOp,.store=attachment.storeOp,.initial=attachment.initialLayout,.final=attachment.finalLayout};
    if(i->attachmentCount==2) {
        /* A5: attachment 1 is a D32/D16 depth attachment in DEPTH_STENCIL_ATTACHMENT_OPTIMAL
         * throughout; stencil operations must be DONT_CARE (no stencil formats exist). */
        const VkAttachmentDescription depth=i->pAttachments[1];const VkAttachmentReference *ref=subpass.pDepthStencilAttachment;
        if(depth.flags||!depth_code(depth.format)||depth.samples!=VK_SAMPLE_COUNT_1_BIT||
           (depth.loadOp!=VK_ATTACHMENT_LOAD_OP_CLEAR&&depth.loadOp!=VK_ATTACHMENT_LOAD_OP_LOAD&&depth.loadOp!=VK_ATTACHMENT_LOAD_OP_DONT_CARE)||
           (depth.storeOp!=VK_ATTACHMENT_STORE_OP_STORE&&depth.storeOp!=VK_ATTACHMENT_STORE_OP_DONT_CARE)||
           depth.stencilLoadOp!=VK_ATTACHMENT_LOAD_OP_DONT_CARE||depth.stencilStoreOp!=VK_ATTACHMENT_STORE_OP_DONT_CARE||
           depth.initialLayout!=VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL||depth.finalLayout!=VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL||
           ref->attachment!=1||ref->layout!=VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL)return VK_ERROR_FEATURE_NOT_PRESENT;
        pass.depth_format=depth.format;pass.depth_load=depth.loadOp;pass.depth_store=depth.storeOp;
        pass.depth_initial=depth.initialLayout;pass.depth_final=depth.finalLayout;
    }
    struct resource *r=resource_new(R_RENDER_PASS);if(!r)return VK_ERROR_OUT_OF_HOST_MEMORY;
    r->graphics.pass=pass;
    *out=HANDLE(VkRenderPass,r->id);return VK_SUCCESS;
}
static VKAPI_ATTR void VKAPI_CALL destroy_render_pass(VkDevice d,VkRenderPass h,const VkAllocationCallbacks *a){destroy_compute_resource(d,RID(h),R_RENDER_PASS,a);}
static VKAPI_ATTR void VKAPI_CALL render_area_granularity(VkDevice d,VkRenderPass h,VkExtent2D *out) {
    if(out)*out=device_valid(d)&&resource_get(RID(h),R_RENDER_PASS)?(VkExtent2D){1,1}:(VkExtent2D){0,0};
}
static VKAPI_ATTR VkResult VKAPI_CALL create_framebuffer(VkDevice d,const VkFramebufferCreateInfo *i,const VkAllocationCallbacks *a,VkFramebuffer *out) {
    if(!out)return VK_ERROR_INITIALIZATION_FAILED;
    *out=VK_NULL_HANDLE;
    if(!device_valid(d)||!live->graphics_supported||!i||a||i->sType!=VK_STRUCTURE_TYPE_FRAMEBUFFER_CREATE_INFO||i->pNext||i->flags||
       !i->attachmentCount||i->attachmentCount>2||!i->pAttachments||i->layers!=1)return VK_ERROR_INITIALIZATION_FAILED;
    struct resource *pass=resource_get(RID(i->renderPass),R_RENDER_PASS),*view=resource_get(RID(i->pAttachments[0]),R_IMAGE_VIEW);
    struct resource *image=view?resource_get(view->graphics.view.image,R_IMAGE):NULL;
    if(!pass||!image||!image->graphics_target||!image->host||!resource_get(image->memory,R_MEMORY)||image_color_format(image)!=pass->graphics.pass.format||
       i->width!=image->width||i->height!=image->height||i->attachmentCount!=(pass->graphics.pass.depth_format?2u:1u))return VK_ERROR_INITIALIZATION_FAILED;
    struct resource *depth_view=NULL,*depth=NULL;
    if(i->attachmentCount==2) {
        /* A5: the depth view's image must match the pass format and the framebuffer extent exactly. */
        depth_view=resource_get(RID(i->pAttachments[1]),R_IMAGE_VIEW);
        depth=depth_view?resource_get(depth_view->graphics.view.image,R_IMAGE):NULL;
        if(!depth||!depth->depth||depth->depth!=depth_code(pass->graphics.pass.depth_format)||!depth->host||
           !resource_get(depth->memory,R_MEMORY)||depth->width!=image->width||depth->height!=image->height)return VK_ERROR_INITIALIZATION_FAILED;
    }
    struct resource *r=resource_new(R_FRAMEBUFFER);if(!r)return VK_ERROR_OUT_OF_HOST_MEMORY;
    r->graphics.framebuffer=(struct graphics_framebuffer){view->id,image->id,i->width,i->height,pass->graphics.pass,
        depth_view?depth_view->id:0,depth?depth->id:0};
    *out=HANDLE(VkFramebuffer,r->id);return VK_SUCCESS;
}
static VKAPI_ATTR void VKAPI_CALL destroy_framebuffer(VkDevice d,VkFramebuffer h,const VkAllocationCallbacks *a){destroy_compute_resource(d,RID(h),R_FRAMEBUFFER,a);}

/* Host slots use sorted Vulkan binding numbers, independently of declaration
 * order. No attribute or layout points into caller-owned memory after return. */
static unsigned graphics_format_components(VkFormat f) {
    return f==VK_FORMAT_R32G32_SFLOAT?2:f==VK_FORMAT_R32G32B32_SFLOAT?3:f==VK_FORMAT_R32G32B32A32_SFLOAT?4:0;
}
static int graphics_vertex_layout(const VkPipelineVertexInputStateCreateInfo *i,struct graphics_pipeline *p) {
    if(!i||i->sType!=VK_STRUCTURE_TYPE_PIPELINE_VERTEX_INPUT_STATE_CREATE_INFO||i->pNext||i->flags||
       i->vertexBindingDescriptionCount>8||i->vertexAttributeDescriptionCount>8||
       (i->vertexBindingDescriptionCount&&!i->pVertexBindingDescriptions)||
       (i->vertexAttributeDescriptionCount&&!i->pVertexAttributeDescriptions))return 0;
    p->binding_count=i->vertexBindingDescriptionCount;
    for(unsigned n=0;n<p->binding_count;n++) {
        VkVertexInputBindingDescription b=i->pVertexBindingDescriptions[n];
        if(b.binding>=8||b.inputRate!=VK_VERTEX_INPUT_RATE_VERTEX||b.stride<4||b.stride>(live->webgl_backend?252u:2048u)||b.stride%4)return 0;
        unsigned slot=n;while(slot&&p->bindings[slot-1].binding>b.binding){p->bindings[slot]=p->bindings[slot-1];slot--;}
        if((slot&&p->bindings[slot-1].binding==b.binding)||(slot<n&&p->bindings[slot].binding==b.binding))return 0;
        p->bindings[slot]=(struct graphics_binding){.binding=b.binding,.stride=b.stride};
    }
    unsigned locations=0;
    for(unsigned n=0;n<i->vertexAttributeDescriptionCount;n++) {
        VkVertexInputAttributeDescription a=i->pVertexAttributeDescriptions[n];unsigned components=graphics_format_components(a.format),slot=0;
        if(a.location>=8||!components||(locations&(1u<<a.location))||a.offset%4)return 0;
        locations|=1u<<a.location;
        while(slot<p->binding_count&&p->bindings[slot].binding!=a.binding)slot++;
        if(slot==p->binding_count||a.offset>p->bindings[slot].stride||components*4>p->bindings[slot].stride-a.offset)return 0;
        struct graphics_binding *b=&p->bindings[slot];b->attributes[b->count++]=a;
    }
    for(unsigned n=0;n<p->binding_count;n++)if(!p->bindings[n].count)return 0;
    return 1;
}
struct graphics_json { char bytes[16384];size_t used;int bad; };
static void graphics_json_append(struct graphics_json *j,const char *format,...) {
    if(j->bad)return;
    va_list args;va_start(args,format);int n=vsnprintf(j->bytes+j->used,sizeof(j->bytes)-j->used,format,args);va_end(args);
    if(n<0||(size_t)n>=sizeof(j->bytes)-j->used){j->bad=1;return;}j->used+=(size_t)n;
}
static void graphics_json_name(struct graphics_json *j,const char *name) {
    if(!name){j->bad=1;return;}
    size_t length=0;while(length<=128&&name[length])length++;
    if(!length||length>128){j->bad=1;return;}
    graphics_json_append(j,"\"");
    for(size_t n=0;n<length;n++) {
        unsigned char c=(unsigned char)name[n];
        if(c=='\"'||c=='\\')graphics_json_append(j,"\\%c",c);
        else if(c<32)graphics_json_append(j,"\\u%04x",c);
        else graphics_json_append(j,"%c",c);
    }
    graphics_json_append(j,"\"");
}
static int graphics_viewport(const VkPipelineViewportStateCreateInfo *i,struct graphics_pipeline *p) {
    if(!i||i->sType!=VK_STRUCTURE_TYPE_PIPELINE_VIEWPORT_STATE_CREATE_INFO||i->pNext||i->flags||
       i->viewportCount!=1||!i->pViewports||i->scissorCount!=1||!i->pScissors)return 0;
    p->viewport=i->pViewports[0];p->scissor=i->pScissors[0];const VkViewport v=p->viewport;const VkRect2D s=p->scissor;
    return v.x>=0&&v.y>=0&&v.width>0&&v.height>0&&v.x+v.width<=128&&v.y+v.height<=128&&
        v.minDepth>=0&&v.maxDepth<=1&&v.minDepth<=v.maxDepth&&s.offset.x>=0&&s.offset.y>=0&&
        s.offset.x<=128&&s.offset.y<=128&&s.extent.width<=128-(unsigned)s.offset.x&&s.extent.height<=128-(unsigned)s.offset.y&&
        (!live->webgl_backend||(v.x==(float)(unsigned)v.x&&v.y==(float)(unsigned)v.y&&
         v.width==(float)(unsigned)v.width&&v.height==(float)(unsigned)v.height));
}
/* Gathering changes shader vertex IDs. Scan validated instruction boundaries,
 * and reject ID-dependent shaders rather than silently changing their outputs.
 * SPIR-V BuiltIn VertexId=5 / VertexIndex=42 (OpDecorate or OpMemberDecorate). */
static int graphics_shader_vertex_index(const struct resource *shader) {
    const uint32_t *w=(const uint32_t *)shader->bytes;size_t words=shader->size/4;
    for(size_t at=5;at<words;) {
        unsigned n=w[at]>>16,op=w[at]&65535u;
        if(!n||n>words-at)return 1;
        if(op==71&&n>=4&&w[at+2]==11&&(w[at+3]==5||w[at+3]==42))return 1;
        if(op==72&&n>=5&&w[at+3]==11&&(w[at+4]==5||w[at+4]==42))return 1;
        at+=n;
    }
    return 0;
}
/* Direct Flat decorations on Output variables and members of their structs.
 * Unknown/group decorations conservatively require gathering; known Input
 * decorations do not change output provoking semantics. */
static int graphics_shader_flat_output(const struct resource *shader) {
    const uint32_t *w=(const uint32_t *)shader->bytes;size_t words=shader->size/4;
    for(size_t at=5;at<words;) {
        unsigned n=w[at]>>16,op=w[at]&65535u;if(!n||n>words-at)return 1;
        unsigned member=op==72&&n>=4&&w[at+3]==14;
        if((op==71&&n>=3&&w[at+2]==14)||member) {
            uint32_t target=w[at+1];int known_input=0;
            for(size_t v=5;v<words;) {
                unsigned vn=w[v]>>16,vop=w[v]&65535u;if(!vn||vn>words-v)return 1;
                if(vop==59&&vn>=4) {
                    if(!member&&w[v+2]==target){if(w[v+3]==3)return 1;if(w[v+3]==1)known_input=1;}
                    if(member)for(size_t p=5;p<words;) {
                        unsigned pn=w[p]>>16,pop=w[p]&65535u;if(!pn||pn>words-p)return 1;
                        if(pop==32&&pn>=4&&w[p+1]==w[v+1]&&w[p+3]==target) {
                            if(w[v+3]==3)return 1;if(w[v+3]==1)known_input=1;
                        }p+=pn;
                    }
                }v+=vn;
            }
            if(!known_input)return 1;
        }at+=n;
    }return 0;
}
static VKAPI_ATTR VkResult VKAPI_CALL create_graphics_pipelines(VkDevice d,VkPipelineCache cache,uint32_t count,const VkGraphicsPipelineCreateInfo *i,const VkAllocationCallbacks *a,VkPipeline *out) {
    if(!out||count!=1)return VK_ERROR_INITIALIZATION_FAILED;
    *out=VK_NULL_HANDLE;
#ifdef GUEST_VK_ZINK
    /* B2a dynamic rendering: renderPass==NULL with exactly one
     * VkPipelineRenderingCreateInfo (1 RGBA8 color, optional D32/D16 depth). */
    const VkPipelineRenderingCreateInfo *rendering=i&&i->pNext&&live->dynamic_rendering&&!i->renderPass?i->pNext:NULL;
    if(rendering&&(rendering->sType!=VK_STRUCTURE_TYPE_PIPELINE_RENDERING_CREATE_INFO||rendering->pNext||rendering->viewMask||
       rendering->colorAttachmentCount!=1||!rendering->pColorAttachmentFormats||!color_format(rendering->pColorAttachmentFormats[0])||
       (rendering->depthAttachmentFormat&&(!live->depth_supported||!depth_code(rendering->depthAttachmentFormat)))||
       rendering->stencilAttachmentFormat))return VK_ERROR_FEATURE_NOT_PRESENT;
#else
    const void *rendering=NULL;
#endif
    if(!device_valid(d)||!live->graphics_supported||cache||!i||a||i->sType!=VK_STRUCTURE_TYPE_GRAPHICS_PIPELINE_CREATE_INFO||(i->pNext&&!rendering)||i->flags||
       i->stageCount!=2||!i->pStages||i->subpass||i->basePipelineHandle||i->basePipelineIndex!=-1||i->pTessellationState||i->pDynamicState||
       (!live->depth_supported&&i->pDepthStencilState))
        return VK_ERROR_INITIALIZATION_FAILED;
    struct resource *layout=resource_get(RID(i->layout),R_PIPELINE_LAYOUT),*pass=resource_get(RID(i->renderPass),R_RENDER_PASS);
    if(!layout||!layout->graphics_layout||(!pass&&!rendering))return VK_ERROR_INITIALIZATION_FAILED;
    struct graphics_pipeline p={0};p.uniforms=layout->graphics.layout;
#ifdef GUEST_VK_ZINK
    if(rendering)p.pass=(struct graphics_pass){.format=rendering->pColorAttachmentFormats[0],.samples=VK_SAMPLE_COUNT_1_BIT,.depth_format=rendering->depthAttachmentFormat};
    else
#endif
    p.pass=pass->graphics.pass;
    if(!graphics_vertex_layout(i->pVertexInputState,&p)||!graphics_viewport(i->pViewportState,&p))return VK_ERROR_FEATURE_NOT_PRESENT;
    /* A5: depth-stencil state is required exactly when the render pass has a
     * depth attachment. Stencil, depth bounds and depth bias are unsupported. */
    const VkPipelineDepthStencilStateCreateInfo *ds=i->pDepthStencilState;
    if(live->depth_supported) {
        if(!!ds!=!!p.pass.depth_format)return VK_ERROR_INITIALIZATION_FAILED;
        if(ds) {
            if(ds->sType!=VK_STRUCTURE_TYPE_PIPELINE_DEPTH_STENCIL_STATE_CREATE_INFO||ds->pNext||ds->flags||
               (unsigned)ds->depthCompareOp>VK_COMPARE_OP_ALWAYS)return VK_ERROR_INITIALIZATION_FAILED;
            if(ds->stencilTestEnable||ds->depthBoundsTestEnable)return VK_ERROR_FEATURE_NOT_PRESENT;
            p.depth_test=ds->depthTestEnable!=VK_FALSE;p.depth_write=p.depth_test&&ds->depthWriteEnable!=VK_FALSE;
            p.depth_compare=p.depth_test?ds->depthCompareOp:VK_COMPARE_OP_ALWAYS;
        }
    }
    const VkPipelineInputAssemblyStateCreateInfo *assembly=i->pInputAssemblyState;
    const VkPipelineRasterizationStateCreateInfo *raster=i->pRasterizationState;
    const VkPipelineMultisampleStateCreateInfo *samples=i->pMultisampleState;
    const VkPipelineColorBlendStateCreateInfo *blend=i->pColorBlendState;
    if(!assembly||assembly->sType!=VK_STRUCTURE_TYPE_PIPELINE_INPUT_ASSEMBLY_STATE_CREATE_INFO||assembly->pNext||assembly->flags||
       (assembly->topology!=VK_PRIMITIVE_TOPOLOGY_TRIANGLE_LIST
#ifdef GUEST_VK_ZINK
        &&!(live->pipeline_state_supported&&assembly->topology==VK_PRIMITIVE_TOPOLOGY_TRIANGLE_FAN)
#endif
       )||assembly->primitiveRestartEnable||
       !raster||raster->sType!=VK_STRUCTURE_TYPE_PIPELINE_RASTERIZATION_STATE_CREATE_INFO||raster->pNext||raster->flags||
       raster->depthClampEnable||raster->rasterizerDiscardEnable||raster->polygonMode!=VK_POLYGON_MODE_FILL||
#ifdef GUEST_VK_ZINK
       raster->cullMode>VK_CULL_MODE_BACK_BIT||(raster->frontFace!=VK_FRONT_FACE_COUNTER_CLOCKWISE&&raster->frontFace!=VK_FRONT_FACE_CLOCKWISE)||
#else
       raster->cullMode!=VK_CULL_MODE_NONE||raster->frontFace!=VK_FRONT_FACE_COUNTER_CLOCKWISE||
#endif
       raster->depthBiasEnable||raster->lineWidth!=1||
       !samples||samples->sType!=VK_STRUCTURE_TYPE_PIPELINE_MULTISAMPLE_STATE_CREATE_INFO||samples->pNext||samples->flags||
       samples->rasterizationSamples!=VK_SAMPLE_COUNT_1_BIT||samples->sampleShadingEnable||samples->pSampleMask||samples->alphaToCoverageEnable||samples->alphaToOneEnable||
       !blend||blend->sType!=VK_STRUCTURE_TYPE_PIPELINE_COLOR_BLEND_STATE_CREATE_INFO||blend->pNext||blend->flags||blend->logicOpEnable||
       blend->attachmentCount!=1||!blend->pAttachments||blend->pAttachments[0].blendEnable||
       (blend->pAttachments[0].colorWriteMask&~15u)||
       (!live->pipeline_state_supported&&blend->pAttachments[0].colorWriteMask!=15u))return VK_ERROR_FEATURE_NOT_PRESENT;
    p.topology=assembly->topology;
    const VkPipelineShaderStageCreateInfo *vertex=NULL,*fragment=NULL;struct resource *vs=NULL,*fs=NULL;
    for(unsigned n=0;n<2;n++) {
        const VkPipelineShaderStageCreateInfo *s=&i->pStages[n];struct resource *shader=resource_get(RID(s->module),R_SHADER);
        if(s->sType!=VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO||s->pNext||s->flags||s->pSpecializationInfo||!shader||!shader->host||shader->shader_stage!=s->stage)
            return VK_ERROR_INITIALIZATION_FAILED;
        if(s->stage==VK_SHADER_STAGE_VERTEX_BIT&&!vertex){vertex=s;vs=shader;}
        else if(s->stage==VK_SHADER_STAGE_FRAGMENT_BIT&&!fragment){fragment=s;fs=shader;}
        else return VK_ERROR_INITIALIZATION_FAILED;
    }
    if(!vertex||!fragment)return VK_ERROR_INITIALIZATION_FAILED;
    p.vertex_index=graphics_shader_vertex_index(vs);p.vertex_flat=graphics_shader_flat_output(vs);
    if((p.topology==VK_PRIMITIVE_TOPOLOGY_TRIANGLE_FAN||(live->host_last_provoking&&p.vertex_flat))&&
       (p.vertex_index||!p.binding_count))return VK_ERROR_FEATURE_NOT_PRESENT;
    struct graphics_json j={0};
    graphics_json_append(&j,"{\"vertex\":{\"shader\":%u,\"entryPoint\":",vs->host);graphics_json_name(&j,vertex->pName);
    graphics_json_append(&j,"},\"fragment\":{\"shader\":%u,\"entryPoint\":",fs->host);graphics_json_name(&j,fragment->pName);
    graphics_json_append(&j,"},\"vertexBuffers\":[");
    for(unsigned n=0;n<p.binding_count;n++) {
        const struct graphics_binding *b=&p.bindings[n];graphics_json_append(&j,"%s{\"stride\":%u,\"attributes\":[",n?",":"",b->stride);
        for(unsigned k=0;k<b->count;k++){const VkVertexInputAttributeDescription *v=&b->attributes[k];
            graphics_json_append(&j,"%s{\"location\":%u,\"offset\":%u,\"format\":\"float32x%u\"}",k?",":"",v->location,v->offset,graphics_format_components(v->format));}
        graphics_json_append(&j,"]}");
    }
    graphics_json_append(&j,"]");
    if(live->pipeline_state_supported)graphics_json_append(&j,",\"colorWriteMask\":%u",(unsigned)blend->pAttachments[0].colorWriteMask);
#ifdef GUEST_VK_ZINK
    /* B2g: face culling (emitted only when not the NONE/CCW default). */
    p.cull_mode=raster->cullMode;p.front_face=raster->frontFace;
    if(p.cull_mode!=VK_CULL_MODE_NONE)graphics_json_append(&j,",\"cullMode\":\"%s\"",p.cull_mode==VK_CULL_MODE_FRONT_BIT?"front":"back");
    if(p.front_face!=VK_FRONT_FACE_COUNTER_CLOCKWISE)graphics_json_append(&j,",\"frontFace\":\"cw\"");
#endif
    /* A3: declared layout bindings; stages bit0=vertex, bit1=fragment. The
     * host checks every reflected shader uniform against this list. */
    unsigned emitted=0;
    for(unsigned s=0;s<p.uniforms.set_count;s++)for(unsigned n=0;n<p.uniforms.sets[s].count;n++) {
        VkShaderStageFlags st=p.uniforms.sets[s].stages[n];
        if(p.uniforms.sets[s].types[n]!=VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER)continue;
#ifdef GUEST_VK_ZINK
        if(!uniform_host_stages(st))continue;
#endif
        graphics_json_append(&j,"%s{\"group\":%u,\"binding\":%u,\"stages\":%u}",emitted++?",":",\"uniforms\":[",s,HOST_BINDING(p.uniforms.sets[s].bindings[n]),uniform_host_stages(st));
    }
    if(emitted)graphics_json_append(&j,"]");
    /* A4: declared combined image samplers, same stage encoding. */
    unsigned textures=0;
    for(unsigned s=0;s<p.uniforms.set_count;s++)for(unsigned n=0;n<p.uniforms.sets[s].count;n++) {
        VkShaderStageFlags st=p.uniforms.sets[s].stages[n];
        if(p.uniforms.sets[s].types[n]!=VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER)continue;
#ifdef GUEST_VK_ZINK
        if(!uniform_host_stages(st))continue;
#endif
        graphics_json_append(&j,"%s{\"group\":%u,\"binding\":%u,\"stages\":%u}",textures++?",":",\"textures\":[",s,HOST_BINDING(p.uniforms.sets[s].bindings[n]),uniform_host_stages(st));
    }
    if(textures)graphics_json_append(&j,"]");
    /* A5: WebGPU-style depth state; a disabled test is always/no-write. */
    if(live->depth_supported) {
        static const char *const compare[]={"never","less","equal","less-equal","greater","not-equal","greater-equal","always"};
        if(p.pass.depth_format)graphics_json_append(&j,",\"depth\":{\"format\":\"%s\",\"depthCompare\":\"%s\",\"depthWriteEnabled\":%s}",
            depth_code(p.pass.depth_format)==1?"depth32float":"depth16unorm",compare[p.depth_compare],p.depth_write?"true":"false");
        else graphics_json_append(&j,",\"depth\":null");
    }
    graphics_json_append(&j,"}");if(j.bad)return VK_ERROR_INITIALIZATION_FAILED;
    struct resource *r=resource_new(R_GRAPHICS_PIPELINE);if(!r)return VK_ERROR_OUT_OF_HOST_MEMORY;
    r->graphics.pipeline=p;
    /* With the uniform profile the reply is the id followed by one minimum
     * std140 block size per declared binding, in emitted (set, binding) order;
     * 0 means no stage statically uses it. Otherwise exactly the id. */
    unsigned char reply[512];uint32_t n=0;
    VkResult result=compute_call(GPU_GRAPHICS_PIPELINE,j.bytes,(uint32_t)j.used,reply,sizeof(reply),&n);
    if(result!=VK_SUCCESS){resource_drop(r);return result;}
    if(n!=4+4*(live->uniform_supported?emitted:0)){live->failed=1;resource_drop(r);return VK_ERROR_DEVICE_LOST;}
    memcpy(&r->host,reply,4);
    if(!r->host){live->failed=1;resource_drop(r);return VK_ERROR_DEVICE_LOST;}
    r->graphics.pipeline.uniform_count=emitted;
    for(unsigned k=0;k<emitted;k++) {
        uint32_t size;memcpy(&size,reply+4+4*k,4);
        if(size>16384||size%4){live->failed=1;resource_drop(r);return VK_ERROR_DEVICE_LOST;}
        r->graphics.pipeline.min_sizes[k]=size;
    }
    /* The host pipeline owns translated shader metadata. No live shader,
     * renderpass or pipeline-layout handle is retained by this pipeline. */
    *out=HANDLE(VkPipeline,r->id);return VK_SUCCESS;
}
#include "graphics-commands.inc"
static PFN_vkVoidFunction graphics_proc(const char *name) {
#define P(api,fn) if(!strcmp(name,#api))return (PFN_vkVoidFunction)fn;
    P(vkCreateShaderModule,create_shader) P(vkDestroyShaderModule,destroy_shader)
    P(vkCreatePipelineLayout,create_pipeline_layout) P(vkDestroyPipelineLayout,destroy_pipeline_layout)
    P(vkCreateImageView,create_image_view) P(vkDestroyImageView,destroy_image_view)
    P(vkCreateRenderPass,create_render_pass) P(vkDestroyRenderPass,destroy_render_pass) P(vkGetRenderAreaGranularity,render_area_granularity)
    P(vkCreateFramebuffer,create_framebuffer) P(vkDestroyFramebuffer,destroy_framebuffer)
    P(vkCreateGraphicsPipelines,create_graphics_pipelines) P(vkDestroyPipeline,destroy_pipeline)
    P(vkCmdBeginRenderPass,begin_graphics_pass) P(vkCmdEndRenderPass,end_graphics_pass)
    P(vkCmdBindPipeline,bind_pipeline) P(vkCmdBindVertexBuffers,bind_vertex_buffers) P(vkCmdDraw,draw_graphics)
    if(live->uniform_supported) {
        P(vkCreateDescriptorSetLayout,create_set_layout) P(vkDestroyDescriptorSetLayout,destroy_set_layout)
        P(vkCreateDescriptorPool,create_descriptor_pool) P(vkDestroyDescriptorPool,destroy_descriptor_pool)
        P(vkAllocateDescriptorSets,allocate_descriptor_sets) P(vkUpdateDescriptorSets,update_descriptor_sets)
        P(vkCmdBindDescriptorSets,bind_descriptor_sets)
    }
#undef P
    return NULL;
}
