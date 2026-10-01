/* B2a Zink capability application. Only public Vulkan and POSIX entrypoints:
 * queries the seven Zink startup extensions, their Features2/Properties2
 * structures, Zink's limits and the CPU device-type switch; creates a device
 * with Zink's feature chain; then exercises descriptor update templates,
 * create_renderpass2, dynamic rendering (colour + D32 depth) with exact pixel
 * readback, timeline semaphore counters/signals/waits and a robustness2
 * nullDescriptor uniform-buffer draw. Every frame is read back and compared
 * byte for byte, followed by a 32-byte untouched sentinel tail. */
#define _POSIX_C_SOURCE 200809L
#include <vulkan/vulkan.h>
#include "../guest-vulkan/zink-ext.h"
#include <signal.h>
#include <stddef.h>
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
#define CHECK(c) do{checks++;if(!(c)){fprintf(stderr,"GUEST_VK_ZINKCAPS_FAIL line=%d check=%s\n",__LINE__,#c);goto done;}}while(0)
static void deadline(int n){(void)n;_exit(124);}
static const unsigned char GREEN[4]={0,255,0,255},RED[4]={255,0,0,255},BLUE[4]={0,0,255,255},ZERO[4]={0,0,0,0};
static unsigned char want[PIXELS];
static const char *const zink_exts[7]={VK_KHR_MAINTENANCE1_EXTENSION_NAME,VK_KHR_DESCRIPTOR_UPDATE_TEMPLATE_EXTENSION_NAME,
    VK_KHR_MAINTENANCE_5_EXTENSION_NAME,VK_KHR_CREATE_RENDERPASS_2_EXTENSION_NAME,VK_KHR_DYNAMIC_RENDERING_EXTENSION_NAME,
    VK_EXT_ROBUSTNESS_2_EXTENSION_NAME,VK_KHR_TIMELINE_SEMAPHORE_EXTENSION_NAME};
static void fill(const unsigned char *c){for(unsigned n=0;n<W*H;n++)memcpy(want+n*4,c,4);}
static void rect(unsigned x0,unsigned y0,unsigned x1,unsigned y1,const unsigned char *c){
    for(unsigned y=y0;y<y1;y++)for(unsigned x=x0;x<x1;x++)memcpy(want+(y*W+x)*4,c,4);
}
static int compare(const unsigned char *bytes,unsigned round){
    for(unsigned n=0;n<PIXELS;n++){checks++;
        if(bytes[n]!=want[n]){fprintf(stderr,"GUEST_VK_ZINKCAPS_PIXEL_FAIL round=%u x=%u y=%u component=%u actual=%u expected=%u\n",round,(n/4)%W,n/4/W,n%4,bytes[n],want[n]);return 0;}}
    for(unsigned n=PIXELS;n<TOTAL;n++){checks++;if(bytes[n]!=0xa5)return 0;}
    printf("GUEST_VK_ZINKCAPS_PIXELS_PASS round=%u width=16 height=16 exact=%u tail=32\n",round,PIXELS);fflush(stdout);
    return 1;
}
static VkDevice device;static VkQueue queue;static VkCommandBuffer cb;static unsigned char *mapped;
static VkImage color_image;static VkBuffer readback;
static VkImageLayout cold=VK_IMAGE_LAYOUT_UNDEFINED;static VkCommandBufferBeginInfo begin_info={.sType=VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO};
static VkSubmitInfo submit_info={.sType=VK_STRUCTURE_TYPE_SUBMIT_INFO,.commandBufferCount=1,.pCommandBuffers=&cb};
static void color_barrier(VkImageLayout old,VkImageLayout next){
    VkImageMemoryBarrier b={.sType=VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER,.oldLayout=old,.newLayout=next,.image=color_image,
        .srcQueueFamilyIndex=VK_QUEUE_FAMILY_IGNORED,.dstQueueFamilyIndex=VK_QUEUE_FAMILY_IGNORED,.subresourceRange={VK_IMAGE_ASPECT_COLOR_BIT,0,1,0,1}};
    VkPipelineStageFlags src=VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT,dst=VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT;
    b.dstAccessMask=VK_ACCESS_COLOR_ATTACHMENT_READ_BIT|VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT;
    if(old==VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL){src=VK_PIPELINE_STAGE_TRANSFER_BIT;b.srcAccessMask=VK_ACCESS_TRANSFER_READ_BIT;}
    if(old==VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL){src=VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT;b.srcAccessMask=VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT;}
    if(next==VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL){dst=VK_PIPELINE_STAGE_TRANSFER_BIT;b.dstAccessMask=VK_ACCESS_TRANSFER_READ_BIT;}
    vkCmdPipelineBarrier(cb,src,dst,0,0,NULL,0,NULL,1,&b);
}
static void depth_barrier(VkImage image,VkImageLayout old){
    const VkPipelineStageFlags tests=VK_PIPELINE_STAGE_EARLY_FRAGMENT_TESTS_BIT|VK_PIPELINE_STAGE_LATE_FRAGMENT_TESTS_BIT;
    VkImageMemoryBarrier b={.sType=VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER,.oldLayout=old,.newLayout=VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL,.image=image,
        .srcQueueFamilyIndex=VK_QUEUE_FAMILY_IGNORED,.dstQueueFamilyIndex=VK_QUEUE_FAMILY_IGNORED,.subresourceRange={VK_IMAGE_ASPECT_DEPTH_BIT,0,1,0,1},
        .dstAccessMask=VK_ACCESS_DEPTH_STENCIL_ATTACHMENT_READ_BIT|VK_ACCESS_DEPTH_STENCIL_ATTACHMENT_WRITE_BIT};
    VkPipelineStageFlags src=VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT;
    if(old==VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL){src=VK_PIPELINE_STAGE_LATE_FRAGMENT_TESTS_BIT;b.srcAccessMask=VK_ACCESS_DEPTH_STENCIL_ATTACHMENT_WRITE_BIT;}
    vkCmdPipelineBarrier(cb,src,tests,0,0,NULL,0,NULL,1,&b);
}
/* kind 0: readback TRANSFER->HOST; 1: vertex HOST->VERTEX_INPUT; 2: uniform HOST->shaders. */
static void buffer_barrier(VkBuffer buffer,int kind){
    VkBufferMemoryBarrier b={.sType=VK_STRUCTURE_TYPE_BUFFER_MEMORY_BARRIER,.buffer=buffer,.size=VK_WHOLE_SIZE,
        .srcQueueFamilyIndex=VK_QUEUE_FAMILY_IGNORED,.dstQueueFamilyIndex=VK_QUEUE_FAMILY_IGNORED};
    VkPipelineStageFlags src=VK_PIPELINE_STAGE_HOST_BIT,dst;
    if(kind==0){src=VK_PIPELINE_STAGE_TRANSFER_BIT;dst=VK_PIPELINE_STAGE_HOST_BIT;b.srcAccessMask=VK_ACCESS_TRANSFER_WRITE_BIT;b.dstAccessMask=VK_ACCESS_HOST_READ_BIT;}
    else if(kind==1){dst=VK_PIPELINE_STAGE_VERTEX_INPUT_BIT;b.srcAccessMask=VK_ACCESS_HOST_WRITE_BIT;b.dstAccessMask=VK_ACCESS_VERTEX_ATTRIBUTE_READ_BIT;}
    else{dst=VK_PIPELINE_STAGE_VERTEX_SHADER_BIT|VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT;b.srcAccessMask=VK_ACCESS_HOST_WRITE_BIT;b.dstAccessMask=VK_ACCESS_UNIFORM_READ_BIT;}
    vkCmdPipelineBarrier(cb,src,dst,0,0,NULL,1,&b,0,NULL);
}
static void record_readback(void){
    color_barrier(VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL,VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL);
    VkBufferImageCopy copy={.imageSubresource={VK_IMAGE_ASPECT_COLOR_BIT,0,0,1},.imageExtent={W,H,1}};
    vkCmdCopyImageToBuffer(cb,color_image,VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL,readback,1,&copy);buffer_barrier(readback,0);
}
static VkResult shader(const unsigned char *bytes,size_t size,VkShaderModule *out){
    uint32_t *copy=malloc(size);if(!copy)return VK_ERROR_OUT_OF_HOST_MEMORY;memcpy(copy,bytes,size);
    VkShaderModuleCreateInfo i={.sType=VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO,.codeSize=size,.pCode=copy};
    VkResult r=vkCreateShaderModule(device,&i,NULL,out);memset(copy,0,size);free(copy);return r;
}
/* depth=1: depth.vert/frag stride 28 (vec3+vec4) with optional depth state;
 * depth=0: offset.vert/tint.frag stride 8 (vec2). rendering!=NULL selects
 * dynamic rendering (renderPass must then be VK_NULL_HANDLE). */
