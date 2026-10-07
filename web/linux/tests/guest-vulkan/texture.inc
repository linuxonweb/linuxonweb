/* A4 bounded sampled-texture profile. Opt-in (host HELLO "textureProfile":1,
 * layered on the uniform profile). Whole-image RGBA8_UNORM 2D textures with
 * SAMPLED|TRANSFER_DST usage, one mip level/layer, filled only by a whole-image
 * vkCmdCopyBufferToImage from a TRANSFER_SRC staging buffer. Samplers are the
 * nearest/linear x repeat/clamp-to-edge/mirrored-repeat subset without LOD
 * bias, anisotropy, comparison or unnormalized coordinates. The staging bytes
 * are read when the copy executes, so rewriting them and resubmitting the same
 * command buffer re-uploads without re-recording. Deliberately NONCONFORMANT. */
static int texture_staging_buffer(const struct resource *b) {
    if(!b)return 0;
#ifdef GUEST_VK_ZINK
    if(b->generic&&(b->usage&VK_BUFFER_USAGE_TRANSFER_SRC_BIT))return 1;
#endif
    return b->staging;
}
static unsigned texture_max_extent(void) {return huge_extent(live->large_texture_supported?1024u:128u);}
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
    /* Mipmap profile: one whole level per copy (row bands carry the level). */
    const unsigned level=region?region->imageSubresource.mipLevel:0;
    const uint32_t lw=i?MIP_DIM(i->width,level):0,lh=i?MIP_DIM(i->height,level):0;const size_t lsize=(size_t)lw*lh*4;
    if(command.graphics.in_pass||!i||!i->sampled||i->depth||(i->width>texture_max_extent()||i->height>texture_max_extent())||!texture_staging_buffer(b)||layout!=VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL||count!=1||!region||
       (level&&(!live->mipmap_supported||level>=i->mips))||
       region->bufferOffset%4||region->bufferOffset>b->size||lsize>b->size-region->bufferOffset||
       (region->bufferRowLength&&region->bufferRowLength!=lw)||(region->bufferImageHeight&&region->bufferImageHeight!=lh)||
       region->imageSubresource.aspectMask!=VK_IMAGE_ASPECT_COLOR_BIT||region->imageSubresource.baseArrayLayer||
       region->imageSubresource.layerCount!=1||region->imageOffset.x||region->imageOffset.y||region->imageOffset.z||
       region->imageExtent.width!=lw||region->imageExtent.height!=lh||region->imageExtent.depth!=1){
        ZREJ("copy_buffer_to_image REJECT img=%p sampled=%d %ux%u size=%u buf=%p staging=%d bsize=%llu layout=%d count=%u off=%llu row=%u h=%u aspect=0x%x mip=%u layer=%u+%u at=%d,%d,%d ext=%ux%ux%u\n",
            (void*)i,i?i->sampled:-1,i?i->width:0,i?i->height:0,i?(unsigned)i->size:0,(void*)b,b?b->staging:-1,b?(unsigned long long)b->size:0ULL,layout,count,
            region?(unsigned long long)region->bufferOffset:0ULL,region?region->bufferRowLength:0,region?region->bufferImageHeight:0,region?region->imageSubresource.aspectMask:0,
            region?region->imageSubresource.mipLevel:0,region?region->imageSubresource.baseArrayLayer:0,region?region->imageSubresource.layerCount:0,
            region?region->imageOffset.x:0,region?region->imageOffset.y:0,region?region->imageOffset.z:0,region?region->imageExtent.width:0,region?region->imageExtent.height:0,region?region->imageExtent.depth:0);
        invalid_command(cb);return;}
    struct recorded *r=record_command(cb,C_TEXTURE_COPY);if(r){r->image=i->id;r->buffer=b->id;r->offset=region->bufferOffset;r->level=level;}
}
/* Submit-time prevalidation against the simulated layout/content state. */
static int texture_prepare_copy(const struct recorded *c,VkImageLayout layouts[MAX_RES],unsigned initialized[MAX_RES]) {
    struct resource *i=resource_get(c->image,R_IMAGE),*b=resource_get(c->buffer,R_BUFFER),*m=b?resource_get(b->memory,R_MEMORY):NULL;
    if(!live->texture_supported||!i||!i->sampled||i->depth||i->width>texture_max_extent()||i->height>texture_max_extent()||!i->host||!resource_get(i->memory,R_MEMORY)||!texture_staging_buffer(b)||!m||!m->bytes||
       c->offset%4||c->offset>b->size||
       (size_t)MIP_DIM(i->width,c->level)*MIP_DIM(i->height,c->level)*4>b->size-c->offset)return 0;
    /* Level-0 layout is tracked; other levels were checked when recorded. */
    if(!c->level&&layouts[i-resources]!=VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL)return 0;
    if(!c->level)initialized[i-resources]=1;return 1;
}
static VkResult texture_execute_copy(const struct recorded *c) {
    static unsigned char data[65536+12];
    struct resource *i=resource_get(c->image,R_IMAGE),*b=resource_get(c->buffer,R_BUFFER),*m=resource_get(b->memory,R_MEMORY);
    if(live->large_texture_supported) {
        /* Row bands {host, 0x80000000|level<<24|y, rows} each within one 1 MiB call. */
        const uint32_t width=MIP_DIM(i->width,c->level),height=MIP_DIM(i->height,c->level),row=width*4,band=(1048576u-12u)/row;
        unsigned char *heap=malloc(12+(size_t)(band<height?band:height)*row);
        if(!heap){i->graphics_initialized=0;return VK_ERROR_DEVICE_LOST;}
        for(uint32_t y=0;y<height;y+=band) {
            const uint32_t rows=height-y<band?height-y:band,header[3]={i->host,0x80000000u|c->level<<24|y,rows};
            memcpy(heap,header,12);memcpy(heap+12,m->bytes+b->offset+(size_t)c->offset+(size_t)y*row,(size_t)rows*row);
            if(i->bgra)swap_rb(heap+12,(size_t)rows*row);
            if(i->alpha_one)force_alpha(heap+12,(size_t)rows*row);
            if(host_empty(GPU_TEXTURE_UPLOAD,heap,12+rows*row)!=VK_SUCCESS){free(heap);i->graphics_initialized=0;return VK_ERROR_DEVICE_LOST;}
        }
        free(heap);if(!c->level)i->graphics_initialized=1;return VK_SUCCESS;
    }
    uint32_t header[3]={i->host,i->width,i->height};memcpy(data,header,12);memcpy(data+12,m->bytes+b->offset+(size_t)c->offset,i->size);
    if(i->bgra)swap_rb(data+12,i->size); /* B2e: guest BGRA bytes -> host RGBA texture. */
    if(i->alpha_one)force_alpha(data+12,i->size);
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
       i->mipLodBias!=0||(i->anisotropyEnable&&(!live->anisotropy_supported||!(i->maxAnisotropy>=1&&i->maxAnisotropy<=16)))||i->compareEnable||!(i->minLod==0||(live->mipmap_supported&&i->minLod>0&&i->minLod<=i->maxLod))||!(i->maxLod>=0&&i->maxLod<=1000)||
       i->unnormalizedCoordinates)return VK_ERROR_FEATURE_NOT_PRESENT;
    unsigned samplers=0;
    for(unsigned n=0;n<MAX_RES;n++)samplers+=resources[n].kind==R_SAMPLER;
    if(samplers>=(live->wide_texture_supported?32u:8u))return VK_ERROR_OUT_OF_HOST_MEMORY;
    /* Without the mipmap profile textures have one level, so the mipmap mode and
     * maxLod cannot change results; with it they are sent (LODs clamped to 32). */
    /* Anisotropy is sent only above 1; WebGPU then requires linear filters, so a
     * nearest-filtered sampler keeps isotropic filtering (still conformant). */
    unsigned aniso=i->anisotropyEnable?(unsigned)i->maxAnisotropy:1;
    if(aniso>1&&!(i->magFilter==VK_FILTER_LINEAR&&i->minFilter==VK_FILTER_LINEAR&&(!live->mipmap_supported||i->mipmapMode==VK_SAMPLER_MIPMAP_MODE_LINEAR)))aniso=1;
    char json[384];int n=aniso>1?snprintf(json,sizeof(json),"{\"magFilter\":\"%s\",\"minFilter\":\"%s\",\"addressModeU\":\"%s\",\"addressModeV\":\"%s\",\"maxAnisotropy\":%u",mag,min,u,v,aniso):
        snprintf(json,sizeof(json),"{\"magFilter\":\"%s\",\"minFilter\":\"%s\",\"addressModeU\":\"%s\",\"addressModeV\":\"%s\"",mag,min,u,v);
    if(n>0&&(size_t)n<sizeof(json)&&live->mipmap_supported)
        n+=snprintf(json+n,sizeof(json)-(size_t)n,",\"mipmapFilter\":\"%s\",\"lodMinClamp\":%.9g,\"lodMaxClamp\":%.9g",
            i->mipmapMode==VK_SAMPLER_MIPMAP_MODE_LINEAR?"linear":"nearest",(double)(i->minLod<32?i->minLod:32),(double)(i->maxLod<32?i->maxLod:32));
    if(n>0&&(size_t)n<sizeof(json))n+=snprintf(json+n,sizeof(json)-(size_t)n,"}");
    if(n<0||(size_t)n>=sizeof(json))return VK_ERROR_INITIALIZATION_FAILED;
    struct resource *r=resource_new(R_SAMPLER);if(!r)return VK_ERROR_OUT_OF_HOST_MEMORY;
    VkResult result=compute_resource(GPU_SAMPLER,json,(uint32_t)n,&r->host);
    if(result!=VK_SUCCESS){resource_drop(r);return result;}
    *out=HANDLE(VkSampler,r->id);return VK_SUCCESS;
}
static VKAPI_ATTR void VKAPI_CALL destroy_sampler(VkDevice d,VkSampler h,const VkAllocationCallbacks *a){destroy_compute_resource(d,RID(h),R_SAMPLER,a);}
#ifdef GUEST_VK_ZINK
/* Mipmap profile: vkCmdBlitImage between colour levels of host sampled images.
 * Each region becomes one host BLIT (a render pass into the destination level
 * sampling the source level), executed in submission order. Layouts of levels
 * other than 0 are not tracked; scaled blits use the requested filter. */
