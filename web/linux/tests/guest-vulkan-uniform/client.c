/* A3 uniform-buffer application. Only public Vulkan and POSIX entrypoints:
 * descriptor set layouts, pools, sets, vkUpdateDescriptorSets and
 * vkCmdBindDescriptorSets drive UNIFORM_BUFFER blocks (MVP matrix, vertex
 * positions indexed by gl_VertexIndex, colours, offsets) that change between
 * frames. Every frame is read back and compared pixel-exactly on the CPU. */
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
#define W 73
#define H 51
#define PIXELS (W*H*4)
#define TOTAL (PIXELS+32)
static unsigned checks;
#define CHECK(c) do{checks++;if(!(c)){fprintf(stderr,"GUEST_VK_UNIFORM_FAIL line=%d check=%s\n",__LINE__,#c);goto done;}}while(0)
static void deadline(int n){(void)n;_exit(124);}
/* Model-space triangles stored in the Transform block (indices 0..5). */
static const float model[6][2]={{-.9f,-.7f},{-.1f,-.6f},{-.5f,.6f},{.1f,-.7f},{.9f,-.6f},{.5f,.7f}};
/* Vertex-buffer triangle for the offset/tint pipeline. */
static const float vbuf[3][2]={{-.2f,-.5f},{.4f,-.5f},{.1f,.5f}};
struct tri { double x[3],y[3]; unsigned char rgba[4]; };
/* Column-major affine matrix scaled by w (w!=1 exercises the full row). */
static void matrix(float m[16],float sx,float sy,float tx,float ty,float w){
    memset(m,0,64);m[0]=sx*w;m[5]=sy*w;m[10]=w;m[12]=tx*w;m[13]=ty*w;m[15]=w;
}
static void transform(const float m[16],float x,float y,double *ox,double *oy){
    double cx=m[0]*x+m[4]*y+m[12],cy=m[1]*x+m[5]*y+m[13],cw=m[3]*x+m[7]*y+m[15];
    *ox=((cx/cw)+1)*W/2;*oy=((cy/cw)+1)*H/2;
}
static void color4(float out[4],const unsigned char c[4]){for(unsigned k=0;k<4;k++)out[k]=c[k]/255.0f;}
static int pixels(const unsigned char *bytes,const struct tri *tris,unsigned count,unsigned round){
    unsigned inside[2]={0},outside=0;
    for(unsigned y=0;y<H;y++)for(unsigned x=0;x<W;x++){
        int hit=-1,edge=0;
        for(unsigned t=0;t<count;t++){
            const struct tri *q=&tris[t];double ax=q->x[0],ay=q->y[0],bx=q->x[1],by=q->y[1],cx=q->x[2],cy=q->y[2];
            double den=(by-cy)*(ax-cx)+(cx-bx)*(ay-cy);
            double a=((by-cy)*(x+.5-cx)+(cx-bx)*(y+.5-cy))/den,b=((cy-ay)*(x+.5-cx)+(ax-cx)*(y+.5-cy))/den;
            double m=fmin(a,fmin(b,1-a-b));
            if(m>-.04&&m<.04)edge=1;else if(m>=.04)hit=(int)t;
        }
        if(edge)continue;
        const unsigned char green[4]={0,255,0,255};const unsigned char *expected=hit<0?green:tris[hit].rgba;
        if(hit<0)outside++;else inside[hit]++;
        for(unsigned k=0;k<4;k++){checks++;if(bytes[(y*W+x)*4+k]!=expected[k]){
            fprintf(stderr,"GUEST_VK_UNIFORM_PIXEL_FAIL round=%u x=%u y=%u component=%u actual=%u expected=%u\n",round,x,y,k,bytes[(y*W+x)*4+k],expected[k]);return 0;}}
    }
    for(unsigned n=PIXELS;n<TOTAL;n++){checks++;if(bytes[n]!=0xa5)return 0;}
    printf("GUEST_VK_UNIFORM_PIXELS_PASS round=%u triangles=%u inside0=%u inside1=%u outside=%u tail=32 width=73 height=51\n",round,count,inside[0],inside[1],outside);fflush(stdout);
    for(unsigned t=0;t<count;t++)if(inside[t]<20)return 0;
    return outside>100;
}
static VkResult make_pass(VkDevice d,VkRenderPass *out){
    VkAttachmentDescription a={.format=VK_FORMAT_R8G8B8A8_UNORM,.samples=VK_SAMPLE_COUNT_1_BIT,.loadOp=VK_ATTACHMENT_LOAD_OP_CLEAR,.storeOp=VK_ATTACHMENT_STORE_OP_STORE,
        .stencilLoadOp=VK_ATTACHMENT_LOAD_OP_DONT_CARE,.stencilStoreOp=VK_ATTACHMENT_STORE_OP_DONT_CARE,.initialLayout=VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL,.finalLayout=VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL};
    VkAttachmentReference ref={0,VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL};VkSubpassDescription s={.pipelineBindPoint=VK_PIPELINE_BIND_POINT_GRAPHICS,.colorAttachmentCount=1,.pColorAttachments=&ref};
    VkRenderPassCreateInfo info={.sType=VK_STRUCTURE_TYPE_RENDER_PASS_CREATE_INFO,.attachmentCount=1,.pAttachments=&a,.subpassCount=1,.pSubpasses=&s};
    return vkCreateRenderPass(d,&info,NULL,out);
}
static void image_barrier(VkCommandBuffer cb,VkImage image,VkImageLayout old,VkImageLayout next){
    VkImageMemoryBarrier b={.sType=VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER,.oldLayout=old,.newLayout=next,.image=image,
        .srcQueueFamilyIndex=VK_QUEUE_FAMILY_IGNORED,.dstQueueFamilyIndex=VK_QUEUE_FAMILY_IGNORED,.subresourceRange={VK_IMAGE_ASPECT_COLOR_BIT,0,1,0,1}};
    VkPipelineStageFlags src=VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT,dst=VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT;
    if(old==VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL){src=VK_PIPELINE_STAGE_TRANSFER_BIT;b.srcAccessMask=VK_ACCESS_TRANSFER_READ_BIT;}
    if(old==VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL){src=VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT;b.srcAccessMask=VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT;}
    b.dstAccessMask=VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT;
    if(next==VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL){dst=VK_PIPELINE_STAGE_TRANSFER_BIT;b.dstAccessMask=VK_ACCESS_TRANSFER_READ_BIT;}
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
static VkResult shader(VkDevice d,const unsigned char *bytes,size_t size,VkShaderModule *out){
    uint32_t *copy=malloc(size);if(!copy)return VK_ERROR_OUT_OF_HOST_MEMORY;memcpy(copy,bytes,size);
    VkShaderModuleCreateInfo i={.sType=VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO,.codeSize=size,.pCode=copy};
    VkResult r=vkCreateShaderModule(d,&i,NULL,out);memset(copy,0,size);free(copy);return r;
}
static VkResult set_layout(VkDevice d,unsigned count,const uint32_t *bindings,const VkShaderStageFlags *stages,uint32_t descriptors,VkDescriptorSetLayout *out){
    VkDescriptorSetLayoutBinding b[8];
    for(unsigned n=0;n<count;n++)b[n]=(VkDescriptorSetLayoutBinding){.binding=bindings[n],.descriptorType=VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER,.descriptorCount=descriptors,.stageFlags=stages[n]};
    VkDescriptorSetLayoutCreateInfo i={.sType=VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO,.bindingCount=count,.pBindings=b};
    VkResult r=vkCreateDescriptorSetLayout(d,&i,NULL,out);memset(b,0xff,sizeof(b));return r;
}
static VkResult pipeline_layout(VkDevice d,unsigned count,const VkDescriptorSetLayout *sets,unsigned push,VkPipelineLayout *out){
    VkPushConstantRange range={VK_SHADER_STAGE_VERTEX_BIT,0,16};
    VkPipelineLayoutCreateInfo i={.sType=VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO,.setLayoutCount=count,.pSetLayouts=sets,.pushConstantRangeCount=push,.pPushConstantRanges=push?&range:NULL};
    return vkCreatePipelineLayout(d,&i,NULL,out);
}
static void write_set(VkDevice d,VkDescriptorSet set,uint32_t binding,VkBuffer buffer,VkDeviceSize offset,VkDeviceSize range){
    VkDescriptorBufferInfo info={buffer,offset,range};
    VkWriteDescriptorSet w={.sType=VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET,.dstSet=set,.dstBinding=binding,.descriptorCount=1,.descriptorType=VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER,.pBufferInfo=&info};
    vkUpdateDescriptorSets(d,1,&w,0,NULL);memset(&info,0xff,sizeof(info));memset(&w,0xff,sizeof(w));
}
static VkResult graphics_pipeline(VkDevice d,VkShaderModule vs_module,VkShaderModule fs_module,unsigned vertex_input,VkPipelineLayout layout,VkRenderPass pass,VkPipeline *out){
    VkPipelineShaderStageCreateInfo stages[2]={{.sType=VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO,.stage=VK_SHADER_STAGE_VERTEX_BIT,.module=vs_module,.pName="main"},
        {.sType=VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO,.stage=VK_SHADER_STAGE_FRAGMENT_BIT,.module=fs_module,.pName="main"}};
    VkVertexInputBindingDescription bind={0,8,VK_VERTEX_INPUT_RATE_VERTEX};VkVertexInputAttributeDescription attr={0,0,VK_FORMAT_R32G32_SFLOAT,0};
    VkPipelineVertexInputStateCreateInfo vin={.sType=VK_STRUCTURE_TYPE_PIPELINE_VERTEX_INPUT_STATE_CREATE_INFO,.vertexBindingDescriptionCount=vertex_input,.pVertexBindingDescriptions=vertex_input?&bind:NULL,
        .vertexAttributeDescriptionCount=vertex_input,.pVertexAttributeDescriptions=vertex_input?&attr:NULL};
    VkPipelineInputAssemblyStateCreateInfo assembly={.sType=VK_STRUCTURE_TYPE_PIPELINE_INPUT_ASSEMBLY_STATE_CREATE_INFO,.topology=VK_PRIMITIVE_TOPOLOGY_TRIANGLE_LIST};
    VkViewport viewport={0,0,W,H,0,1};VkRect2D scissor={{0,0},{W,H}};VkPipelineViewportStateCreateInfo vs={.sType=VK_STRUCTURE_TYPE_PIPELINE_VIEWPORT_STATE_CREATE_INFO,.viewportCount=1,.pViewports=&viewport,.scissorCount=1,.pScissors=&scissor};
    VkPipelineRasterizationStateCreateInfo rs={.sType=VK_STRUCTURE_TYPE_PIPELINE_RASTERIZATION_STATE_CREATE_INFO,.polygonMode=VK_POLYGON_MODE_FILL,.cullMode=VK_CULL_MODE_NONE,.frontFace=VK_FRONT_FACE_COUNTER_CLOCKWISE,.lineWidth=1};
    VkPipelineMultisampleStateCreateInfo ms={.sType=VK_STRUCTURE_TYPE_PIPELINE_MULTISAMPLE_STATE_CREATE_INFO,.rasterizationSamples=VK_SAMPLE_COUNT_1_BIT};VkPipelineColorBlendAttachmentState attachment={.colorWriteMask=15};
    VkPipelineColorBlendStateCreateInfo blend={.sType=VK_STRUCTURE_TYPE_PIPELINE_COLOR_BLEND_STATE_CREATE_INFO,.attachmentCount=1,.pAttachments=&attachment};
    VkGraphicsPipelineCreateInfo pi={.sType=VK_STRUCTURE_TYPE_GRAPHICS_PIPELINE_CREATE_INFO,.stageCount=2,.pStages=stages,.pVertexInputState=&vin,.pInputAssemblyState=&assembly,.pViewportState=&vs,
        .pRasterizationState=&rs,.pMultisampleState=&ms,.pColorBlendState=&blend,.layout=layout,.renderPass=pass,.basePipelineIndex=-1};
    VkResult r=vkCreateGraphicsPipelines(d,VK_NULL_HANDLE,1,&pi,NULL,out);
    memset(stages,0xff,sizeof(stages));memset(&viewport,0xff,sizeof(viewport));memset(&bind,0xff,sizeof(bind));memset(&attr,0xff,sizeof(attr));return r;
}
struct scene { VkImage image; VkRenderPass pass; VkFramebuffer framebuffer; VkBuffer readback, uniform, params, vertices;
    VkPipeline pa, pb; VkPipelineLayout la, lb; VkDescriptorSet transform, material_a, material_b, params_set; };
/* Stream kinds: 0 pipeline A one draw; 1 pipeline A two draws (set 1 rebound
 * between them, second draw firstVertex=3); 2 pipeline A + pipeline B. */
static void record(VkCommandBuffer cb,const struct scene *s,VkImageLayout old,unsigned kind){
    image_barrier(cb,s->image,old,VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL);
    buffer_barrier(cb,s->uniform,2);if(kind==2){buffer_barrier(cb,s->params,2);buffer_barrier(cb,s->vertices,1);}
    VkClearValue color={.color={{0,1,0,1}}};VkRenderPassBeginInfo begin={.sType=VK_STRUCTURE_TYPE_RENDER_PASS_BEGIN_INFO,.renderPass=s->pass,.framebuffer=s->framebuffer,.renderArea={{0,0},{W,H}},.clearValueCount=1,.pClearValues=&color};
    vkCmdBeginRenderPass(cb,&begin,VK_SUBPASS_CONTENTS_INLINE);
    vkCmdBindPipeline(cb,VK_PIPELINE_BIND_POINT_GRAPHICS,s->pa);
    VkDescriptorSet sets[2]={s->transform,s->material_a};vkCmdBindDescriptorSets(cb,VK_PIPELINE_BIND_POINT_GRAPHICS,s->la,0,2,sets,0,NULL);memset(sets,0,sizeof(sets));
    vkCmdDraw(cb,3,1,0,0);
    if(kind==1){VkDescriptorSet m=s->material_b;vkCmdBindDescriptorSets(cb,VK_PIPELINE_BIND_POINT_GRAPHICS,s->la,1,1,&m,0,NULL);m=VK_NULL_HANDLE;vkCmdDraw(cb,3,1,3,0);}
    if(kind==2){
        vkCmdBindPipeline(cb,VK_PIPELINE_BIND_POINT_GRAPHICS,s->pb);
        VkDescriptorSet p=s->params_set;vkCmdBindDescriptorSets(cb,VK_PIPELINE_BIND_POINT_GRAPHICS,s->lb,0,1,&p,0,NULL);p=VK_NULL_HANDLE;
        VkBuffer v=s->vertices;VkDeviceSize offset=0;vkCmdBindVertexBuffers(cb,0,1,&v,&offset);vkCmdDraw(cb,3,1,0,0);
    }
    vkCmdEndRenderPass(cb);
    image_barrier(cb,s->image,VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL,VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL);
    VkBufferImageCopy copy={.imageSubresource={VK_IMAGE_ASPECT_COLOR_BIT,0,0,1},.imageExtent={W,H,1}};
    vkCmdCopyImageToBuffer(cb,s->image,VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL,s->readback,1,&copy);
    buffer_barrier(cb,s->readback,0);
}
/* Fill the Transform/material block bytes and the matching expected triangle. */
static void set_transform(unsigned char *u,const float m[16]){
    memcpy(u,m,64);for(unsigned i=0;i<6;i++){float p[4]={model[i][0],model[i][1],0,1};memcpy(u+64+16*i,p,16);}
}
static void set_color(unsigned char *u,unsigned offset,const unsigned char c[4]){float f[4];color4(f,c);memcpy(u+offset,f,16);}
static void set_params(unsigned char *p,float ox,float oy,const unsigned char c[4]){float o[4]={ox,oy,0,0};memcpy(p,o,16);set_color(p,16,c);}
static struct tri model_tri(const float m[16],unsigned first,const unsigned char c[4]){
    struct tri t;for(unsigned i=0;i<3;i++)transform(m,model[first+i][0],model[first+i][1],&t.x[i],&t.y[i]);memcpy(t.rgba,c,4);return t;
}
static struct tri buffer_tri(float ox,float oy,const unsigned char c[4]){
    struct tri t;for(unsigned i=0;i<3;i++){t.x[i]=(vbuf[i][0]+ox+1)*W/2;t.y[i]=(vbuf[i][1]+oy+1)*H/2;}memcpy(t.rgba,c,4);return t;
}
int main(void){
    int result=1;VkInstance instance=VK_NULL_HANDLE;VkDevice device=VK_NULL_HANDLE;VkDeviceMemory image_mem=VK_NULL_HANDLE,read_mem=VK_NULL_HANDLE,uniform_mem=VK_NULL_HANDLE,params_mem=VK_NULL_HANDLE,vertex_mem=VK_NULL_HANDLE;
    VkImageView view=VK_NULL_HANDLE;unsigned char *mapped=NULL,*umap=NULL,*pmap=NULL,*vmap=NULL;VkShaderModule modules[4]={0};
    VkDescriptorSetLayout lt=VK_NULL_HANDLE,lm=VK_NULL_HANDLE,lp=VK_NULL_HANDLE,l4=VK_NULL_HANDLE;VkDescriptorPool pool=VK_NULL_HANDLE,pool2=VK_NULL_HANDLE;
    VkCommandPool cpool=VK_NULL_HANDLE;VkCommandBuffer cb=VK_NULL_HANDLE;struct scene s={0};
    struct sigaction action={0};action.sa_handler=deadline;sigemptyset(&action.sa_mask);if(sigaction(SIGALRM,&action,NULL))return 2;alarm(110);signal(SIGPIPE,SIG_IGN);
    puts("GUEST_VK_UNIFORM_SCOPE public static Khronos loader; UNIFORM_BUFFER descriptors; bounded nonconformant ICD");
    VkApplicationInfo app={.sType=VK_STRUCTURE_TYPE_APPLICATION_INFO,.apiVersion=VK_API_VERSION_1_0,.pApplicationName="public-uniform"};VkInstanceCreateInfo ii={.sType=VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO,.pApplicationInfo=&app};
    CHECK(vkCreateInstance(&ii,NULL,&instance)==VK_SUCCESS);uint32_t count=1;VkPhysicalDevice physical;CHECK(vkEnumeratePhysicalDevices(instance,&count,&physical)==VK_SUCCESS&&count==1);
    VkQueueFamilyProperties qp;count=1;vkGetPhysicalDeviceQueueFamilyProperties(physical,&count,&qp);CHECK(qp.queueFlags&VK_QUEUE_GRAPHICS_BIT);
    VkPhysicalDeviceProperties properties;vkGetPhysicalDeviceProperties(physical,&properties);const VkPhysicalDeviceLimits *lim=&properties.limits;
    CHECK(lim->maxBoundDescriptorSets==4&&lim->maxUniformBufferRange==16384&&lim->minUniformBufferOffsetAlignment==256);
    CHECK(lim->maxPerStageDescriptorUniformBuffers==8&&lim->maxDescriptorSetUniformBuffers==8);
    const unsigned max_stride=lim->maxVertexInputBindingStride;CHECK(max_stride==252||max_stride==2048);
    printf("GUEST_VK_UNIFORM_LIMITS sets=%u range=%u alignment=%u max_stride=%u\n",lim->maxBoundDescriptorSets,lim->maxUniformBufferRange,(unsigned)lim->minUniformBufferOffsetAlignment,max_stride);fflush(stdout);
    VkPhysicalDeviceMemoryProperties mp;vkGetPhysicalDeviceMemoryProperties(physical,&mp);CHECK(mp.memoryTypeCount==2&&(mp.memoryTypes[1].propertyFlags&VK_MEMORY_PROPERTY_HOST_COHERENT_BIT));
    float priority=1;VkDeviceQueueCreateInfo qi={.sType=VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO,.queueCount=1,.pQueuePriorities=&priority};VkDeviceCreateInfo di={.sType=VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO,.queueCreateInfoCount=1,.pQueueCreateInfos=&qi};
    CHECK(vkCreateDevice(physical,&di,NULL,&device)==VK_SUCCESS);VkQueue queue;vkGetDeviceQueue(device,0,0,&queue);CHECK(queue!=VK_NULL_HANDLE);
    CHECK(vkGetDeviceProcAddr(device,"vkCmdBindDescriptorSets")!=NULL&&vkGetDeviceProcAddr(device,"vkUpdateDescriptorSets")!=NULL&&vkGetDeviceProcAddr(device,"vkGuestUnknown")==NULL);
    /* Colour target, readback. */
    VkImageCreateInfo im={.sType=VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO,.imageType=VK_IMAGE_TYPE_2D,.format=VK_FORMAT_R8G8B8A8_UNORM,.extent={W,H,1},.mipLevels=1,.arrayLayers=1,.samples=VK_SAMPLE_COUNT_1_BIT,.tiling=VK_IMAGE_TILING_OPTIMAL,.usage=VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT|VK_IMAGE_USAGE_TRANSFER_SRC_BIT,.sharingMode=VK_SHARING_MODE_EXCLUSIVE};
    CHECK(vkCreateImage(device,&im,NULL,&s.image)==VK_SUCCESS);VkMemoryRequirements mr;vkGetImageMemoryRequirements(device,s.image,&mr);CHECK(mr.size==PIXELS&&mr.memoryTypeBits==1);
    VkMemoryAllocateInfo ai={.sType=VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO,.allocationSize=mr.size};CHECK(vkAllocateMemory(device,&ai,NULL,&image_mem)==VK_SUCCESS);CHECK(vkBindImageMemory(device,s.image,image_mem,0)==VK_SUCCESS);
    VkImageViewCreateInfo vi={.sType=VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO,.image=s.image,.viewType=VK_IMAGE_VIEW_TYPE_2D,.format=VK_FORMAT_R8G8B8A8_UNORM,.subresourceRange={VK_IMAGE_ASPECT_COLOR_BIT,0,1,0,1}};CHECK(vkCreateImageView(device,&vi,NULL,&view)==VK_SUCCESS);
    VkBufferCreateInfo bi={.sType=VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO,.size=PIXELS+16,.usage=VK_BUFFER_USAGE_TRANSFER_DST_BIT,.sharingMode=VK_SHARING_MODE_EXCLUSIVE};CHECK(vkCreateBuffer(device,&bi,NULL,&s.readback)==VK_SUCCESS);
    vkGetBufferMemoryRequirements(device,s.readback,&mr);CHECK(mr.size==PIXELS+16&&mr.memoryTypeBits==2);ai.allocationSize=TOTAL;ai.memoryTypeIndex=1;CHECK(vkAllocateMemory(device,&ai,NULL,&read_mem)==VK_SUCCESS);
    CHECK(vkBindBufferMemory(device,s.readback,read_mem,0)==VK_SUCCESS);CHECK(vkMapMemory(device,read_mem,0,VK_WHOLE_SIZE,0,(void**)&mapped)==VK_SUCCESS);
    /* Uniform buffers: sizes must be multiples of 16 up to 64 KiB. */
    VkBuffer rejected=VK_NULL_HANDLE;bi.usage=VK_BUFFER_USAGE_UNIFORM_BUFFER_BIT;
    bi.size=24;CHECK(vkCreateBuffer(device,&bi,NULL,&rejected)==VK_ERROR_FEATURE_NOT_PRESENT&&!rejected);
    bi.size=65552;CHECK(vkCreateBuffer(device,&bi,NULL,&rejected)==VK_ERROR_FEATURE_NOT_PRESENT&&!rejected);
    bi.size=1024;CHECK(vkCreateBuffer(device,&bi,NULL,&s.uniform)==VK_SUCCESS);vkGetBufferMemoryRequirements(device,s.uniform,&mr);CHECK(mr.size==1024&&mr.alignment==256&&mr.memoryTypeBits==2);
    ai.allocationSize=1024;CHECK(vkAllocateMemory(device,&ai,NULL,&uniform_mem)==VK_SUCCESS);CHECK(vkBindBufferMemory(device,s.uniform,uniform_mem,0)==VK_SUCCESS);CHECK(vkMapMemory(device,uniform_mem,0,VK_WHOLE_SIZE,0,(void**)&umap)==VK_SUCCESS);memset(umap,0,1024);
    bi.size=32;CHECK(vkCreateBuffer(device,&bi,NULL,&s.params)==VK_SUCCESS);vkGetBufferMemoryRequirements(device,s.params,&mr);CHECK(mr.size==32&&mr.alignment==256);
    ai.allocationSize=256;CHECK(vkAllocateMemory(device,&ai,NULL,&params_mem)==VK_SUCCESS);CHECK(vkBindBufferMemory(device,s.params,params_mem,0)==VK_SUCCESS);CHECK(vkMapMemory(device,params_mem,0,VK_WHOLE_SIZE,0,(void**)&pmap)==VK_SUCCESS);memset(pmap,0,256);
    bi.size=24;bi.usage=VK_BUFFER_USAGE_VERTEX_BUFFER_BIT;CHECK(vkCreateBuffer(device,&bi,NULL,&s.vertices)==VK_SUCCESS);
    ai.allocationSize=32;CHECK(vkAllocateMemory(device,&ai,NULL,&vertex_mem)==VK_SUCCESS);CHECK(vkBindBufferMemory(device,s.vertices,vertex_mem,0)==VK_SUCCESS);CHECK(vkMapMemory(device,vertex_mem,0,VK_WHOLE_SIZE,0,(void**)&vmap)==VK_SUCCESS);memcpy(vmap,vbuf,24);
    /* Descriptor set layouts and their negative shapes. */
    const uint32_t b0=0,b1=1,dup[2]={3,3},five[5]={0,1,2,3,4},four[4]={0,1,2,3};
    const VkShaderStageFlags vsf=VK_SHADER_STAGE_VERTEX_BIT,fsf=VK_SHADER_STAGE_FRAGMENT_BIT,both=VK_SHADER_STAGE_VERTEX_BIT|VK_SHADER_STAGE_FRAGMENT_BIT,cs=VK_SHADER_STAGE_COMPUTE_BIT;
    const VkShaderStageFlags vs4[5]={vsf,vsf,vsf,vsf,vsf};
    VkDescriptorSetLayout bad=VK_NULL_HANDLE;const uint32_t b16=16;
    CHECK(set_layout(device,1,&b16,&vsf,1,&bad)==VK_ERROR_INITIALIZATION_FAILED&&!bad);
    CHECK(set_layout(device,1,&b0,&vsf,2,&bad)==VK_ERROR_INITIALIZATION_FAILED&&!bad);
    CHECK(set_layout(device,1,&b0,&cs,1,&bad)==VK_ERROR_INITIALIZATION_FAILED&&!bad);
    CHECK(set_layout(device,2,dup,vs4,1,&bad)==VK_ERROR_INITIALIZATION_FAILED&&!bad);
    CHECK(set_layout(device,5,five,vs4,1,&bad)==VK_ERROR_INITIALIZATION_FAILED&&!bad);
    CHECK(set_layout(device,1,&b0,&vsf,1,&lt)==VK_SUCCESS);CHECK(set_layout(device,1,&b0,&fsf,1,&lm)==VK_SUCCESS);CHECK(set_layout(device,1,&b1,&both,1,&lp)==VK_SUCCESS);
    CHECK(set_layout(device,4,four,vs4,1,&l4)==VK_SUCCESS);
    /* Pipeline layouts: push constants, more than four sets or eight bindings are refused. */
    VkPipelineLayout badl=VK_NULL_HANDLE;VkDescriptorSetLayout many[5]={lt,lt,lt,lt,lt},wide[3]={l4,l4,l4};
    CHECK(pipeline_layout(device,1,&lt,1,&badl)==VK_ERROR_INITIALIZATION_FAILED&&!badl);
    CHECK(pipeline_layout(device,5,many,0,&badl)==VK_ERROR_INITIALIZATION_FAILED&&!badl);
    CHECK(pipeline_layout(device,3,wide,0,&badl)==VK_ERROR_INITIALIZATION_FAILED&&!badl);
    vkDestroyDescriptorSetLayout(device,l4,NULL);l4=VK_NULL_HANDLE;
    VkDescriptorSetLayout la_sets[2]={lt,lm};CHECK(pipeline_layout(device,2,la_sets,0,&s.la)==VK_SUCCESS);CHECK(pipeline_layout(device,1,&lp,0,&s.lb)==VK_SUCCESS);
    /* Pools: bounded capacity, exhaustion reported as OUT_OF_POOL_MEMORY. */
    VkDescriptorPoolSize ps={VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER,4};VkDescriptorPoolCreateInfo pci={.sType=VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO,.maxSets=9,.poolSizeCount=1,.pPoolSizes=&ps};
    VkDescriptorPool badp=VK_NULL_HANDLE;CHECK(vkCreateDescriptorPool(device,&pci,NULL,&badp)==VK_ERROR_INITIALIZATION_FAILED&&!badp);
    pci.maxSets=4;CHECK(vkCreateDescriptorPool(device,&pci,NULL,&pool)==VK_SUCCESS);
    VkDescriptorSetLayout alloc_layouts[4]={lt,lm,lm,lp};VkDescriptorSet out[4]={0};
    VkDescriptorSetAllocateInfo dai={.sType=VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO,.descriptorPool=pool,.descriptorSetCount=4,.pSetLayouts=alloc_layouts};
    CHECK(vkAllocateDescriptorSets(device,&dai,out)==VK_SUCCESS&&out[0]&&out[1]&&out[2]&&out[3]);
    s.transform=out[0];s.material_a=out[1];s.material_b=out[2];s.params_set=out[3];
    VkDescriptorSet extra=VK_NULL_HANDLE;dai.descriptorSetCount=1;CHECK(vkAllocateDescriptorSets(device,&dai,&extra)==VK_ERROR_OUT_OF_POOL_MEMORY&&!extra);
    ps.descriptorCount=1;pci.maxSets=2;CHECK(vkCreateDescriptorPool(device,&pci,NULL,&pool2)==VK_SUCCESS);
    VkDescriptorSet two[2]={0};dai.descriptorPool=pool2;dai.descriptorSetCount=2;CHECK(vkAllocateDescriptorSets(device,&dai,two)==VK_ERROR_OUT_OF_POOL_MEMORY&&!two[0]&&!two[1]);
    dai.descriptorSetCount=1;CHECK(vkAllocateDescriptorSets(device,&dai,two)==VK_SUCCESS&&two[0]);
    vkDestroyDescriptorPool(device,pool2,NULL);pool2=VK_NULL_HANDLE; /* Frees its set as well. */
    printf("GUEST_VK_UNIFORM_DESCRIPTORS layouts=3 rejected_layouts=5 rejected_pipeline_layouts=3 pool_exhaustion=2\n");fflush(stdout);
    write_set(device,s.transform,0,s.uniform,0,160);write_set(device,s.material_a,0,s.uniform,256,16);write_set(device,s.material_b,0,s.uniform,512,16);write_set(device,s.params_set,1,s.params,0,VK_WHOLE_SIZE);
    /* Shaders: rejected uniform shapes fail in the host translator. */
    VkShaderModule badm=VK_NULL_HANDLE;
    CHECK(shader(device,shader_bad_binding_frag,sizeof(shader_bad_binding_frag),&badm)==VK_ERROR_INITIALIZATION_FAILED&&!badm);
    CHECK(shader(device,shader_bad_member_frag,sizeof(shader_bad_member_frag),&badm)==VK_ERROR_INITIALIZATION_FAILED&&!badm);
    CHECK(shader(device,shader_index_vert,sizeof(shader_index_vert),&modules[0])==VK_SUCCESS);CHECK(shader(device,shader_color_frag,sizeof(shader_color_frag),&modules[1])==VK_SUCCESS);
    CHECK(shader(device,shader_offset_vert,sizeof(shader_offset_vert),&modules[2])==VK_SUCCESS);CHECK(shader(device,shader_tint_frag,sizeof(shader_tint_frag),&modules[3])==VK_SUCCESS);
    CHECK(make_pass(device,&s.pass)==VK_SUCCESS);
    /* Host rejects layouts that do not cover a shader uniform or hide it from its stage. */
    VkPipelineLayout wrong=VK_NULL_HANDLE;VkPipeline badpipe=VK_NULL_HANDLE;VkDescriptorSetLayout ltlt[2]={lt,lt};
    CHECK(pipeline_layout(device,2,ltlt,0,&wrong)==VK_SUCCESS);CHECK(graphics_pipeline(device,modules[0],modules[1],0,wrong,s.pass,&badpipe)==VK_ERROR_INITIALIZATION_FAILED&&!badpipe);vkDestroyPipelineLayout(device,wrong,NULL);wrong=VK_NULL_HANDLE;
    CHECK(pipeline_layout(device,1,&lt,0,&wrong)==VK_SUCCESS);CHECK(graphics_pipeline(device,modules[0],modules[1],0,wrong,s.pass,&badpipe)==VK_ERROR_INITIALIZATION_FAILED&&!badpipe);vkDestroyPipelineLayout(device,wrong,NULL);wrong=VK_NULL_HANDLE;
    CHECK(graphics_pipeline(device,modules[0],modules[1],0,s.la,s.pass,&s.pa)==VK_SUCCESS);CHECK(graphics_pipeline(device,modules[2],modules[3],1,s.lb,s.pass,&s.pb)==VK_SUCCESS);
    for(unsigned i=0;i<4;i++){vkDestroyShaderModule(device,modules[i],NULL);modules[i]=VK_NULL_HANDLE;}
    VkFramebufferCreateInfo fi={.sType=VK_STRUCTURE_TYPE_FRAMEBUFFER_CREATE_INFO,.renderPass=s.pass,.attachmentCount=1,.pAttachments=&view,.width=W,.height=H,.layers=1};CHECK(vkCreateFramebuffer(device,&fi,NULL,&s.framebuffer)==VK_SUCCESS);
    VkCommandPoolCreateInfo cpi={.sType=VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO,.flags=VK_COMMAND_POOL_CREATE_RESET_COMMAND_BUFFER_BIT};CHECK(vkCreateCommandPool(device,&cpi,NULL,&cpool)==VK_SUCCESS);
    VkCommandBufferAllocateInfo cai={.sType=VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO,.commandPool=cpool,.level=VK_COMMAND_BUFFER_LEVEL_PRIMARY,.commandBufferCount=1};CHECK(vkAllocateCommandBuffers(device,&cai,&cb)==VK_SUCCESS);
    VkCommandBufferBeginInfo begin={.sType=VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO};VkSubmitInfo submit={.sType=VK_STRUCTURE_TYPE_SUBMIT_INFO,.commandBufferCount=1,.pCommandBuffers=&cb};
    /* Invalid recordings: EndCommandBuffer must refuse every one of them. */
    for(unsigned n=0;n<6;n++){
        CHECK(vkResetCommandBuffer(cb,0)==VK_SUCCESS);CHECK(vkBeginCommandBuffer(cb,&begin)==VK_SUCCESS);
        image_barrier(cb,s.image,VK_IMAGE_LAYOUT_UNDEFINED,VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL);
        if(n==0){VkBufferMemoryBarrier b={.sType=VK_STRUCTURE_TYPE_BUFFER_MEMORY_BARRIER,.buffer=s.uniform,.size=VK_WHOLE_SIZE,.srcQueueFamilyIndex=VK_QUEUE_FAMILY_IGNORED,.dstQueueFamilyIndex=VK_QUEUE_FAMILY_IGNORED,
            .srcAccessMask=VK_ACCESS_TRANSFER_WRITE_BIT,.dstAccessMask=VK_ACCESS_UNIFORM_READ_BIT};vkCmdPipelineBarrier(cb,VK_PIPELINE_STAGE_TRANSFER_BIT,VK_PIPELINE_STAGE_VERTEX_SHADER_BIT,0,0,NULL,1,&b,0,NULL);}
        VkClearValue color={.color={{0,1,0,1}}};VkRenderPassBeginInfo rb={.sType=VK_STRUCTURE_TYPE_RENDER_PASS_BEGIN_INFO,.renderPass=s.pass,.framebuffer=s.framebuffer,.renderArea={{0,0},{W,H}},.clearValueCount=1,.pClearValues=&color};
        vkCmdBeginRenderPass(cb,&rb,VK_SUBPASS_CONTENTS_INLINE);vkCmdBindPipeline(cb,VK_PIPELINE_BIND_POINT_GRAPHICS,s.pa);
        VkDescriptorSet sets[2]={s.transform,s.material_a};uint32_t dynamic=0;
        if(n==1)vkCmdBindDescriptorSets(cb,VK_PIPELINE_BIND_POINT_GRAPHICS,s.la,0,2,sets,1,&dynamic); /* dynamic offsets */
        else if(n==2)vkCmdBindDescriptorSets(cb,VK_PIPELINE_BIND_POINT_GRAPHICS,s.la,0,1,sets,0,NULL); /* set 1 unbound at draw */
        else if(n==3){VkDescriptorSet p=s.params_set;vkCmdBindDescriptorSets(cb,VK_PIPELINE_BIND_POINT_GRAPHICS,s.la,0,1,&p,0,NULL);} /* incompatible set */
        else if(n==4)vkCmdBindDescriptorSets(cb,VK_PIPELINE_BIND_POINT_GRAPHICS,s.la,2,1,sets,0,NULL); /* first beyond layout */
        else if(n==5)vkCmdBindDescriptorSets(cb,VK_PIPELINE_BIND_POINT_GRAPHICS,s.la,1,2,sets,0,NULL); /* count beyond layout */
        else vkCmdBindDescriptorSets(cb,VK_PIPELINE_BIND_POINT_GRAPHICS,s.la,0,2,sets,0,NULL);
        vkCmdDraw(cb,3,1,0,0);vkCmdEndRenderPass(cb);
        CHECK(vkEndCommandBuffer(cb)==VK_ERROR_INITIALIZATION_FAILED);
    }
    printf("GUEST_VK_UNIFORM_RECORDING_REJECTED count=6\n");fflush(stdout);
    /* Frames. Colours are exact k/255 values and never equal the background. */
    static const unsigned char ca0[4]={51,102,153,255},ca1[4]={200,40,90,255},cb0[4]={17,34,221,255},cp0[4]={250,128,3,255},cp1[4]={90,10,180,255},ca2[4]={128,64,32,255},cb2[4]={1,254,127,255};
    float m0[16],m1[16],m2[16];matrix(m0,.9f,.8f,.05f,.1f,1);matrix(m1,.7f,-.9f,-.1f,0,2);matrix(m2,.8f,.8f,-.1f,0,1);
    struct tri tris[2];VkImageLayout old=VK_IMAGE_LAYOUT_UNDEFINED;
#define RECORD(kind) do{CHECK(vkResetCommandBuffer(cb,0)==VK_SUCCESS);CHECK(vkBeginCommandBuffer(cb,&begin)==VK_SUCCESS);record(cb,&s,old,kind);CHECK(vkEndCommandBuffer(cb)==VK_SUCCESS);}while(0)
#define FRAME(round,n) do{memset(mapped,0xa5,TOTAL);CHECK(vkQueueSubmit(queue,1,&submit,VK_NULL_HANDLE)==VK_SUCCESS);CHECK(vkQueueWaitIdle(queue)==VK_SUCCESS);old=VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL;CHECK(pixels(mapped,tris,n,round));}while(0)
#define REFUSED() do{memset(mapped,0xa5,TOTAL);CHECK(vkQueueSubmit(queue,1,&submit,VK_NULL_HANDLE)==VK_ERROR_INITIALIZATION_FAILED);for(unsigned k=0;k<TOTAL;k++)CHECK(mapped[k]==0xa5);}while(0)
    /* Round 0: MVP, positions (via gl_VertexIndex) and colour written after recording. */
    RECORD(0);set_transform(umap,m0);set_color(umap,256,ca0);tris[0]=model_tri(m0,0,ca0);FRAME(0,1);
    /* Round 1: change the uniform bytes only; resubmit the same command buffer. */
    set_transform(umap,m1);set_color(umap,256,ca1);tris[0]=model_tri(m1,0,ca1);FRAME(1,1);
    /* Round 2: rebind set 1 between draws; the second draw uses firstVertex=3. */
    set_color(umap,512,cb0);RECORD(1);tris[1]=model_tri(m1,3,cb0);FRAME(2,2);
    /* Round 3: two pipelines, two uniform buffers and a vertex buffer in one pass. */
    set_transform(umap,m2);set_params(pmap,.35f,.1f,cp0);RECORD(2);tris[0]=model_tri(m2,0,ca1);tris[1]=buffer_tri(.35f,.1f,cp0);FRAME(3,2);
    /* Round 4: new offset/tint and colour; resubmit without re-recording. */
    set_params(pmap,.2f,-.2f,cp1);set_color(umap,256,ca2);memcpy(tris[0].rgba,ca2,4);tris[1]=buffer_tri(.2f,-.2f,cp1);FRAME(4,2);
    /* Round 5: vkUpdateDescriptorSets re-points material A at offset 512 (whole size). */
    set_color(umap,512,cb2);write_set(device,s.material_a,0,s.uniform,512,VK_WHOLE_SIZE);RECORD(2);memcpy(tris[0].rgba,cb2,4);FRAME(5,2);
    printf("GUEST_VK_UNIFORM_FRAMES_PASS rounds=6\n");fflush(stdout);
    /* Invalid descriptor writes invalidate the set; submission is refused without host effects. */
    for(unsigned n=0;n<5;n++){
        if(n==0)write_set(device,s.material_a,0,s.uniform,16,16);        /* offset not 256-aligned */
        else if(n==1)write_set(device,s.material_a,0,s.uniform,512,20);  /* range not a multiple of 16 */
        else if(n==2)write_set(device,s.material_a,0,s.vertices,0,16);   /* not a uniform buffer */
        else if(n==3)write_set(device,s.material_a,0,s.uniform,1024,16); /* offset past the end */
        else write_set(device,s.material_a,3,s.uniform,512,16);          /* binding absent from the layout */
        RECORD(2);REFUSED();
    }
    write_set(device,s.material_a,0,s.uniform,512,16);RECORD(2);FRAME(6,2);
    /* A range shorter than the shader's Transform block (160 bytes) is refused at submit. */
    write_set(device,s.transform,0,s.uniform,0,144);RECORD(2);REFUSED();
    write_set(device,s.transform,0,s.uniform,0,160);RECORD(2);FRAME(7,2);
    printf("GUEST_VK_UNIFORM_NEGATIVE_PASS invalid_writes=5 short_range=1 recovered=2\n");fflush(stdout);
#undef RECORD
#undef FRAME
#undef REFUSED
    result=0;
done:
    if(device){
        if(cb)vkFreeCommandBuffers(device,cpool,1,&cb);if(cpool)vkDestroyCommandPool(device,cpool,NULL);
        if(s.framebuffer)vkDestroyFramebuffer(device,s.framebuffer,NULL);if(s.pa)vkDestroyPipeline(device,s.pa,NULL);if(s.pb)vkDestroyPipeline(device,s.pb,NULL);
        if(s.pass)vkDestroyRenderPass(device,s.pass,NULL);
        for(unsigned i=0;i<4;i++)if(modules[i])vkDestroyShaderModule(device,modules[i],NULL);
        if(pool)vkDestroyDescriptorPool(device,pool,NULL);if(pool2)vkDestroyDescriptorPool(device,pool2,NULL);
        if(s.la)vkDestroyPipelineLayout(device,s.la,NULL);if(s.lb)vkDestroyPipelineLayout(device,s.lb,NULL);
        if(lt)vkDestroyDescriptorSetLayout(device,lt,NULL);if(lm)vkDestroyDescriptorSetLayout(device,lm,NULL);if(lp)vkDestroyDescriptorSetLayout(device,lp,NULL);if(l4)vkDestroyDescriptorSetLayout(device,l4,NULL);
        if(vmap)vkUnmapMemory(device,vertex_mem);if(s.vertices)vkDestroyBuffer(device,s.vertices,NULL);if(vertex_mem)vkFreeMemory(device,vertex_mem,NULL);
        if(pmap)vkUnmapMemory(device,params_mem);if(s.params)vkDestroyBuffer(device,s.params,NULL);if(params_mem)vkFreeMemory(device,params_mem,NULL);
        if(umap)vkUnmapMemory(device,uniform_mem);if(s.uniform)vkDestroyBuffer(device,s.uniform,NULL);if(uniform_mem)vkFreeMemory(device,uniform_mem,NULL);
        if(mapped)vkUnmapMemory(device,read_mem);if(s.readback)vkDestroyBuffer(device,s.readback,NULL);if(read_mem)vkFreeMemory(device,read_mem,NULL);
        if(view)vkDestroyImageView(device,view,NULL);if(s.image)vkDestroyImage(device,s.image,NULL);if(image_mem)vkFreeMemory(device,image_mem,NULL);vkDestroyDevice(device,NULL);
    }
    if(instance)vkDestroyInstance(instance,NULL);
    printf("GUEST_VK_UNIFORM_EXIT status=%d checks=%u\n",result,checks);fflush(stdout);alarm(0);return result;
}