static VkResult pipeline(VkShaderModule vs_module,VkShaderModule fs_module,int depth,VkPipelineLayout layout,VkRenderPass pass,
        const void *rendering,const VkPipelineDepthStencilStateCreateInfo *ds,VkPipeline *out){
    VkPipelineShaderStageCreateInfo stages[2]={{.sType=VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO,.stage=VK_SHADER_STAGE_VERTEX_BIT,.module=vs_module,.pName="main"},
        {.sType=VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO,.stage=VK_SHADER_STAGE_FRAGMENT_BIT,.module=fs_module,.pName="main"}};
    VkVertexInputBindingDescription bind={0,depth?STRIDE:8,VK_VERTEX_INPUT_RATE_VERTEX};
    VkVertexInputAttributeDescription attr[2]={{0,0,depth?VK_FORMAT_R32G32B32_SFLOAT:VK_FORMAT_R32G32_SFLOAT,0},{1,0,VK_FORMAT_R32G32B32A32_SFLOAT,12}};
    VkPipelineVertexInputStateCreateInfo vin={.sType=VK_STRUCTURE_TYPE_PIPELINE_VERTEX_INPUT_STATE_CREATE_INFO,.vertexBindingDescriptionCount=1,.pVertexBindingDescriptions=&bind,
        .vertexAttributeDescriptionCount=depth?2:1,.pVertexAttributeDescriptions=attr};
    VkPipelineInputAssemblyStateCreateInfo assembly={.sType=VK_STRUCTURE_TYPE_PIPELINE_INPUT_ASSEMBLY_STATE_CREATE_INFO,.topology=VK_PRIMITIVE_TOPOLOGY_TRIANGLE_LIST};
    VkViewport viewport={0,0,W,H,0,1};VkRect2D scissor={{0,0},{W,H}};VkPipelineViewportStateCreateInfo vs={.sType=VK_STRUCTURE_TYPE_PIPELINE_VIEWPORT_STATE_CREATE_INFO,.viewportCount=1,.pViewports=&viewport,.scissorCount=1,.pScissors=&scissor};
    VkPipelineRasterizationStateCreateInfo rs={.sType=VK_STRUCTURE_TYPE_PIPELINE_RASTERIZATION_STATE_CREATE_INFO,.polygonMode=VK_POLYGON_MODE_FILL,.cullMode=VK_CULL_MODE_NONE,.frontFace=VK_FRONT_FACE_COUNTER_CLOCKWISE,.lineWidth=1};
    VkPipelineMultisampleStateCreateInfo ms={.sType=VK_STRUCTURE_TYPE_PIPELINE_MULTISAMPLE_STATE_CREATE_INFO,.rasterizationSamples=VK_SAMPLE_COUNT_1_BIT};VkPipelineColorBlendAttachmentState attachment={.colorWriteMask=15};
    VkPipelineColorBlendStateCreateInfo blend={.sType=VK_STRUCTURE_TYPE_PIPELINE_COLOR_BLEND_STATE_CREATE_INFO,.attachmentCount=1,.pAttachments=&attachment};
    VkGraphicsPipelineCreateInfo pi={.sType=VK_STRUCTURE_TYPE_GRAPHICS_PIPELINE_CREATE_INFO,.pNext=rendering,.stageCount=2,.pStages=stages,.pVertexInputState=&vin,.pInputAssemblyState=&assembly,.pViewportState=&vs,
        .pRasterizationState=&rs,.pMultisampleState=&ms,.pDepthStencilState=ds,.pColorBlendState=&blend,.layout=layout,.renderPass=pass,.basePipelineIndex=-1};
    VkResult r=vkCreateGraphicsPipelines(device,VK_NULL_HANDLE,1,&pi,NULL,out);
    memset(stages,0xff,sizeof(stages));memset(&viewport,0xff,sizeof(viewport));memset(attr,0xff,sizeof(attr));return r;
}
static void quad(float *v,float x0,float y0,float x1,float y1,float z,const unsigned char *c){
    const float r=c[0]/255.0f,g=c[1]/255.0f,b=c[2]/255.0f,a=c[3]/255.0f;
    const float q[6][7]={{x0,y0,z,r,g,b,a},{x1,y0,z,r,g,b,a},{x1,y1,z,r,g,b,a},{x0,y0,z,r,g,b,a},{x1,y1,z,r,g,b,a},{x0,y1,z,r,g,b,a}};memcpy(v,q,sizeof(q));
}
static void set_params(unsigned char *p,float ox,float oy,const unsigned char c[4]){
    float f[8]={ox,oy,0,0,c[0]/255.0f,c[1]/255.0f,c[2]/255.0f,c[3]/255.0f};memcpy(p,f,32);
}
static VkRenderingAttachmentInfo color_attachment(VkImageView view,VkAttachmentLoadOp load){
    return (VkRenderingAttachmentInfo){.sType=VK_STRUCTURE_TYPE_RENDERING_ATTACHMENT_INFO,.imageView=view,.imageLayout=VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL,
        .loadOp=load,.storeOp=VK_ATTACHMENT_STORE_OP_STORE,.clearValue={.color={{0,1,0,1}}}};
}
static int submit_frame(unsigned round){
    memset(mapped,0xa5,TOTAL);
    if(vkQueueSubmit(queue,1,&submit_info,VK_NULL_HANDLE)!=VK_SUCCESS||vkQueueWaitIdle(queue)!=VK_SUCCESS)return 0;
    cold=VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL;return compare(mapped,round);
}
int main(void){
    int result=1;VkInstance instance=VK_NULL_HANDLE;VkDeviceMemory image_mem=VK_NULL_HANDLE,read_mem=VK_NULL_HANDLE,dvert_mem=VK_NULL_HANDLE,qvert_mem=VK_NULL_HANDLE,
        params_mem=VK_NULL_HANDLE,depth_mem=VK_NULL_HANDLE;
    VkImage depth_image=VK_NULL_HANDLE;VkImageView color_view=VK_NULL_HANDLE,depth_view=VK_NULL_HANDLE;VkBuffer dverts=VK_NULL_HANDLE,qverts=VK_NULL_HANDLE,params=VK_NULL_HANDLE;
    unsigned char *dmap=NULL,*qmap=NULL,*pmap=NULL;VkCommandPool cpool=VK_NULL_HANDLE;
    VkShaderModule depth_vs=VK_NULL_HANDLE,depth_fs=VK_NULL_HANDLE,offset_vs=VK_NULL_HANDLE,tint_fs=VK_NULL_HANDLE;
    VkDescriptorSetLayout set_layout=VK_NULL_HANDLE;VkPipelineLayout empty_layout=VK_NULL_HANDLE,uniform_layout=VK_NULL_HANDLE;
    VkDescriptorPool pool=VK_NULL_HANDLE;VkDescriptorSet tset=VK_NULL_HANDLE,nset=VK_NULL_HANDLE;VkDescriptorUpdateTemplate tmpl=VK_NULL_HANDLE;
    VkRenderPass pass2=VK_NULL_HANDLE;VkFramebuffer fb=VK_NULL_HANDLE;
    VkPipeline rp2_pipe=VK_NULL_HANDLE,dyn_depth=VK_NULL_HANDLE,dyn_tint=VK_NULL_HANDLE;
    VkSemaphore tl=VK_NULL_HANDLE,tl2=VK_NULL_HANDLE;
    VkImage bgra_image=VK_NULL_HANDLE;VkDeviceMemory bgra_mem=VK_NULL_HANDLE;VkImageView bgra_view=VK_NULL_HANDLE;VkPipeline dyn_bgra=VK_NULL_HANDLE;
    struct sigaction action={0};action.sa_handler=deadline;sigemptyset(&action.sa_mask);if(sigaction(SIGALRM,&action,NULL))return 2;alarm(110);signal(SIGPIPE,SIG_IGN);
    puts("GUEST_VK_ZINKCAPS_SCOPE public static Khronos loader; Zink startup extensions (maintenance1/5, update templates, renderpass2, dynamic rendering, robustness2 nullDescriptor, timeline semaphores); bounded nonconformant ICD");
    VkApplicationInfo app={.sType=VK_STRUCTURE_TYPE_APPLICATION_INFO,.apiVersion=VK_API_VERSION_1_1,.pApplicationName="public-zinkcaps"};VkInstanceCreateInfo ii={.sType=VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO,.pApplicationInfo=&app};
    CHECK(vkCreateInstance(&ii,NULL,&instance)==VK_SUCCESS);uint32_t count=1;VkPhysicalDevice physical;CHECK(vkEnumeratePhysicalDevices(instance,&count,&physical)==VK_SUCCESS&&count==1);
    VkQueueFamilyProperties qp;count=1;vkGetPhysicalDeviceQueueFamilyProperties(physical,&count,&qp);CHECK(qp.queueFlags&VK_QUEUE_GRAPHICS_BIT);
    /* ---- Properties, limits and the CPU device-type switch. ---- */
    VkPhysicalDeviceProperties properties;vkGetPhysicalDeviceProperties(physical,&properties);const VkPhysicalDeviceLimits *lim=&properties.limits;
    CHECK(properties.apiVersion==VK_API_VERSION_1_1&&properties.deviceType==VK_PHYSICAL_DEVICE_TYPE_OTHER);
    CHECK(lim->maxPushConstantsSize>=128&&lim->maxStorageBufferRange>=(1u<<27)&&lim->maxUniformBufferRange>=16384&&lim->maxBoundDescriptorSets>=4);
    CHECK(lim->maxImageDimension2D==128&&lim->framebufferDepthSampleCounts==VK_SAMPLE_COUNT_1_BIT);
    CHECK(lim->maxImageDimension1D==128);   /* B2e: Zink's max_texture_2d_size is MIN3(dim1D, dim2D, 16384). */
    const unsigned max_stride=lim->maxVertexInputBindingStride;CHECK(max_stride==252||max_stride==2048);
    printf("GUEST_VK_ZINKCAPS_LIMITS push=%u storage_range=%u uniform_range=%u sets=%u dimension=%u max_stride=%u\n",lim->maxPushConstantsSize,lim->maxStorageBufferRange,
        lim->maxUniformBufferRange,lim->maxBoundDescriptorSets,lim->maxImageDimension2D,max_stride);fflush(stdout);
    {
        VkPhysicalDeviceProperties p;
        CHECK(setenv("LIBGL_ALWAYS_SOFTWARE","1",1)==0);vkGetPhysicalDeviceProperties(physical,&p);CHECK(p.deviceType==VK_PHYSICAL_DEVICE_TYPE_CPU);
        CHECK(setenv("LIBGL_ALWAYS_SOFTWARE","0",1)==0);vkGetPhysicalDeviceProperties(physical,&p);CHECK(p.deviceType==VK_PHYSICAL_DEVICE_TYPE_OTHER);
        CHECK(setenv("LIBGL_ALWAYS_SOFTWARE","true",1)==0);CHECK(setenv("GUEST_VK_DEVICE_TYPE","other",1)==0);vkGetPhysicalDeviceProperties(physical,&p);CHECK(p.deviceType==VK_PHYSICAL_DEVICE_TYPE_OTHER);
        CHECK(unsetenv("LIBGL_ALWAYS_SOFTWARE")==0);CHECK(setenv("GUEST_VK_DEVICE_TYPE","cpu",1)==0);vkGetPhysicalDeviceProperties(physical,&p);CHECK(p.deviceType==VK_PHYSICAL_DEVICE_TYPE_CPU);
        VkPhysicalDeviceProperties2 p2={.sType=VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_PROPERTIES_2};vkGetPhysicalDeviceProperties2(physical,&p2);CHECK(p2.properties.deviceType==VK_PHYSICAL_DEVICE_TYPE_CPU);
        CHECK(unsetenv("GUEST_VK_DEVICE_TYPE")==0);vkGetPhysicalDeviceProperties(physical,&p);CHECK(p.deviceType==VK_PHYSICAL_DEVICE_TYPE_OTHER);
        printf("GUEST_VK_ZINKCAPS_DEVICE_TYPE default=other libgl_software=cpu libgl_zero=other override_other=other guest_cpu=cpu\n");fflush(stdout);
    }
    /* ---- Device extensions: exactly the seven Zink startup extensions. ---- */
    {
        VkExtensionProperties ext[16];count=16;CHECK(vkEnumerateDeviceExtensionProperties(physical,NULL,&count,ext)==VK_SUCCESS);CHECK(count==7);
        for(unsigned n=0;n<7;n++){unsigned found=0;for(unsigned k=0;k<count;k++)found+=!strcmp(ext[k].extensionName,zink_exts[n])&&ext[k].specVersion>=1;CHECK(found==1);}
        printf("GUEST_VK_ZINKCAPS_EXTENSIONS count=%u",count);for(unsigned k=0;k<count;k++)printf(" %s",ext[k].extensionName);printf("\n");fflush(stdout);
    }
    /* ---- Features2 / Properties2 chains (Zink's query shape). ---- */
    VkPhysicalDeviceRobustness2FeaturesEXT rob={.sType=VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_ROBUSTNESS_2_FEATURES_EXT};
    VkPhysicalDeviceTimelineSemaphoreFeatures tlf={.sType=VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_TIMELINE_SEMAPHORE_FEATURES,.pNext=&rob};
    VkPhysicalDeviceDynamicRenderingFeatures drf={.sType=VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_DYNAMIC_RENDERING_FEATURES,.pNext=&tlf};
    VkPhysicalDeviceMaintenance5FeaturesKHR m5f={.sType=VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_MAINTENANCE_5_FEATURES_KHR,.pNext=&drf};
    VkPhysicalDeviceDepthClipEnableFeaturesEXT dcf={.sType=VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_DEPTH_CLIP_ENABLE_FEATURES_EXT,.pNext=&m5f};
    VkPhysicalDeviceVertexAttributeDivisorFeaturesEXT vadf={.sType=VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_VERTEX_ATTRIBUTE_DIVISOR_FEATURES_EXT,.pNext=&dcf};
    VkPhysicalDeviceTransformFeedbackFeaturesEXT tff={.sType=VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_TRANSFORM_FEEDBACK_FEATURES_EXT,.pNext=&vadf};
    VkPhysicalDeviceFeatures2 f2={.sType=VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_FEATURES_2,.pNext=&tff};
    memset(&rob.robustBufferAccess2,0x55,sizeof(rob)-offsetof(VkPhysicalDeviceRobustness2FeaturesEXT,robustBufferAccess2));
    memset(&dcf.depthClipEnable,0x55,sizeof(VkBool32));memset(&f2.features,0x55,sizeof(f2.features));
    vkGetPhysicalDeviceFeatures2(physical,&f2);
    CHECK(rob.nullDescriptor==VK_TRUE&&rob.robustBufferAccess2==VK_FALSE&&rob.robustImageAccess2==VK_FALSE);
    CHECK(tlf.timelineSemaphore==VK_TRUE&&drf.dynamicRendering==VK_TRUE&&m5f.maintenance5==VK_TRUE);
    CHECK(dcf.depthClipEnable==VK_FALSE&&vadf.vertexAttributeInstanceRateDivisor==VK_FALSE&&tff.transformFeedback==VK_FALSE&&tff.geometryStreams==VK_FALSE);
    CHECK(f2.features.robustBufferAccess==VK_FALSE&&f2.features.geometryShader==VK_FALSE&&f2.features.depthClamp==VK_FALSE);
    CHECK(f2.features.independentBlend==VK_TRUE);   /* B2e: Zink's blend_equation_separate, required for ES 2.0 */
    {
        VkPhysicalDeviceTimelineSemaphoreProperties tlp={.sType=VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_TIMELINE_SEMAPHORE_PROPERTIES};
        VkPhysicalDeviceRobustness2PropertiesEXT robp={.sType=VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_ROBUSTNESS_2_PROPERTIES_EXT,.pNext=&tlp};
        VkPhysicalDeviceMaintenance5PropertiesKHR m5p={.sType=VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_MAINTENANCE_5_PROPERTIES_KHR,.pNext=&robp};
        VkPhysicalDeviceMaintenance3Properties m3p={.sType=VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_MAINTENANCE_3_PROPERTIES,.pNext=&m5p};
        VkPhysicalDeviceProperties2 p2={.sType=VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_PROPERTIES_2,.pNext=&m3p};
        memset(&m5p.earlyFragmentMultisampleCoverageAfterSampleCounting,0x55,sizeof(VkBool32));
        vkGetPhysicalDeviceProperties2(physical,&p2);
        CHECK(tlp.maxTimelineSemaphoreValueDifference==UINT64_MAX);
        CHECK(robp.robustStorageBufferAccessSizeAlignment==4&&robp.robustUniformBufferAccessSizeAlignment==16);
        CHECK(m5p.earlyFragmentMultisampleCoverageAfterSampleCounting==VK_FALSE);
        CHECK(m3p.maxPerSetDescriptors==4&&m3p.maxMemoryAllocationSize==1024*1024);
        printf("GUEST_VK_ZINKCAPS_FEATURES null_descriptor=1 timeline=1 dynamic_rendering=1 maintenance5=1 depth_clip=0 divisor=0 xfb=0 timeline_diff=max robust_align=4/16\n");fflush(stdout);
    }
    VkPhysicalDeviceMemoryProperties mp;vkGetPhysicalDeviceMemoryProperties(physical,&mp);CHECK(mp.memoryTypeCount==2&&(mp.memoryTypes[1].propertyFlags&VK_MEMORY_PROPERTY_HOST_COHERENT_BIT));
    /* ---- Device creation: negative chains, then Zink's chain. ---- */
    float priority=1;VkDeviceQueueCreateInfo qi={.sType=VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO,.queueCount=1,.pQueuePriorities=&priority};
    {
        VkDevice bad=VK_NULL_HANDLE;
        VkPhysicalDeviceRobustness2FeaturesEXT r2={.sType=VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_ROBUSTNESS_2_FEATURES_EXT,.nullDescriptor=VK_TRUE};
        VkDeviceCreateInfo di={.sType=VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO,.pNext=&r2,.queueCreateInfoCount=1,.pQueueCreateInfos=&qi};
        CHECK(vkCreateDevice(physical,&di,NULL,&bad)==VK_ERROR_FEATURE_NOT_PRESENT&&!bad);                /* nullDescriptor without robustness2 */
        di.enabledExtensionCount=7;di.ppEnabledExtensionNames=zink_exts;r2.robustBufferAccess2=VK_TRUE;
        CHECK(vkCreateDevice(physical,&di,NULL,&bad)==VK_ERROR_FEATURE_NOT_PRESENT&&!bad);                /* robustBufferAccess2 */
        r2.robustBufferAccess2=VK_FALSE;
        VkPhysicalDeviceVulkan12Features v12={.sType=VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_VULKAN_1_2_FEATURES,.pNext=&r2,.timelineSemaphore=VK_TRUE};di.pNext=&v12;
        CHECK(vkCreateDevice(physical,&di,NULL,&bad)==VK_ERROR_FEATURE_NOT_PRESENT&&!bad);                /* Vulkan12 bool */
        VkBaseInStructure unknown={.sType=(VkStructureType)1000082000,.pNext=(const void*)&r2};di.pNext=&unknown;
        CHECK(vkCreateDevice(physical,&di,NULL,&bad)==VK_ERROR_FEATURE_NOT_PRESENT&&!bad);                /* unknown structure */
        VkPhysicalDeviceTimelineSemaphoreFeatures t={.sType=VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_TIMELINE_SEMAPHORE_FEATURES,.timelineSemaphore=VK_TRUE};
        const char *no_timeline[6]={zink_exts[0],zink_exts[1],zink_exts[2],zink_exts[3],zink_exts[4],zink_exts[5]};
        di.pNext=&t;di.enabledExtensionCount=6;di.ppEnabledExtensionNames=no_timeline;
        CHECK(vkCreateDevice(physical,&di,NULL,&bad)==VK_ERROR_FEATURE_NOT_PRESENT&&!bad);                /* timeline without its extension */
        VkPhysicalDeviceFeatures base={.geometryShader=VK_TRUE};di.pNext=NULL;di.pEnabledFeatures=&base;di.enabledExtensionCount=7;di.ppEnabledExtensionNames=zink_exts;
        CHECK(vkCreateDevice(physical,&di,NULL,&bad)==VK_ERROR_FEATURE_NOT_PRESENT&&!bad);                /* unsupported core feature */
        const char *unknown_ext[1]={"VK_KHR_push_descriptor"};di.pEnabledFeatures=NULL;di.enabledExtensionCount=1;di.ppEnabledExtensionNames=unknown_ext;
        CHECK(vkCreateDevice(physical,&di,NULL,&bad)==VK_ERROR_EXTENSION_NOT_PRESENT&&!bad);              /* unadvertised extension */
        printf("GUEST_VK_ZINKCAPS_DEVICE_NEGATIVE rejected=7\n");fflush(stdout);
    }
    {   /* Zink copies its Features2 query results into the create chain. */
        f2.pNext=&tff;VkDeviceCreateInfo di={.sType=VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO,.pNext=&f2,.queueCreateInfoCount=1,.pQueueCreateInfos=&qi,
            .enabledExtensionCount=7,.ppEnabledExtensionNames=zink_exts};
        CHECK(vkCreateDevice(physical,&di,NULL,&device)==VK_SUCCESS);vkGetDeviceQueue(device,0,0,&queue);CHECK(queue!=VK_NULL_HANDLE);
        printf("GUEST_VK_ZINKCAPS_DEVICE chain=features2,xfb,divisor,depth_clip,maintenance5,dynamic_rendering,timeline,robustness2 extensions=7\n");fflush(stdout);
    }
    /* ---- Resources. ---- */
    VkImageCreateInfo ti={.sType=VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO,.imageType=VK_IMAGE_TYPE_2D,.format=VK_FORMAT_R8G8B8A8_UNORM,.extent={W,H,1},.mipLevels=1,.arrayLayers=1,.samples=VK_SAMPLE_COUNT_1_BIT,
        .tiling=VK_IMAGE_TILING_OPTIMAL,.usage=VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT|VK_IMAGE_USAGE_TRANSFER_SRC_BIT,.sharingMode=VK_SHARING_MODE_EXCLUSIVE};
    CHECK(vkCreateImage(device,&ti,NULL,&color_image)==VK_SUCCESS);VkMemoryRequirements mr;vkGetImageMemoryRequirements(device,color_image,&mr);CHECK(mr.size==PIXELS&&mr.memoryTypeBits==1);
    VkMemoryAllocateInfo ai={.sType=VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO,.allocationSize=mr.size};CHECK(vkAllocateMemory(device,&ai,NULL,&image_mem)==VK_SUCCESS);CHECK(vkBindImageMemory(device,color_image,image_mem,0)==VK_SUCCESS);
    VkImageViewCreateInfo vi={.sType=VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO,.image=color_image,.viewType=VK_IMAGE_VIEW_TYPE_2D,.format=VK_FORMAT_R8G8B8A8_UNORM,.subresourceRange={VK_IMAGE_ASPECT_COLOR_BIT,0,1,0,1}};
    CHECK(vkCreateImageView(device,&vi,NULL,&color_view)==VK_SUCCESS);
    ti.format=VK_FORMAT_D32_SFLOAT;ti.usage=VK_IMAGE_USAGE_DEPTH_STENCIL_ATTACHMENT_BIT;CHECK(vkCreateImage(device,&ti,NULL,&depth_image)==VK_SUCCESS);
    vkGetImageMemoryRequirements(device,depth_image,&mr);CHECK(mr.size==4*W*H&&mr.memoryTypeBits==1);ai.allocationSize=mr.size;
    CHECK(vkAllocateMemory(device,&ai,NULL,&depth_mem)==VK_SUCCESS);CHECK(vkBindImageMemory(device,depth_image,depth_mem,0)==VK_SUCCESS);
    vi.image=depth_image;vi.format=VK_FORMAT_D32_SFLOAT;vi.subresourceRange.aspectMask=VK_IMAGE_ASPECT_DEPTH_BIT;CHECK(vkCreateImageView(device,&vi,NULL,&depth_view)==VK_SUCCESS);
    VkBufferCreateInfo bi={.sType=VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO,.size=PIXELS+16,.usage=VK_BUFFER_USAGE_TRANSFER_DST_BIT,.sharingMode=VK_SHARING_MODE_EXCLUSIVE};CHECK(vkCreateBuffer(device,&bi,NULL,&readback)==VK_SUCCESS);
    vkGetBufferMemoryRequirements(device,readback,&mr);CHECK(mr.size==PIXELS+16&&mr.memoryTypeBits==2);ai.allocationSize=TOTAL;ai.memoryTypeIndex=1;CHECK(vkAllocateMemory(device,&ai,NULL,&read_mem)==VK_SUCCESS);
    CHECK(vkBindBufferMemory(device,readback,read_mem,0)==VK_SUCCESS);CHECK(vkMapMemory(device,read_mem,0,VK_WHOLE_SIZE,0,(void**)&mapped)==VK_SUCCESS);
    /* Depth quads (stride 28): A z=0.25 red columns 0-11, B z=0.75 blue columns 4-15, rows 0-11; C z=0.5 blue full frame. */
    float dv[18][7];quad(dv[0],-1,-1,0.5f,0.5f,0.25f,RED);quad(dv[6],-0.5f,-1,1,0.5f,0.75f,BLUE);quad(dv[12],-1,-1,1,1,0.5f,BLUE);
    bi.size=sizeof(dv);bi.usage=VK_BUFFER_USAGE_VERTEX_BUFFER_BIT;CHECK(vkCreateBuffer(device,&bi,NULL,&dverts)==VK_SUCCESS);
    ai.allocationSize=sizeof(dv);CHECK(vkAllocateMemory(device,&ai,NULL,&dvert_mem)==VK_SUCCESS);CHECK(vkBindBufferMemory(device,dverts,dvert_mem,0)==VK_SUCCESS);
    CHECK(vkMapMemory(device,dvert_mem,0,VK_WHOLE_SIZE,0,(void**)&dmap)==VK_SUCCESS);memcpy(dmap,dv,sizeof(dv));
    /* Offset/tint quad (stride 8): NDC -0.5..0.5, i.e. pixels 4-11 before the uniform offset. */
    const float qv[6][2]={{-.5f,-.5f},{.5f,-.5f},{.5f,.5f},{-.5f,-.5f},{.5f,.5f},{-.5f,.5f}};
    bi.size=sizeof(qv);CHECK(vkCreateBuffer(device,&bi,NULL,&qverts)==VK_SUCCESS);
    ai.allocationSize=sizeof(qv);CHECK(vkAllocateMemory(device,&ai,NULL,&qvert_mem)==VK_SUCCESS);CHECK(vkBindBufferMemory(device,qverts,qvert_mem,0)==VK_SUCCESS);
    CHECK(vkMapMemory(device,qvert_mem,0,VK_WHOLE_SIZE,0,(void**)&qmap)==VK_SUCCESS);memcpy(qmap,qv,sizeof(qv));
    bi.size=32;bi.usage=VK_BUFFER_USAGE_UNIFORM_BUFFER_BIT;CHECK(vkCreateBuffer(device,&bi,NULL,&params)==VK_SUCCESS);
    vkGetBufferMemoryRequirements(device,params,&mr);CHECK(mr.memoryTypeBits==2&&mr.alignment==256);
    ai.allocationSize=256;CHECK(vkAllocateMemory(device,&ai,NULL,&params_mem)==VK_SUCCESS);CHECK(vkBindBufferMemory(device,params,params_mem,0)==VK_SUCCESS);
    CHECK(vkMapMemory(device,params_mem,0,VK_WHOLE_SIZE,0,(void**)&pmap)==VK_SUCCESS);
    CHECK(shader(shader_depth_vert,sizeof(shader_depth_vert),&depth_vs)==VK_SUCCESS);CHECK(shader(shader_depth_frag,sizeof(shader_depth_frag),&depth_fs)==VK_SUCCESS);
    CHECK(shader(shader_offset_vert,sizeof(shader_offset_vert),&offset_vs)==VK_SUCCESS);CHECK(shader(shader_tint_frag,sizeof(shader_tint_frag),&tint_fs)==VK_SUCCESS);
    {
        VkDescriptorSetLayoutBinding b={.binding=1,.descriptorType=VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER,.descriptorCount=1,.stageFlags=VK_SHADER_STAGE_VERTEX_BIT|VK_SHADER_STAGE_FRAGMENT_BIT};
        VkDescriptorSetLayoutCreateInfo li={.sType=VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO,.bindingCount=1,.pBindings=&b};CHECK(vkCreateDescriptorSetLayout(device,&li,NULL,&set_layout)==VK_SUCCESS);
        VkPipelineLayoutCreateInfo pli={.sType=VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO};CHECK(vkCreatePipelineLayout(device,&pli,NULL,&empty_layout)==VK_SUCCESS);
        pli.setLayoutCount=1;pli.pSetLayouts=&set_layout;CHECK(vkCreatePipelineLayout(device,&pli,NULL,&uniform_layout)==VK_SUCCESS);
        VkDescriptorPoolSize ps={VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER,4};VkDescriptorPoolCreateInfo pci={.sType=VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO,.maxSets=4,.poolSizeCount=1,.pPoolSizes=&ps};
        CHECK(vkCreateDescriptorPool(device,&pci,NULL,&pool)==VK_SUCCESS);
        VkDescriptorSetLayout two[2]={set_layout,set_layout};VkDescriptorSet sets[2];
        VkDescriptorSetAllocateInfo dai={.sType=VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO,.descriptorPool=pool,.descriptorSetCount=2,.pSetLayouts=two};
        CHECK(vkAllocateDescriptorSets(device,&dai,sets)==VK_SUCCESS);tset=sets[0];nset=sets[1];
    }
    VkCommandPoolCreateInfo cpi={.sType=VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO,.flags=VK_COMMAND_POOL_CREATE_RESET_COMMAND_BUFFER_BIT};CHECK(vkCreateCommandPool(device,&cpi,NULL,&cpool)==VK_SUCCESS);
    VkCommandBufferAllocateInfo cai={.sType=VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO,.commandPool=cpool,.level=VK_COMMAND_BUFFER_LEVEL_PRIMARY,.commandBufferCount=1};CHECK(vkAllocateCommandBuffers(device,&cai,&cb)==VK_SUCCESS);
    vkTrimCommandPool(device,cpool,0);   /* maintenance1: no-op for the single static command buffer */
    {   /* maintenance5: the only exposed entry point is reachable through vkGetDeviceProcAddr or absent from the static loader. */
        PFN_vkGetRenderingAreaGranularityKHR granularity=(PFN_vkGetRenderingAreaGranularityKHR)vkGetDeviceProcAddr(device,"vkGetRenderingAreaGranularityKHR");
        unsigned via=0;
        if(granularity){VkFormat f=VK_FORMAT_R8G8B8A8_UNORM;VkRenderingAreaInfoKHR ri={.sType=VK_STRUCTURE_TYPE_RENDERING_AREA_INFO_KHR,.colorAttachmentCount=1,.pColorAttachmentFormats=&f};
            VkExtent2D g={0,0};granularity(device,&ri,&g);CHECK(g.width==1&&g.height==1);via=1;}
        printf("GUEST_VK_ZINKCAPS_MAINTENANCE trim=1 granularity_proc=%u\n",via);fflush(stdout);
    }
    /* ---- Descriptor update templates. ---- */
    {
        VkDescriptorUpdateTemplateEntry e={.dstBinding=1,.descriptorCount=1,.descriptorType=VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER,.offset=0,.stride=sizeof(VkDescriptorBufferInfo)};
        VkDescriptorUpdateTemplateCreateInfo ti2={.sType=VK_STRUCTURE_TYPE_DESCRIPTOR_UPDATE_TEMPLATE_CREATE_INFO,.descriptorUpdateEntryCount=1,.pDescriptorUpdateEntries=&e,
            .templateType=VK_DESCRIPTOR_UPDATE_TEMPLATE_TYPE_DESCRIPTOR_SET,.descriptorSetLayout=set_layout};
        VkDescriptorUpdateTemplate bad=VK_NULL_HANDLE;
        e.descriptorCount=2;CHECK(vkCreateDescriptorUpdateTemplate(device,&ti2,NULL,&bad)==VK_ERROR_FEATURE_NOT_PRESENT&&!bad);
        e.descriptorCount=1;e.descriptorType=VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;CHECK(vkCreateDescriptorUpdateTemplate(device,&ti2,NULL,&bad)==VK_ERROR_FEATURE_NOT_PRESENT&&!bad);
        e.descriptorType=VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER;ti2.descriptorUpdateEntryCount=0;CHECK(vkCreateDescriptorUpdateTemplate(device,&ti2,NULL,&bad)==VK_ERROR_INITIALIZATION_FAILED&&!bad);
        ti2.descriptorUpdateEntryCount=1;ti2.templateType=VK_DESCRIPTOR_UPDATE_TEMPLATE_TYPE_PUSH_DESCRIPTORS_KHR;CHECK(vkCreateDescriptorUpdateTemplate(device,&ti2,NULL,&bad)==VK_ERROR_INITIALIZATION_FAILED&&!bad);
        ti2.templateType=VK_DESCRIPTOR_UPDATE_TEMPLATE_TYPE_DESCRIPTOR_SET;CHECK(vkCreateDescriptorUpdateTemplate(device,&ti2,NULL,&tmpl)==VK_SUCCESS&&tmpl);
        struct { uint32_t pad[2]; VkDescriptorBufferInfo info; } data={{0xdeadbeef,0xdeadbeef},{params,0,32}};
        e.offset=8;   /* the template was copied at creation: later edits must not matter */
        vkUpdateDescriptorSetWithTemplate(device,tset,tmpl,&data.info);memset(&data,0xff,sizeof(data));
        printf("GUEST_VK_ZINKCAPS_TEMPLATES rejected=4 created=1\n");fflush(stdout);
    }
    /* ---- create_renderpass2 + update-template set: offset (0.25,0.25), red tint. ---- */
    {
        VkRenderPass bad=VK_NULL_HANDLE;
        VkAttachmentDescription2 a={.sType=VK_STRUCTURE_TYPE_ATTACHMENT_DESCRIPTION_2,.format=VK_FORMAT_R8G8B8A8_UNORM,.samples=VK_SAMPLE_COUNT_1_BIT,.loadOp=VK_ATTACHMENT_LOAD_OP_CLEAR,
            .storeOp=VK_ATTACHMENT_STORE_OP_STORE,.stencilLoadOp=VK_ATTACHMENT_LOAD_OP_DONT_CARE,.stencilStoreOp=VK_ATTACHMENT_STORE_OP_DONT_CARE,
            .initialLayout=VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL,.finalLayout=VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL};
        VkAttachmentReference2 ref={.sType=VK_STRUCTURE_TYPE_ATTACHMENT_REFERENCE_2,.attachment=0,.layout=VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL,.aspectMask=VK_IMAGE_ASPECT_COLOR_BIT};
        VkSubpassDescription2 s[2]={{.sType=VK_STRUCTURE_TYPE_SUBPASS_DESCRIPTION_2,.pipelineBindPoint=VK_PIPELINE_BIND_POINT_GRAPHICS,.colorAttachmentCount=1,.pColorAttachments=&ref},
            {.sType=VK_STRUCTURE_TYPE_SUBPASS_DESCRIPTION_2,.pipelineBindPoint=VK_PIPELINE_BIND_POINT_GRAPHICS,.colorAttachmentCount=1,.pColorAttachments=&ref}};
        VkSubpassDependency2 dep={.sType=VK_STRUCTURE_TYPE_SUBPASS_DEPENDENCY_2,.srcSubpass=VK_SUBPASS_EXTERNAL,.dstSubpass=0,.srcStageMask=VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT,
            .dstStageMask=VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT,.dstAccessMask=VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT};
        VkRenderPassCreateInfo2 ri={.sType=VK_STRUCTURE_TYPE_RENDER_PASS_CREATE_INFO_2,.attachmentCount=1,.pAttachments=&a,.subpassCount=2,.pSubpasses=s,.dependencyCount=1,.pDependencies=&dep};
        CHECK(vkCreateRenderPass2(device,&ri,NULL,&bad)==VK_ERROR_INITIALIZATION_FAILED&&!bad);                 /* two subpasses */
        ri.subpassCount=1;s[0].viewMask=1;CHECK(vkCreateRenderPass2(device,&ri,NULL,&bad)==VK_ERROR_FEATURE_NOT_PRESENT&&!bad);   /* multiview */
        s[0].viewMask=0;dep.srcSubpass=0;CHECK(vkCreateRenderPass2(device,&ri,NULL,&bad)==VK_ERROR_FEATURE_NOT_PRESENT&&!bad);  /* self dependency */
        dep.srcSubpass=VK_SUBPASS_EXTERNAL;CHECK(vkCreateRenderPass2(device,&ri,NULL,&pass2)==VK_SUCCESS&&pass2);
        memset(&a,0xff,sizeof(a));memset(&ref,0xff,sizeof(ref));
        VkFramebufferCreateInfo fi={.sType=VK_STRUCTURE_TYPE_FRAMEBUFFER_CREATE_INFO,.renderPass=pass2,.attachmentCount=1,.pAttachments=&color_view,.width=W,.height=H,.layers=1};
        CHECK(vkCreateFramebuffer(device,&fi,NULL,&fb)==VK_SUCCESS);
        CHECK(pipeline(offset_vs,tint_fs,0,uniform_layout,pass2,NULL,NULL,&rp2_pipe)==VK_SUCCESS);
        printf("GUEST_VK_ZINKCAPS_RENDERPASS2 rejected=3 created=1\n");fflush(stdout);
    }
    VkSubpassBeginInfo sbi={.sType=VK_STRUCTURE_TYPE_SUBPASS_BEGIN_INFO,.contents=VK_SUBPASS_CONTENTS_INLINE};VkSubpassEndInfo sei={.sType=VK_STRUCTURE_TYPE_SUBPASS_END_INFO};
    VkClearValue green={.color={{0,1,0,1}}};VkDeviceSize zero_offset=0;
    VkRenderPassBeginInfo rbi={.sType=VK_STRUCTURE_TYPE_RENDER_PASS_BEGIN_INFO,.renderPass=pass2,.framebuffer=fb,.renderArea={{0,0},{W,H}},.clearValueCount=1,.pClearValues=&green};
#define RECORD_RP2(SET) do{CHECK(vkResetCommandBuffer(cb,0)==VK_SUCCESS);CHECK(vkBeginCommandBuffer(cb,&begin_info)==VK_SUCCESS); \
        color_barrier(cold,VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL);buffer_barrier(params,2);buffer_barrier(qverts,1); \
        vkCmdBeginRenderPass2(cb,&rbi,&sbi);vkCmdBindPipeline(cb,VK_PIPELINE_BIND_POINT_GRAPHICS,rp2_pipe); \
        vkCmdBindDescriptorSets(cb,VK_PIPELINE_BIND_POINT_GRAPHICS,uniform_layout,0,1,&(SET),0,NULL);vkCmdBindVertexBuffers(cb,0,1,&qverts,&zero_offset); \
        vkCmdDraw(cb,6,1,0,0);vkCmdEndRenderPass2(cb,&sei);record_readback();CHECK(vkEndCommandBuffer(cb)==VK_SUCCESS);}while(0)
    set_params(pmap,0.25f,0.25f,RED);RECORD_RP2(tset);fill(GREEN);rect(6,6,14,14,RED);CHECK(submit_frame(1));
    set_params(pmap,-0.25f,0,BLUE);RECORD_RP2(tset);fill(GREEN);rect(2,4,10,12,BLUE);CHECK(submit_frame(2));
    {   /* vkCmdNextSubpass2 is refused: EndCommandBuffer fails. */
        CHECK(vkResetCommandBuffer(cb,0)==VK_SUCCESS);CHECK(vkBeginCommandBuffer(cb,&begin_info)==VK_SUCCESS);
        color_barrier(cold,VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL);vkCmdBeginRenderPass2(cb,&rbi,&sbi);vkCmdNextSubpass2(cb,&sbi,&sei);vkCmdEndRenderPass2(cb,&sei);
        CHECK(vkEndCommandBuffer(cb)!=VK_SUCCESS);
        CHECK(vkResetCommandBuffer(cb,0)==VK_SUCCESS);CHECK(vkBeginCommandBuffer(cb,&begin_info)==VK_SUCCESS);   /* SubpassEndInfo is required */
        color_barrier(cold,VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL);vkCmdBeginRenderPass2(cb,&rbi,&sbi);vkCmdEndRenderPass2(cb,NULL);
        CHECK(vkEndCommandBuffer(cb)!=VK_SUCCESS);
    }
    printf("GUEST_VK_ZINKCAPS_RENDERPASS2_PASS frames=2 refused=2\n");fflush(stdout);
    /* ---- Dynamic rendering: pipelines without a render pass. ---- */
    VkFormat rgba=VK_FORMAT_R8G8B8A8_UNORM,two_rgba[2]={VK_FORMAT_R8G8B8A8_UNORM,VK_FORMAT_R8G8B8A8_UNORM};
    {
        VkPipeline bad=VK_NULL_HANDLE;
        VkPipelineRenderingCreateInfo pr={.sType=VK_STRUCTURE_TYPE_PIPELINE_RENDERING_CREATE_INFO,.colorAttachmentCount=2,.pColorAttachmentFormats=two_rgba};
        CHECK(pipeline(offset_vs,tint_fs,0,uniform_layout,VK_NULL_HANDLE,NULL,NULL,&bad)==VK_ERROR_INITIALIZATION_FAILED&&!bad);   /* neither pass nor rendering info */
        CHECK(pipeline(offset_vs,tint_fs,0,uniform_layout,VK_NULL_HANDLE,&pr,NULL,&bad)==VK_ERROR_FEATURE_NOT_PRESENT&&!bad);       /* two colour attachments */
        pr.colorAttachmentCount=1;pr.pColorAttachmentFormats=&rgba;pr.stencilAttachmentFormat=VK_FORMAT_S8_UINT;
        CHECK(pipeline(offset_vs,tint_fs,0,uniform_layout,VK_NULL_HANDLE,&pr,NULL,&bad)==VK_ERROR_FEATURE_NOT_PRESENT&&!bad);       /* stencil */
        pr.stencilAttachmentFormat=VK_FORMAT_UNDEFINED;
        CHECK(pipeline(offset_vs,tint_fs,0,uniform_layout,pass2,&pr,NULL,&bad)==VK_ERROR_INITIALIZATION_FAILED&&!bad);               /* rendering info with a pass */
        CHECK(pipeline(offset_vs,tint_fs,0,uniform_layout,VK_NULL_HANDLE,&pr,NULL,&dyn_tint)==VK_SUCCESS);
        VkPipelineDepthStencilStateCreateInfo ds={.sType=VK_STRUCTURE_TYPE_PIPELINE_DEPTH_STENCIL_STATE_CREATE_INFO,.depthTestEnable=VK_TRUE,.depthWriteEnable=VK_TRUE,
            .depthCompareOp=VK_COMPARE_OP_LESS,.maxDepthBounds=1};
        pr.depthAttachmentFormat=VK_FORMAT_D32_SFLOAT;
        CHECK(pipeline(depth_vs,depth_fs,1,empty_layout,VK_NULL_HANDLE,&pr,NULL,&bad)==VK_ERROR_INITIALIZATION_FAILED&&!bad);         /* depth format without depth state */
        CHECK(pipeline(depth_vs,depth_fs,1,empty_layout,VK_NULL_HANDLE,&pr,&ds,&dyn_depth)==VK_SUCCESS);
        printf("GUEST_VK_ZINKCAPS_DYNAMIC_PIPELINES rejected=5 created=2\n");fflush(stdout);
    }
    VkRenderingAttachmentInfo ca=color_attachment(color_view,VK_ATTACHMENT_LOAD_OP_CLEAR);
    VkRenderingAttachmentInfo za={.sType=VK_STRUCTURE_TYPE_RENDERING_ATTACHMENT_INFO,.imageView=depth_view,.imageLayout=VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL,
        .loadOp=VK_ATTACHMENT_LOAD_OP_CLEAR,.storeOp=VK_ATTACHMENT_STORE_OP_STORE,.clearValue={.depthStencil={1.0f,0}}};
    VkRenderingInfo rinfo={.sType=VK_STRUCTURE_TYPE_RENDERING_INFO,.renderArea={{0,0},{W,H}},.layerCount=1,.colorAttachmentCount=1,.pColorAttachments=&ca,.pDepthAttachment=&za};
    VkImageLayout dold=VK_IMAGE_LAYOUT_UNDEFINED;