static int texture_blit_side(const struct resource *i,const VkImageSubresourceLayers *s,const VkOffset3D o[2]) {
    if(!i||i->depth||!(i->graphics_target||i->sampled)||!i->host||s->aspectMask!=VK_IMAGE_ASPECT_COLOR_BIT||s->baseArrayLayer||s->layerCount!=1||s->mipLevel>=(i->mips?i->mips:1))return 0;
    const int32_t w=(int32_t)MIP_DIM(i->width,s->mipLevel),h=(int32_t)MIP_DIM(i->height,s->mipLevel);
    for(unsigned k=0;k<2;k++)if(o[k].x<0||o[k].x>w||o[k].y<0||o[k].y>h||o[k].z!=(int32_t)k)return 0;
    return 1;
}
static VKAPI_ATTR void VKAPI_CALL blit_image(VkCommandBuffer cb,VkImage src,VkImageLayout src_layout,VkImage dst,VkImageLayout dst_layout,
        uint32_t count,const VkImageBlit *regions,VkFilter filter) {
    SELECT_CB(cb);
    if(cb!=&command||command.state!=2)return;
    struct resource *s=resource_get(RID(src),R_IMAGE),*d=resource_get(RID(dst),R_IMAGE);
    if(!live->mipmap_supported||command.graphics.in_pass||!s||!d||!count||!regions||(filter!=VK_FILTER_NEAREST&&filter!=VK_FILTER_LINEAR)||
       (src_layout!=VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL&&src_layout!=VK_IMAGE_LAYOUT_GENERAL)||
       (dst_layout!=VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL&&dst_layout!=VK_IMAGE_LAYOUT_GENERAL)){
        ZREJ("blit_image REJECT src=%p dst=%p count=%u filter=%d layouts=%d,%d\n",(void*)s,(void*)d,count,(int)filter,(int)src_layout,(int)dst_layout);invalid_command(cb);return;}
    for(uint32_t k=0;k<count;k++) {
        const VkImageBlit *g=&regions[k];
        if(!texture_blit_side(s,&g->srcSubresource,g->srcOffsets)||!texture_blit_side(d,&g->dstSubresource,g->dstOffsets)||
           (s==d&&g->srcSubresource.mipLevel==g->dstSubresource.mipLevel)||
           g->dstOffsets[0].x==g->dstOffsets[1].x||g->dstOffsets[0].y==g->dstOffsets[1].y){
            ZREJ("blit_image REJECT region src=%u:%d,%d-%d,%d dst=%u:%d,%d-%d,%d\n",g->srcSubresource.mipLevel,g->srcOffsets[0].x,g->srcOffsets[0].y,g->srcOffsets[1].x,g->srcOffsets[1].y,
                g->dstSubresource.mipLevel,g->dstOffsets[0].x,g->dstOffsets[0].y,g->dstOffsets[1].x,g->dstOffsets[1].y);
            invalid_command(cb);return;}
        struct recorded *r=record_command(cb,C_BLIT);if(!r)return;
        r->image=s->id;r->dst=d->id;r->blit=*g;r->filter=filter;
    }
}
/* vkCmdCopyImage between colour images of matching colour space: each region
 * is an unscaled nearest BLIT, which reproduces the source texels exactly. */
