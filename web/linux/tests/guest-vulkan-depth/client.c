/* A5 depth-attachment application. Only public Vulkan and POSIX entrypoints:
 * D32_SFLOAT and D16_UNORM DEPTH_STENCIL_ATTACHMENT images, render passes with
 * a depth attachment (CLEAR/LOAD/DONT_CARE load, STORE/DONT_CARE store) and
 * pipeline depth test/write/compare state. Two overlapping constant-depth quads
 * select an exact winner per pixel; every frame is read back (colour only) and
 * compared byte for byte, followed by a 32-byte untouched sentinel tail. */
#define _POSIX_C_SOURCE 200809L
#include <vulkan/vulkan.h>
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
#define STRIDE 28
static unsigned checks;
#define CHECK(c) do{checks++;if(!(c)){fprintf(stderr,"GUEST_VK_DEPTH_FAIL line=%d check=%s\n",__LINE__,#c);goto done;}}while(0)
static void deadline(int n){(void)n;_exit(124);}
static const unsigned char GREEN[4]={0,255,0,255},RED[4]={255,0,0,255},BLUE[4]={0,0,255,255};
static unsigned char want[PIXELS];
/* Quad A covers columns 0-11, quad B columns 4-15; both cover rows 0-11. Rows
 * 12-15 always keep the green colour clear. */
