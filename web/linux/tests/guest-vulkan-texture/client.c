/* A4 sampled-texture application. Only public Vulkan and POSIX entrypoints:
 * SAMPLED|TRANSFER_DST images filled by vkCmdCopyBufferToImage from a staging
 * buffer, VkSampler (nearest/linear x repeat/clamp/mirror), COMBINED_IMAGE_SAMPLER
 * descriptors read from fragment and vertex shaders. Every frame is read back
 * and compared on the CPU: nearest frames exactly, linear frames against a
 * double-precision bilinear reference with a small tolerance (reported). */
#define _POSIX_C_SOURCE 200809L
#include <vulkan/vulkan.h>
#include <math.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include "shaders.h"
#define W 16
#define H 16
#define PIXELS (W*H*4)
#define TOTAL (PIXELS+32)
#define STAGING 256
static unsigned checks;
#define CHECK(c) do{checks++;if(!(c)){fprintf(stderr,"GUEST_VK_TEXTURE_FAIL line=%d check=%s\n",__LINE__,#c);goto done;}}while(0)
static void deadline(int n){(void)n;_exit(124);}
/* Texture contents (row 0 = first bytes = texel row t=0). */
static unsigned char t0[64],t1[64],t0b[64],t0c[64],want[PIXELS];
static void fill(void){
    for(unsigned j=0;j<4;j++)for(unsigned i=0;i<4;i++){unsigned char *p=t0+(j*4+i)*4;p[0]=20+40*i;p[1]=30+50*j;p[2]=200-30*i-10*j;p[3]=255-16*(i+4*j);}
    for(unsigned j=0;j<2;j++)for(unsigned i=0;i<8;i++){unsigned char *p=t1+(j*8+i)*4;p[0]=5+30*i;p[1]=50+100*j;p[2]=250-20*i;p[3]=100+80*j+5*i;}
    for(unsigned j=0;j<4;j++)for(unsigned i=0;i<4;i++){unsigned char *p=t0b+(j*4+i)*4;p[0]=250-60*j;p[1]=10+15*i+3*j;p[2]=77+i*j*9;p[3]=33+50*i;}
    for(unsigned j=0;j<4;j++)for(unsigned i=0;i<4;i++){unsigned char *p=t0c+(j*4+i)*4;p[0]=1+16*(i+4*j);p[1]=254-16*(i+4*j);p[2]=128;p[3]=64+i+j;}
}
enum {REPEAT,CLAMP,MIRROR};
static int wrap(int i,int n,int mode){
    if(mode==REPEAT)return ((i%n)+n)%n;
    if(mode==CLAMP)return i<0?0:i>=n?n-1:i;
    int m=((i%(2*n))+2*n)%(2*n);return m<n?m:2*n-1-m;
}
static void nearest(const unsigned char *tex,int w,int h,int mode,double u,double v,double out[4]){
    const unsigned char *p=tex+(wrap((int)floor(u*w),h?w:w,mode)+wrap((int)floor(v*h),h,mode)*w)*4;
    for(unsigned k=0;k<4;k++)out[k]=p[k];
}
static void bilinear(const unsigned char *tex,int w,int h,int mode,double u,double v,double out[4]){
    double tu=u*w-.5,tv=v*h-.5;int i0=(int)floor(tu),j0=(int)floor(tv);double a=tu-i0,b=tv-j0;
    for(unsigned k=0;k<4;k++){
        double c00=tex[(wrap(i0,w,mode)+wrap(j0,h,mode)*w)*4+k],c10=tex[(wrap(i0+1,w,mode)+wrap(j0,h,mode)*w)*4+k];
        double c01=tex[(wrap(i0,w,mode)+wrap(j0+1,h,mode)*w)*4+k],c11=tex[(wrap(i0+1,w,mode)+wrap(j0+1,h,mode)*w)*4+k];
        out[k]=(1-b)*((1-a)*c00+a*c10)+b*((1-a)*c01+a*c11);
    }
}
/* Expected frame of a full-screen quad with texture coordinates lo..hi. */
static void expect_quad(const unsigned char *tex,int w,int h,int mode,int linear,double lo,double hi){
    for(unsigned y=0;y<H;y++)for(unsigned x=0;x<W;x++){
        double u=lo+(hi-lo)*(x+.5)/W,v=lo+(hi-lo)*(y+.5)/H,c[4];
        if(linear)bilinear(tex,w,h,mode,u,v,c);else nearest(tex,w,h,mode,u,v,c);
        for(unsigned k=0;k<4;k++)want[(y*W+x)*4+k]=(unsigned char)lround(c[k]);
    }
}
static unsigned max_linear_delta;
static int compare(const unsigned char *bytes,unsigned round,unsigned tolerance){
    unsigned worst=0,exact=0;
    for(unsigned n=0;n<PIXELS;n++){
        unsigned d=bytes[n]>want[n]?bytes[n]-want[n]:want[n]-bytes[n];checks++;
        if(d>worst)worst=d;if(!d)exact++;
        if(d>tolerance){fprintf(stderr,"GUEST_VK_TEXTURE_PIXEL_FAIL round=%u x=%u y=%u component=%u actual=%u expected=%u\n",round,(n/4)%W,n/4/W,n%4,bytes[n],want[n]);return 0;}
    }
    for(unsigned n=PIXELS;n<TOTAL;n++){checks++;if(bytes[n]!=0xa5)return 0;}
    if(tolerance&&worst>max_linear_delta)max_linear_delta=worst;
    printf("GUEST_VK_TEXTURE_PIXELS_PASS round=%u width=16 height=16 tolerance=%u max_delta=%u exact_components=%u tail=32\n",round,tolerance,worst,exact);fflush(stdout);
    return 1;
}
static VkResult make_pass(VkDevice d,VkRenderPass *out){
    VkAttachmentDescription a={.format=VK_FORMAT_R8G8B8A8_UNORM,.samples=VK_SAMPLE_COUNT_1_BIT,.loadOp=VK_ATTACHMENT_LOAD_OP_CLEAR,.storeOp=VK_ATTACHMENT_STORE_OP_STORE,
        .stencilLoadOp=VK_ATTACHMENT_LOAD_OP_DONT_CARE,.stencilStoreOp=VK_ATTACHMENT_STORE_OP_DONT_CARE,.initialLayout=VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL,.finalLayout=VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL};
    VkAttachmentReference ref={0,VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL};VkSubpassDescription s={.pipelineBindPoint=VK_PIPELINE_BIND_POINT_GRAPHICS,.colorAttachmentCount=1,.pColorAttachments=&ref};
    VkRenderPassCreateInfo info={.sType=VK_STRUCTURE_TYPE_RENDER_PASS_CREATE_INFO,.attachmentCount=1,.pAttachments=&a,.subpassCount=1,.pSubpasses=&s};
    return vkCreateRenderPass(d,&info,NULL,out);
}
static void target_barrier(VkCommandBuffer cb,VkImage image,VkImageLayout old,VkImageLayout next){
    VkImageMemoryBarrier b={.sType=VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER,.oldLayout=old,.newLayout=next,.image=image,
        .srcQueueFamilyIndex=VK_QUEUE_FAMILY_IGNORED,.dstQueueFamilyIndex=VK_QUEUE_FAMILY_IGNORED,.subresourceRange={VK_IMAGE_ASPECT_COLOR_BIT,0,1,0,1}};
    VkPipelineStageFlags src=VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT,dst=VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT;
    if(old==VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL){src=VK_PIPELINE_STAGE_TRANSFER_BIT;b.srcAccessMask=VK_ACCESS_TRANSFER_READ_BIT;}
    if(old==VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL){src=VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT;b.srcAccessMask=VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT;}
    b.dstAccessMask=VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT;
    if(next==VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL){dst=VK_PIPELINE_STAGE_TRANSFER_BIT;b.dstAccessMask=VK_ACCESS_TRANSFER_READ_BIT;}
    vkCmdPipelineBarrier(cb,src,dst,0,0,NULL,0,NULL,1,&b);
}
/* Sampled-image transitions: UNDEFINED/SHADER_READ_ONLY -> TRANSFER_DST, TRANSFER_DST -> SHADER_READ_ONLY. */
static void texture_barrier(VkCommandBuffer cb,VkImage image,VkImageLayout old,VkImageLayout next){
    const VkPipelineStageFlags shaders=VK_PIPELINE_STAGE_VERTEX_SHADER_BIT|VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT;
    VkImageMemoryBarrier b={.sType=VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER,.oldLayout=old,.newLayout=next,.image=image,
        .srcQueueFamilyIndex=VK_QUEUE_FAMILY_IGNORED,.dstQueueFamilyIndex=VK_QUEUE_FAMILY_IGNORED,.subresourceRange={VK_IMAGE_ASPECT_COLOR_BIT,0,1,0,1}};
    VkPipelineStageFlags src=VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT,dst=VK_PIPELINE_STAGE_TRANSFER_BIT;
    if(next==VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL){b.dstAccessMask=VK_ACCESS_TRANSFER_WRITE_BIT;
        if(old==VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL){src=shaders;b.srcAccessMask=VK_ACCESS_SHADER_READ_BIT;}}
    else{src=VK_PIPELINE_STAGE_TRANSFER_BIT;b.srcAccessMask=VK_ACCESS_TRANSFER_WRITE_BIT;dst=shaders;b.dstAccessMask=VK_ACCESS_SHADER_READ_BIT;
        if(old==VK_IMAGE_LAYOUT_UNDEFINED){src=VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT;b.srcAccessMask=0;}}
    vkCmdPipelineBarrier(cb,src,dst,0,0,NULL,0,NULL,1,&b);
}
static void buffer_barrier(VkCommandBuffer cb,VkBuffer buffer,int kind){
    /* kind 0: readback TRANSFER->HOST; 1: vertex HOST->VERTEX_INPUT; 2: uniform HOST->shaders. */
    VkBufferMemoryBarrier b={.sType=VK_STRUCTURE_TYPE_BUFFER_MEMORY_BARRIER,.buffer=buffer,.size=VK_WHOLE_SIZE,
        .srcQueueFamilyIndex=VK_QUEUE_FAMILY_IGNORED,.dstQueueFamilyIndex=VK_QUEUE_FAMILY_IGNORED};
    VkPipelineStageFlags src=VK_PIPELINE_STAGE_HOST_BIT,dst;
    if(kind==0){src=VK_PIPELINE_STAGE_TRANSFER_BIT;dst=VK_PIPELINE_STAGE_HOST_BIT;b.srcAccessMask=VK_ACCESS_TRANSFER_WRITE_BIT;b.dstAccessMask=VK_ACCESS_HOST_READ_BIT;}
    else if(kind==1){dst=VK_PIPELINE_STAGE_VERTEX_INPUT_BIT;b.srcAccessMask=VK_ACCESS_HOST_WRITE_BIT;b.dstAccessMask=VK_ACCESS_VERTEX_ATTRIBUTE_READ_BIT;}
    else{dst=VK_PIPELINE_STAGE_VERTEX_SHADER_BIT|VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT;b.srcAccessMask=VK_ACCESS_HOST_WRITE_BIT;b.dstAccessMask=VK_ACCESS_UNIFORM_READ_BIT;}
    vkCmdPipelineBarrier(cb,src,dst,0,0,NULL,1,&b,0,NULL);
}
static void copy_to_image(VkCommandBuffer cb,VkBuffer staging,VkImage image,uint32_t w,uint32_t h,VkDeviceSize offset,uint32_t row_length){
    VkBufferImageCopy copy={.bufferOffset=offset,.bufferRowLength=row_length,.imageSubresource={VK_IMAGE_ASPECT_COLOR_BIT,0,0,1},.imageExtent={w,h,1}};
    vkCmdCopyBufferToImage(cb,staging,image,VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL,1,&copy);memset(&copy,0xff,sizeof(copy));
}
static VkResult shader(VkDevice d,const unsigned char *bytes,size_t size,VkShaderModule *out){
    uint32_t *copy=malloc(size);if(!copy)return VK_ERROR_OUT_OF_HOST_MEMORY;memcpy(copy,bytes,size);
    VkShaderModuleCreateInfo i={.sType=VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO,.codeSize=size,.pCode=copy};
    VkResult r=vkCreateShaderModule(d,&i,NULL,out);memset(copy,0,size);free(copy);return r;
}
static VkResult set_layout(VkDevice d,unsigned count,const VkDescriptorSetLayoutBinding *bindings,VkDescriptorSetLayout *out){
    VkDescriptorSetLayoutCreateInfo i={.sType=VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO,.bindingCount=count,.pBindings=bindings};
    return vkCreateDescriptorSetLayout(d,&i,NULL,out);
}
static VkResult pipeline_layout(VkDevice d,unsigned count,const VkDescriptorSetLayout *sets,VkPipelineLayout *out){
    VkPipelineLayoutCreateInfo i={.sType=VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO,.setLayoutCount=count,.pSetLayouts=sets};
    return vkCreatePipelineLayout(d,&i,NULL,out);
}
static VkResult make_sampler(VkDevice d,VkFilter mag,VkFilter min,VkSamplerAddressMode mode,VkSampler *out){
    VkSamplerCreateInfo i={.sType=VK_STRUCTURE_TYPE_SAMPLER_CREATE_INFO,.magFilter=mag,.minFilter=min,.mipmapMode=VK_SAMPLER_MIPMAP_MODE_NEAREST,
        .addressModeU=mode,.addressModeV=mode,.addressModeW=mode,.maxLod=0.25f,.borderColor=VK_BORDER_COLOR_FLOAT_TRANSPARENT_BLACK};
    return vkCreateSampler(d,&i,NULL,out);
}
static void write_texture(VkDevice d,VkDescriptorSet set,uint32_t binding,VkImageView view,VkSampler sampler,VkImageLayout layout){
    VkDescriptorImageInfo info={sampler,view,layout};
    VkWriteDescriptorSet w={.sType=VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET,.dstSet=set,.dstBinding=binding,.descriptorCount=1,.descriptorType=VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER,.pImageInfo=&info};
    vkUpdateDescriptorSets(d,1,&w,0,NULL);memset(&info,0xff,sizeof(info));memset(&w,0xff,sizeof(w));
}
static void write_uniform(VkDevice d,VkDescriptorSet set,uint32_t binding,VkBuffer buffer){
    VkDescriptorBufferInfo info={buffer,0,16};
    VkWriteDescriptorSet w={.sType=VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET,.dstSet=set,.dstBinding=binding,.descriptorCount=1,.descriptorType=VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER,.pBufferInfo=&info};
    vkUpdateDescriptorSets(d,1,&w,0,NULL);memset(&info,0xff,sizeof(info));memset(&w,0xff,sizeof(w));
}
static VkResult graphics_pipeline(VkDevice d,VkShaderModule vs_module,VkShaderModule fs_module,VkPipelineLayout layout,VkRenderPass pass,VkPipeline *out){
    VkPipelineShaderStageCreateInfo stages[2]={{.sType=VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO,.stage=VK_SHADER_STAGE_VERTEX_BIT,.module=vs_module,.pName="main"},
        {.sType=VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO,.stage=VK_SHADER_STAGE_FRAGMENT_BIT,.module=fs_module,.pName="main"}};
    VkVertexInputBindingDescription bind={0,16,VK_VERTEX_INPUT_RATE_VERTEX};
    VkVertexInputAttributeDescription attr[2]={{0,0,VK_FORMAT_R32G32_SFLOAT,0},{1,0,VK_FORMAT_R32G32_SFLOAT,8}};
    VkPipelineVertexInputStateCreateInfo vin={.sType=VK_STRUCTURE_TYPE_PIPELINE_VERTEX_INPUT_STATE_CREATE_INFO,.vertexBindingDescriptionCount=1,.pVertexBindingDescriptions=&bind,
        .vertexAttributeDescriptionCount=2,.pVertexAttributeDescriptions=attr};
    VkPipelineInputAssemblyStateCreateInfo assembly={.sType=VK_STRUCTURE_TYPE_PIPELINE_INPUT_ASSEMBLY_STATE_CREATE_INFO,.topology=VK_PRIMITIVE_TOPOLOGY_TRIANGLE_LIST};
    VkViewport viewport={0,0,W,H,0,1};VkRect2D scissor={{0,0},{W,H}};VkPipelineViewportStateCreateInfo vs={.sType=VK_STRUCTURE_TYPE_PIPELINE_VIEWPORT_STATE_CREATE_INFO,.viewportCount=1,.pViewports=&viewport,.scissorCount=1,.pScissors=&scissor};
    VkPipelineRasterizationStateCreateInfo rs={.sType=VK_STRUCTURE_TYPE_PIPELINE_RASTERIZATION_STATE_CREATE_INFO,.polygonMode=VK_POLYGON_MODE_FILL,.cullMode=VK_CULL_MODE_NONE,.frontFace=VK_FRONT_FACE_COUNTER_CLOCKWISE,.lineWidth=1};
    VkPipelineMultisampleStateCreateInfo ms={.sType=VK_STRUCTURE_TYPE_PIPELINE_MULTISAMPLE_STATE_CREATE_INFO,.rasterizationSamples=VK_SAMPLE_COUNT_1_BIT};VkPipelineColorBlendAttachmentState attachment={.colorWriteMask=15};
    VkPipelineColorBlendStateCreateInfo blend={.sType=VK_STRUCTURE_TYPE_PIPELINE_COLOR_BLEND_STATE_CREATE_INFO,.attachmentCount=1,.pAttachments=&attachment};
    VkGraphicsPipelineCreateInfo pi={.sType=VK_STRUCTURE_TYPE_GRAPHICS_PIPELINE_CREATE_INFO,.stageCount=2,.pStages=stages,.pVertexInputState=&vin,.pInputAssemblyState=&assembly,.pViewportState=&vs,
        .pRasterizationState=&rs,.pMultisampleState=&ms,.pColorBlendState=&blend,.layout=layout,.renderPass=pass,.basePipelineIndex=-1};
    VkResult r=vkCreateGraphicsPipelines(d,VK_NULL_HANDLE,1,&pi,NULL,out);
    memset(stages,0xff,sizeof(stages));memset(&viewport,0xff,sizeof(viewport));memset(&bind,0xff,sizeof(bind));memset(attr,0xff,sizeof(attr));return r;
}
struct scene { VkImage image,tex0,tex1; VkRenderPass pass; VkFramebuffer framebuffer; VkBuffer readback,vertices,staging,uniform;
    VkPipeline pt,pp,pv; VkPipelineLayout layout; VkDescriptorSet set; };
