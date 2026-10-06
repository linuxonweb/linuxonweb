/* Genuine standalone public-Vulkan pixel fixture. Expected geometry and colors
 * are calculated from Vulkan strip semantics, not from the ICD lowering helper.
 * No transport/GL probes are faked; zero backend/guest acceptance until run. */
#define _POSIX_C_SOURCE 200809L
#include <vulkan/vulkan.h>
#include <stdint.h>
#include <math.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include "shaders.h"
#define W 64
#define H 64
#define PIXELS (W*H*4)
#define TAIL 32
#define VERTEX_BYTES 400000u
#define INDEX_BYTES 20000u
static unsigned checks;
#define CHECK(c) do{checks++;if(!(c)){fprintf(stderr,"GUEST_VK_STRIP_FAIL line=%d check=%s\n",__LINE__,#c);goto done;}}while(0)
static VkInstance instance;static VkDevice d;static VkQueue queue;static VkCommandPool pool;static VkCommandBuffer cb;
static VkImage image;static VkImageView view;static VkDeviceMemory image_mem,read_mem,vertex_mem,index_mem;
static VkBuffer readback,vertices,indices;static unsigned char *read_map,*vertex_map,*index_map;
static VkRenderPass pass;static VkFramebuffer framebuffer;static VkPipelineLayout layout;static VkPipeline pipeline;
static VkShaderModule vert,frag,index_vert;
static VkImageLayout image_layout=VK_IMAGE_LAYOUT_UNDEFINED;
static const unsigned char background[4]={31,63,127,64};
static const float small_positions[6][2]={{-.8f,-.7f},{-.8f,.7f},{0,-.7f},{0,.7f},{.8f,-.7f},{.8f,.7f}};
static const unsigned char small_colors[6][3]={{255,0,0},{0,255,0},{0,0,255},{255,255,0},{255,0,255},{0,255,255}};
static void deadline(int n){(void)n;_exit(124);}
static void source_vertex(unsigned count,unsigned k,double *x,double *y,unsigned char color[3]){
    if(count<4097){*x=small_positions[k][0];*y=small_positions[k][1];memcpy(color,small_colors[k],3);return;}
    unsigned column=k/2,band=column/512;if(band>3)band=3;
    static const unsigned char colors[4][3]={{255,0,0},{0,255,0},{0,0,255},{255,255,0}};
    memcpy(color,colors[band],3);*x=-.8+1.6*column/2048;*y=k%2?.7:-.7;
}
static void upload_vertices(unsigned count,unsigned reverse){
    memset(vertex_map,0,VERTEX_BYTES);memset(index_map,0,INDEX_BYTES);
    for(unsigned k=0;k<count;k++){double x,y;unsigned char color[3];source_vertex(count,k,&x,&y,color);
        float v[5]={(float)x,(float)y,color[0]/255.f,color[1]/255.f,color[2]/255.f};memcpy(vertex_map+4+(k+2)*20,v,20);}
    (void)reverse;
}
static int pixels(unsigned count,unsigned fan,unsigned mask,unsigned reverse,unsigned cull,unsigned front,unsigned round){
    unsigned inside=0,outside=0;
    for(unsigned y=0;y<H;y++)for(unsigned x=0;x<W;x++){
        double px=2.0*(x+.5)/W-1,py=2.0*(y+.5)/H-1;int near=0,covered=0;unsigned char color[3]={0};
        if(count>=4097){
            near=fabs(fabs(px)-.8)<.03||fabs(fabs(py)-.7)<.03;
            covered=fabs(px)<.77&&fabs(py)<.67;
            /* Four geometric bands occupy distinct ring pieces. A missing,
             * repeated or parity-flipped piece changes actual sampled colors. */
            unsigned band=px<-.4?0:px<0?1:px<.4?2:3;
            static const unsigned char bands[4][3]={{255,0,0},{0,255,0},{0,0,255},{255,255,0}};memcpy(color,bands[band],3);
        }
        else for(unsigned t=0;t<(fan?count-2:count/3);t++){
            unsigned ids[3]={t,t+(t%2?2:1),t+(t%2?1:2)};
            if(reverse)for(unsigned k=0;k<3;k++)ids[k]=count-1-ids[k];
            double p[3][2];unsigned char c[3][3];for(unsigned k=0;k<3;k++)source_vertex(count,ids[k],&p[k][0],&p[k][1],c[k]);
            double area=(p[1][0]-p[0][0])*(p[2][1]-p[0][1])-(p[1][1]-p[0][1])*(p[2][0]-p[0][0]);
            /* Vulkan framebuffer area is -1/2 of this cross product for the
             * positive viewport above; zero area is always back-facing. */
            double framebuffer_area=-0.5*area;
            int facing=front==VK_FRONT_FACE_COUNTER_CLOCKWISE?framebuffer_area>0:framebuffer_area<0;
            if((cull==VK_CULL_MODE_FRONT_BIT&&facing)||(cull==VK_CULL_MODE_BACK_BIT&&!facing))continue;
            double a=((p[1][1]-p[2][1])*(px-p[2][0])+(p[2][0]-p[1][0])*(py-p[2][1]))/area;
            double b=((p[2][1]-p[0][1])*(px-p[2][0])+(p[0][0]-p[2][0])*(py-p[2][1]))/area;
            double m=fmin(a,fmin(b,1-a-b));if(fabs(m)<.035)near=1;
            if(m>=.035){covered=1;memcpy(color,c[0],3);} /* Vulkan FIRST provoking vertex. */
        }
        if(near)continue;unsigned char expected[4];memcpy(expected,background,4);
        if(covered){inside++;for(unsigned k=0;k<4;k++)if(mask&(1u<<k))expected[k]=k==3?255:color[k];}else outside++;
        for(unsigned k=0;k<4;k++){checks++;if(abs((int)read_map[(y*W+x)*4+k]-expected[k])>1){fprintf(stderr,"GUEST_VK_STRIP_PIXEL_FAIL round=%u x=%u y=%u component=%u actual=%u expected=%u\n",round,x,y,k,read_map[(y*W+x)*4+k],expected[k]);return 0;}}
    }
    for(unsigned i=PIXELS;i<PIXELS+TAIL;i++){checks++;if(read_map[i]!=0xa5)return 0;}
    printf("GUEST_VK_STRIP_PIXELS_PASS round=%u count=%u strip=%u mask=%u reverse=%u cull=%u front=%u inside=%u outside=%u alphaPreload=64 flatFirst=1 largeBands=4\n",round,count,fan,mask,reverse,cull,front,inside,outside);fflush(stdout);
    return outside>100&&(inside>30||cull);
}
static VkResult make_shader(const uint32_t *bytes,size_t size,VkShaderModule *out){
    VkShaderModuleCreateInfo i={.sType=VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO,.codeSize=size,.pCode=bytes};return vkCreateShaderModule(d,&i,NULL,out);
}
static VkResult make_pipeline(unsigned fan,unsigned mask,unsigned cull,unsigned front,VkShaderModule vs,unsigned restart){
    VkPipelineShaderStageCreateInfo stages[2]={{.sType=VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO,.stage=VK_SHADER_STAGE_VERTEX_BIT,.module=vs,.pName="main"},{.sType=VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO,.stage=VK_SHADER_STAGE_FRAGMENT_BIT,.module=frag,.pName="main"}};
    VkVertexInputBindingDescription binding={0,20,VK_VERTEX_INPUT_RATE_VERTEX};VkVertexInputAttributeDescription attrs[2]={{0,0,VK_FORMAT_R32G32_SFLOAT,0},{1,0,VK_FORMAT_R32G32B32_SFLOAT,8}};
    VkPipelineVertexInputStateCreateInfo input={.sType=VK_STRUCTURE_TYPE_PIPELINE_VERTEX_INPUT_STATE_CREATE_INFO,.vertexBindingDescriptionCount=1,.pVertexBindingDescriptions=&binding,.vertexAttributeDescriptionCount=2,.pVertexAttributeDescriptions=attrs};
    VkPipelineInputAssemblyStateCreateInfo assembly={.sType=VK_STRUCTURE_TYPE_PIPELINE_INPUT_ASSEMBLY_STATE_CREATE_INFO,.topology=fan?VK_PRIMITIVE_TOPOLOGY_TRIANGLE_STRIP:VK_PRIMITIVE_TOPOLOGY_TRIANGLE_LIST,.primitiveRestartEnable=restart};
    VkViewport viewport={0,0,W,H,0,1};VkRect2D scissor={{0,0},{W,H}};VkPipelineViewportStateCreateInfo vp={.sType=VK_STRUCTURE_TYPE_PIPELINE_VIEWPORT_STATE_CREATE_INFO,.viewportCount=1,.pViewports=&viewport,.scissorCount=1,.pScissors=&scissor};
    VkPipelineRasterizationStateCreateInfo raster={.sType=VK_STRUCTURE_TYPE_PIPELINE_RASTERIZATION_STATE_CREATE_INFO,.polygonMode=VK_POLYGON_MODE_FILL,.cullMode=cull,.frontFace=front,.lineWidth=1};
    VkPipelineMultisampleStateCreateInfo samples={.sType=VK_STRUCTURE_TYPE_PIPELINE_MULTISAMPLE_STATE_CREATE_INFO,.rasterizationSamples=VK_SAMPLE_COUNT_1_BIT};
    VkPipelineColorBlendAttachmentState attachment={.colorWriteMask=mask};VkPipelineColorBlendStateCreateInfo blend={.sType=VK_STRUCTURE_TYPE_PIPELINE_COLOR_BLEND_STATE_CREATE_INFO,.attachmentCount=1,.pAttachments=&attachment};
    VkGraphicsPipelineCreateInfo info={.sType=VK_STRUCTURE_TYPE_GRAPHICS_PIPELINE_CREATE_INFO,.stageCount=2,.pStages=stages,.pVertexInputState=&input,.pInputAssemblyState=&assembly,.pViewportState=&vp,.pRasterizationState=&raster,.pMultisampleState=&samples,.pColorBlendState=&blend,.layout=layout,.renderPass=pass,.basePipelineIndex=-1};
    return vkCreateGraphicsPipelines(d,VK_NULL_HANDLE,1,&info,NULL,&pipeline);
}
static void barrier(VkImageLayout old,VkImageLayout next){
    VkImageMemoryBarrier b={.sType=VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER,.oldLayout=old,.newLayout=next,.image=image,.srcQueueFamilyIndex=VK_QUEUE_FAMILY_IGNORED,.dstQueueFamilyIndex=VK_QUEUE_FAMILY_IGNORED,.subresourceRange={VK_IMAGE_ASPECT_COLOR_BIT,0,1,0,1}};
    VkPipelineStageFlags src=VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT,dst=VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT;b.dstAccessMask=VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT;
    if(old==VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL){src=VK_PIPELINE_STAGE_TRANSFER_BIT;b.srcAccessMask=VK_ACCESS_TRANSFER_READ_BIT;}
    if(next==VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL){src=VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT;dst=VK_PIPELINE_STAGE_TRANSFER_BIT;b.srcAccessMask=VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT;b.dstAccessMask=VK_ACCESS_TRANSFER_READ_BIT;}
    vkCmdPipelineBarrier(cb,src,dst,0,0,NULL,0,NULL,1,&b);
}
static VkResult frame(unsigned count,unsigned indexed,int32_t vertex_offset,unsigned invalid){
    VkCommandBufferBeginInfo bi={.sType=VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO};if(vkResetCommandBuffer(cb,0)||vkBeginCommandBuffer(cb,&bi))return VK_ERROR_INITIALIZATION_FAILED;
    barrier(image_layout,VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL);VkClearValue color;for(unsigned k=0;k<4;k++)color.color.float32[k]=background[k]/255.f;
    VkRenderPassBeginInfo begin={.sType=VK_STRUCTURE_TYPE_RENDER_PASS_BEGIN_INFO,.renderPass=pass,.framebuffer=framebuffer,.renderArea={{0,0},{W,H}},.clearValueCount=1,.pClearValues=&color};
    vkCmdBeginRenderPass(cb,&begin,VK_SUBPASS_CONTENTS_INLINE);vkCmdBindPipeline(cb,VK_PIPELINE_BIND_POINT_GRAPHICS,pipeline);VkDeviceSize offset=4;vkCmdBindVertexBuffers(cb,0,1,&vertices,&offset);
    if(indexed){vkCmdBindIndexBuffer(cb,indices,8,indexed==1?VK_INDEX_TYPE_UINT16:indexed==3?VK_INDEX_TYPE_UINT8_EXT:VK_INDEX_TYPE_UINT32);vkCmdDrawIndexed(cb,count,1,2,vertex_offset,0);}else vkCmdDraw(cb,count,1,2,0);
    vkCmdEndRenderPass(cb);barrier(VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL,VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL);
    VkBufferImageCopy copy={.imageSubresource={VK_IMAGE_ASPECT_COLOR_BIT,0,0,1},.imageExtent={W,H,1}};vkCmdCopyImageToBuffer(cb,image,VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL,readback,1,&copy);
    VkBufferMemoryBarrier mb={.sType=VK_STRUCTURE_TYPE_BUFFER_MEMORY_BARRIER,.srcAccessMask=VK_ACCESS_TRANSFER_WRITE_BIT,.dstAccessMask=VK_ACCESS_HOST_READ_BIT,.srcQueueFamilyIndex=VK_QUEUE_FAMILY_IGNORED,.dstQueueFamilyIndex=VK_QUEUE_FAMILY_IGNORED,.buffer=readback,.size=VK_WHOLE_SIZE};
    vkCmdPipelineBarrier(cb,VK_PIPELINE_STAGE_TRANSFER_BIT,VK_PIPELINE_STAGE_HOST_BIT,0,0,NULL,1,&mb,0,NULL);
    if(vkEndCommandBuffer(cb)!=VK_SUCCESS)return VK_ERROR_INITIALIZATION_FAILED;VkSubmitInfo submit={.sType=VK_STRUCTURE_TYPE_SUBMIT_INFO,.commandBufferCount=1,.pCommandBuffers=&cb};
    if(!invalid)memset(read_map,0xa5,PIXELS+TAIL);VkResult result=vkQueueSubmit(queue,1,&submit,VK_NULL_HANDLE);
    if(result==VK_SUCCESS)image_layout=VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL;return result;
}
static VkResult copy_only(void){
    VkCommandBufferBeginInfo bi={.sType=VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO};if(vkResetCommandBuffer(cb,0)||vkBeginCommandBuffer(cb,&bi))return VK_ERROR_INITIALIZATION_FAILED;
    VkBufferImageCopy copy={.imageSubresource={VK_IMAGE_ASPECT_COLOR_BIT,0,0,1},.imageExtent={W,H,1}};vkCmdCopyImageToBuffer(cb,image,VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL,readback,1,&copy);
    VkBufferMemoryBarrier mb={.sType=VK_STRUCTURE_TYPE_BUFFER_MEMORY_BARRIER,.srcAccessMask=VK_ACCESS_TRANSFER_WRITE_BIT,.dstAccessMask=VK_ACCESS_HOST_READ_BIT,.srcQueueFamilyIndex=VK_QUEUE_FAMILY_IGNORED,.dstQueueFamilyIndex=VK_QUEUE_FAMILY_IGNORED,.buffer=readback,.size=VK_WHOLE_SIZE};
    vkCmdPipelineBarrier(cb,VK_PIPELINE_STAGE_TRANSFER_BIT,VK_PIPELINE_STAGE_HOST_BIT,0,0,NULL,1,&mb,0,NULL);
    if(vkEndCommandBuffer(cb)!=VK_SUCCESS)return VK_ERROR_INITIALIZATION_FAILED;VkSubmitInfo submit={.sType=VK_STRUCTURE_TYPE_SUBMIT_INFO,.commandBufferCount=1,.pCommandBuffers=&cb};return vkQueueSubmit(queue,1,&submit,VK_NULL_HANDLE);
}
static int buffer(VkBufferUsageFlags usage,unsigned size,VkBuffer *out,VkDeviceMemory *mem,unsigned char **map){
    VkBufferCreateInfo b={.sType=VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO,.size=size,.usage=usage,.sharingMode=VK_SHARING_MODE_EXCLUSIVE};if(vkCreateBuffer(d,&b,NULL,out))return 0;
    VkMemoryRequirements mr;vkGetBufferMemoryRequirements(d,*out,&mr);VkMemoryAllocateInfo a={.sType=VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO,.allocationSize=mr.size+TAIL,.memoryTypeIndex=1};
    return vkAllocateMemory(d,&a,NULL,mem)==VK_SUCCESS&&vkBindBufferMemory(d,*out,*mem,0)==VK_SUCCESS&&vkMapMemory(d,*mem,0,VK_WHOLE_SIZE,0,(void **)map)==VK_SUCCESS;
}
int main(int argc,char **argv){
    int result=1;struct sigaction action={0};action.sa_handler=deadline;sigemptyset(&action.sa_mask);if(sigaction(SIGALRM,&action,NULL))return 2;alarm(110);signal(SIGPIPE,SIG_IGN);
    puts("GUEST_VK_STRIP_SCOPE public Vulkan; genuine shared Rust backend required; no Firefox acceptance");
    VkApplicationInfo app={.sType=VK_STRUCTURE_TYPE_APPLICATION_INFO,.apiVersion=VK_API_VERSION_1_1,.pApplicationName="strip-lowering-profile1"};VkInstanceCreateInfo ii={.sType=VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO,.pApplicationInfo=&app};CHECK(vkCreateInstance(&ii,NULL,&instance)==VK_SUCCESS);
    VkPhysicalDevice physical;uint32_t n=1;CHECK(vkEnumeratePhysicalDevices(instance,&n,&physical)==VK_SUCCESS&&n==1);
    float priority=1;VkDeviceQueueCreateInfo qi={.sType=VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO,.queueCount=1,.pQueuePriorities=&priority};VkDeviceCreateInfo di={.sType=VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO,.queueCreateInfoCount=1,.pQueueCreateInfos=&qi};CHECK(vkCreateDevice(physical,&di,NULL,&d)==VK_SUCCESS);vkGetDeviceQueue(d,0,0,&queue);
    VkImageCreateInfo im={.sType=VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO,.imageType=VK_IMAGE_TYPE_2D,.format=VK_FORMAT_R8G8B8A8_UNORM,.extent={W,H,1},.mipLevels=1,.arrayLayers=1,.samples=VK_SAMPLE_COUNT_1_BIT,.tiling=VK_IMAGE_TILING_OPTIMAL,.usage=VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT|VK_IMAGE_USAGE_TRANSFER_SRC_BIT,.sharingMode=VK_SHARING_MODE_EXCLUSIVE};CHECK(vkCreateImage(d,&im,NULL,&image)==VK_SUCCESS);
    VkMemoryRequirements mr;vkGetImageMemoryRequirements(d,image,&mr);VkMemoryAllocateInfo ai={.sType=VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO,.allocationSize=mr.size};CHECK(vkAllocateMemory(d,&ai,NULL,&image_mem)==VK_SUCCESS);CHECK(vkBindImageMemory(d,image,image_mem,0)==VK_SUCCESS);
    VkImageViewCreateInfo vi={.sType=VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO,.image=image,.viewType=VK_IMAGE_VIEW_TYPE_2D,.format=VK_FORMAT_R8G8B8A8_UNORM,.subresourceRange={VK_IMAGE_ASPECT_COLOR_BIT,0,1,0,1}};CHECK(vkCreateImageView(d,&vi,NULL,&view)==VK_SUCCESS);
    CHECK(buffer(VK_BUFFER_USAGE_TRANSFER_DST_BIT,PIXELS,&readback,&read_mem,&read_map));CHECK(buffer(VK_BUFFER_USAGE_VERTEX_BUFFER_BIT,VERTEX_BYTES,&vertices,&vertex_mem,&vertex_map));CHECK(buffer(VK_BUFFER_USAGE_INDEX_BUFFER_BIT,INDEX_BYTES,&indices,&index_mem,&index_map));
    VkAttachmentDescription attachment={.format=VK_FORMAT_R8G8B8A8_UNORM,.samples=VK_SAMPLE_COUNT_1_BIT,.loadOp=VK_ATTACHMENT_LOAD_OP_CLEAR,.storeOp=VK_ATTACHMENT_STORE_OP_STORE,.stencilLoadOp=VK_ATTACHMENT_LOAD_OP_DONT_CARE,.stencilStoreOp=VK_ATTACHMENT_STORE_OP_DONT_CARE,.initialLayout=VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL,.finalLayout=VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL};
    VkAttachmentReference ref={0,VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL};VkSubpassDescription subpass={.pipelineBindPoint=VK_PIPELINE_BIND_POINT_GRAPHICS,.colorAttachmentCount=1,.pColorAttachments=&ref};VkRenderPassCreateInfo rp={.sType=VK_STRUCTURE_TYPE_RENDER_PASS_CREATE_INFO,.attachmentCount=1,.pAttachments=&attachment,.subpassCount=1,.pSubpasses=&subpass};CHECK(vkCreateRenderPass(d,&rp,NULL,&pass)==VK_SUCCESS);
    VkFramebufferCreateInfo fb={.sType=VK_STRUCTURE_TYPE_FRAMEBUFFER_CREATE_INFO,.renderPass=pass,.attachmentCount=1,.pAttachments=&view,.width=W,.height=H,.layers=1};CHECK(vkCreateFramebuffer(d,&fb,NULL,&framebuffer)==VK_SUCCESS);
    VkCommandPoolCreateInfo pc={.sType=VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO,.flags=VK_COMMAND_POOL_CREATE_RESET_COMMAND_BUFFER_BIT};CHECK(vkCreateCommandPool(d,&pc,NULL,&pool)==VK_SUCCESS);
    VkCommandBufferAllocateInfo ca={.sType=VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO,.commandPool=pool,.level=VK_COMMAND_BUFFER_LEVEL_PRIMARY,.commandBufferCount=1};CHECK(vkAllocateCommandBuffers(d,&ca,&cb)==VK_SUCCESS);
    VkPipelineLayoutCreateInfo pli={.sType=VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO};CHECK(vkCreatePipelineLayout(d,&pli,NULL,&layout)==VK_SUCCESS);CHECK(make_shader(shader_flat_vert,sizeof(shader_flat_vert),&vert)==VK_SUCCESS);CHECK(make_shader(shader_flat_frag,sizeof(shader_flat_frag),&frag)==VK_SUCCESS);CHECK(make_shader(shader_index_vert,sizeof(shader_index_vert),&index_vert)==VK_SUCCESS);
    if(argc>1&&!strcmp(argv[1],"--historical-host-negative")){CHECK(make_pipeline(1,15,0,0,vert,0)==VK_ERROR_FEATURE_NOT_PRESENT&&!pipeline);CHECK(make_pipeline(0,7,0,0,vert,0)==VK_ERROR_FEATURE_NOT_PRESENT&&!pipeline);puts("GUEST_VK_STRIP_OLD_HOST_REJECT_PASS");result=0;goto done;}
    CHECK(make_pipeline(1,16,0,0,vert,0)==VK_ERROR_FEATURE_NOT_PRESENT&&!pipeline);CHECK(make_pipeline(1,15,0,0,vert,1)==VK_ERROR_FEATURE_NOT_PRESENT&&!pipeline);CHECK(make_pipeline(1,15,0,0,index_vert,0)==VK_ERROR_FEATURE_NOT_PRESENT&&!pipeline);
    for(unsigned round=0;round<24;round++){
        unsigned fan=1,count=round>=21?4098:6,indexed=round>=21?round-21:round%3;
        unsigned mask=round%4==0?0:round%4==1?7:round%4==2?8:15,reverse=round>=15&&round<21&&indexed;
        unsigned cull=round>=9&&round<21?(round%2?VK_CULL_MODE_FRONT_BIT:VK_CULL_MODE_BACK_BIT):VK_CULL_MODE_NONE;
        unsigned front=round>=12&&round<21?VK_FRONT_FACE_CLOCKWISE:VK_FRONT_FACE_COUNTER_CLOCKWISE;
        if(round==0)mask=15;
        upload_vertices(count,reverse);int32_t vo=indexed==1?-3:indexed==2?2:0;
        for(unsigned k=0;k<count;k++){uint32_t ordinal=reverse?count-1-k:k,index=(uint32_t)((int64_t)ordinal+2-vo);if(indexed==1){uint16_t q=(uint16_t)index;memcpy(index_map+8+(2+k)*2,&q,2);}else memcpy(index_map+8+(2+k)*4,&index,4);}
        CHECK(make_pipeline(fan,mask,cull,front,vert,0)==VK_SUCCESS);CHECK(frame(count,indexed,vo,0)==VK_SUCCESS);CHECK(vkQueueWaitIdle(queue)==VK_SUCCESS);CHECK(pixels(count,fan,mask,reverse,cull,front,round));
        unsigned char saved[PIXELS+TAIL];memcpy(saved,read_map,sizeof(saved));
        if(indexed){unsigned size=indexed==1?2:4;memset(index_map+8+(2+count-1)*size,0xff,size);CHECK(frame(count,indexed,vo,1)==VK_ERROR_INITIALIZATION_FAILED);CHECK(!memcmp(saved,read_map,sizeof(saved)));}
        else {CHECK(frame(round==21?10000:65536,0,0,1)==VK_ERROR_INITIALIZATION_FAILED);CHECK(!memcmp(saved,read_map,sizeof(saved)));}
        CHECK(copy_only()==VK_SUCCESS);CHECK(!memcmp(saved,read_map,sizeof(saved)));
        if(round==0){vkDestroyPipeline(d,pipeline,NULL);CHECK(frame(count,0,0,1)==VK_ERROR_INITIALIZATION_FAILED);pipeline=VK_NULL_HANDLE;}
        else{CHECK(frame(count,3,0,1)==VK_ERROR_INITIALIZATION_FAILED);}
        CHECK(!memcmp(saved,read_map,sizeof(saved)));
        CHECK(copy_only()==VK_SUCCESS);CHECK(!memcmp(saved,read_map,sizeof(saved)));
        CHECK(vkResetCommandBuffer(cb,0)==VK_SUCCESS);if(pipeline)vkDestroyPipeline(d,pipeline,NULL);pipeline=VK_NULL_HANDLE;
        printf("GUEST_VK_STRIP_ROUND_PASS round=%u indexed=%u vertexOffset=%d rejectsPreserveReadback=1\n",round,indexed,vo);fflush(stdout);
    }
    {VkResult ir=make_pipeline(1,15,0,0,index_vert,0);
        if(ir==VK_SUCCESS){upload_vertices(3,0);CHECK(frame(3,2,0,1)==VK_ERROR_INITIALIZATION_FAILED);vkDestroyPipeline(d,pipeline,NULL);pipeline=VK_NULL_HANDLE;puts("GUEST_VK_STRIP_VERTEX_INDEX_LIMIT indexedDrawRejected=1");}
        else{CHECK(ir==VK_ERROR_FEATURE_NOT_PRESENT&&!pipeline);puts("GUEST_VK_STRIP_VERTEX_INDEX_LIMIT flatGlPipelineRejected=1");}}
    result=0;
    if(argc>1&&!strcmp(argv[1],"--normal-exit-cleanup")){
        /* Leave actual device/resources live for the PID-bound libc callback.
         * Acceptance must join its real GPU_CLOSE and host closed report. */
        printf("GUEST_VK_STRIP_NORMAL_EXIT status=0 checks=%u explicitDestroy=0\n",checks);fflush(stdout);alarm(0);return 0;
    }
done:
    if(d){if(cb)vkFreeCommandBuffers(d,pool,1,&cb);if(pool)vkDestroyCommandPool(d,pool,NULL);if(pipeline)vkDestroyPipeline(d,pipeline,NULL);if(framebuffer)vkDestroyFramebuffer(d,framebuffer,NULL);if(pass)vkDestroyRenderPass(d,pass,NULL);if(layout)vkDestroyPipelineLayout(d,layout,NULL);if(vert)vkDestroyShaderModule(d,vert,NULL);if(frag)vkDestroyShaderModule(d,frag,NULL);if(index_vert)vkDestroyShaderModule(d,index_vert,NULL);
        if(vertex_map)vkUnmapMemory(d,vertex_mem);if(index_map)vkUnmapMemory(d,index_mem);if(read_map)vkUnmapMemory(d,read_mem);if(vertices)vkDestroyBuffer(d,vertices,NULL);if(indices)vkDestroyBuffer(d,indices,NULL);if(readback)vkDestroyBuffer(d,readback,NULL);if(vertex_mem)vkFreeMemory(d,vertex_mem,NULL);if(index_mem)vkFreeMemory(d,index_mem,NULL);if(read_mem)vkFreeMemory(d,read_mem,NULL);if(view)vkDestroyImageView(d,view,NULL);if(image)vkDestroyImage(d,image,NULL);if(image_mem)vkFreeMemory(d,image_mem,NULL);vkDestroyDevice(d,NULL);}
    if(instance)vkDestroyInstance(instance,NULL);printf("GUEST_VK_STRIP_EXIT status=%d checks=%u\n",result,checks);fflush(stdout);alarm(0);return result;
}
