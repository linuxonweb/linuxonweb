/* Bounded resources for an explicitly NONCONFORMANT graphics profile.
 * All state is copied, typed and bounded; host translation validates real SPIR-V. */
#include <stdarg.h>

static VKAPI_ATTR VkResult VKAPI_CALL create_image_view(VkDevice d,const VkImageViewCreateInfo *i,const VkAllocationCallbacks *a,VkImageView *out) {
    if(!out)return VK_ERROR_INITIALIZATION_FAILED;
    *out=VK_NULL_HANDLE;
    if(!device_valid(d)||!live->graphics_supported||!i||a||i->sType!=VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO||i->pNext||i->flags||
       i->viewType!=VK_IMAGE_VIEW_TYPE_2D||i->format!=VK_FORMAT_R8G8B8A8_UNORM||!full_range(&i->subresourceRange))return VK_ERROR_INITIALIZATION_FAILED;
    const VkComponentMapping c=i->components;
    if((c.r!=VK_COMPONENT_SWIZZLE_IDENTITY&&c.r!=VK_COMPONENT_SWIZZLE_R)||
       (c.g!=VK_COMPONENT_SWIZZLE_IDENTITY&&c.g!=VK_COMPONENT_SWIZZLE_G)||
       (c.b!=VK_COMPONENT_SWIZZLE_IDENTITY&&c.b!=VK_COMPONENT_SWIZZLE_B)||
       (c.a!=VK_COMPONENT_SWIZZLE_IDENTITY&&c.a!=VK_COMPONENT_SWIZZLE_A))return VK_ERROR_FEATURE_NOT_PRESENT;
    struct resource *image=resource_get(RID(i->image),R_IMAGE);
    if(!image||!image->graphics_target||!image->host||!resource_get(image->memory,R_MEMORY))return VK_ERROR_INITIALIZATION_FAILED;
    struct resource *r=resource_new(R_IMAGE_VIEW);if(!r)return VK_ERROR_OUT_OF_HOST_MEMORY;
    r->graphics.view.image=image->id;*out=HANDLE(VkImageView,r->id);return VK_SUCCESS;
}
static VKAPI_ATTR void VKAPI_CALL destroy_image_view(VkDevice d,VkImageView h,const VkAllocationCallbacks *a){destroy_compute_resource(d,RID(h),R_IMAGE_VIEW,a);}