/* One recorded frame. upload0/upload1: 0 none, else the old layout (+1 bias
 * so UNDEFINED=0 is representable) for a T0/T1 staging upload. */
struct frame { int upload0,upload1; VkDeviceSize offset0; VkPipeline pipeline; uint32_t first,count; int skip_sro; };
static void record(VkCommandBuffer cb,const struct scene *s,VkImageLayout old,const struct frame *f){
    if(f->upload0){texture_barrier(cb,s->tex0,(VkImageLayout)(f->upload0-1),VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL);copy_to_image(cb,s->staging,s->tex0,4,4,f->offset0,0);
        if(!f->skip_sro)texture_barrier(cb,s->tex0,VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL,VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL);}
    if(f->upload1){texture_barrier(cb,s->tex1,(VkImageLayout)(f->upload1-1),VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL);copy_to_image(cb,s->staging,s->tex1,8,2,64,0);
        texture_barrier(cb,s->tex1,VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL,VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL);}
    target_barrier(cb,s->image,old,VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL);
    buffer_barrier(cb,s->vertices,1);buffer_barrier(cb,s->uniform,2);
    VkClearValue color={.color={{0,1,0,1}}};VkRenderPassBeginInfo begin={.sType=VK_STRUCTURE_TYPE_RENDER_PASS_BEGIN_INFO,.renderPass=s->pass,.framebuffer=s->framebuffer,.renderArea={{0,0},{W,H}},.clearValueCount=1,.pClearValues=&color};
    vkCmdBeginRenderPass(cb,&begin,VK_SUBPASS_CONTENTS_INLINE);
    vkCmdBindPipeline(cb,VK_PIPELINE_BIND_POINT_GRAPHICS,f->pipeline);
    VkDescriptorSet set=s->set;vkCmdBindDescriptorSets(cb,VK_PIPELINE_BIND_POINT_GRAPHICS,s->layout,0,1,&set,0,NULL);set=VK_NULL_HANDLE;
    VkBuffer v=s->vertices;VkDeviceSize offset=0;vkCmdBindVertexBuffers(cb,0,1,&v,&offset);
    vkCmdDraw(cb,f->count,1,f->first,0);
    vkCmdEndRenderPass(cb);
    target_barrier(cb,s->image,VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL,VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL);
    VkBufferImageCopy copy={.imageSubresource={VK_IMAGE_ASPECT_COLOR_BIT,0,0,1},.imageExtent={W,H,1}};
    vkCmdCopyImageToBuffer(cb,s->image,VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL,s->readback,1,&copy);
    buffer_barrier(cb,s->readback,0);
}
static void quad(float *v,float x0,float y0,float x1,float y1,float u0,float v0,float u1,float v1){
    const float q[6][4]={{x0,y0,u0,v0},{x1,y0,u1,v0},{x1,y1,u1,v1},{x0,y0,u0,v0},{x1,y1,u1,v1},{x0,y1,u0,v1}};memcpy(v,q,sizeof(q));
}
/* Vertex-fetch quadrants: texel (i,j) of the current T0 lookup texture. */
static const unsigned quadrant_texel[4][2]={{0,0},{3,0},{1,2},{2,3}};
int main(void){
    int result=1;VkInstance instance=VK_NULL_HANDLE;VkDevice device=VK_NULL_HANDLE;
    VkDeviceMemory image_mem=VK_NULL_HANDLE,read_mem=VK_NULL_HANDLE,vertex_mem=VK_NULL_HANDLE,staging_mem=VK_NULL_HANDLE,uniform_mem=VK_NULL_HANDLE,tex0_mem=VK_NULL_HANDLE,tex1_mem=VK_NULL_HANDLE;
    VkImageView view=VK_NULL_HANDLE,view0=VK_NULL_HANDLE,view1=VK_NULL_HANDLE;unsigned char *mapped=NULL,*vmap=NULL,*smap=NULL,*umap=NULL;
    VkShaderModule vs_module=VK_NULL_HANDLE,fs_module=VK_NULL_HANDLE;VkDescriptorSetLayout layout=VK_NULL_HANDLE;VkDescriptorPool pool=VK_NULL_HANDLE;
    VkSampler samplers[8]={0};VkCommandPool cpool=VK_NULL_HANDLE;VkCommandBuffer cb=VK_NULL_HANDLE;struct scene s={0};
    struct sigaction action={0};action.sa_handler=deadline;sigemptyset(&action.sa_mask);if(sigaction(SIGALRM,&action,NULL))return 2;alarm(110);signal(SIGPIPE,SIG_IGN);
    puts("GUEST_VK_TEXTURE_SCOPE public static Khronos loader; SAMPLED images, VkSampler, COMBINED_IMAGE_SAMPLER; bounded nonconformant ICD");
    fill();
    VkApplicationInfo app={.sType=VK_STRUCTURE_TYPE_APPLICATION_INFO,.apiVersion=VK_API_VERSION_1_0,.pApplicationName="public-texture"};VkInstanceCreateInfo ii={.sType=VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO,.pApplicationInfo=&app};
    CHECK(vkCreateInstance(&ii,NULL,&instance)==VK_SUCCESS);uint32_t count=1;VkPhysicalDevice physical;CHECK(vkEnumeratePhysicalDevices(instance,&count,&physical)==VK_SUCCESS&&count==1);
    VkQueueFamilyProperties qp;count=1;vkGetPhysicalDeviceQueueFamilyProperties(physical,&count,&qp);CHECK(qp.queueFlags&VK_QUEUE_GRAPHICS_BIT);
    VkPhysicalDeviceProperties properties;vkGetPhysicalDeviceProperties(physical,&properties);const VkPhysicalDeviceLimits *lim=&properties.limits;
    CHECK(lim->maxBoundDescriptorSets==4&&lim->maxUniformBufferRange==16384&&lim->minUniformBufferOffsetAlignment==256);
    CHECK(lim->maxPerStageDescriptorSamplers==4&&lim->maxPerStageDescriptorSampledImages==4&&lim->maxDescriptorSetSamplers==4&&lim->maxDescriptorSetSampledImages==4);
    CHECK(lim->maxSamplerAllocationCount==8&&lim->maxSamplerAnisotropy==1&&lim->maxSamplerLodBias==0&&lim->maxImageDimension2D==128);
    const unsigned max_stride=lim->maxVertexInputBindingStride;CHECK(max_stride==252||max_stride==2048);
    printf("GUEST_VK_TEXTURE_LIMITS samplers=%u sampled_images=%u sampler_allocations=%u dimension=%u max_stride=%u\n",lim->maxPerStageDescriptorSamplers,
        lim->maxPerStageDescriptorSampledImages,lim->maxSamplerAllocationCount,lim->maxImageDimension2D,max_stride);fflush(stdout);
    VkFormatProperties fp;vkGetPhysicalDeviceFormatProperties(physical,VK_FORMAT_R8G8B8A8_UNORM,&fp);
    const VkFormatFeatureFlags sampled=VK_FORMAT_FEATURE_SAMPLED_IMAGE_BIT|VK_FORMAT_FEATURE_SAMPLED_IMAGE_FILTER_LINEAR_BIT|VK_FORMAT_FEATURE_TRANSFER_DST_BIT;
    CHECK((fp.optimalTilingFeatures&sampled)==sampled&&!fp.linearTilingFeatures);
    vkGetPhysicalDeviceFormatProperties(physical,VK_FORMAT_B8G8R8A8_UNORM,&fp);CHECK(!fp.optimalTilingFeatures);
    VkImageFormatProperties ifp;
    CHECK(vkGetPhysicalDeviceImageFormatProperties(physical,VK_FORMAT_R8G8B8A8_UNORM,VK_IMAGE_TYPE_2D,VK_IMAGE_TILING_OPTIMAL,VK_IMAGE_USAGE_SAMPLED_BIT|VK_IMAGE_USAGE_TRANSFER_DST_BIT,0,&ifp)==VK_SUCCESS);
    CHECK(ifp.maxExtent.width==128&&ifp.maxExtent.height==128&&ifp.maxMipLevels==1&&ifp.maxArrayLayers==1);
    CHECK(vkGetPhysicalDeviceImageFormatProperties(physical,VK_FORMAT_R8G8B8A8_UNORM,VK_IMAGE_TYPE_2D,VK_IMAGE_TILING_OPTIMAL,VK_IMAGE_USAGE_SAMPLED_BIT,0,&ifp)==VK_ERROR_FORMAT_NOT_SUPPORTED);
    VkPhysicalDeviceMemoryProperties mp;vkGetPhysicalDeviceMemoryProperties(physical,&mp);CHECK(mp.memoryTypeCount==2&&(mp.memoryTypes[1].propertyFlags&VK_MEMORY_PROPERTY_HOST_COHERENT_BIT));
    float priority=1;VkDeviceQueueCreateInfo qi={.sType=VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO,.queueCount=1,.pQueuePriorities=&priority};VkDeviceCreateInfo di={.sType=VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO,.queueCreateInfoCount=1,.pQueueCreateInfos=&qi};
    CHECK(vkCreateDevice(physical,&di,NULL,&device)==VK_SUCCESS);VkQueue queue;vkGetDeviceQueue(device,0,0,&queue);CHECK(queue!=VK_NULL_HANDLE);
    CHECK(vkGetDeviceProcAddr(device,"vkCreateSampler")!=NULL&&vkGetDeviceProcAddr(device,"vkCmdCopyBufferToImage")!=NULL&&vkGetDeviceProcAddr(device,"vkGuestUnknown")==NULL);
    /* Samplers: unsupported state is FEATURE_NOT_PRESENT; the ninth live sampler is refused. */
    {
        VkSamplerCreateInfo base={.sType=VK_STRUCTURE_TYPE_SAMPLER_CREATE_INFO,.magFilter=VK_FILTER_NEAREST,.minFilter=VK_FILTER_NEAREST,.mipmapMode=VK_SAMPLER_MIPMAP_MODE_NEAREST,
            .addressModeU=VK_SAMPLER_ADDRESS_MODE_REPEAT,.addressModeV=VK_SAMPLER_ADDRESS_MODE_REPEAT,.addressModeW=VK_SAMPLER_ADDRESS_MODE_REPEAT};
        VkSampler bad=VK_NULL_HANDLE;VkSamplerCreateInfo i;unsigned refused=0;
        for(unsigned n=0;n<6;n++){
            i=base;
            if(n==0){i.anisotropyEnable=VK_TRUE;i.maxAnisotropy=4;}
            else if(n==1){i.compareEnable=VK_TRUE;i.compareOp=VK_COMPARE_OP_LESS;}
            else if(n==2)i.mipLodBias=0.5f;
            else if(n==3)i.unnormalizedCoordinates=VK_TRUE;
            else if(n==4)i.addressModeU=VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_BORDER;
            else i.minLod=1;
            CHECK(vkCreateSampler(device,&i,NULL,&bad)==VK_ERROR_FEATURE_NOT_PRESENT&&!bad);refused++;
        }
        i=base;i.sType=VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO;CHECK(vkCreateSampler(device,&i,NULL,&bad)==VK_ERROR_INITIALIZATION_FAILED&&!bad);
        for(unsigned n=0;n<8;n++){i=base;i.addressModeV=(VkSamplerAddressMode)(n%3);CHECK(vkCreateSampler(device,&i,NULL,&samplers[n])==VK_SUCCESS&&samplers[n]);}
        CHECK(vkCreateSampler(device,&base,NULL,&bad)==VK_ERROR_OUT_OF_HOST_MEMORY&&!bad);
        for(unsigned n=0;n<8;n++){vkDestroySampler(device,samplers[n],NULL);samplers[n]=VK_NULL_HANDLE;}
        printf("GUEST_VK_TEXTURE_SAMPLERS refused=%u invalid=1 exhaustion=8\n",refused);fflush(stdout);
    }
    /* Images: sampled images are whole-image RGBA8 2D up to 128x128, SAMPLED|TRANSFER_DST, one level. */
    VkImageCreateInfo im={.sType=VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO,.imageType=VK_IMAGE_TYPE_2D,.format=VK_FORMAT_R8G8B8A8_UNORM,.extent={129,4,1},.mipLevels=1,.arrayLayers=1,.samples=VK_SAMPLE_COUNT_1_BIT,
        .tiling=VK_IMAGE_TILING_OPTIMAL,.usage=VK_IMAGE_USAGE_SAMPLED_BIT|VK_IMAGE_USAGE_TRANSFER_DST_BIT,.sharingMode=VK_SHARING_MODE_EXCLUSIVE};
    VkImage rejected=VK_NULL_HANDLE;
    CHECK(vkCreateImage(device,&im,NULL,&rejected)==VK_ERROR_FORMAT_NOT_SUPPORTED&&!rejected);
    im.extent=(VkExtent3D){4,4,1};im.usage=VK_IMAGE_USAGE_SAMPLED_BIT;CHECK(vkCreateImage(device,&im,NULL,&rejected)==VK_ERROR_FORMAT_NOT_SUPPORTED&&!rejected);
    im.usage=VK_IMAGE_USAGE_SAMPLED_BIT|VK_IMAGE_USAGE_TRANSFER_DST_BIT;im.mipLevels=2;CHECK(vkCreateImage(device,&im,NULL,&rejected)==VK_ERROR_FORMAT_NOT_SUPPORTED&&!rejected);
    im.mipLevels=1;im.format=VK_FORMAT_R8G8B8A8_SRGB;CHECK(vkCreateImage(device,&im,NULL,&rejected)==VK_ERROR_FORMAT_NOT_SUPPORTED&&!rejected);
    im.format=VK_FORMAT_R8G8B8A8_UNORM;
    printf("GUEST_VK_TEXTURE_IMAGES rejected=4\n");fflush(stdout);
    /* Colour target and readback. */
    VkImageCreateInfo ti=im;ti.extent=(VkExtent3D){W,H,1};ti.usage=VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT|VK_IMAGE_USAGE_TRANSFER_SRC_BIT;
    CHECK(vkCreateImage(device,&ti,NULL,&s.image)==VK_SUCCESS);VkMemoryRequirements mr;vkGetImageMemoryRequirements(device,s.image,&mr);CHECK(mr.size==PIXELS&&mr.memoryTypeBits==1);
    VkMemoryAllocateInfo ai={.sType=VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO,.allocationSize=mr.size};CHECK(vkAllocateMemory(device,&ai,NULL,&image_mem)==VK_SUCCESS);CHECK(vkBindImageMemory(device,s.image,image_mem,0)==VK_SUCCESS);
    VkImageViewCreateInfo vi={.sType=VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO,.image=s.image,.viewType=VK_IMAGE_VIEW_TYPE_2D,.format=VK_FORMAT_R8G8B8A8_UNORM,.subresourceRange={VK_IMAGE_ASPECT_COLOR_BIT,0,1,0,1}};CHECK(vkCreateImageView(device,&vi,NULL,&view)==VK_SUCCESS);
    VkBufferCreateInfo bi={.sType=VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO,.size=PIXELS+16,.usage=VK_BUFFER_USAGE_TRANSFER_DST_BIT,.sharingMode=VK_SHARING_MODE_EXCLUSIVE};CHECK(vkCreateBuffer(device,&bi,NULL,&s.readback)==VK_SUCCESS);
    vkGetBufferMemoryRequirements(device,s.readback,&mr);CHECK(mr.size==PIXELS+16&&mr.memoryTypeBits==2);ai.allocationSize=TOTAL;ai.memoryTypeIndex=1;CHECK(vkAllocateMemory(device,&ai,NULL,&read_mem)==VK_SUCCESS);
    CHECK(vkBindBufferMemory(device,s.readback,read_mem,0)==VK_SUCCESS);CHECK(vkMapMemory(device,read_mem,0,VK_WHOLE_SIZE,0,(void**)&mapped)==VK_SUCCESS);
    /* Vertex buffer: stride 16 (position, texture coordinate). */
    float verts[36][4];
    quad(verts[0],-1,-1,1,1,-1,-1,2,2);quad(verts[6],-1,-1,1,1,0,0,1,1);
    for(unsigned q=0;q<4;q++){float x0=q%2?0:-1,y0=q/2?0:-1;quad(verts[12+6*q],x0,y0,x0+1,y0+1,(quadrant_texel[q][0]+.5f)/4,(quadrant_texel[q][1]+.5f)/4,(quadrant_texel[q][0]+.5f)/4,(quadrant_texel[q][1]+.5f)/4);}
    bi.size=sizeof(verts);bi.usage=VK_BUFFER_USAGE_VERTEX_BUFFER_BIT;CHECK(vkCreateBuffer(device,&bi,NULL,&s.vertices)==VK_SUCCESS);
    ai.allocationSize=sizeof(verts);CHECK(vkAllocateMemory(device,&ai,NULL,&vertex_mem)==VK_SUCCESS);CHECK(vkBindBufferMemory(device,s.vertices,vertex_mem,0)==VK_SUCCESS);
    CHECK(vkMapMemory(device,vertex_mem,0,VK_WHOLE_SIZE,0,(void**)&vmap)==VK_SUCCESS);memcpy(vmap,verts,sizeof(verts));
    /* Staging: T0 at 0, T1 at 64, replacement T0 contents at 128. */
    VkBuffer badbuf=VK_NULL_HANDLE;bi.usage=VK_BUFFER_USAGE_TRANSFER_SRC_BIT;bi.size=6;CHECK(vkCreateBuffer(device,&bi,NULL,&badbuf)==VK_ERROR_FEATURE_NOT_PRESENT&&!badbuf);
    bi.usage=VK_BUFFER_USAGE_TRANSFER_SRC_BIT|VK_BUFFER_USAGE_TRANSFER_DST_BIT;bi.size=STAGING;CHECK(vkCreateBuffer(device,&bi,NULL,&badbuf)==VK_ERROR_FEATURE_NOT_PRESENT&&!badbuf);
    bi.usage=VK_BUFFER_USAGE_TRANSFER_SRC_BIT;CHECK(vkCreateBuffer(device,&bi,NULL,&s.staging)==VK_SUCCESS);vkGetBufferMemoryRequirements(device,s.staging,&mr);CHECK(mr.size==STAGING&&mr.memoryTypeBits==2);
    ai.allocationSize=STAGING;CHECK(vkAllocateMemory(device,&ai,NULL,&staging_mem)==VK_SUCCESS);CHECK(vkBindBufferMemory(device,s.staging,staging_mem,0)==VK_SUCCESS);
    CHECK(vkMapMemory(device,staging_mem,0,VK_WHOLE_SIZE,0,(void**)&smap)==VK_SUCCESS);memset(smap,0,STAGING);memcpy(smap,t0,64);memcpy(smap+64,t1,64);memcpy(smap+128,t0b,64);
    /* Uniform block Select{vec4 scale}. */
    bi.usage=VK_BUFFER_USAGE_UNIFORM_BUFFER_BIT;bi.size=16;CHECK(vkCreateBuffer(device,&bi,NULL,&s.uniform)==VK_SUCCESS);
    ai.allocationSize=256;CHECK(vkAllocateMemory(device,&ai,NULL,&uniform_mem)==VK_SUCCESS);CHECK(vkBindBufferMemory(device,s.uniform,uniform_mem,0)==VK_SUCCESS);
    CHECK(vkMapMemory(device,uniform_mem,0,VK_WHOLE_SIZE,0,(void**)&umap)==VK_SUCCESS);{const float scale[4]={1,0,1,1};memcpy(umap,scale,16);}
    /* Sampled images T0 (4x4) and T1 (8x2): device-local memory type 0, view after binding. */
    im.extent=(VkExtent3D){4,4,1};CHECK(vkCreateImage(device,&im,NULL,&s.tex0)==VK_SUCCESS);vkGetImageMemoryRequirements(device,s.tex0,&mr);CHECK(mr.size==64&&mr.memoryTypeBits==1);
    ai.allocationSize=64;ai.memoryTypeIndex=0;CHECK(vkAllocateMemory(device,&ai,NULL,&tex0_mem)==VK_SUCCESS);
    vi.image=s.tex0;CHECK(vkCreateImageView(device,&vi,NULL,&view0)==VK_ERROR_INITIALIZATION_FAILED&&!view0); /* not yet bound */
    CHECK(vkBindImageMemory(device,s.tex0,tex0_mem,0)==VK_SUCCESS);CHECK(vkCreateImageView(device,&vi,NULL,&view0)==VK_SUCCESS);
    im.extent=(VkExtent3D){8,2,1};CHECK(vkCreateImage(device,&im,NULL,&s.tex1)==VK_SUCCESS);vkGetImageMemoryRequirements(device,s.tex1,&mr);CHECK(mr.size==64&&mr.memoryTypeBits==1);
    CHECK(vkAllocateMemory(device,&ai,NULL,&tex1_mem)==VK_SUCCESS);CHECK(vkBindImageMemory(device,s.tex1,tex1_mem,0)==VK_SUCCESS);vi.image=s.tex1;CHECK(vkCreateImageView(device,&vi,NULL,&view1)==VK_SUCCESS);
    CHECK(make_pass(device,&s.pass)==VK_SUCCESS);
    VkFramebufferCreateInfo fi={.sType=VK_STRUCTURE_TYPE_FRAMEBUFFER_CREATE_INFO,.renderPass=s.pass,.attachmentCount=1,.pAttachments=&view,.width=W,.height=H,.layers=1};CHECK(vkCreateFramebuffer(device,&fi,NULL,&s.framebuffer)==VK_SUCCESS);
    /* Shaders: unsupported sampling shapes fail in the host translator. */
    {
        const struct {const unsigned char *bytes;size_t size;} bad[8]={{shader_bad_separate_frag,sizeof(shader_bad_separate_frag)},{shader_bad_array_frag,sizeof(shader_bad_array_frag)},
            {shader_bad_3d_frag,sizeof(shader_bad_3d_frag)},{shader_bad_shadow_frag,sizeof(shader_bad_shadow_frag)},{shader_bad_integer_frag,sizeof(shader_bad_integer_frag)},
            {shader_bad_param_frag,sizeof(shader_bad_param_frag)},{shader_bad_fetch_frag,sizeof(shader_bad_fetch_frag)},{shader_bad_binding_frag,sizeof(shader_bad_binding_frag)}};
        for(unsigned n=0;n<8;n++){VkShaderModule m=VK_NULL_HANDLE;CHECK(shader(device,bad[n].bytes,bad[n].size,&m)==VK_ERROR_INITIALIZATION_FAILED&&!m);}
        printf("GUEST_VK_TEXTURE_SHADERS rejected=8\n");fflush(stdout);
    }
    /* Descriptor set layouts. The shared layout: b0/b1 fragment samplers, b2 fragment uniform, b3 vertex sampler. */
    const VkDescriptorType CIS=VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER,UBO=VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER;
    const VkShaderStageFlags FS=VK_SHADER_STAGE_FRAGMENT_BIT,VS=VK_SHADER_STAGE_VERTEX_BIT;
    const VkDescriptorSetLayoutBinding shared[4]={{0,CIS,1,FS,NULL},{1,CIS,1,FS,NULL},{2,UBO,1,FS,NULL},{3,CIS,1,VS,NULL}};
    {
        VkDescriptorSetLayout bad=VK_NULL_HANDLE;VkSampler immutable=VK_NULL_HANDLE;
        VkDescriptorSetLayoutBinding b={0,CIS,2,FS,NULL};CHECK(set_layout(device,1,&b,&bad)==VK_ERROR_INITIALIZATION_FAILED&&!bad);
        b.descriptorCount=1;b.pImmutableSamplers=&immutable;CHECK(set_layout(device,1,&b,&bad)==VK_ERROR_INITIALIZATION_FAILED&&!bad);
        b.pImmutableSamplers=NULL;b.descriptorType=VK_DESCRIPTOR_TYPE_SAMPLED_IMAGE;CHECK(set_layout(device,1,&b,&bad)==VK_ERROR_INITIALIZATION_FAILED&&!bad);
        b.descriptorType=VK_DESCRIPTOR_TYPE_SAMPLER;CHECK(set_layout(device,1,&b,&bad)==VK_ERROR_INITIALIZATION_FAILED&&!bad);
        b.descriptorType=CIS;b.stageFlags=VK_SHADER_STAGE_COMPUTE_BIT;CHECK(set_layout(device,1,&b,&bad)==VK_ERROR_INITIALIZATION_FAILED&&!bad);
        /* Five samplers across a pipeline layout exceed the per-layout limit of four. */
        VkDescriptorSetLayout three=VK_NULL_HANDLE;VkPipelineLayout badl=VK_NULL_HANDLE;
        const VkDescriptorSetLayoutBinding tri[3]={{0,CIS,1,FS,NULL},{1,CIS,1,FS,NULL},{2,CIS,1,FS,NULL}};
        CHECK(set_layout(device,3,tri,&three)==VK_SUCCESS);VkDescriptorSetLayout pair[2]={three,three};
        CHECK(pipeline_layout(device,2,pair,&badl)==VK_ERROR_INITIALIZATION_FAILED&&!badl);vkDestroyDescriptorSetLayout(device,three,NULL);
        printf("GUEST_VK_TEXTURE_LAYOUTS rejected_layouts=5 rejected_pipeline_layouts=1\n");fflush(stdout);
    }
    CHECK(set_layout(device,4,shared,&layout)==VK_SUCCESS);CHECK(pipeline_layout(device,1,&layout,&s.layout)==VK_SUCCESS);
    CHECK(shader(device,shader_tex_vert,sizeof(shader_tex_vert),&vs_module)==VK_SUCCESS);CHECK(shader(device,shader_tex_frag,sizeof(shader_tex_frag),&fs_module)==VK_SUCCESS);
    /* Host rejects layouts that omit a sampled binding, declare it as a uniform or hide it from its stage. */
    {
        const VkDescriptorSetLayoutBinding variants[3][1]={{{2,UBO,1,FS,NULL}},{{0,UBO,1,FS,NULL}},{{0,CIS,1,VS,NULL}}};
        for(unsigned n=0;n<3;n++){
            VkDescriptorSetLayout l=VK_NULL_HANDLE;VkPipelineLayout pl=VK_NULL_HANDLE;VkPipeline p=VK_NULL_HANDLE;
            CHECK(set_layout(device,1,variants[n],&l)==VK_SUCCESS);CHECK(pipeline_layout(device,1,&l,&pl)==VK_SUCCESS);
            VkResult r=graphics_pipeline(device,vs_module,fs_module,pl,s.pass,&p);
            vkDestroyPipelineLayout(device,pl,NULL);vkDestroyDescriptorSetLayout(device,l,NULL);
            CHECK(r==VK_ERROR_INITIALIZATION_FAILED&&!p);
        }
        printf("GUEST_VK_TEXTURE_PIPELINES rejected=3\n");fflush(stdout);
    }
    CHECK(graphics_pipeline(device,vs_module,fs_module,s.layout,s.pass,&s.pt)==VK_SUCCESS);
    vkDestroyShaderModule(device,fs_module,NULL);fs_module=VK_NULL_HANDLE;
    CHECK(shader(device,shader_pair_frag,sizeof(shader_pair_frag),&fs_module)==VK_SUCCESS);CHECK(graphics_pipeline(device,vs_module,fs_module,s.layout,s.pass,&s.pp)==VK_SUCCESS);
    vkDestroyShaderModule(device,fs_module,NULL);fs_module=VK_NULL_HANDLE;vkDestroyShaderModule(device,vs_module,NULL);vs_module=VK_NULL_HANDLE;
    CHECK(shader(device,shader_vfetch_vert,sizeof(shader_vfetch_vert),&vs_module)==VK_SUCCESS);CHECK(shader(device,shader_vcolor_frag,sizeof(shader_vcolor_frag),&fs_module)==VK_SUCCESS);
    CHECK(graphics_pipeline(device,vs_module,fs_module,s.layout,s.pass,&s.pv)==VK_SUCCESS);
    vkDestroyShaderModule(device,fs_module,NULL);fs_module=VK_NULL_HANDLE;vkDestroyShaderModule(device,vs_module,NULL);vs_module=VK_NULL_HANDLE;
    /* Pools: one or two distinct UNIFORM_BUFFER/COMBINED_IMAGE_SAMPLER sizes; sampler capacity is enforced. */
    {
        VkDescriptorPoolSize sizes[3]={{UBO,1},{CIS,3},{CIS,1}};VkDescriptorPoolCreateInfo pci={.sType=VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO,.maxSets=1,.poolSizeCount=3,.pPoolSizes=sizes};
        VkDescriptorPool badp=VK_NULL_HANDLE;CHECK(vkCreateDescriptorPool(device,&pci,NULL,&badp)==VK_ERROR_INITIALIZATION_FAILED&&!badp);
        pci.poolSizeCount=2;sizes[0]=(VkDescriptorPoolSize){CIS,1};CHECK(vkCreateDescriptorPool(device,&pci,NULL,&badp)==VK_ERROR_INITIALIZATION_FAILED&&!badp); /* duplicate type */
        sizes[0]=(VkDescriptorPoolSize){UBO,1};sizes[1].descriptorCount=2;CHECK(vkCreateDescriptorPool(device,&pci,NULL,&badp)==VK_SUCCESS);
        VkDescriptorSetAllocateInfo dai={.sType=VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO,.descriptorPool=badp,.descriptorSetCount=1,.pSetLayouts=&layout};VkDescriptorSet extra=VK_NULL_HANDLE;
        CHECK(vkAllocateDescriptorSets(device,&dai,&extra)==VK_ERROR_OUT_OF_POOL_MEMORY&&!extra);vkDestroyDescriptorPool(device,badp,NULL);
        sizes[1].descriptorCount=3;CHECK(vkCreateDescriptorPool(device,&pci,NULL,&pool)==VK_SUCCESS);dai.descriptorPool=pool;
        CHECK(vkAllocateDescriptorSets(device,&dai,&s.set)==VK_SUCCESS&&s.set);CHECK(vkAllocateDescriptorSets(device,&dai,&extra)==VK_ERROR_OUT_OF_POOL_MEMORY&&!extra);
        printf("GUEST_VK_TEXTURE_POOLS rejected=2 sampler_capacity=1 set_capacity=1\n");fflush(stdout);
    }
    vkDestroyDescriptorSetLayout(device,layout,NULL);layout=VK_NULL_HANDLE;
    /* Samplers used by the frames. */
    enum {NR,NC,NM,MIX,LR,LC};
    CHECK(make_sampler(device,VK_FILTER_NEAREST,VK_FILTER_NEAREST,VK_SAMPLER_ADDRESS_MODE_REPEAT,&samplers[NR])==VK_SUCCESS);
    CHECK(make_sampler(device,VK_FILTER_NEAREST,VK_FILTER_NEAREST,VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE,&samplers[NC])==VK_SUCCESS);
    CHECK(make_sampler(device,VK_FILTER_NEAREST,VK_FILTER_NEAREST,VK_SAMPLER_ADDRESS_MODE_MIRRORED_REPEAT,&samplers[NM])==VK_SUCCESS);
    CHECK(make_sampler(device,VK_FILTER_NEAREST,VK_FILTER_LINEAR,VK_SAMPLER_ADDRESS_MODE_REPEAT,&samplers[MIX])==VK_SUCCESS);
    CHECK(make_sampler(device,VK_FILTER_LINEAR,VK_FILTER_LINEAR,VK_SAMPLER_ADDRESS_MODE_REPEAT,&samplers[LR])==VK_SUCCESS);
    CHECK(make_sampler(device,VK_FILTER_LINEAR,VK_FILTER_LINEAR,VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE,&samplers[LC])==VK_SUCCESS);
    const VkImageLayout SRO=VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;
#define WRITE_ALL(sampler0) do{write_texture(device,s.set,0,view0,samplers[sampler0],SRO);write_texture(device,s.set,1,view1,samplers[NC],SRO);write_uniform(device,s.set,2,s.uniform);write_texture(device,s.set,3,view0,samplers[NC],SRO);}while(0)
    WRITE_ALL(NR);
    VkCommandPoolCreateInfo cpi={.sType=VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO,.flags=VK_COMMAND_POOL_CREATE_RESET_COMMAND_BUFFER_BIT};CHECK(vkCreateCommandPool(device,&cpi,NULL,&cpool)==VK_SUCCESS);
    VkCommandBufferAllocateInfo cai={.sType=VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO,.commandPool=cpool,.level=VK_COMMAND_BUFFER_LEVEL_PRIMARY,.commandBufferCount=1};CHECK(vkAllocateCommandBuffers(device,&cai,&cb)==VK_SUCCESS);
    VkCommandBufferBeginInfo begin={.sType=VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO};VkSubmitInfo submit={.sType=VK_STRUCTURE_TYPE_SUBMIT_INFO,.commandBufferCount=1,.pCommandBuffers=&cb};
    /* Invalid recordings: EndCommandBuffer must refuse every one of them. */
    for(unsigned n=0;n<6;n++){
        CHECK(vkResetCommandBuffer(cb,0)==VK_SUCCESS);CHECK(vkBeginCommandBuffer(cb,&begin)==VK_SUCCESS);
        if(n==2){texture_barrier(cb,s.tex0,VK_IMAGE_LAYOUT_UNDEFINED,SRO);} /* UNDEFINED -> SHADER_READ_ONLY */
        else{
            texture_barrier(cb,s.tex0,VK_IMAGE_LAYOUT_UNDEFINED,VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL);
            if(n==0)copy_to_image(cb,s.staging,s.tex0,4,4,0,8);            /* bufferRowLength */
            else if(n==1){target_barrier(cb,s.image,VK_IMAGE_LAYOUT_UNDEFINED,VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL);
                VkClearValue color={.color={{0,1,0,1}}};VkRenderPassBeginInfo rb={.sType=VK_STRUCTURE_TYPE_RENDER_PASS_BEGIN_INFO,.renderPass=s.pass,.framebuffer=s.framebuffer,.renderArea={{0,0},{W,H}},.clearValueCount=1,.pClearValues=&color};
                vkCmdBeginRenderPass(cb,&rb,VK_SUBPASS_CONTENTS_INLINE);copy_to_image(cb,s.staging,s.tex0,4,4,0,0);vkCmdEndRenderPass(cb);} /* copy inside a pass */
            else if(n==3)copy_to_image(cb,s.vertices,s.tex0,4,4,0,0);       /* not a staging buffer */
            else if(n==4)copy_to_image(cb,s.staging,s.tex0,2,4,0,0);        /* partial extent */
            else copy_to_image(cb,s.staging,s.tex0,4,4,224,0);             /* region beyond the buffer */
        }
        CHECK(vkEndCommandBuffer(cb)==VK_ERROR_INITIALIZATION_FAILED);
    }
    printf("GUEST_VK_TEXTURE_RECORDING_REJECTED count=6\n");fflush(stdout);
    VkImageLayout old=VK_IMAGE_LAYOUT_UNDEFINED;const double LO=-1,HI=2;
    const int U=VK_IMAGE_LAYOUT_UNDEFINED+1,R=VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL+1;
#define RECORD(...) do{const struct frame f=__VA_ARGS__;CHECK(vkResetCommandBuffer(cb,0)==VK_SUCCESS);CHECK(vkBeginCommandBuffer(cb,&begin)==VK_SUCCESS);record(cb,&s,old,&f);CHECK(vkEndCommandBuffer(cb)==VK_SUCCESS);}while(0)
#define FRAME(round,tolerance) do{memset(mapped,0xa5,TOTAL);CHECK(vkQueueSubmit(queue,1,&submit,VK_NULL_HANDLE)==VK_SUCCESS);CHECK(vkQueueWaitIdle(queue)==VK_SUCCESS);old=VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL;CHECK(compare(mapped,round,tolerance));}while(0)
#define REFUSED() do{memset(mapped,0xa5,TOTAL);CHECK(vkQueueSubmit(queue,1,&submit,VK_NULL_HANDLE)==VK_ERROR_INITIALIZATION_FAILED);for(unsigned k=0;k<TOTAL;k++)CHECK(mapped[k]==0xa5);}while(0)
    /* Rounds 0-3: nearest filtering with texture coordinates -1..2 (4x magnified tiling). */
    RECORD({U,U,0,s.pt,0,6,0});expect_quad(t0,4,4,REPEAT,0,LO,HI);FRAME(0,0);
    WRITE_ALL(NC);RECORD({0,0,0,s.pt,0,6,0});expect_quad(t0,4,4,CLAMP,0,LO,HI);FRAME(1,0);
    WRITE_ALL(NM);RECORD({0,0,0,s.pt,0,6,0});expect_quad(t0,4,4,MIRROR,0,LO,HI);FRAME(2,0);
    /* Magnification selects magFilter (NEAREST) although minFilter is LINEAR. */
    WRITE_ALL(MIX);RECORD({0,0,0,s.pt,0,6,0});expect_quad(t0,4,4,REPEAT,0,LO,HI);FRAME(3,0);
    /* Rounds 4-5: bilinear filtering against a double-precision reference. */
    WRITE_ALL(LR);RECORD({0,0,0,s.pt,6,6,0});expect_quad(t0,4,4,REPEAT,1,0,1);FRAME(4,2);
    WRITE_ALL(LC);RECORD({0,0,0,s.pt,6,6,0});expect_quad(t0,4,4,CLAMP,1,0,1);FRAME(5,2);
    WRITE_ALL(NC);RECORD({0,0,0,s.pt,6,6,0});expect_quad(t0,4,4,CLAMP,0,0,1);FRAME(6,0);
    /* Round 7: two textures on separate units plus the uniform scale (1,0,1,1). */
    RECORD({0,0,0,s.pp,6,6,0});
    for(unsigned y=0;y<H;y++)for(unsigned x=0;x<W;x++){double u=(x+.5)/W,v=(y+.5)/H,a[4],b[4];nearest(t0,4,4,CLAMP,u,v,a);nearest(t1,8,2,CLAMP,u,v,b);
        unsigned char *p=want+(y*W+x)*4;p[0]=(unsigned char)a[0];p[1]=0;p[2]=(unsigned char)b[2];p[3]=(unsigned char)b[3];}
    FRAME(7,0);
    /* Round 8: re-upload T0 from SHADER_READ_ONLY with replacement contents. */
    RECORD({R,0,128,s.pt,6,6,0});expect_quad(t0b,4,4,CLAMP,0,0,1);FRAME(8,0);
    /* Round 9: rewrite the staging bytes after recording; resubmit without re-recording. */
    memcpy(smap+128,t0c,64);expect_quad(t0c,4,4,CLAMP,0,0,1);FRAME(9,0);
    /* Round 10: vertex-stage sampling (binding 3) selects one texel per quadrant. */
    RECORD({0,0,0,s.pv,12,24,0});
    for(unsigned y=0;y<H;y++)for(unsigned x=0;x<W;x++){unsigned q=(x>=W/2)+2*(y>=H/2);memcpy(want+(y*W+x)*4,t0c+(quadrant_texel[q][1]*4+quadrant_texel[q][0])*4,4);}
    FRAME(10,0);
    printf("GUEST_VK_TEXTURE_ROUNDS_PASS rounds=11 linear_max_delta=%u\n",max_linear_delta);fflush(stdout);
    /* Submission-time refusals leave the readback untouched and the device usable. */
    RECORD({U,0,128,s.pt,6,6,1});REFUSED();                                     /* texture still TRANSFER_DST at draw */
    {   /* Contents discarded by an UNDEFINED transition and never copied. */
        CHECK(vkResetCommandBuffer(cb,0)==VK_SUCCESS);CHECK(vkBeginCommandBuffer(cb,&begin)==VK_SUCCESS);
        texture_barrier(cb,s.tex0,VK_IMAGE_LAYOUT_UNDEFINED,VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL);texture_barrier(cb,s.tex0,VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL,SRO);
        const struct frame f={0,0,0,s.pt,6,6,0};record(cb,&s,old,&f);CHECK(vkEndCommandBuffer(cb)==VK_SUCCESS);REFUSED();
    }
    {   /* Recorded old layout (TRANSFER_DST) does not match the current SHADER_READ_ONLY. */
        CHECK(vkResetCommandBuffer(cb,0)==VK_SUCCESS);CHECK(vkBeginCommandBuffer(cb,&begin)==VK_SUCCESS);
        texture_barrier(cb,s.tex0,VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL,SRO);
        const struct frame f={0,0,0,s.pt,6,6,0};record(cb,&s,old,&f);CHECK(vkEndCommandBuffer(cb)==VK_SUCCESS);REFUSED();
    }
    write_texture(device,s.set,0,view0,samplers[NC],VK_IMAGE_LAYOUT_GENERAL);RECORD({0,0,0,s.pt,6,6,0});REFUSED();   /* wrong descriptor layout */
    WRITE_ALL(NC);write_texture(device,s.set,0,view,samplers[NC],SRO);RECORD({0,0,0,s.pt,6,6,0});REFUSED();          /* view of a non-sampled image */
    WRITE_ALL(NC);RECORD({0,0,0,s.pt,6,6,0});expect_quad(t0c,4,4,CLAMP,0,0,1);FRAME(11,0);
    printf("GUEST_VK_TEXTURE_NEGATIVE_PASS refused_submits=5 recovered=1\n");fflush(stdout);
#undef RECORD
#undef FRAME
#undef REFUSED
#undef WRITE_ALL
    result=0;
done:
    if(device){
        if(cb)vkFreeCommandBuffers(device,cpool,1,&cb);if(cpool)vkDestroyCommandPool(device,cpool,NULL);
        if(s.framebuffer)vkDestroyFramebuffer(device,s.framebuffer,NULL);
        if(s.pt)vkDestroyPipeline(device,s.pt,NULL);if(s.pp)vkDestroyPipeline(device,s.pp,NULL);if(s.pv)vkDestroyPipeline(device,s.pv,NULL);
        if(s.pass)vkDestroyRenderPass(device,s.pass,NULL);
        if(vs_module)vkDestroyShaderModule(device,vs_module,NULL);if(fs_module)vkDestroyShaderModule(device,fs_module,NULL);
        if(pool)vkDestroyDescriptorPool(device,pool,NULL);if(s.layout)vkDestroyPipelineLayout(device,s.layout,NULL);if(layout)vkDestroyDescriptorSetLayout(device,layout,NULL);
        for(unsigned n=0;n<8;n++)if(samplers[n])vkDestroySampler(device,samplers[n],NULL);
        if(view0)vkDestroyImageView(device,view0,NULL);if(s.tex0)vkDestroyImage(device,s.tex0,NULL);if(tex0_mem)vkFreeMemory(device,tex0_mem,NULL);
        if(view1)vkDestroyImageView(device,view1,NULL);if(s.tex1)vkDestroyImage(device,s.tex1,NULL);if(tex1_mem)vkFreeMemory(device,tex1_mem,NULL);
        if(umap)vkUnmapMemory(device,uniform_mem);if(s.uniform)vkDestroyBuffer(device,s.uniform,NULL);if(uniform_mem)vkFreeMemory(device,uniform_mem,NULL);
        if(smap)vkUnmapMemory(device,staging_mem);if(s.staging)vkDestroyBuffer(device,s.staging,NULL);if(staging_mem)vkFreeMemory(device,staging_mem,NULL);
        if(vmap)vkUnmapMemory(device,vertex_mem);if(s.vertices)vkDestroyBuffer(device,s.vertices,NULL);if(vertex_mem)vkFreeMemory(device,vertex_mem,NULL);
        if(mapped)vkUnmapMemory(device,read_mem);if(s.readback)vkDestroyBuffer(device,s.readback,NULL);if(read_mem)vkFreeMemory(device,read_mem,NULL);
        if(view)vkDestroyImageView(device,view,NULL);if(s.image)vkDestroyImage(device,s.image,NULL);if(image_mem)vkFreeMemory(device,image_mem,NULL);vkDestroyDevice(device,NULL);
    }
    if(instance)vkDestroyInstance(instance,NULL);
    printf("GUEST_VK_TEXTURE_EXIT status=%d checks=%u\n",result,checks);fflush(stdout);alarm(0);return result;
}