static VKAPI_ATTR void VKAPI_CALL copy_image_image(VkCommandBuffer cb,VkImage src,VkImageLayout src_layout,VkImage dst,VkImageLayout dst_layout,
        uint32_t count,const VkImageCopy *regions) {
    SELECT_CB(cb);
    if(cb!=&command||command.state!=2)return;
    struct resource *s=resource_get(RID(src),R_IMAGE),*d=resource_get(RID(dst),R_IMAGE);
    if(!s||!d||!count||!regions||s->srgb!=d->srgb){
        ZREJ("copy_image_image REJECT src=%p dst=%p count=%u srgb=%d,%d\n",(void*)s,(void*)d,count,s?(int)s->srgb:-1,d?(int)d->srgb:-1);invalid_command(cb);return;}
    for(uint32_t k=0;k<count;k++) {
        const VkImageCopy *c=&regions[k];
        if(c->srcOffset.z||c->dstOffset.z||c->extent.depth!=1||c->extent.width>INT32_MAX||c->extent.height>INT32_MAX){
            ZREJ("copy_image_image REJECT region z=%d,%d depth=%u\n",c->srcOffset.z,c->dstOffset.z,c->extent.depth);invalid_command(cb);return;}
        VkImageBlit g={.srcSubresource=c->srcSubresource,.dstSubresource=c->dstSubresource};
        g.srcOffsets[0]=c->srcOffset;g.dstOffsets[0]=c->dstOffset;
        g.srcOffsets[1]=(VkOffset3D){c->srcOffset.x+(int32_t)c->extent.width,c->srcOffset.y+(int32_t)c->extent.height,1};
        g.dstOffsets[1]=(VkOffset3D){c->dstOffset.x+(int32_t)c->extent.width,c->dstOffset.y+(int32_t)c->extent.height,1};
        blit_image(cb,src,src_layout,dst,dst_layout,1,&g,VK_FILTER_NEAREST);
        if(command.state!=2)return;
    }
}
static int texture_prepare_blit(const struct recorded *c,unsigned initialized[MAX_RES]) {
    struct resource *s=resource_get(c->image,R_IMAGE),*d=resource_get(c->dst,R_IMAGE);
    if(!live->mipmap_supported||!texture_blit_side(s,&c->blit.srcSubresource,c->blit.srcOffsets)||!texture_blit_side(d,&c->blit.dstSubresource,c->blit.dstOffsets)||
       !resource_get(s->memory,R_MEMORY)||!resource_get(d->memory,R_MEMORY))return 0;
    if(!c->blit.dstSubresource.mipLevel)initialized[d-resources]=1;
    return 1;
}
static VkResult texture_execute_blit(const struct recorded *c) {
    struct resource *s=resource_get(c->image,R_IMAGE),*d=resource_get(c->dst,R_IMAGE);const VkImageBlit *g=&c->blit;
    char json[320];
    int n=snprintf(json,sizeof(json),"{\"src\":%u,\"srcLevel\":%u,\"srcRect\":[%d,%d,%d,%d],\"dst\":%u,\"dstLevel\":%u,\"dstRect\":[%d,%d,%d,%d],\"filter\":\"%s\"}",
        s->host,g->srcSubresource.mipLevel,g->srcOffsets[0].x,g->srcOffsets[0].y,g->srcOffsets[1].x,g->srcOffsets[1].y,
        d->host,g->dstSubresource.mipLevel,g->dstOffsets[0].x,g->dstOffsets[0].y,g->dstOffsets[1].x,g->dstOffsets[1].y,c->filter==VK_FILTER_LINEAR?"linear":"nearest");
    if(n<0||(size_t)n>=sizeof(json)||host_empty(GPU_BLIT,json,(uint32_t)n)!=VK_SUCCESS){if(!g->dstSubresource.mipLevel)d->graphics_initialized=0;return VK_ERROR_DEVICE_LOST;}
    if(!g->dstSubresource.mipLevel)d->graphics_initialized=1;
    return VK_SUCCESS;
}
#endif
