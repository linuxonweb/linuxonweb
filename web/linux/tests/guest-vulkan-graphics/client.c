/* A separate Vulkan application. Only public Vulkan and POSIX entrypoints. */
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
#ifdef GUEST_PRESENT_X11
#include "presentation-x11.inc"
#endif
static unsigned checks;
#define CHECK(c) do{checks++;if(!(c)){fprintf(stderr,"GUEST_VK_GRAPHICS_FAIL line=%d check=%s\n",__LINE__,#c);goto done;}}while(0)
static void deadline(int n){(void)n;_exit(124);}
static const float positions[3][2]={{-.8f,-.7f},{.2f,-.6f},{-.5f,.6f}};
static const float colors[3][3]={{1,0,0},{0,1,0},{0,0,1}};
static int pixels(const unsigned char *bytes,unsigned vertex,unsigned fragment,unsigned round){
    double t[3][2];unsigned inside=0,outside=0;
    for(unsigned i=0;i<3;i++){double x=positions[i][0],y=positions[i][1];if(vertex){x=x*.5+.25;y=y*.75-.1;}t[i][0]=(x+1)*W/2;t[i][1]=(y+1)*H/2;}
    double ax=t[0][0],ay=t[0][1],bx=t[1][0],by=t[1][1],cx=t[2][0],cy=t[2][1];
    double den=(by-cy)*(ax-cx)+(cx-bx)*(ay-cy);
    for(unsigned y=0;y<H;y++)for(unsigned x=0;x<W;x++){
        double a=((by-cy)*(x+.5-cx)+(cx-bx)*(y+.5-cy))/den,b=((cy-ay)*(x+.5-cx)+(ax-cx)*(y+.5-cy))/den;
        double c=1-a-b,m=fmin(a,fmin(b,c));if(m>-.04&&m<.04)continue;
        int expected[4]={0,255,0,255};if(m>=.04){inside++;expected[0]=(int)lround((fragment?c:a)*255);expected[1]=(int)lround(b*255);expected[2]=(int)lround((fragment?a:c)*255);}else outside++;
        for(unsigned k=0;k<4;k++){checks++;if(abs((int)bytes[(y*W+x)*4+k]-expected[k])>(m>=.04?2:0)){
            fprintf(stderr,"GUEST_VK_GRAPHICS_PIXEL_FAIL round=%u x=%u y=%u component=%u actual=%u expected=%d\n",round,x,y,k,bytes[(y*W+x)*4+k],expected[k]);return 0;}}
    }
    for(unsigned n=PIXELS;n<TOTAL;n++){checks++;if(bytes[n]!=0xa5)return 0;}
    printf("GUEST_VK_GRAPHICS_PIXELS_PASS round=%u vertex=%u fragment=%u inside=%u outside=%u tail=32 width=73 height=51\n",round,vertex,fragment,inside,outside);fflush(stdout);
    return inside>20&&outside>100;
}
static VkResult make_pass(VkDevice d,VkAttachmentLoadOp load,VkRenderPass *out){
    VkAttachmentDescription a={.format=VK_FORMAT_R8G8B8A8_UNORM,.samples=VK_SAMPLE_COUNT_1_BIT,.loadOp=load,.storeOp=VK_ATTACHMENT_STORE_OP_STORE,
        .stencilLoadOp=VK_ATTACHMENT_LOAD_OP_DONT_CARE,.stencilStoreOp=VK_ATTACHMENT_STORE_OP_DONT_CARE,.initialLayout=VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL,.finalLayout=VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL};
    VkAttachmentReference ref={0,VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL};VkSubpassDescription s={.pipelineBindPoint=VK_PIPELINE_BIND_POINT_GRAPHICS,.colorAttachmentCount=1,.pColorAttachments=&ref};
    VkRenderPassCreateInfo info={.sType=VK_STRUCTURE_TYPE_RENDER_PASS_CREATE_INFO,.attachmentCount=1,.pAttachments=&a,.subpassCount=1,.pSubpasses=&s};
    VkResult r=vkCreateRenderPass(d,&info,NULL,out);memset(&a,0xff,sizeof(a));memset(&s,0xff,sizeof(s));return r;
}
static void image_barrier(VkCommandBuffer cb,VkImage image,VkImageLayout old,VkImageLayout next){
    VkImageMemoryBarrier b={.sType=VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER,.oldLayout=old,.newLayout=next,.image=image,
        .srcQueueFamilyIndex=VK_QUEUE_FAMILY_IGNORED,.dstQueueFamilyIndex=VK_QUEUE_FAMILY_IGNORED,.subresourceRange={VK_IMAGE_ASPECT_COLOR_BIT,0,1,0,1}};
    VkPipelineStageFlags src=VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT,dst=VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT;
    if(old==VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL){src=VK_PIPELINE_STAGE_TRANSFER_BIT;b.srcAccessMask=VK_ACCESS_TRANSFER_READ_BIT;}
    if(old==VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL){src=VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT;b.srcAccessMask=VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT;}
    b.dstAccessMask=VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT;
    if(old==next)b.dstAccessMask|=VK_ACCESS_COLOR_ATTACHMENT_READ_BIT;
    if(next==VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL){dst=VK_PIPELINE_STAGE_TRANSFER_BIT;b.dstAccessMask=VK_ACCESS_TRANSFER_READ_BIT;}
    vkCmdPipelineBarrier(cb,src,dst,0,0,NULL,0,NULL,1,&b);memset(&b,0xff,sizeof(b));
}
static void buffer_barrier(VkCommandBuffer cb,VkBuffer buffer,int vertex){
    VkBufferMemoryBarrier b={.sType=VK_STRUCTURE_TYPE_BUFFER_MEMORY_BARRIER,.buffer=buffer,.size=VK_WHOLE_SIZE,
        .srcQueueFamilyIndex=VK_QUEUE_FAMILY_IGNORED,.dstQueueFamilyIndex=VK_QUEUE_FAMILY_IGNORED,
        .srcAccessMask=vertex?VK_ACCESS_HOST_WRITE_BIT:VK_ACCESS_TRANSFER_WRITE_BIT,.dstAccessMask=vertex?VK_ACCESS_VERTEX_ATTRIBUTE_READ_BIT:VK_ACCESS_HOST_READ_BIT};
    vkCmdPipelineBarrier(cb,vertex?VK_PIPELINE_STAGE_HOST_BIT:VK_PIPELINE_STAGE_TRANSFER_BIT,vertex?VK_PIPELINE_STAGE_VERTEX_INPUT_BIT:VK_PIPELINE_STAGE_HOST_BIT,0,0,NULL,1,&b,0,NULL);
}
static VkResult shader(VkDevice d,const unsigned char *bytes,size_t size,VkShaderModule *out){
    uint32_t *copy=malloc(size);if(!copy)return VK_ERROR_OUT_OF_HOST_MEMORY;memcpy(copy,bytes,size);
    VkShaderModuleCreateInfo i={.sType=VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO,.codeSize=size,.pCode=copy};
    VkResult r=vkCreateShaderModule(d,&i,NULL,out);memset(copy,0,size);free(copy);return r;
}
static void record(VkCommandBuffer cb,VkImage image,VkImageLayout old,VkRenderPass clear,VkRenderPass load,VkFramebuffer framebuffer,VkPipeline pipeline,
        VkBuffer vertices[2],unsigned separate,VkBuffer readback,unsigned hostbarrier,unsigned invalid){
    image_barrier(cb,image,old,VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL);
    if(hostbarrier){buffer_barrier(cb,vertices[0],1);if(separate)buffer_barrier(cb,vertices[1],1);}
    VkClearValue color={.color={{0,1,0,1}}};VkRenderPassBeginInfo begin={.sType=VK_STRUCTURE_TYPE_RENDER_PASS_BEGIN_INFO,.renderPass=clear,.framebuffer=framebuffer,.renderArea={{0,0},{W,H}},.clearValueCount=1,.pClearValues=&color};
    vkCmdBeginRenderPass(cb,&begin,VK_SUBPASS_CONTENTS_INLINE);memset(&color,0xff,sizeof(color));memset(&begin,0xff,sizeof(begin));
    vkCmdBindPipeline(cb,VK_PIPELINE_BIND_POINT_GRAPHICS,pipeline);
    VkBuffer v=vertices[0];VkDeviceSize offset=4;vkCmdBindVertexBuffers(cb,separate?7:5,1,&v,&offset);v=VK_NULL_HANDLE;offset=65532;
    if(separate){v=vertices[1];offset=4;vkCmdBindVertexBuffers(cb,2,1,&v,&offset);v=VK_NULL_HANDLE;offset=65532;}
    vkCmdDraw(cb,3,1,0,0);vkCmdDraw(cb,3,1,0,0);vkCmdEndRenderPass(cb);
    image_barrier(cb,image,VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL,VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL);
    begin=(VkRenderPassBeginInfo){.sType=VK_STRUCTURE_TYPE_RENDER_PASS_BEGIN_INFO,.renderPass=load,.framebuffer=framebuffer,.renderArea={{0,0},{W,H}}};
    vkCmdBeginRenderPass(cb,&begin,VK_SUBPASS_CONTENTS_INLINE);vkCmdEndRenderPass(cb);
    image_barrier(cb,image,VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL,VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL);
    VkBufferImageCopy copy={.imageSubresource={VK_IMAGE_ASPECT_COLOR_BIT,0,0,1},.imageExtent={W,H,1}};
    vkCmdCopyImageToBuffer(cb,image,VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL,readback,1,&copy);memset(&copy,0xff,sizeof(copy));
    if(!invalid)buffer_barrier(cb,readback,0);
}
int main(void){
    int result=1;VkInstance instance=VK_NULL_HANDLE;VkDevice device=VK_NULL_HANDLE;VkImage image=VK_NULL_HANDLE;VkDeviceMemory image_mem=VK_NULL_HANDLE;
    VkImageView view=VK_NULL_HANDLE;VkBuffer readback=VK_NULL_HANDLE,vertices[2]={0};VkDeviceMemory read_mem=VK_NULL_HANDLE,vertex_mem[2]={0};
    unsigned char *mapped=NULL,*vertex_map[2]={0};VkShaderModule modules[2]={0};VkPipelineLayout layout=VK_NULL_HANDLE;VkPipeline pipeline=VK_NULL_HANDLE;
    VkRenderPass creation=VK_NULL_HANDLE,clear=VK_NULL_HANDLE,load=VK_NULL_HANDLE;VkFramebuffer framebuffer=VK_NULL_HANDLE;VkCommandPool pool=VK_NULL_HANDLE;VkCommandBuffer cb=VK_NULL_HANDLE;
    struct sigaction action={0};action.sa_handler=deadline;sigemptyset(&action.sa_mask);if(sigaction(SIGALRM,&action,NULL))return 2;alarm(110);signal(SIGPIPE,SIG_IGN);
    puts("GUEST_VK_GRAPHICS_SCOPE public static Khronos loader; application SPIR-V graphics; bounded nonconformant ICD");
#ifdef GUEST_PRESENT_X11
    CHECK(x11_open());
#endif
    VkApplicationInfo app={.sType=VK_STRUCTURE_TYPE_APPLICATION_INFO,.apiVersion=VK_API_VERSION_1_0,.pApplicationName="public-graphics"};VkInstanceCreateInfo ii={.sType=VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO,.pApplicationInfo=&app};
    CHECK(vkCreateInstance(&ii,NULL,&instance)==VK_SUCCESS);uint32_t count=1;VkPhysicalDevice physical;CHECK(vkEnumeratePhysicalDevices(instance,&count,&physical)==VK_SUCCESS&&count==1);
    VkQueueFamilyProperties qp;count=1;vkGetPhysicalDeviceQueueFamilyProperties(physical,&count,&qp);CHECK(qp.queueFlags&VK_QUEUE_GRAPHICS_BIT);
    VkPhysicalDeviceProperties properties;vkGetPhysicalDeviceProperties(physical,&properties);
    const unsigned max_stride=properties.limits.maxVertexInputBindingStride;
    CHECK(max_stride==252||max_stride==2048);CHECK(!(qp.queueFlags&VK_QUEUE_COMPUTE_BIT));
    CHECK(properties.limits.maxVertexInputAttributeOffset==(max_stride==252?244u:2040u));
    printf("GUEST_VK_GRAPHICS_LIMITS max_stride=%u integer_viewport=%u compute=0\n",max_stride,max_stride==252);fflush(stdout);
    VkPhysicalDeviceMemoryProperties mp;vkGetPhysicalDeviceMemoryProperties(physical,&mp);CHECK(mp.memoryTypeCount==2&&(mp.memoryTypes[1].propertyFlags&VK_MEMORY_PROPERTY_HOST_COHERENT_BIT));
    float priority=1;VkDeviceQueueCreateInfo qi={.sType=VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO,.queueCount=1,.pQueuePriorities=&priority};VkDeviceCreateInfo di={.sType=VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO,.queueCreateInfoCount=1,.pQueueCreateInfos=&qi};
    CHECK(vkCreateDevice(physical,&di,NULL,&device)==VK_SUCCESS);VkQueue queue;vkGetDeviceQueue(device,0,0,&queue);CHECK(queue!=VK_NULL_HANDLE);
    CHECK(vkGetDeviceProcAddr(device,"vkCmdDraw")!=NULL&&vkGetDeviceProcAddr(device,"vkGuestUnknown")==NULL);
    VkImageCreateInfo im={.sType=VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO,.imageType=VK_IMAGE_TYPE_2D,.format=VK_FORMAT_R8G8B8A8_UNORM,.extent={W,H,1},.mipLevels=1,.arrayLayers=1,.samples=VK_SAMPLE_COUNT_1_BIT,.tiling=VK_IMAGE_TILING_OPTIMAL,.usage=VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT|VK_IMAGE_USAGE_TRANSFER_SRC_BIT,.sharingMode=VK_SHARING_MODE_EXCLUSIVE};
    CHECK(vkCreateImage(device,&im,NULL,&image)==VK_SUCCESS);VkMemoryRequirements mr;vkGetImageMemoryRequirements(device,image,&mr);CHECK(mr.size==PIXELS&&mr.memoryTypeBits==1);
    VkMemoryAllocateInfo ai={.sType=VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO,.allocationSize=mr.size};CHECK(vkAllocateMemory(device,&ai,NULL,&image_mem)==VK_SUCCESS);CHECK(vkBindImageMemory(device,image,image_mem,0)==VK_SUCCESS);
    VkImageViewCreateInfo vi={.sType=VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO,.image=image,.viewType=VK_IMAGE_VIEW_TYPE_2D,.format=VK_FORMAT_R8G8B8A8_UNORM,.subresourceRange={VK_IMAGE_ASPECT_COLOR_BIT,0,1,0,1}};CHECK(vkCreateImageView(device,&vi,NULL,&view)==VK_SUCCESS);
    VkBufferCreateInfo bi={.sType=VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO,.size=PIXELS+16,.usage=VK_BUFFER_USAGE_TRANSFER_DST_BIT,.sharingMode=VK_SHARING_MODE_EXCLUSIVE};CHECK(vkCreateBuffer(device,&bi,NULL,&readback)==VK_SUCCESS);
    vkGetBufferMemoryRequirements(device,readback,&mr);CHECK(mr.size==PIXELS+16&&mr.memoryTypeBits==2);ai.allocationSize=TOTAL;ai.memoryTypeIndex=1;CHECK(vkAllocateMemory(device,&ai,NULL,&read_mem)==VK_SUCCESS);CHECK(vkBindBufferMemory(device,readback,read_mem,0)==VK_SUCCESS);CHECK(vkMapMemory(device,read_mem,0,VK_WHOLE_SIZE,0,(void**)&mapped)==VK_SUCCESS);
    VkCommandPoolCreateInfo cpi={.sType=VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO,.flags=VK_COMMAND_POOL_CREATE_RESET_COMMAND_BUFFER_BIT};CHECK(vkCreateCommandPool(device,&cpi,NULL,&pool)==VK_SUCCESS);
    VkCommandBufferAllocateInfo cai={.sType=VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO,.commandPool=pool,.level=VK_COMMAND_BUFFER_LEVEL_PRIMARY,.commandBufferCount=1};CHECK(vkAllocateCommandBuffers(device,&cai,&cb)==VK_SUCCESS);
    VkCommandBufferBeginInfo begin={.sType=VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO};VkSubmitInfo submit={.sType=VK_STRUCTURE_TYPE_SUBMIT_INFO,.commandBufferCount=1,.pCommandBuffers=&cb};
    unsigned char bad[20]={0};CHECK(shader(device,bad,sizeof(bad),&modules[0])==VK_ERROR_INITIALIZATION_FAILED&&!modules[0]);
    CHECK(shader(device,shader_resource_frag,sizeof(shader_resource_frag),&modules[0])==VK_ERROR_INITIALIZATION_FAILED&&!modules[0]);CHECK(vkDeviceWaitIdle(device)==VK_SUCCESS);
    for(unsigned round=0;round<8;round++){
        unsigned vertex=round/4,fragment=(round/2)%2,separate=round%2;
        CHECK(make_pass(device,VK_ATTACHMENT_LOAD_OP_CLEAR,&creation)==VK_SUCCESS);
        VkPipelineLayoutCreateInfo pli={.sType=VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO};CHECK(vkCreatePipelineLayout(device,&pli,NULL,&layout)==VK_SUCCESS);
        CHECK(shader(device,vertex?shader_pair_b_vert:shader_pair_a_vert,vertex?sizeof(shader_pair_b_vert):sizeof(shader_pair_a_vert),&modules[0])==VK_SUCCESS);
        CHECK(shader(device,fragment?shader_pair_b_frag:shader_pair_a_frag,fragment?sizeof(shader_pair_b_frag):sizeof(shader_pair_a_frag),&modules[1])==VK_SUCCESS);
        VkPipelineShaderStageCreateInfo stages[2]={{.sType=VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO,.stage=VK_SHADER_STAGE_FRAGMENT_BIT,.module=modules[1],.pName=fragment?"if":"fragment_a"},{.sType=VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO,.stage=VK_SHADER_STAGE_VERTEX_BIT,.module=modules[0],.pName=vertex?"VertexPayload":"vertex.main-a"}};
        VkVertexInputBindingDescription binds[2]={{separate?7:5,separate?8:20,VK_VERTEX_INPUT_RATE_VERTEX},{2,12,VK_VERTEX_INPUT_RATE_VERTEX}};
        VkVertexInputAttributeDescription attrs[2]={{1,separate?2:5,VK_FORMAT_R32G32B32_SFLOAT,separate?0:8},{0,separate?7:5,VK_FORMAT_R32G32_SFLOAT,0}};
        VkPipelineVertexInputStateCreateInfo vin={.sType=VK_STRUCTURE_TYPE_PIPELINE_VERTEX_INPUT_STATE_CREATE_INFO,.vertexBindingDescriptionCount=separate?2:1,.pVertexBindingDescriptions=binds,.vertexAttributeDescriptionCount=2,.pVertexAttributeDescriptions=attrs};
        VkPipelineInputAssemblyStateCreateInfo assembly={.sType=VK_STRUCTURE_TYPE_PIPELINE_INPUT_ASSEMBLY_STATE_CREATE_INFO,.topology=VK_PRIMITIVE_TOPOLOGY_TRIANGLE_LIST};
        VkViewport viewport={0,0,W,H,0,1};VkRect2D scissor={{0,0},{W,H}};VkPipelineViewportStateCreateInfo vs={.sType=VK_STRUCTURE_TYPE_PIPELINE_VIEWPORT_STATE_CREATE_INFO,.viewportCount=1,.pViewports=&viewport,.scissorCount=1,.pScissors=&scissor};
        VkPipelineRasterizationStateCreateInfo rs={.sType=VK_STRUCTURE_TYPE_PIPELINE_RASTERIZATION_STATE_CREATE_INFO,.polygonMode=VK_POLYGON_MODE_FILL,.cullMode=VK_CULL_MODE_NONE,.frontFace=VK_FRONT_FACE_COUNTER_CLOCKWISE,.lineWidth=1};
        VkPipelineMultisampleStateCreateInfo ms={.sType=VK_STRUCTURE_TYPE_PIPELINE_MULTISAMPLE_STATE_CREATE_INFO,.rasterizationSamples=VK_SAMPLE_COUNT_1_BIT};VkPipelineColorBlendAttachmentState attachment={.colorWriteMask=15};VkPipelineColorBlendStateCreateInfo blend={.sType=VK_STRUCTURE_TYPE_PIPELINE_COLOR_BLEND_STATE_CREATE_INFO,.attachmentCount=1,.pAttachments=&attachment};
        VkGraphicsPipelineCreateInfo pi={.sType=VK_STRUCTURE_TYPE_GRAPHICS_PIPELINE_CREATE_INFO,.stageCount=2,.pStages=stages,.pVertexInputState=&vin,.pInputAssemblyState=&assembly,.pViewportState=&vs,.pRasterizationState=&rs,.pMultisampleState=&ms,.pColorBlendState=&blend,.layout=layout,.renderPass=creation,.basePipelineIndex=-1};
        unsigned saved_stride=binds[0].stride;binds[0].stride=max_stride+4;
        CHECK(vkCreateGraphicsPipelines(device,VK_NULL_HANDLE,1,&pi,NULL,&pipeline)==VK_ERROR_FEATURE_NOT_PRESENT&&!pipeline);binds[0].stride=saved_stride;
        if(max_stride==252){viewport.x=0.5f;CHECK(vkCreateGraphicsPipelines(device,VK_NULL_HANDLE,1,&pi,NULL,&pipeline)==VK_ERROR_FEATURE_NOT_PRESENT&&!pipeline);viewport.x=0;}
        CHECK(vkCreateGraphicsPipelines(device,VK_NULL_HANDLE,1,&pi,NULL,&pipeline)==VK_SUCCESS);
        memset(binds,0xff,sizeof(binds));memset(attrs,0xff,sizeof(attrs));memset(stages,0xff,sizeof(stages));memset(&viewport,0xff,sizeof(viewport));memset(&scissor,0xff,sizeof(scissor));
        vkDestroyShaderModule(device,modules[0],NULL);vkDestroyShaderModule(device,modules[1],NULL);modules[0]=modules[1]=VK_NULL_HANDLE;vkDestroyPipelineLayout(device,layout,NULL);layout=VK_NULL_HANDLE;vkDestroyRenderPass(device,creation,NULL);creation=VK_NULL_HANDLE;
        CHECK(make_pass(device,VK_ATTACHMENT_LOAD_OP_CLEAR,&clear)==VK_SUCCESS);CHECK(make_pass(device,VK_ATTACHMENT_LOAD_OP_LOAD,&load)==VK_SUCCESS);
        VkFramebufferCreateInfo fi={.sType=VK_STRUCTURE_TYPE_FRAMEBUFFER_CREATE_INFO,.renderPass=load,.attachmentCount=1,.pAttachments=&view,.width=W,.height=H,.layers=1};CHECK(vkCreateFramebuffer(device,&fi,NULL,&framebuffer)==VK_SUCCESS);
        for(unsigned i=0;i<1+separate;i++){
            bi.size=separate?(i?44:32):68;bi.usage=VK_BUFFER_USAGE_VERTEX_BUFFER_BIT;CHECK(vkCreateBuffer(device,&bi,NULL,&vertices[i])==VK_SUCCESS);ai.allocationSize=bi.size+16;CHECK(vkAllocateMemory(device,&ai,NULL,&vertex_mem[i])==VK_SUCCESS);CHECK(vkBindBufferMemory(device,vertices[i],vertex_mem[i],0)==VK_SUCCESS);CHECK(vkMapMemory(device,vertex_mem[i],0,VK_WHOLE_SIZE,0,(void**)&vertex_map[i])==VK_SUCCESS);memset(vertex_map[i],0,ai.allocationSize);
        }
        CHECK(vkResetCommandBuffer(cb,0)==VK_SUCCESS);CHECK(vkBeginCommandBuffer(cb,&begin)==VK_SUCCESS);
        record(cb,image,round?VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL:VK_IMAGE_LAYOUT_UNDEFINED,clear,load,framebuffer,pipeline,vertices,separate,readback,separate,1);
        CHECK(vkEndCommandBuffer(cb)==VK_SUCCESS);memset(mapped,0xa5,TOTAL);CHECK(vkQueueSubmit(queue,1,&submit,VK_NULL_HANDLE)==VK_ERROR_INITIALIZATION_FAILED);
        for(unsigned n=0;n<TOTAL;n++)CHECK(mapped[n]==0xa5);
        CHECK(vkResetCommandBuffer(cb,0)==VK_SUCCESS);CHECK(vkBeginCommandBuffer(cb,&begin)==VK_SUCCESS);
        record(cb,image,round?VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL:VK_IMAGE_LAYOUT_UNDEFINED,clear,load,framebuffer,pipeline,vertices,separate,readback,separate,0);CHECK(vkEndCommandBuffer(cb)==VK_SUCCESS);
        /* Coherent writes after recording must be observed, even without a HOST barrier. */
        for(unsigned i=0;i<3;i++){if(separate){memcpy(vertex_map[0]+4+i*8,positions[i],8);memcpy(vertex_map[1]+4+i*12,colors[i],12);}else{memcpy(vertex_map[0]+4+i*20,positions[i],8);memcpy(vertex_map[0]+12+i*20,colors[i],12);}}
        CHECK(vkQueueSubmit(queue,1,&submit,VK_NULL_HANDLE)==VK_SUCCESS);CHECK(vkQueueWaitIdle(queue)==VK_SUCCESS);CHECK(pixels(mapped,vertex,fragment,round));
#ifdef GUEST_PRESENT_X11
        CHECK(x11_present(mapped,round));
#endif
        unsigned char saved[TOTAL];memcpy(saved,mapped,TOTAL);
        CHECK(vkResetCommandBuffer(cb,0)==VK_SUCCESS);CHECK(vkBeginCommandBuffer(cb,&begin)==VK_SUCCESS);record(cb,image,VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL,clear,load,framebuffer,pipeline,vertices,separate,readback,0,0);CHECK(vkEndCommandBuffer(cb)==VK_SUCCESS);
        vkDestroyPipeline(device,pipeline,NULL);pipeline=VK_NULL_HANDLE;CHECK(vkQueueSubmit(queue,1,&submit,VK_NULL_HANDLE)==VK_ERROR_INITIALIZATION_FAILED);CHECK(!memcmp(mapped,saved,TOTAL));CHECK(vkDeviceWaitIdle(device)==VK_SUCCESS);CHECK(vkResetCommandBuffer(cb,0)==VK_SUCCESS);
        vkDestroyFramebuffer(device,framebuffer,NULL);framebuffer=VK_NULL_HANDLE;vkDestroyRenderPass(device,clear,NULL);clear=VK_NULL_HANDLE;vkDestroyRenderPass(device,load,NULL);load=VK_NULL_HANDLE;
        for(unsigned i=0;i<1+separate;i++){vkUnmapMemory(device,vertex_mem[i]);vertex_map[i]=NULL;vkDestroyBuffer(device,vertices[i],NULL);vertices[i]=VK_NULL_HANDLE;vkFreeMemory(device,vertex_mem[i],NULL);vertex_mem[i]=VK_NULL_HANDLE;}
        printf("GUEST_VK_GRAPHICS_ROUND_PASS round=%u host_barrier=%u draws=2 compatible_load=1 invalid_stream=1 stale_pipeline=1\n",round,separate);fflush(stdout);
    }
    result=0;
done:
    if(device){
        if(cb)vkFreeCommandBuffers(device,pool,1,&cb);if(pool)vkDestroyCommandPool(device,pool,NULL);
        if(framebuffer)vkDestroyFramebuffer(device,framebuffer,NULL);if(pipeline)vkDestroyPipeline(device,pipeline,NULL);
        if(creation)vkDestroyRenderPass(device,creation,NULL);if(clear)vkDestroyRenderPass(device,clear,NULL);if(load)vkDestroyRenderPass(device,load,NULL);
        if(layout)vkDestroyPipelineLayout(device,layout,NULL);
        for(unsigned i=0;i<2;i++){if(modules[i])vkDestroyShaderModule(device,modules[i],NULL);if(vertex_map[i])vkUnmapMemory(device,vertex_mem[i]);if(vertices[i])vkDestroyBuffer(device,vertices[i],NULL);if(vertex_mem[i])vkFreeMemory(device,vertex_mem[i],NULL);}
        if(mapped)vkUnmapMemory(device,read_mem);if(readback)vkDestroyBuffer(device,readback,NULL);if(read_mem)vkFreeMemory(device,read_mem,NULL);
        if(view)vkDestroyImageView(device,view,NULL);if(image)vkDestroyImage(device,image,NULL);if(image_mem)vkFreeMemory(device,image_mem,NULL);vkDestroyDevice(device,NULL);
    }
    if(instance)vkDestroyInstance(instance,NULL);
#ifdef GUEST_PRESENT_X11
    if(!x11_close())result=1;
#endif
    printf("GUEST_VK_GRAPHICS_EXIT status=%d checks=%u\n",result,checks);fflush(stdout);alarm(0);return result;
}