static void expect(const unsigned char *a_only,const unsigned char *overlap,const unsigned char *b_only){
    for(unsigned y=0;y<H;y++)for(unsigned x=0;x<W;x++)memcpy(want+(y*W+x)*4,y>=12?GREEN:x<4?a_only:x<12?overlap:b_only,4);
}
static int compare(const unsigned char *bytes,unsigned round){
    for(unsigned n=0;n<PIXELS;n++){checks++;
        if(bytes[n]!=want[n]){fprintf(stderr,"GUEST_VK_DEPTH_PIXEL_FAIL round=%u x=%u y=%u component=%u actual=%u expected=%u\n",round,(n/4)%W,n/4/W,n%4,bytes[n],want[n]);return 0;}}
    for(unsigned n=PIXELS;n<TOTAL;n++){checks++;if(bytes[n]!=0xa5)return 0;}
    printf("GUEST_VK_DEPTH_PIXELS_PASS round=%u width=16 height=16 exact=%u tail=32\n",round,PIXELS);fflush(stdout);
    return 1;
}
/* Shared state. */
static VkDevice device;static VkQueue queue;static VkCommandBuffer cb;static unsigned char *mapped;
static VkImage color_image;static VkImageView color_view;static VkBuffer readback,vertices;static VkPipelineLayout playout;
static VkShaderModule vs_module,fs_module;static VkRenderPass cpass;static VkPipeline cpipe;
static VkImageLayout cold=VK_IMAGE_LAYOUT_UNDEFINED;static VkCommandBufferBeginInfo begin_info={.sType=VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO};
static VkSubmitInfo submit_info={.sType=VK_STRUCTURE_TYPE_SUBMIT_INFO,.commandBufferCount=1,.pCommandBuffers=&cb};
enum {NORMAL,STENCIL_CLEAR,INITIAL_UNDEFINED,NO_REFERENCE};
static VkResult make_pass(VkFormat depth,VkAttachmentLoadOp load,VkAttachmentStoreOp store,int variant,VkRenderPass *out){
    VkAttachmentDescription a[2]={{.format=VK_FORMAT_R8G8B8A8_UNORM,.samples=VK_SAMPLE_COUNT_1_BIT,.loadOp=VK_ATTACHMENT_LOAD_OP_CLEAR,.storeOp=VK_ATTACHMENT_STORE_OP_STORE,
        .stencilLoadOp=VK_ATTACHMENT_LOAD_OP_DONT_CARE,.stencilStoreOp=VK_ATTACHMENT_STORE_OP_DONT_CARE,.initialLayout=VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL,.finalLayout=VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL},
        {.format=depth,.samples=VK_SAMPLE_COUNT_1_BIT,.loadOp=load,.storeOp=store,.stencilLoadOp=VK_ATTACHMENT_LOAD_OP_DONT_CARE,.stencilStoreOp=VK_ATTACHMENT_STORE_OP_DONT_CARE,
        .initialLayout=VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL,.finalLayout=VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL}};
    if(variant==STENCIL_CLEAR)a[1].stencilLoadOp=VK_ATTACHMENT_LOAD_OP_CLEAR;
    if(variant==INITIAL_UNDEFINED)a[1].initialLayout=VK_IMAGE_LAYOUT_UNDEFINED;
    VkAttachmentReference ref={0,VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL},dref={1,VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL};
    VkSubpassDescription s={.pipelineBindPoint=VK_PIPELINE_BIND_POINT_GRAPHICS,.colorAttachmentCount=1,.pColorAttachments=&ref,
        .pDepthStencilAttachment=depth&&variant!=NO_REFERENCE?&dref:NULL};
    VkRenderPassCreateInfo info={.sType=VK_STRUCTURE_TYPE_RENDER_PASS_CREATE_INFO,.attachmentCount=depth?2:1,.pAttachments=a,.subpassCount=1,.pSubpasses=&s};
    VkResult r=vkCreateRenderPass(device,&info,NULL,out);memset(a,0xff,sizeof(a));memset(&dref,0xff,sizeof(dref));return r;
}
static VkPipelineDepthStencilStateCreateInfo depth_state(int test,int write,VkCompareOp op){
    return (VkPipelineDepthStencilStateCreateInfo){.sType=VK_STRUCTURE_TYPE_PIPELINE_DEPTH_STENCIL_STATE_CREATE_INFO,.depthTestEnable=test,.depthWriteEnable=write,.depthCompareOp=op,.maxDepthBounds=1};
}
static VkResult graphics_pipeline(VkRenderPass pass,const VkPipelineDepthStencilStateCreateInfo *ds,int bias,VkPipeline *out){
    VkPipelineShaderStageCreateInfo stages[2]={{.sType=VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO,.stage=VK_SHADER_STAGE_VERTEX_BIT,.module=vs_module,.pName="main"},
        {.sType=VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO,.stage=VK_SHADER_STAGE_FRAGMENT_BIT,.module=fs_module,.pName="main"}};
    VkVertexInputBindingDescription bind={0,STRIDE,VK_VERTEX_INPUT_RATE_VERTEX};
    VkVertexInputAttributeDescription attr[2]={{0,0,VK_FORMAT_R32G32B32_SFLOAT,0},{1,0,VK_FORMAT_R32G32B32A32_SFLOAT,12}};
    VkPipelineVertexInputStateCreateInfo vin={.sType=VK_STRUCTURE_TYPE_PIPELINE_VERTEX_INPUT_STATE_CREATE_INFO,.vertexBindingDescriptionCount=1,.pVertexBindingDescriptions=&bind,
        .vertexAttributeDescriptionCount=2,.pVertexAttributeDescriptions=attr};
    VkPipelineInputAssemblyStateCreateInfo assembly={.sType=VK_STRUCTURE_TYPE_PIPELINE_INPUT_ASSEMBLY_STATE_CREATE_INFO,.topology=VK_PRIMITIVE_TOPOLOGY_TRIANGLE_LIST};
    VkViewport viewport={0,0,W,H,0,1};VkRect2D scissor={{0,0},{W,H}};VkPipelineViewportStateCreateInfo vs={.sType=VK_STRUCTURE_TYPE_PIPELINE_VIEWPORT_STATE_CREATE_INFO,.viewportCount=1,.pViewports=&viewport,.scissorCount=1,.pScissors=&scissor};
    VkPipelineRasterizationStateCreateInfo rs={.sType=VK_STRUCTURE_TYPE_PIPELINE_RASTERIZATION_STATE_CREATE_INFO,.polygonMode=VK_POLYGON_MODE_FILL,.cullMode=VK_CULL_MODE_NONE,.frontFace=VK_FRONT_FACE_COUNTER_CLOCKWISE,.lineWidth=1,
        .depthBiasEnable=bias,.depthBiasConstantFactor=bias?1.0f:0.0f};
    VkPipelineMultisampleStateCreateInfo ms={.sType=VK_STRUCTURE_TYPE_PIPELINE_MULTISAMPLE_STATE_CREATE_INFO,.rasterizationSamples=VK_SAMPLE_COUNT_1_BIT};VkPipelineColorBlendAttachmentState attachment={.colorWriteMask=15};
    VkPipelineColorBlendStateCreateInfo blend={.sType=VK_STRUCTURE_TYPE_PIPELINE_COLOR_BLEND_STATE_CREATE_INFO,.attachmentCount=1,.pAttachments=&attachment};
    VkPipelineDepthStencilStateCreateInfo copy;if(ds)copy=*ds;
    VkGraphicsPipelineCreateInfo pi={.sType=VK_STRUCTURE_TYPE_GRAPHICS_PIPELINE_CREATE_INFO,.stageCount=2,.pStages=stages,.pVertexInputState=&vin,.pInputAssemblyState=&assembly,.pViewportState=&vs,
        .pRasterizationState=&rs,.pMultisampleState=&ms,.pDepthStencilState=ds?&copy:NULL,.pColorBlendState=&blend,.layout=playout,.renderPass=pass,.basePipelineIndex=-1};
    VkResult r=vkCreateGraphicsPipelines(device,VK_NULL_HANDLE,1,&pi,NULL,out);
    memset(stages,0xff,sizeof(stages));memset(&viewport,0xff,sizeof(viewport));memset(&copy,0xff,sizeof(copy));memset(attr,0xff,sizeof(attr));return r;
}
static void color_barrier(VkImageLayout old,VkImageLayout next){
    VkImageMemoryBarrier b={.sType=VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER,.oldLayout=old,.newLayout=next,.image=color_image,
        .srcQueueFamilyIndex=VK_QUEUE_FAMILY_IGNORED,.dstQueueFamilyIndex=VK_QUEUE_FAMILY_IGNORED,.subresourceRange={VK_IMAGE_ASPECT_COLOR_BIT,0,1,0,1}};
    VkPipelineStageFlags src=VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT,dst=VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT;
    b.dstAccessMask=VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT;
    if(old==VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL){src=VK_PIPELINE_STAGE_TRANSFER_BIT;b.srcAccessMask=VK_ACCESS_TRANSFER_READ_BIT;}
    if(old==VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL){src=VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT;b.srcAccessMask=VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT;
        b.dstAccessMask=VK_ACCESS_COLOR_ATTACHMENT_READ_BIT|VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT;}
    if(next==VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL){dst=VK_PIPELINE_STAGE_TRANSFER_BIT;b.dstAccessMask=VK_ACCESS_TRANSFER_READ_BIT;}
    vkCmdPipelineBarrier(cb,src,dst,0,0,NULL,0,NULL,1,&b);
}
/* Depth transitions into DEPTH_STENCIL_ATTACHMENT_OPTIMAL. src_access<0 selects the valid mask. */
static void depth_barrier_ex(VkImage image,VkImageLayout old,VkImageLayout next,VkImageAspectFlags aspect,int src_access){
    const VkPipelineStageFlags tests=VK_PIPELINE_STAGE_EARLY_FRAGMENT_TESTS_BIT|VK_PIPELINE_STAGE_LATE_FRAGMENT_TESTS_BIT;
    VkImageMemoryBarrier b={.sType=VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER,.oldLayout=old,.newLayout=next,.image=image,
        .srcQueueFamilyIndex=VK_QUEUE_FAMILY_IGNORED,.dstQueueFamilyIndex=VK_QUEUE_FAMILY_IGNORED,.subresourceRange={aspect,0,1,0,1},
        .dstAccessMask=VK_ACCESS_DEPTH_STENCIL_ATTACHMENT_READ_BIT|VK_ACCESS_DEPTH_STENCIL_ATTACHMENT_WRITE_BIT};
    VkPipelineStageFlags src=VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT;
    if(old==VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL){src=VK_PIPELINE_STAGE_LATE_FRAGMENT_TESTS_BIT;b.srcAccessMask=VK_ACCESS_DEPTH_STENCIL_ATTACHMENT_WRITE_BIT;}
    if(src_access>=0)b.srcAccessMask=(VkAccessFlags)src_access;
    vkCmdPipelineBarrier(cb,src,tests,0,0,NULL,0,NULL,1,&b);
}
static void depth_barrier(VkImage image,VkImageLayout old){depth_barrier_ex(image,old,VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL,VK_IMAGE_ASPECT_DEPTH_BIT,-1);}
static void buffer_barrier(VkBuffer buffer,int kind){
    VkBufferMemoryBarrier b={.sType=VK_STRUCTURE_TYPE_BUFFER_MEMORY_BARRIER,.buffer=buffer,.size=VK_WHOLE_SIZE,
        .srcQueueFamilyIndex=VK_QUEUE_FAMILY_IGNORED,.dstQueueFamilyIndex=VK_QUEUE_FAMILY_IGNORED};
    VkPipelineStageFlags src=VK_PIPELINE_STAGE_HOST_BIT,dst=VK_PIPELINE_STAGE_VERTEX_INPUT_BIT;
    if(kind==0){src=VK_PIPELINE_STAGE_TRANSFER_BIT;dst=VK_PIPELINE_STAGE_HOST_BIT;b.srcAccessMask=VK_ACCESS_TRANSFER_WRITE_BIT;b.dstAccessMask=VK_ACCESS_HOST_READ_BIT;}
    else{b.srcAccessMask=VK_ACCESS_HOST_WRITE_BIT;b.dstAccessMask=VK_ACCESS_VERTEX_ATTRIBUTE_READ_BIT;}
    vkCmdPipelineBarrier(cb,src,dst,0,0,NULL,1,&b,0,NULL);
}
static void begin_pass(VkRenderPass pass,VkFramebuffer fb,float depth,uint32_t count){
    VkClearValue clear[2]={{.color={{0,1,0,1}}},{.depthStencil={depth,0}}};
    VkRenderPassBeginInfo info={.sType=VK_STRUCTURE_TYPE_RENDER_PASS_BEGIN_INFO,.renderPass=pass,.framebuffer=fb,.renderArea={{0,0},{W,H}},.clearValueCount=count,.pClearValues=clear};
    vkCmdBeginRenderPass(cb,&info,VK_SUBPASS_CONTENTS_INLINE);memset(clear,0xff,sizeof(clear));
}
static void draw(VkPipeline pipeline,uint32_t first){
    vkCmdBindPipeline(cb,VK_PIPELINE_BIND_POINT_GRAPHICS,pipeline);
    VkBuffer v=vertices;VkDeviceSize offset=0;vkCmdBindVertexBuffers(cb,0,1,&v,&offset);vkCmdDraw(cb,6,1,first,0);
}
/* One pass of a frame: up to two quads, each with its own pipeline. */
struct step { VkRenderPass pass; float clear; VkPipeline p1; uint32_t f1; VkPipeline p2; uint32_t f2; };
static void record_frame(VkImage depth,VkImageLayout dold,int transition,VkFramebuffer fb,const struct step *steps,unsigned count){
    color_barrier(cold,VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL);buffer_barrier(vertices,1);
    if(transition)depth_barrier(depth,dold);
    for(unsigned k=0;k<count;k++){
        if(k){color_barrier(VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL,VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL);depth_barrier(depth,VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL);}
        begin_pass(steps[k].pass,fb,steps[k].clear,2);draw(steps[k].p1,steps[k].f1);if(steps[k].p2)draw(steps[k].p2,steps[k].f2);vkCmdEndRenderPass(cb);
    }
    color_barrier(VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL,VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL);
    VkBufferImageCopy copy={.imageSubresource={VK_IMAGE_ASPECT_COLOR_BIT,0,0,1},.imageExtent={W,H,1}};
    vkCmdCopyImageToBuffer(cb,color_image,VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL,readback,1,&copy);buffer_barrier(readback,0);
}
enum {A=0,B=6,BSAME=12};
/* One depth format: image, passes, framebuffer, pipelines, eleven rounds of
 * exact comparisons, recording/submission refusals and a recovery frame. */