#define RECORD_DEPTH(F1,F2) do{CHECK(vkResetCommandBuffer(cb,0)==VK_SUCCESS);CHECK(vkBeginCommandBuffer(cb,&begin_info)==VK_SUCCESS); \
        color_barrier(cold,VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL);depth_barrier(depth_image,dold);buffer_barrier(dverts,1); \
        vkCmdBeginRendering(cb,&rinfo);vkCmdBindPipeline(cb,VK_PIPELINE_BIND_POINT_GRAPHICS,dyn_depth);vkCmdBindVertexBuffers(cb,0,1,&dverts,&zero_offset); \
        vkCmdDraw(cb,6,1,F1,0);vkCmdDraw(cb,6,1,F2,0);vkCmdEndRendering(cb);record_readback();CHECK(vkEndCommandBuffer(cb)==VK_SUCCESS);}while(0)
    /* A (near, red) then B (far, blue), and B then A: the depth test makes both orders equal. */
    RECORD_DEPTH(0,6);fill(GREEN);rect(0,0,12,12,RED);rect(12,0,16,12,BLUE);CHECK(submit_frame(3));dold=VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL;
    RECORD_DEPTH(6,0);CHECK(submit_frame(4));
    /* Depth LOAD keeps the stored depths (0.25 under A, 0.75 under B only, 1.0 below):
     * a z=0.5 full-frame quad over a black clear only passes outside A. */
    za.loadOp=VK_ATTACHMENT_LOAD_OP_LOAD;ca.clearValue.color=(VkClearColorValue){{0,0,0,1}};
    RECORD_DEPTH(12,12);fill(BLUE);rect(0,0,12,12,(const unsigned char[4]){0,0,0,255});CHECK(submit_frame(5));
    za.loadOp=VK_ATTACHMENT_LOAD_OP_CLEAR;ca.clearValue.color=(VkClearColorValue){{0,1,0,1}};
    printf("GUEST_VK_ZINKCAPS_DYNAMIC_DEPTH_PASS frames=3 format=d32-sfloat\n");fflush(stdout);
    /* Colour-only dynamic rendering with LOAD: the update-template set draws a red quad over frame 5. */
    VkRenderingAttachmentInfo lc=color_attachment(color_view,VK_ATTACHMENT_LOAD_OP_LOAD);
    VkRenderingInfo cinfo={.sType=VK_STRUCTURE_TYPE_RENDERING_INFO,.renderArea={{0,0},{W,H}},.layerCount=1,.colorAttachmentCount=1,.pColorAttachments=&lc};