static VKAPI_ATTR VkResult VKAPI_CALL create_render_pass(VkDevice d,const VkRenderPassCreateInfo *i,const VkAllocationCallbacks *a,VkRenderPass *out) {
    if(!out)return VK_ERROR_INITIALIZATION_FAILED;
    *out=VK_NULL_HANDLE;
    if(!device_valid(d)||!live->graphics_supported||!i||a||i->sType!=VK_STRUCTURE_TYPE_RENDER_PASS_CREATE_INFO||i->pNext||i->flags||
       i->attachmentCount!=1||!i->pAttachments||i->subpassCount!=1||!i->pSubpasses||i->dependencyCount)return VK_ERROR_INITIALIZATION_FAILED;
    const VkAttachmentDescription attachment=i->pAttachments[0];const VkSubpassDescription subpass=i->pSubpasses[0];
    if(attachment.flags||attachment.format!=VK_FORMAT_R8G8B8A8_UNORM||attachment.samples!=VK_SAMPLE_COUNT_1_BIT||
       (attachment.loadOp!=VK_ATTACHMENT_LOAD_OP_CLEAR&&attachment.loadOp!=VK_ATTACHMENT_LOAD_OP_LOAD)||
       attachment.storeOp!=VK_ATTACHMENT_STORE_OP_STORE||attachment.stencilLoadOp!=VK_ATTACHMENT_LOAD_OP_DONT_CARE||
       attachment.stencilStoreOp!=VK_ATTACHMENT_STORE_OP_DONT_CARE||attachment.initialLayout!=VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL||
       attachment.finalLayout!=VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL||subpass.flags||subpass.pipelineBindPoint!=VK_PIPELINE_BIND_POINT_GRAPHICS||
       subpass.inputAttachmentCount||subpass.colorAttachmentCount!=1||!subpass.pColorAttachments||subpass.pResolveAttachments||
       subpass.pDepthStencilAttachment||subpass.preserveAttachmentCount||subpass.pColorAttachments[0].attachment||
       subpass.pColorAttachments[0].layout!=VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL)return VK_ERROR_FEATURE_NOT_PRESENT;
    struct resource *r=resource_new(R_RENDER_PASS);if(!r)return VK_ERROR_OUT_OF_HOST_MEMORY;
    r->graphics.pass=(struct graphics_pass){attachment.format,attachment.samples,attachment.loadOp,attachment.storeOp,attachment.initialLayout,attachment.finalLayout};
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
       i->attachmentCount!=1||!i->pAttachments||i->layers!=1)return VK_ERROR_INITIALIZATION_FAILED;
    struct resource *pass=resource_get(RID(i->renderPass),R_RENDER_PASS),*view=resource_get(RID(i->pAttachments[0]),R_IMAGE_VIEW);
    struct resource *image=view?resource_get(view->graphics.view.image,R_IMAGE):NULL;
    if(!pass||!image||!image->graphics_target||!image->host||!resource_get(image->memory,R_MEMORY)||
       i->width!=image->width||i->height!=image->height)return VK_ERROR_INITIALIZATION_FAILED;
    struct resource *r=resource_new(R_FRAMEBUFFER);if(!r)return VK_ERROR_OUT_OF_HOST_MEMORY;
    r->graphics.framebuffer=(struct graphics_framebuffer){view->id,image->id,i->width,i->height,pass->graphics.pass};
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
        if(b.binding>=8||b.inputRate!=VK_VERTEX_INPUT_RATE_VERTEX||b.stride<4||b.stride>2048||b.stride%4)return 0;
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
        s.offset.x<=128&&s.offset.y<=128&&s.extent.width<=128-(unsigned)s.offset.x&&s.extent.height<=128-(unsigned)s.offset.y;
}
static VKAPI_ATTR VkResult VKAPI_CALL create_graphics_pipelines(VkDevice d,VkPipelineCache cache,uint32_t count,const VkGraphicsPipelineCreateInfo *i,const VkAllocationCallbacks *a,VkPipeline *out) {
    if(!out||count!=1)return VK_ERROR_INITIALIZATION_FAILED;
    *out=VK_NULL_HANDLE;
    if(!device_valid(d)||!live->graphics_supported||cache||!i||a||i->sType!=VK_STRUCTURE_TYPE_GRAPHICS_PIPELINE_CREATE_INFO||i->pNext||i->flags||
       i->stageCount!=2||!i->pStages||i->subpass||i->basePipelineHandle||i->basePipelineIndex!=-1||i->pTessellationState||i->pDepthStencilState||i->pDynamicState)
        return VK_ERROR_INITIALIZATION_FAILED;
    struct resource *layout=resource_get(RID(i->layout),R_PIPELINE_LAYOUT),*pass=resource_get(RID(i->renderPass),R_RENDER_PASS);
    if(!layout||!layout->graphics_layout||!pass)return VK_ERROR_INITIALIZATION_FAILED;
    struct graphics_pipeline p={0};p.pass=pass->graphics.pass;
    if(!graphics_vertex_layout(i->pVertexInputState,&p)||!graphics_viewport(i->pViewportState,&p))return VK_ERROR_FEATURE_NOT_PRESENT;
    const VkPipelineInputAssemblyStateCreateInfo *assembly=i->pInputAssemblyState;
    const VkPipelineRasterizationStateCreateInfo *raster=i->pRasterizationState;
    const VkPipelineMultisampleStateCreateInfo *samples=i->pMultisampleState;
    const VkPipelineColorBlendStateCreateInfo *blend=i->pColorBlendState;
    if(!assembly||assembly->sType!=VK_STRUCTURE_TYPE_PIPELINE_INPUT_ASSEMBLY_STATE_CREATE_INFO||assembly->pNext||assembly->flags||
       assembly->topology!=VK_PRIMITIVE_TOPOLOGY_TRIANGLE_LIST||assembly->primitiveRestartEnable||
       !raster||raster->sType!=VK_STRUCTURE_TYPE_PIPELINE_RASTERIZATION_STATE_CREATE_INFO||raster->pNext||raster->flags||
       raster->depthClampEnable||raster->rasterizerDiscardEnable||raster->polygonMode!=VK_POLYGON_MODE_FILL||raster->cullMode!=VK_CULL_MODE_NONE||
       raster->frontFace!=VK_FRONT_FACE_COUNTER_CLOCKWISE||raster->depthBiasEnable||raster->lineWidth!=1||
       !samples||samples->sType!=VK_STRUCTURE_TYPE_PIPELINE_MULTISAMPLE_STATE_CREATE_INFO||samples->pNext||samples->flags||
       samples->rasterizationSamples!=VK_SAMPLE_COUNT_1_BIT||samples->sampleShadingEnable||samples->pSampleMask||samples->alphaToCoverageEnable||samples->alphaToOneEnable||
       !blend||blend->sType!=VK_STRUCTURE_TYPE_PIPELINE_COLOR_BLEND_STATE_CREATE_INFO||blend->pNext||blend->flags||blend->logicOpEnable||
       blend->attachmentCount!=1||!blend->pAttachments||blend->pAttachments[0].blendEnable||
       blend->pAttachments[0].colorWriteMask!=(VK_COLOR_COMPONENT_R_BIT|VK_COLOR_COMPONENT_G_BIT|VK_COLOR_COMPONENT_B_BIT|VK_COLOR_COMPONENT_A_BIT))return VK_ERROR_FEATURE_NOT_PRESENT;
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
    graphics_json_append(&j,"]}");if(j.bad)return VK_ERROR_INITIALIZATION_FAILED;
    struct resource *r=resource_new(R_GRAPHICS_PIPELINE);if(!r)return VK_ERROR_OUT_OF_HOST_MEMORY;
    r->graphics.pipeline=p;
    VkResult result=compute_resource(GPU_GRAPHICS_PIPELINE,j.bytes,(uint32_t)j.used,&r->host);
    if(result!=VK_SUCCESS){resource_drop(r);return result;}
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
#undef P
    return NULL;
}