static int phase(VkFormat format,const char *name,unsigned base){
    int ok=0;VkImage depth=VK_NULL_HANDLE,small=VK_NULL_HANDLE;VkDeviceMemory memory=VK_NULL_HANDLE,small_mem=VK_NULL_HANDLE;
    VkImageView view=VK_NULL_HANDLE,small_view=VK_NULL_HANDLE;VkRenderPass cs=VK_NULL_HANDLE,ls=VK_NULL_HANDLE,cd=VK_NULL_HANDLE,ds=VK_NULL_HANDLE,other=VK_NULL_HANDLE;
    VkFramebuffer fb=VK_NULL_HANDLE;VkPipeline less=VK_NULL_HANDLE,less_nw=VK_NULL_HANDLE,greater=VK_NULL_HANDLE,off=VK_NULL_HANDLE,lequal=VK_NULL_HANDLE;
    const VkImageLayout DSA=VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL;VkImageLayout dold=VK_IMAGE_LAYOUT_UNDEFINED;
    const VkFormat wrong=format==VK_FORMAT_D32_SFLOAT?VK_FORMAT_D16_UNORM:VK_FORMAT_D32_SFLOAT;const VkDeviceSize bytes=format==VK_FORMAT_D32_SFLOAT?4*W*H:2*W*H;
    /* Image, memory requirements and views. */
    VkImageCreateInfo im={.sType=VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO,.imageType=VK_IMAGE_TYPE_2D,.format=format,.extent={W,H,1},.mipLevels=1,.arrayLayers=1,.samples=VK_SAMPLE_COUNT_1_BIT,
        .tiling=VK_IMAGE_TILING_OPTIMAL,.usage=VK_IMAGE_USAGE_DEPTH_STENCIL_ATTACHMENT_BIT,.sharingMode=VK_SHARING_MODE_EXCLUSIVE};
    CHECK(vkCreateImage(device,&im,NULL,&depth)==VK_SUCCESS);VkMemoryRequirements mr;vkGetImageMemoryRequirements(device,depth,&mr);CHECK(mr.size==bytes&&mr.memoryTypeBits==1&&mr.alignment==4);
    VkMemoryAllocateInfo ai={.sType=VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO,.allocationSize=mr.size,.memoryTypeIndex=0};CHECK(vkAllocateMemory(device,&ai,NULL,&memory)==VK_SUCCESS);
    VkImageViewCreateInfo vi={.sType=VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO,.image=depth,.viewType=VK_IMAGE_VIEW_TYPE_2D,.format=format,.subresourceRange={VK_IMAGE_ASPECT_DEPTH_BIT,0,1,0,1}};
    CHECK(vkCreateImageView(device,&vi,NULL,&view)==VK_ERROR_INITIALIZATION_FAILED&&!view);    /* not yet bound */
    CHECK(vkBindImageMemory(device,depth,memory,0)==VK_SUCCESS);
    vi.subresourceRange.aspectMask=VK_IMAGE_ASPECT_COLOR_BIT;CHECK(vkCreateImageView(device,&vi,NULL,&view)==VK_ERROR_INITIALIZATION_FAILED&&!view);
    vi.subresourceRange.aspectMask=VK_IMAGE_ASPECT_DEPTH_BIT;vi.format=wrong;CHECK(vkCreateImageView(device,&vi,NULL,&view)==VK_ERROR_INITIALIZATION_FAILED&&!view);
    vi.format=format;CHECK(vkCreateImageView(device,&vi,NULL,&view)==VK_SUCCESS&&view);
    printf("GUEST_VK_DEPTH_IMAGE format=%s bytes=%u rejected_views=3\n",name,(unsigned)mr.size);fflush(stdout);
    /* Render passes: CLEAR/STORE, LOAD/STORE, CLEAR/DONT_CARE, DONT_CARE/STORE; unsupported shapes are refused. */
    {
        VkRenderPass bad=VK_NULL_HANDLE;
        CHECK(make_pass(format,VK_ATTACHMENT_LOAD_OP_CLEAR,VK_ATTACHMENT_STORE_OP_STORE,STENCIL_CLEAR,&bad)==VK_ERROR_FEATURE_NOT_PRESENT&&!bad);
        CHECK(make_pass(format,VK_ATTACHMENT_LOAD_OP_CLEAR,VK_ATTACHMENT_STORE_OP_STORE,INITIAL_UNDEFINED,&bad)==VK_ERROR_FEATURE_NOT_PRESENT&&!bad);
        CHECK(make_pass(VK_FORMAT_D24_UNORM_S8_UINT,VK_ATTACHMENT_LOAD_OP_CLEAR,VK_ATTACHMENT_STORE_OP_STORE,NORMAL,&bad)==VK_ERROR_FEATURE_NOT_PRESENT&&!bad);
        CHECK(make_pass(format,VK_ATTACHMENT_LOAD_OP_CLEAR,VK_ATTACHMENT_STORE_OP_STORE,NO_REFERENCE,&bad)==VK_ERROR_FEATURE_NOT_PRESENT&&!bad);
        printf("GUEST_VK_DEPTH_PASSES format=%s rejected=4\n",name);fflush(stdout);
    }
    CHECK(make_pass(format,VK_ATTACHMENT_LOAD_OP_CLEAR,VK_ATTACHMENT_STORE_OP_STORE,NORMAL,&cs)==VK_SUCCESS);
    CHECK(make_pass(format,VK_ATTACHMENT_LOAD_OP_LOAD,VK_ATTACHMENT_STORE_OP_STORE,NORMAL,&ls)==VK_SUCCESS);
    CHECK(make_pass(format,VK_ATTACHMENT_LOAD_OP_CLEAR,VK_ATTACHMENT_STORE_OP_DONT_CARE,NORMAL,&cd)==VK_SUCCESS);
    CHECK(make_pass(format,VK_ATTACHMENT_LOAD_OP_DONT_CARE,VK_ATTACHMENT_STORE_OP_STORE,NORMAL,&ds)==VK_SUCCESS);
    /* Framebuffers: attachment count, extent, attachment kind and format must match. */
    {
        VkImageView pair[2]={color_view,view};VkFramebuffer bad=VK_NULL_HANDLE;
        VkFramebufferCreateInfo fi={.sType=VK_STRUCTURE_TYPE_FRAMEBUFFER_CREATE_INFO,.renderPass=cs,.attachmentCount=1,.pAttachments=pair,.width=W,.height=H,.layers=1};
        CHECK(vkCreateFramebuffer(device,&fi,NULL,&bad)==VK_ERROR_INITIALIZATION_FAILED&&!bad);
        fi.attachmentCount=2;pair[1]=color_view;CHECK(vkCreateFramebuffer(device,&fi,NULL,&bad)==VK_ERROR_INITIALIZATION_FAILED&&!bad);
        im.extent=(VkExtent3D){8,8,1};CHECK(vkCreateImage(device,&im,NULL,&small)==VK_SUCCESS);ai.allocationSize=bytes/4;CHECK(vkAllocateMemory(device,&ai,NULL,&small_mem)==VK_SUCCESS);
        CHECK(vkBindImageMemory(device,small,small_mem,0)==VK_SUCCESS);vi.image=small;CHECK(vkCreateImageView(device,&vi,NULL,&small_view)==VK_SUCCESS);
        pair[1]=small_view;CHECK(vkCreateFramebuffer(device,&fi,NULL,&bad)==VK_ERROR_INITIALIZATION_FAILED&&!bad);
        vkDestroyImageView(device,small_view,NULL);small_view=VK_NULL_HANDLE;vkDestroyImage(device,small,NULL);small=VK_NULL_HANDLE;vkFreeMemory(device,small_mem,NULL);small_mem=VK_NULL_HANDLE;
        CHECK(make_pass(wrong,VK_ATTACHMENT_LOAD_OP_CLEAR,VK_ATTACHMENT_STORE_OP_STORE,NORMAL,&other)==VK_SUCCESS);
        pair[1]=view;fi.renderPass=other;CHECK(vkCreateFramebuffer(device,&fi,NULL,&bad)==VK_ERROR_INITIALIZATION_FAILED&&!bad);
        vkDestroyRenderPass(device,other,NULL);other=VK_NULL_HANDLE;
        fi.renderPass=cs;CHECK(vkCreateFramebuffer(device,&fi,NULL,&fb)==VK_SUCCESS&&fb);
        printf("GUEST_VK_DEPTH_FRAMEBUFFERS format=%s rejected=4\n",name);fflush(stdout);
    }
    /* Pipelines: depth state exactly with a depth pass; no stencil, bounds or bias. */
    {
        VkPipeline bad=VK_NULL_HANDLE;VkPipelineDepthStencilStateCreateInfo d=depth_state(1,1,VK_COMPARE_OP_LESS);
        d.stencilTestEnable=VK_TRUE;CHECK(graphics_pipeline(cs,&d,0,&bad)==VK_ERROR_FEATURE_NOT_PRESENT&&!bad);
        d=depth_state(1,1,VK_COMPARE_OP_LESS);d.depthBoundsTestEnable=VK_TRUE;CHECK(graphics_pipeline(cs,&d,0,&bad)==VK_ERROR_FEATURE_NOT_PRESENT&&!bad);
        d=depth_state(1,1,VK_COMPARE_OP_LESS);CHECK(graphics_pipeline(cs,&d,1,&bad)==VK_ERROR_FEATURE_NOT_PRESENT&&!bad);
        CHECK(graphics_pipeline(cs,NULL,0,&bad)==VK_ERROR_INITIALIZATION_FAILED&&!bad);
        CHECK(graphics_pipeline(cpass,&d,0,&bad)==VK_ERROR_INITIALIZATION_FAILED&&!bad);
        d.depthCompareOp=(VkCompareOp)8;CHECK(graphics_pipeline(cs,&d,0,&bad)==VK_ERROR_INITIALIZATION_FAILED&&!bad);
        printf("GUEST_VK_DEPTH_PIPELINES format=%s rejected=6\n",name);fflush(stdout);
        d=depth_state(1,1,VK_COMPARE_OP_LESS);CHECK(graphics_pipeline(cs,&d,0,&less)==VK_SUCCESS);
        d=depth_state(1,0,VK_COMPARE_OP_LESS);CHECK(graphics_pipeline(cs,&d,0,&less_nw)==VK_SUCCESS);
        d=depth_state(1,1,VK_COMPARE_OP_GREATER);CHECK(graphics_pipeline(ls,&d,0,&greater)==VK_SUCCESS);   /* any compatible pass */
        d=depth_state(0,1,VK_COMPARE_OP_NEVER);CHECK(graphics_pipeline(cs,&d,0,&off)==VK_SUCCESS);
        d=depth_state(1,1,VK_COMPARE_OP_LESS_OR_EQUAL);CHECK(graphics_pipeline(cs,&d,0,&lequal)==VK_SUCCESS);
    }
    /* Invalid recordings: EndCommandBuffer must refuse every one of them. */
    for(unsigned n=0;n<5;n++){
        CHECK(vkResetCommandBuffer(cb,0)==VK_SUCCESS);CHECK(vkBeginCommandBuffer(cb,&begin_info)==VK_SUCCESS);
        if(n<2){color_barrier(cold,VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL);depth_barrier(depth,VK_IMAGE_LAYOUT_UNDEFINED);
            begin_pass(cs,fb,n?1.5f:1.0f,n?2:1);vkCmdEndRenderPass(cb);}                                       /* missing depth clear value; clear outside [0,1] */
        else if(n==2)depth_barrier_ex(depth,VK_IMAGE_LAYOUT_UNDEFINED,DSA,VK_IMAGE_ASPECT_COLOR_BIT,-1);           /* colour aspect */
        else if(n==3)depth_barrier_ex(depth,DSA,DSA,VK_IMAGE_ASPECT_DEPTH_BIT,0);                                 /* missing write dependency */
        else depth_barrier_ex(depth,VK_IMAGE_LAYOUT_UNDEFINED,VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL,VK_IMAGE_ASPECT_DEPTH_BIT,-1);
        CHECK(vkEndCommandBuffer(cb)==VK_ERROR_INITIALIZATION_FAILED);
    }
    printf("GUEST_VK_DEPTH_RECORDING_REJECTED format=%s count=5\n",name);fflush(stdout);
#define RECORD(transition,...) do{const struct step st[]={__VA_ARGS__};CHECK(vkResetCommandBuffer(cb,0)==VK_SUCCESS);CHECK(vkBeginCommandBuffer(cb,&begin_info)==VK_SUCCESS);\
    record_frame(depth,dold,transition,fb,st,sizeof(st)/sizeof(st[0]));CHECK(vkEndCommandBuffer(cb)==VK_SUCCESS);}while(0)