#define RECORD_TINT(SET) do{CHECK(vkResetCommandBuffer(cb,0)==VK_SUCCESS);CHECK(vkBeginCommandBuffer(cb,&begin_info)==VK_SUCCESS); \
        color_barrier(cold,VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL);buffer_barrier(params,2);buffer_barrier(qverts,1); \
        vkCmdBeginRendering(cb,&cinfo);vkCmdBindPipeline(cb,VK_PIPELINE_BIND_POINT_GRAPHICS,dyn_tint); \
        vkCmdBindDescriptorSets(cb,VK_PIPELINE_BIND_POINT_GRAPHICS,uniform_layout,0,1,&(SET),0,NULL);vkCmdBindVertexBuffers(cb,0,1,&qverts,&zero_offset); \
        vkCmdDraw(cb,6,1,0,0);vkCmdEndRendering(cb);record_readback();CHECK(vkEndCommandBuffer(cb)==VK_SUCCESS);}while(0)
    set_params(pmap,0,-0.25f,RED);RECORD_TINT(tset);rect(4,2,12,10,RED);CHECK(submit_frame(6));
    {   /* Refused dynamic-rendering recordings. */
        VkRenderingInfo bad=cinfo;bad.renderArea.extent.width=W-1;
        CHECK(vkResetCommandBuffer(cb,0)==VK_SUCCESS);CHECK(vkBeginCommandBuffer(cb,&begin_info)==VK_SUCCESS);color_barrier(cold,VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL);
        vkCmdBeginRendering(cb,&bad);vkCmdEndRendering(cb);CHECK(vkEndCommandBuffer(cb)!=VK_SUCCESS);                 /* partial render area */
        bad=cinfo;bad.layerCount=2;
        CHECK(vkResetCommandBuffer(cb,0)==VK_SUCCESS);CHECK(vkBeginCommandBuffer(cb,&begin_info)==VK_SUCCESS);color_barrier(cold,VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL);
        vkCmdBeginRendering(cb,&bad);vkCmdEndRendering(cb);CHECK(vkEndCommandBuffer(cb)!=VK_SUCCESS);                 /* layered */
        VkRenderingAttachmentInfo wrong=lc;wrong.imageLayout=VK_IMAGE_LAYOUT_GENERAL;bad=cinfo;bad.pColorAttachments=&wrong;
        CHECK(vkResetCommandBuffer(cb,0)==VK_SUCCESS);CHECK(vkBeginCommandBuffer(cb,&begin_info)==VK_SUCCESS);color_barrier(cold,VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL);
        vkCmdBeginRendering(cb,&bad);vkCmdEndRendering(cb);CHECK(vkEndCommandBuffer(cb)!=VK_SUCCESS);                 /* GENERAL layout */
        CHECK(vkResetCommandBuffer(cb,0)==VK_SUCCESS);CHECK(vkBeginCommandBuffer(cb,&begin_info)==VK_SUCCESS);color_barrier(cold,VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL);
        vkCmdBeginRendering(cb,&cinfo);CHECK(vkEndCommandBuffer(cb)!=VK_SUCCESS);                                      /* unterminated */
        printf("GUEST_VK_ZINKCAPS_DYNAMIC_NEGATIVE refused=4\n");fflush(stdout);
    }
    /* ---- robustness2 nullDescriptor: a VK_NULL_HANDLE uniform buffer reads zeros. ---- */
    {
        VkDescriptorBufferInfo info={VK_NULL_HANDLE,0,VK_WHOLE_SIZE};
        VkWriteDescriptorSet w={.sType=VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET,.dstSet=nset,.dstBinding=1,.descriptorCount=1,.descriptorType=VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER,.pBufferInfo=&info};
        vkUpdateDescriptorSets(device,1,&w,0,NULL);
        /* Zero offset and zero tint: the quad sits at pixels 4-11 with every component 0, over a green clear. */
        lc.loadOp=VK_ATTACHMENT_LOAD_OP_CLEAR;set_params(pmap,0.5f,0.5f,BLUE);
        RECORD_TINT(nset);fill(GREEN);rect(4,4,12,12,ZERO);CHECK(submit_frame(7));
        /* The template set is unaffected and still reads the real buffer. */
        RECORD_TINT(tset);fill(GREEN);rect(8,8,16,16,BLUE);CHECK(submit_frame(8));
        /* A null buffer with a non-zero offset invalidates the set: submission is refused. */
        info.offset=256;vkUpdateDescriptorSets(device,1,&w,0,NULL);
        RECORD_TINT(nset);CHECK(vkQueueSubmit(queue,1,&submit_info,VK_NULL_HANDLE)!=VK_SUCCESS);
        info.offset=0;vkUpdateDescriptorSets(device,1,&w,0,NULL);
        RECORD_TINT(nset);fill(GREEN);rect(4,4,12,12,ZERO);CHECK(submit_frame(9));
        printf("GUEST_VK_ZINKCAPS_NULL_DESCRIPTOR_PASS frames=2 refused=1\n");fflush(stdout);
    }
    /* ---- Timeline semaphores (non-blocking waits). ---- */
    {
        VkSemaphoreTypeCreateInfo sti={.sType=VK_STRUCTURE_TYPE_SEMAPHORE_TYPE_CREATE_INFO,.semaphoreType=VK_SEMAPHORE_TYPE_TIMELINE,.initialValue=5};
        VkSemaphoreCreateInfo sci={.sType=VK_STRUCTURE_TYPE_SEMAPHORE_CREATE_INFO,.pNext=&sti};
        CHECK(vkCreateSemaphore(device,&sci,NULL,&tl)==VK_SUCCESS);sti.initialValue=0;CHECK(vkCreateSemaphore(device,&sci,NULL,&tl2)==VK_SUCCESS);
        VkSemaphore bad=VK_NULL_HANDLE;sti.semaphoreType=VK_SEMAPHORE_TYPE_BINARY;sti.initialValue=1;
        CHECK(vkCreateSemaphore(device,&sci,NULL,&bad)==VK_ERROR_INITIALIZATION_FAILED&&!bad);    /* binary with an initial value */
        uint64_t value=0;CHECK(vkGetSemaphoreCounterValue(device,tl,&value)==VK_SUCCESS&&value==5);
        /* A rendering submission signals 7. */
        uint64_t sig=7;VkTimelineSemaphoreSubmitInfo tsi={.sType=VK_STRUCTURE_TYPE_TIMELINE_SEMAPHORE_SUBMIT_INFO,.signalSemaphoreValueCount=1,.pSignalSemaphoreValues=&sig};
        RECORD_TINT(nset);VkSubmitInfo si=submit_info;si.pNext=&tsi;si.signalSemaphoreCount=1;si.pSignalSemaphores=&tl;
        memset(mapped,0xa5,TOTAL);CHECK(vkQueueSubmit(queue,1,&si,VK_NULL_HANDLE)==VK_SUCCESS);CHECK(vkQueueWaitIdle(queue)==VK_SUCCESS);cold=VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL;
        CHECK(compare(mapped,10));
        CHECK(vkGetSemaphoreCounterValue(device,tl,&value)==VK_SUCCESS&&value==7);
        uint64_t want_value=7;VkSemaphoreWaitInfo wi={.sType=VK_STRUCTURE_TYPE_SEMAPHORE_WAIT_INFO,.semaphoreCount=1,.pSemaphores=&tl,.pValues=&want_value};
        CHECK(vkWaitSemaphores(device,&wi,UINT64_MAX)==VK_SUCCESS);
        want_value=8;CHECK(vkWaitSemaphores(device,&wi,0)==VK_TIMEOUT);
        VkSemaphoreSignalInfo ssi={.sType=VK_STRUCTURE_TYPE_SEMAPHORE_SIGNAL_INFO,.semaphore=tl,.value=10};CHECK(vkSignalSemaphore(device,&ssi)==VK_SUCCESS);
        CHECK(vkWaitSemaphores(device,&wi,0)==VK_SUCCESS);
        ssi.value=9;CHECK(vkSignalSemaphore(device,&ssi)!=VK_SUCCESS);CHECK(vkGetSemaphoreCounterValue(device,tl,&value)==VK_SUCCESS&&value==10);
        /* Command-buffer-free submission: wait 10, signal 11. */
        uint64_t wv=10,sv=11;VkPipelineStageFlags stage=VK_PIPELINE_STAGE_ALL_COMMANDS_BIT;
        VkTimelineSemaphoreSubmitInfo t2={.sType=VK_STRUCTURE_TYPE_TIMELINE_SEMAPHORE_SUBMIT_INFO,.waitSemaphoreValueCount=1,.pWaitSemaphoreValues=&wv,.signalSemaphoreValueCount=1,.pSignalSemaphoreValues=&sv};
        VkSubmitInfo s2={.sType=VK_STRUCTURE_TYPE_SUBMIT_INFO,.pNext=&t2,.waitSemaphoreCount=1,.pWaitSemaphores=&tl,.pWaitDstStageMask=&stage,.signalSemaphoreCount=1,.pSignalSemaphores=&tl};
        CHECK(vkQueueSubmit(queue,1,&s2,VK_NULL_HANDLE)==VK_SUCCESS);CHECK(vkGetSemaphoreCounterValue(device,tl,&value)==VK_SUCCESS&&value==11);
        wv=12;sv=13;CHECK(vkQueueSubmit(queue,1,&s2,VK_NULL_HANDLE)==VK_ERROR_INITIALIZATION_FAILED);          /* wait for an unreachable value */
        wv=11;sv=11;CHECK(vkQueueSubmit(queue,1,&s2,VK_NULL_HANDLE)==VK_ERROR_INITIALIZATION_FAILED);          /* non-increasing signal */
        CHECK(vkGetSemaphoreCounterValue(device,tl,&value)==VK_SUCCESS&&value==11);
        /* WAIT_ANY across two timelines; WAIT_ALL needs both. */
        VkSemaphore both[2]={tl,tl2};uint64_t vals[2]={11,1};wi.semaphoreCount=2;wi.pSemaphores=both;wi.pValues=vals;
        CHECK(vkWaitSemaphores(device,&wi,0)==VK_TIMEOUT);wi.flags=VK_SEMAPHORE_WAIT_ANY_BIT;CHECK(vkWaitSemaphores(device,&wi,0)==VK_SUCCESS);
        wi.flags=0;ssi.semaphore=tl2;ssi.value=1;CHECK(vkSignalSemaphore(device,&ssi)==VK_SUCCESS);CHECK(vkWaitSemaphores(device,&wi,0)==VK_SUCCESS);
        printf("GUEST_VK_ZINKCAPS_TIMELINE_PASS final=11 signals=3 waits=6 refused=4\n");fflush(stdout);
    }
    /* ---- B2e: B8G8R8A8_UNORM colour attachment (Zink's EGL/GBM config format). The host stores
     * RGBA; guest-visible bytes are B,G,R,A. ---- */
    {
        VkFormatProperties fr,fb2,fsr;vkGetPhysicalDeviceFormatProperties(physical,VK_FORMAT_R8G8B8A8_UNORM,&fr);
        vkGetPhysicalDeviceFormatProperties(physical,VK_FORMAT_B8G8R8A8_UNORM,&fb2);vkGetPhysicalDeviceFormatProperties(physical,VK_FORMAT_B8G8R8A8_SRGB,&fsr);
        const VkFormatFeatureFlags need=VK_FORMAT_FEATURE_COLOR_ATTACHMENT_BIT|VK_FORMAT_FEATURE_TRANSFER_SRC_BIT;
        CHECK(fb2.optimalTilingFeatures==fr.optimalTilingFeatures&&(fb2.optimalTilingFeatures&need)==need&&!fb2.linearTilingFeatures&&!fb2.bufferFeatures);
        CHECK(!fsr.optimalTilingFeatures&&!fsr.linearTilingFeatures&&!fsr.bufferFeatures);
        VkImageFormatProperties ip;
        CHECK(vkGetPhysicalDeviceImageFormatProperties(physical,VK_FORMAT_B8G8R8A8_UNORM,VK_IMAGE_TYPE_2D,VK_IMAGE_TILING_OPTIMAL,
            VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT|VK_IMAGE_USAGE_TRANSFER_SRC_BIT,0,&ip)==VK_SUCCESS);
        CHECK(ip.maxExtent.width==128&&ip.maxExtent.height==128&&ip.maxMipLevels==1&&ip.sampleCounts==VK_SAMPLE_COUNT_1_BIT);
        CHECK(vkGetPhysicalDeviceImageFormatProperties(physical,VK_FORMAT_B8G8R8A8_SRGB,VK_IMAGE_TYPE_2D,VK_IMAGE_TILING_OPTIMAL,
            VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT|VK_IMAGE_USAGE_TRANSFER_SRC_BIT,0,&ip)==VK_ERROR_FORMAT_NOT_SUPPORTED);
        VkImageCreateInfo bi2={.sType=VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO,.imageType=VK_IMAGE_TYPE_2D,.format=VK_FORMAT_B8G8R8A8_UNORM,.extent={W,H,1},.mipLevels=1,.arrayLayers=1,
            .samples=VK_SAMPLE_COUNT_1_BIT,.tiling=VK_IMAGE_TILING_OPTIMAL,.usage=VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT|VK_IMAGE_USAGE_TRANSFER_SRC_BIT,.sharingMode=VK_SHARING_MODE_EXCLUSIVE};
        VkImage bad_image=VK_NULL_HANDLE;bi2.format=VK_FORMAT_B8G8R8A8_SRGB;CHECK(vkCreateImage(device,&bi2,NULL,&bad_image)!=VK_SUCCESS&&!bad_image);
        bi2.format=VK_FORMAT_B8G8R8A8_UNORM;CHECK(vkCreateImage(device,&bi2,NULL,&bgra_image)==VK_SUCCESS);
        VkMemoryRequirements bmr;vkGetImageMemoryRequirements(device,bgra_image,&bmr);CHECK(bmr.size==PIXELS&&bmr.memoryTypeBits==1);
        VkMemoryAllocateInfo bai={.sType=VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO,.allocationSize=bmr.size};
        CHECK(vkAllocateMemory(device,&bai,NULL,&bgra_mem)==VK_SUCCESS);CHECK(vkBindImageMemory(device,bgra_image,bgra_mem,0)==VK_SUCCESS);
        VkImageViewCreateInfo bvi={.sType=VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO,.image=bgra_image,.viewType=VK_IMAGE_VIEW_TYPE_2D,.format=VK_FORMAT_R8G8B8A8_UNORM,
            .subresourceRange={VK_IMAGE_ASPECT_COLOR_BIT,0,1,0,1}};
        VkImageView bad_view=VK_NULL_HANDLE;CHECK(vkCreateImageView(device,&bvi,NULL,&bad_view)!=VK_SUCCESS&&!bad_view);   /* RGBA view of a BGRA image */
        bvi.format=VK_FORMAT_B8G8R8A8_UNORM;CHECK(vkCreateImageView(device,&bvi,NULL,&bgra_view)==VK_SUCCESS);
        VkFormat bgra=VK_FORMAT_B8G8R8A8_UNORM;
        VkPipelineRenderingCreateInfo pr={.sType=VK_STRUCTURE_TYPE_PIPELINE_RENDERING_CREATE_INFO,.colorAttachmentCount=1,.pColorAttachmentFormats=&bgra};
        CHECK(pipeline(offset_vs,tint_fs,0,uniform_layout,VK_NULL_HANDLE,&pr,NULL,&dyn_bgra)==VK_SUCCESS);
        /* Clear to blue, then a red quad at offset (0.25,0.25): blue reads back as bytes 255,0,0,255 and red as 0,0,255,255. */
        VkImage saved_image=color_image;VkImageLayout saved_layout=cold;color_image=bgra_image;cold=VK_IMAGE_LAYOUT_UNDEFINED;
        VkRenderingAttachmentInfo bc=color_attachment(bgra_view,VK_ATTACHMENT_LOAD_OP_CLEAR);bc.clearValue.color=(VkClearColorValue){{0,0,1,1}};
        VkRenderingInfo binfo={.sType=VK_STRUCTURE_TYPE_RENDERING_INFO,.renderArea={{0,0},{W,H}},.layerCount=1,.colorAttachmentCount=1,.pColorAttachments=&bc};
        set_params(pmap,0.25f,0.25f,RED);
        CHECK(vkResetCommandBuffer(cb,0)==VK_SUCCESS);CHECK(vkBeginCommandBuffer(cb,&begin_info)==VK_SUCCESS);
        color_barrier(cold,VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL);buffer_barrier(params,2);buffer_barrier(qverts,1);
        vkCmdBeginRendering(cb,&binfo);vkCmdBindPipeline(cb,VK_PIPELINE_BIND_POINT_GRAPHICS,dyn_bgra);
        vkCmdBindDescriptorSets(cb,VK_PIPELINE_BIND_POINT_GRAPHICS,uniform_layout,0,1,&tset,0,NULL);vkCmdBindVertexBuffers(cb,0,1,&qverts,&zero_offset);
        vkCmdDraw(cb,6,1,0,0);vkCmdEndRendering(cb);record_readback();CHECK(vkEndCommandBuffer(cb)==VK_SUCCESS);
        static const unsigned char BGRA_BLUE[4]={255,0,0,255},BGRA_RED[4]={0,0,255,255};
        fill(BGRA_BLUE);rect(6,6,14,14,BGRA_RED);const int ok=submit_frame(11);color_image=saved_image;cold=saved_layout;CHECK(ok);
        printf("GUEST_VK_ZINKCAPS_BGRA_PASS frames=1 refused=2 dim1d=%u independent_blend=1 srgb=0\n",lim->maxImageDimension1D);fflush(stdout);
    }
    printf("GUEST_VK_ZINKCAPS_PASS frames=11\n");fflush(stdout);
    result=0;
