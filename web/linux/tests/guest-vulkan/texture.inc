/* A4 bounded sampled-texture profile. Opt-in (host HELLO "textureProfile":1,
 * layered on the uniform profile). Whole-image RGBA8_UNORM 2D textures with
 * SAMPLED|TRANSFER_DST usage, one mip level/layer, filled only by a whole-image
 * vkCmdCopyBufferToImage from a TRANSFER_SRC staging buffer. Samplers are the
 * nearest/linear x repeat/clamp-to-edge/mirrored-repeat subset without LOD
 * bias, anisotropy, comparison or unnormalized coordinates. The staging bytes
 * are read when the copy executes, so rewriting them and resubmitting the same
 * command buffer re-uploads without re-recording. Deliberately NONCONFORMANT. */
static int texture_image_barrier(VkPipelineStageFlags src,VkPipelineStageFlags dst,const VkImageMemoryBarrier *b) {
    const VkPipelineStageFlags shaders=VK_PIPELINE_STAGE_VERTEX_SHADER_BIT|VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT;
    int to_transfer=b->newLayout==VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL&&dst==VK_PIPELINE_STAGE_TRANSFER_BIT&&b->dstAccessMask==VK_ACCESS_TRANSFER_WRITE_BIT;
    if(to_transfer&&b->oldLayout==VK_IMAGE_LAYOUT_UNDEFINED&&src==VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT&&!b->srcAccessMask)return 1;
    if(to_transfer&&b->oldLayout==VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL&&src&&!(src&~shaders)&&
       (!b->srcAccessMask||b->srcAccessMask==VK_ACCESS_SHADER_READ_BIT))return 1;
    return b->oldLayout==VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL&&b->newLayout==VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL&&
        src==VK_PIPELINE_STAGE_TRANSFER_BIT&&b->srcAccessMask==VK_ACCESS_TRANSFER_WRITE_BIT&&
        dst&&!(dst&~shaders)&&b->dstAccessMask==VK_ACCESS_SHADER_READ_BIT;
}
static VKAPI_ATTR void VKAPI_CALL copy_buffer_to_image(VkCommandBuffer cb,VkBuffer buffer,VkImage image,VkImageLayout layout,uint32_t count,const VkBufferImageCopy *region) {
    SELECT_CB(cb);
    if(cb!=&command||command.state!=2)return;
    struct resource *i=resource_get(RID(image),R_IMAGE),*b=resource_get(RID(buffer),R_BUFFER);
    if(command.graphics.in_pass||!i||!i->sampled||!b||!b->staging||layout!=VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL||count!=1||!region||
       region->bufferOffset%4||region->bufferOffset>b->size||i->size>b->size-region->bufferOffset||region->bufferRowLength||region->bufferImageHeight||
       region->imageSubresource.aspectMask!=VK_IMAGE_ASPECT_COLOR_BIT||region->imageSubresource.mipLevel||region->imageSubresource.baseArrayLayer||
       region->imageSubresource.layerCount!=1||region->imageOffset.x||region->imageOffset.y||region->imageOffset.z||
       region->imageExtent.width!=i->width||region->imageExtent.height!=i->height||region->imageExtent.depth!=1){invalid_command(cb);return;}
    struct recorded *r=record_command(cb,C_TEXTURE_COPY);if(r){r->image=i->id;r->buffer=b->id;r->offset=region->bufferOffset;}
}
/* Submit-time prevalidation against the simulated layout/content state. */
static int texture_prepare_copy(const struct recorded *c,VkImageLayout layouts[MAX_RES],unsigned initialized[MAX_RES]) {
    struct resource *i=resource_get(c->image,R_IMAGE),*b=resource_get(c->buffer,R_BUFFER),*m=b?resource_get(b->memory,R_MEMORY):NULL;
    if(!live->texture_supported||!i||!i->sampled||!i->host||!resource_get(i->memory,R_MEMORY)||!b||!b->staging||!m||!m->bytes||
       layouts[i-resources]!=VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL||c->offset%4||c->offset>b->size||i->size>b->size-c->offset)return 0;
    initialized[i-resources]=1;return 1;
}
static VkResult texture_execute_copy(const struct recorded *c) {
    static unsigned char data[65536+12];
    struct resource *i=resource_get(c->image,R_IMAGE),*b=resource_get(c->buffer,R_BUFFER),*m=resource_get(b->memory,R_MEMORY);
    uint32_t header[3]={i->host,i->width,i->height};memcpy(data,header,12);memcpy(data+12,m->bytes+b->offset+(size_t)c->offset,i->size);
    if(i->bgra)swap_rb(data+12,i->size); /* B2e: guest BGRA bytes -> host RGBA texture. */
    if(host_empty(GPU_TEXTURE_UPLOAD,data,(uint32_t)i->size+12)!=VK_SUCCESS){i->graphics_initialized=0;return VK_ERROR_DEVICE_LOST;}
    i->graphics_initialized=1;return VK_SUCCESS;
}
static const char *texture_filter(VkFilter f) {return f==VK_FILTER_NEAREST?"nearest":f==VK_FILTER_LINEAR?"linear":NULL;}
static const char *texture_address(VkSamplerAddressMode m) {
    return m==VK_SAMPLER_ADDRESS_MODE_REPEAT?"repeat":m==VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE?"clamp-to-edge":
        m==VK_SAMPLER_ADDRESS_MODE_MIRRORED_REPEAT?"mirror-repeat":NULL;
}
static VKAPI_ATTR VkResult VKAPI_CALL create_sampler(VkDevice d,const VkSamplerCreateInfo *i,const VkAllocationCallbacks *a,VkSampler *out) {
    if(!out)return VK_ERROR_INITIALIZATION_FAILED;
    *out=VK_NULL_HANDLE;
    if(!device_valid(d)||!live->texture_supported||!i||a||i->sType!=VK_STRUCTURE_TYPE_SAMPLER_CREATE_INFO||i->pNext||i->flags)return VK_ERROR_INITIALIZATION_FAILED;
    const char *mag=texture_filter(i->magFilter),*min=texture_filter(i->minFilter),*u=texture_address(i->addressModeU),*v=texture_address(i->addressModeV);
    if(!mag||!min||!u||!v||!texture_address(i->addressModeW)||
       (i->mipmapMode!=VK_SAMPLER_MIPMAP_MODE_NEAREST&&i->mipmapMode!=VK_SAMPLER_MIPMAP_MODE_LINEAR)||
       i->mipLodBias!=0||i->anisotropyEnable||i->compareEnable||i->minLod!=0||!(i->maxLod>=0&&i->maxLod<=1000)||
       i->unnormalizedCoordinates)return VK_ERROR_FEATURE_NOT_PRESENT;
    unsigned samplers=0;
    for(unsigned n=0;n<MAX_RES;n++)samplers+=resources[n].kind==R_SAMPLER;
    if(samplers>=8)return VK_ERROR_OUT_OF_HOST_MEMORY;
    /* Single-level textures: the mipmap mode and maxLod cannot change results. */
    char json[256];int n=snprintf(json,sizeof(json),"{\"magFilter\":\"%s\",\"minFilter\":\"%s\",\"addressModeU\":\"%s\",\"addressModeV\":\"%s\"}",mag,min,u,v);
    if(n<0||(size_t)n>=sizeof(json))return VK_ERROR_INITIALIZATION_FAILED;
    struct resource *r=resource_new(R_SAMPLER);if(!r)return VK_ERROR_OUT_OF_HOST_MEMORY;
    VkResult result=compute_resource(GPU_SAMPLER,json,(uint32_t)n,&r->host);
    if(result!=VK_SUCCESS){resource_drop(r);return result;}
    *out=HANDLE(VkSampler,r->id);return VK_SUCCESS;
}
static VKAPI_ATTR void VKAPI_CALL destroy_sampler(VkDevice d,VkSampler h,const VkAllocationCallbacks *a){destroy_compute_resource(d,RID(h),R_SAMPLER,a);}