#define FRAME(round) do{memset(mapped,0xa5,TOTAL);CHECK(vkQueueSubmit(queue,1,&submit_info,VK_NULL_HANDLE)==VK_SUCCESS);CHECK(vkQueueWaitIdle(queue)==VK_SUCCESS);\
    cold=VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL;dold=DSA;CHECK(compare(mapped,base+(round)));}while(0)
#define REFUSED() do{memset(mapped,0xa5,TOTAL);CHECK(vkQueueSubmit(queue,1,&submit_info,VK_NULL_HANDLE)==VK_ERROR_INITIALIZATION_FAILED);for(unsigned k=0;k<TOTAL;k++)CHECK(mapped[k]==0xa5);}while(0)
    /* A fresh image is still UNDEFINED: a pass needs the DEPTH_STENCIL_ATTACHMENT transition first. */
    RECORD(0,{cs,1,less,A,less,B});REFUSED();
    RECORD(1,{cs,1,less,A,less,B});expect(RED,RED,BLUE);FRAME(1);                 /* nearer A wins regardless of order */
    RECORD(1,{cs,1,less,B,less,A});expect(RED,RED,BLUE);FRAME(2);
    RECORD(1,{cs,0,greater,A,greater,B});expect(RED,BLUE,BLUE);FRAME(3);          /* GREATER against clear 0 */
    RECORD(1,{cs,1,less_nw,A,less,B});expect(RED,BLUE,BLUE);FRAME(4);             /* A tested but not written */
    RECORD(1,{cs,1,off,A,off,B});expect(RED,BLUE,BLUE);FRAME(5);                  /* test disabled: draw order */
    RECORD(1,{cs,0.5f,less,A,less,B});expect(RED,RED,GREEN);FRAME(6);             /* clear value 0.5 rejects B at 0.75 */
    RECORD(1,{cs,1,less,A,less,BSAME});expect(RED,RED,BLUE);FRAME(7);             /* equal depth: LESS keeps A */
    RECORD(1,{cs,1,less,A,lequal,BSAME});expect(RED,BLUE,BLUE);FRAME(8);          /* equal depth: LESS_OR_EQUAL takes B */
    /* Depth persists across submissions: CLEAR/STORE with A, then LOAD with B. */
    RECORD(1,{cs,1,less,A,VK_NULL_HANDLE,0});expect(RED,RED,GREEN);FRAME(9);
    RECORD(1,{ls,1,less,B,VK_NULL_HANDLE,0});expect(GREEN,GREEN,BLUE);FRAME(10);
    /* ... and across two passes of one command buffer. */
    RECORD(1,{cs,1,less,A,VK_NULL_HANDLE,0},{ls,1,less,B,VK_NULL_HANDLE,0});expect(GREEN,GREEN,BLUE);FRAME(11);
    /* DONT_CARE load starts from the far plane (1.0), not the stored A depth. */
    RECORD(1,{ds,1,less,A,less,B});expect(RED,RED,BLUE);FRAME(12);
    /* DONT_CARE store: the frame renders but the depth contents are then undefined. */
    RECORD(1,{cd,1,less,A,less,B});expect(RED,RED,BLUE);FRAME(13);
    printf("GUEST_VK_DEPTH_ROUNDS_PASS format=%s rounds=13\n",name);fflush(stdout);
    RECORD(1,{ls,1,less,B,VK_NULL_HANDLE,0});REFUSED();                           /* LOAD after DONT_CARE store */
    RECORD(1,{cs,1,less,A,VK_NULL_HANDLE,0});expect(RED,RED,GREEN);FRAME(14);     /* restore stored contents */
    dold=VK_IMAGE_LAYOUT_UNDEFINED;RECORD(1,{ls,1,less,B,VK_NULL_HANDLE,0});REFUSED();dold=DSA;   /* LOAD after an UNDEFINED transition */
    RECORD(1,{cs,1,cpipe,A,VK_NULL_HANDLE,0});REFUSED();                          /* colour-only pipeline in a depth pass */
    {   /* Depth contents are never copied to guest memory. */
        CHECK(vkResetCommandBuffer(cb,0)==VK_SUCCESS);CHECK(vkBeginCommandBuffer(cb,&begin_info)==VK_SUCCESS);
        VkBufferImageCopy copy={.imageSubresource={VK_IMAGE_ASPECT_COLOR_BIT,0,0,1},.imageExtent={W,H,1}};
        vkCmdCopyImageToBuffer(cb,depth,VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL,readback,1,&copy);buffer_barrier(readback,0);
        CHECK(vkEndCommandBuffer(cb)==VK_SUCCESS);REFUSED();
    }
    RECORD(1,{cs,1,less,B,less,A});expect(RED,RED,BLUE);FRAME(15);                /* recovery */
    printf("GUEST_VK_DEPTH_NEGATIVE_PASS format=%s refused_submits=5 recovered=1\n",name);fflush(stdout);