done:
    if(device){
        if(tl)vkDestroySemaphore(device,tl,NULL);if(tl2)vkDestroySemaphore(device,tl2,NULL);
        if(cb)vkFreeCommandBuffers(device,cpool,1,&cb);if(cpool)vkDestroyCommandPool(device,cpool,NULL);
        if(dyn_bgra)vkDestroyPipeline(device,dyn_bgra,NULL);if(bgra_view)vkDestroyImageView(device,bgra_view,NULL);
        if(bgra_image)vkDestroyImage(device,bgra_image,NULL);if(bgra_mem)vkFreeMemory(device,bgra_mem,NULL);
        if(rp2_pipe)vkDestroyPipeline(device,rp2_pipe,NULL);if(dyn_depth)vkDestroyPipeline(device,dyn_depth,NULL);if(dyn_tint)vkDestroyPipeline(device,dyn_tint,NULL);
        if(fb)vkDestroyFramebuffer(device,fb,NULL);if(pass2)vkDestroyRenderPass(device,pass2,NULL);
        if(tmpl)vkDestroyDescriptorUpdateTemplate(device,tmpl,NULL);if(pool)vkDestroyDescriptorPool(device,pool,NULL);
        if(uniform_layout)vkDestroyPipelineLayout(device,uniform_layout,NULL);if(empty_layout)vkDestroyPipelineLayout(device,empty_layout,NULL);
        if(set_layout)vkDestroyDescriptorSetLayout(device,set_layout,NULL);
        if(depth_vs)vkDestroyShaderModule(device,depth_vs,NULL);if(depth_fs)vkDestroyShaderModule(device,depth_fs,NULL);
        if(offset_vs)vkDestroyShaderModule(device,offset_vs,NULL);if(tint_fs)vkDestroyShaderModule(device,tint_fs,NULL);
        if(pmap)vkUnmapMemory(device,params_mem);if(params)vkDestroyBuffer(device,params,NULL);if(params_mem)vkFreeMemory(device,params_mem,NULL);
        if(qmap)vkUnmapMemory(device,qvert_mem);if(qverts)vkDestroyBuffer(device,qverts,NULL);if(qvert_mem)vkFreeMemory(device,qvert_mem,NULL);
        if(dmap)vkUnmapMemory(device,dvert_mem);if(dverts)vkDestroyBuffer(device,dverts,NULL);if(dvert_mem)vkFreeMemory(device,dvert_mem,NULL);
        if(mapped)vkUnmapMemory(device,read_mem);if(readback)vkDestroyBuffer(device,readback,NULL);if(read_mem)vkFreeMemory(device,read_mem,NULL);
        if(depth_view)vkDestroyImageView(device,depth_view,NULL);if(depth_image)vkDestroyImage(device,depth_image,NULL);if(depth_mem)vkFreeMemory(device,depth_mem,NULL);
        if(color_view)vkDestroyImageView(device,color_view,NULL);if(color_image)vkDestroyImage(device,color_image,NULL);if(image_mem)vkFreeMemory(device,image_mem,NULL);
        vkDestroyDevice(device,NULL);
    }
    if(instance)vkDestroyInstance(instance,NULL);
    printf("GUEST_VK_ZINKCAPS_EXIT status=%d checks=%u\n",result,checks);fflush(stdout);alarm(0);return result;
}