#undef RECORD
#undef FRAME
#undef REFUSED
    ok=1;
done:
    if(less)vkDestroyPipeline(device,less,NULL);if(less_nw)vkDestroyPipeline(device,less_nw,NULL);if(greater)vkDestroyPipeline(device,greater,NULL);
    if(off)vkDestroyPipeline(device,off,NULL);if(lequal)vkDestroyPipeline(device,lequal,NULL);if(fb)vkDestroyFramebuffer(device,fb,NULL);
    if(cs)vkDestroyRenderPass(device,cs,NULL);if(ls)vkDestroyRenderPass(device,ls,NULL);if(cd)vkDestroyRenderPass(device,cd,NULL);if(ds)vkDestroyRenderPass(device,ds,NULL);
    if(other)vkDestroyRenderPass(device,other,NULL);
    if(small_view)vkDestroyImageView(device,small_view,NULL);if(small)vkDestroyImage(device,small,NULL);if(small_mem)vkFreeMemory(device,small_mem,NULL);
    if(view)vkDestroyImageView(device,view,NULL);if(depth)vkDestroyImage(device,depth,NULL);if(memory)vkFreeMemory(device,memory,NULL);
    return ok;
}
static void quad(float *v,float x0,float y0,float x1,float y1,float z,const unsigned char *c){
    const float r=c[0]/255.0f,g=c[1]/255.0f,b=c[2]/255.0f,a=c[3]/255.0f;
    const float q[6][7]={{x0,y0,z,r,g,b,a},{x1,y0,z,r,g,b,a},{x1,y1,z,r,g,b,a},{x0,y0,z,r,g,b,a},{x1,y1,z,r,g,b,a},{x0,y1,z,r,g,b,a}};memcpy(v,q,sizeof(q));
}
int main(void){
    int result=1;VkInstance instance=VK_NULL_HANDLE;VkDeviceMemory image_mem=VK_NULL_HANDLE,read_mem=VK_NULL_HANDLE,vertex_mem=VK_NULL_HANDLE;
    unsigned char *vmap=NULL;VkCommandPool cpool=VK_NULL_HANDLE;
    struct sigaction action={0};action.sa_handler=deadline;sigemptyset(&action.sa_mask);if(sigaction(SIGALRM,&action,NULL))return 2;alarm(110);signal(SIGPIPE,SIG_IGN);
    puts("GUEST_VK_DEPTH_SCOPE public static Khronos loader; D32_SFLOAT/D16_UNORM depth attachments, depth test/write/compare; bounded nonconformant ICD");
    VkApplicationInfo app={.sType=VK_STRUCTURE_TYPE_APPLICATION_INFO,.apiVersion=VK_API_VERSION_1_0,.pApplicationName="public-depth"};VkInstanceCreateInfo ii={.sType=VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO,.pApplicationInfo=&app};
    CHECK(vkCreateInstance(&ii,NULL,&instance)==VK_SUCCESS);uint32_t count=1;VkPhysicalDevice physical;CHECK(vkEnumeratePhysicalDevices(instance,&count,&physical)==VK_SUCCESS&&count==1);
    VkQueueFamilyProperties qp;count=1;vkGetPhysicalDeviceQueueFamilyProperties(physical,&count,&qp);CHECK(qp.queueFlags&VK_QUEUE_GRAPHICS_BIT);
    VkPhysicalDeviceProperties properties;vkGetPhysicalDeviceProperties(physical,&properties);const VkPhysicalDeviceLimits *lim=&properties.limits;
    CHECK(lim->framebufferDepthSampleCounts==VK_SAMPLE_COUNT_1_BIT&&lim->framebufferColorSampleCounts==VK_SAMPLE_COUNT_1_BIT&&lim->maxImageDimension2D==128);
    const unsigned max_stride=lim->maxVertexInputBindingStride;CHECK(max_stride==252||max_stride==2048);
    printf("GUEST_VK_DEPTH_LIMITS depth_samples=%u dimension=%u max_stride=%u\n",(unsigned)lim->framebufferDepthSampleCounts,lim->maxImageDimension2D,max_stride);fflush(stdout);
    /* Format queries: D32_SFLOAT and D16_UNORM are depth-attachment-only; stencil formats are absent. */
    {
        VkFormatProperties fp;VkImageFormatProperties ifp;const VkImageUsageFlags DSA_USAGE=VK_IMAGE_USAGE_DEPTH_STENCIL_ATTACHMENT_BIT;
        const VkFormat good[2]={VK_FORMAT_D32_SFLOAT,VK_FORMAT_D16_UNORM},bad[4]={VK_FORMAT_D24_UNORM_S8_UINT,VK_FORMAT_S8_UINT,VK_FORMAT_D32_SFLOAT_S8_UINT,VK_FORMAT_X8_D24_UNORM_PACK32};
        for(unsigned n=0;n<2;n++){
            vkGetPhysicalDeviceFormatProperties(physical,good[n],&fp);
            CHECK(fp.optimalTilingFeatures==VK_FORMAT_FEATURE_DEPTH_STENCIL_ATTACHMENT_BIT&&!fp.linearTilingFeatures&&!fp.bufferFeatures);
            CHECK(vkGetPhysicalDeviceImageFormatProperties(physical,good[n],VK_IMAGE_TYPE_2D,VK_IMAGE_TILING_OPTIMAL,DSA_USAGE,0,&ifp)==VK_SUCCESS);
            CHECK(ifp.maxExtent.width==128&&ifp.maxExtent.height==128&&ifp.maxMipLevels==1&&ifp.maxArrayLayers==1&&ifp.sampleCounts==VK_SAMPLE_COUNT_1_BIT);
            CHECK(vkGetPhysicalDeviceImageFormatProperties(physical,good[n],VK_IMAGE_TYPE_2D,VK_IMAGE_TILING_OPTIMAL,DSA_USAGE|VK_IMAGE_USAGE_SAMPLED_BIT,0,&ifp)==VK_ERROR_FORMAT_NOT_SUPPORTED);
        }
        for(unsigned n=0;n<4;n++){
            vkGetPhysicalDeviceFormatProperties(physical,bad[n],&fp);CHECK(!fp.optimalTilingFeatures&&!fp.linearTilingFeatures);
            CHECK(vkGetPhysicalDeviceImageFormatProperties(physical,bad[n],VK_IMAGE_TYPE_2D,VK_IMAGE_TILING_OPTIMAL,DSA_USAGE,0,&ifp)==VK_ERROR_FORMAT_NOT_SUPPORTED);
        }
        printf("GUEST_VK_DEPTH_FORMATS supported=2 unsupported=4\n");fflush(stdout);
    }
    VkPhysicalDeviceMemoryProperties mp;vkGetPhysicalDeviceMemoryProperties(physical,&mp);CHECK(mp.memoryTypeCount==2&&(mp.memoryTypes[1].propertyFlags&VK_MEMORY_PROPERTY_HOST_COHERENT_BIT));
    float priority=1;VkDeviceQueueCreateInfo qi={.sType=VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO,.queueCount=1,.pQueuePriorities=&priority};VkDeviceCreateInfo di={.sType=VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO,.queueCreateInfoCount=1,.pQueueCreateInfos=&qi};
    CHECK(vkCreateDevice(physical,&di,NULL,&device)==VK_SUCCESS);vkGetDeviceQueue(device,0,0,&queue);CHECK(queue!=VK_NULL_HANDLE);
    /* Images: only exact DEPTH_STENCIL_ATTACHMENT usage of D32/D16, one level, one layer, <=128. */
    {
        VkImageCreateInfo im={.sType=VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO,.imageType=VK_IMAGE_TYPE_2D,.format=VK_FORMAT_D24_UNORM_S8_UINT,.extent={W,H,1},.mipLevels=1,.arrayLayers=1,.samples=VK_SAMPLE_COUNT_1_BIT,
            .tiling=VK_IMAGE_TILING_OPTIMAL,.usage=VK_IMAGE_USAGE_DEPTH_STENCIL_ATTACHMENT_BIT,.sharingMode=VK_SHARING_MODE_EXCLUSIVE};VkImage rejected=VK_NULL_HANDLE;
        CHECK(vkCreateImage(device,&im,NULL,&rejected)==VK_ERROR_FORMAT_NOT_SUPPORTED&&!rejected);
        im.format=VK_FORMAT_S8_UINT;CHECK(vkCreateImage(device,&im,NULL,&rejected)==VK_ERROR_FORMAT_NOT_SUPPORTED&&!rejected);
        im.format=VK_FORMAT_D32_SFLOAT;im.usage|=VK_IMAGE_USAGE_SAMPLED_BIT;CHECK(vkCreateImage(device,&im,NULL,&rejected)==VK_ERROR_FORMAT_NOT_SUPPORTED&&!rejected);
        im.usage=VK_IMAGE_USAGE_DEPTH_STENCIL_ATTACHMENT_BIT|VK_IMAGE_USAGE_TRANSFER_SRC_BIT;CHECK(vkCreateImage(device,&im,NULL,&rejected)==VK_ERROR_FORMAT_NOT_SUPPORTED&&!rejected);
        im.usage=VK_IMAGE_USAGE_DEPTH_STENCIL_ATTACHMENT_BIT;im.extent.width=129;CHECK(vkCreateImage(device,&im,NULL,&rejected)==VK_ERROR_FORMAT_NOT_SUPPORTED&&!rejected);
        im.extent.width=W;im.mipLevels=2;CHECK(vkCreateImage(device,&im,NULL,&rejected)==VK_ERROR_FORMAT_NOT_SUPPORTED&&!rejected);
        im.mipLevels=1;im.format=VK_FORMAT_D16_UNORM;im.tiling=VK_IMAGE_TILING_LINEAR;CHECK(vkCreateImage(device,&im,NULL,&rejected)==VK_ERROR_FORMAT_NOT_SUPPORTED&&!rejected);
        printf("GUEST_VK_DEPTH_IMAGES rejected=7\n");fflush(stdout);
    }
    /* Colour target, readback and vertex buffers. */
    VkImageCreateInfo ti={.sType=VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO,.imageType=VK_IMAGE_TYPE_2D,.format=VK_FORMAT_R8G8B8A8_UNORM,.extent={W,H,1},.mipLevels=1,.arrayLayers=1,.samples=VK_SAMPLE_COUNT_1_BIT,
        .tiling=VK_IMAGE_TILING_OPTIMAL,.usage=VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT|VK_IMAGE_USAGE_TRANSFER_SRC_BIT,.sharingMode=VK_SHARING_MODE_EXCLUSIVE};
    CHECK(vkCreateImage(device,&ti,NULL,&color_image)==VK_SUCCESS);VkMemoryRequirements mr;vkGetImageMemoryRequirements(device,color_image,&mr);CHECK(mr.size==PIXELS&&mr.memoryTypeBits==1);
    VkMemoryAllocateInfo ai={.sType=VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO,.allocationSize=mr.size};CHECK(vkAllocateMemory(device,&ai,NULL,&image_mem)==VK_SUCCESS);CHECK(vkBindImageMemory(device,color_image,image_mem,0)==VK_SUCCESS);
    VkImageViewCreateInfo vi={.sType=VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO,.image=color_image,.viewType=VK_IMAGE_VIEW_TYPE_2D,.format=VK_FORMAT_R8G8B8A8_UNORM,.subresourceRange={VK_IMAGE_ASPECT_COLOR_BIT,0,1,0,1}};
    CHECK(vkCreateImageView(device,&vi,NULL,&color_view)==VK_SUCCESS);
    VkBufferCreateInfo bi={.sType=VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO,.size=PIXELS+16,.usage=VK_BUFFER_USAGE_TRANSFER_DST_BIT,.sharingMode=VK_SHARING_MODE_EXCLUSIVE};CHECK(vkCreateBuffer(device,&bi,NULL,&readback)==VK_SUCCESS);
    vkGetBufferMemoryRequirements(device,readback,&mr);CHECK(mr.size==PIXELS+16&&mr.memoryTypeBits==2);ai.allocationSize=TOTAL;ai.memoryTypeIndex=1;CHECK(vkAllocateMemory(device,&ai,NULL,&read_mem)==VK_SUCCESS);
    CHECK(vkBindBufferMemory(device,readback,read_mem,0)==VK_SUCCESS);CHECK(vkMapMemory(device,read_mem,0,VK_WHOLE_SIZE,0,(void**)&mapped)==VK_SUCCESS);
    /* Vertex buffer, stride 28 (vec3 position, vec4 colour): A z=0.25 red, B z=0.75 blue, B at z=0.25. */
    float verts[18][7];
    quad(verts[0],-1,-1,0.5f,0.5f,0.25f,RED);quad(verts[6],-0.5f,-1,1,0.5f,0.75f,BLUE);quad(verts[12],-0.5f,-1,1,0.5f,0.25f,BLUE);
    bi.size=sizeof(verts);bi.usage=VK_BUFFER_USAGE_VERTEX_BUFFER_BIT;CHECK(vkCreateBuffer(device,&bi,NULL,&vertices)==VK_SUCCESS);
    ai.allocationSize=sizeof(verts);CHECK(vkAllocateMemory(device,&ai,NULL,&vertex_mem)==VK_SUCCESS);CHECK(vkBindBufferMemory(device,vertices,vertex_mem,0)==VK_SUCCESS);
    CHECK(vkMapMemory(device,vertex_mem,0,VK_WHOLE_SIZE,0,(void**)&vmap)==VK_SUCCESS);memcpy(vmap,verts,sizeof(verts));
    VkPipelineLayoutCreateInfo pli={.sType=VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO};CHECK(vkCreatePipelineLayout(device,&pli,NULL,&playout)==VK_SUCCESS);
    {
        VkShaderModuleCreateInfo si={.sType=VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO,.codeSize=sizeof(shader_depth_vert),.pCode=(const uint32_t*)shader_depth_vert};
        uint32_t *copy=malloc(sizeof(shader_depth_vert));CHECK(copy);memcpy(copy,shader_depth_vert,sizeof(shader_depth_vert));si.pCode=copy;
        VkResult r=vkCreateShaderModule(device,&si,NULL,&vs_module);free(copy);CHECK(r==VK_SUCCESS);
        copy=malloc(sizeof(shader_depth_frag));CHECK(copy);memcpy(copy,shader_depth_frag,sizeof(shader_depth_frag));si.pCode=copy;si.codeSize=sizeof(shader_depth_frag);
        r=vkCreateShaderModule(device,&si,NULL,&fs_module);free(copy);CHECK(r==VK_SUCCESS);
    }
    CHECK(make_pass(0,0,0,NORMAL,&cpass)==VK_SUCCESS);CHECK(graphics_pipeline(cpass,NULL,0,&cpipe)==VK_SUCCESS);
    VkCommandPoolCreateInfo cpi={.sType=VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO,.flags=VK_COMMAND_POOL_CREATE_RESET_COMMAND_BUFFER_BIT};CHECK(vkCreateCommandPool(device,&cpi,NULL,&cpool)==VK_SUCCESS);
    VkCommandBufferAllocateInfo cai={.sType=VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO,.commandPool=cpool,.level=VK_COMMAND_BUFFER_LEVEL_PRIMARY,.commandBufferCount=1};CHECK(vkAllocateCommandBuffers(device,&cai,&cb)==VK_SUCCESS);
    CHECK(phase(VK_FORMAT_D32_SFLOAT,"d32-sfloat",0));
    CHECK(phase(VK_FORMAT_D16_UNORM,"d16-unorm",100));
    printf("GUEST_VK_DEPTH_FORMATS_PASS formats=2 rounds=30\n");fflush(stdout);
    result=0;
done:
    if(device){
        if(cb)vkFreeCommandBuffers(device,cpool,1,&cb);if(cpool)vkDestroyCommandPool(device,cpool,NULL);
        if(cpipe)vkDestroyPipeline(device,cpipe,NULL);if(cpass)vkDestroyRenderPass(device,cpass,NULL);
        if(vs_module)vkDestroyShaderModule(device,vs_module,NULL);if(fs_module)vkDestroyShaderModule(device,fs_module,NULL);if(playout)vkDestroyPipelineLayout(device,playout,NULL);
        if(vmap)vkUnmapMemory(device,vertex_mem);if(vertices)vkDestroyBuffer(device,vertices,NULL);if(vertex_mem)vkFreeMemory(device,vertex_mem,NULL);
        if(mapped)vkUnmapMemory(device,read_mem);if(readback)vkDestroyBuffer(device,readback,NULL);if(read_mem)vkFreeMemory(device,read_mem,NULL);
        if(color_view)vkDestroyImageView(device,color_view,NULL);if(color_image)vkDestroyImage(device,color_image,NULL);if(image_mem)vkFreeMemory(device,image_mem,NULL);vkDestroyDevice(device,NULL);
    }
    if(instance)vkDestroyInstance(instance,NULL);
    printf("GUEST_VK_DEPTH_EXIT status=%d checks=%u\n",result,checks);fflush(stdout);alarm(0);return result;
}
