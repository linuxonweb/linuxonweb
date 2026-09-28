/* Separate application translation unit: only public Vulkan and POSIX APIs.
 * The linked upstream loader owns every public vk* symbol used here. */
#define _POSIX_C_SOURCE 200809L
#include <vulkan/vulkan.h>
#include <signal.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>
static void deadline(int number) { (void)number; _exit(124); }
#define CHECK(condition) do { checks++; if (!(condition)) { fprintf(stderr, "GUEST_VK_LOADER_FAIL line=%d check=%s\n", __LINE__, #condition); goto done; } } while (0)

int main(void) {
    unsigned checks=0; int result=1;
    VkInstance instance=VK_NULL_HANDLE; VkDevice device=VK_NULL_HANDLE;
    VkImage image=VK_NULL_HANDLE; VkBuffer buffer=VK_NULL_HANDLE;
    VkDeviceMemory image_memory=VK_NULL_HANDLE, buffer_memory=VK_NULL_HANDLE;
    VkCommandPool pool=VK_NULL_HANDLE; VkCommandBuffer command=VK_NULL_HANDLE;
    void *mapped=NULL;
    VkFence fence=VK_NULL_HANDLE; VkSemaphore semaphore=VK_NULL_HANDLE;
    struct sigaction action={0}; action.sa_handler=deadline; sigemptyset(&action.sa_mask);
    if (sigaction(SIGALRM,&action,NULL)) return 2;
    alarm(90); signal(SIGPIPE,SIG_IGN);
    puts("GUEST_VK_LOADER_SCOPE upstream static loader; core 1.1 queries and fence/binary-semaphore sync; partial clear/copy ICD; not conformant; no shaders, GL or physical GPU claim");
    CHECK(vkGetInstanceProcAddr(VK_NULL_HANDLE,"vkGuestUnknownProcedure")==NULL);
    CHECK(vkGetInstanceProcAddr(VK_NULL_HANDLE,"vkCreateInstance")==(PFN_vkVoidFunction)vkCreateInstance);
    uint32_t count=0;
    CHECK(vkEnumerateInstanceLayerProperties(&count,NULL)==VK_SUCCESS && count==0);
    CHECK(vkEnumerateInstanceExtensionProperties(NULL,&count,NULL)==VK_SUCCESS);
    uint32_t loader_version=0;
    CHECK(vkEnumerateInstanceVersion(&loader_version)==VK_SUCCESS && loader_version>=VK_API_VERSION_1_1);
    /* Core 1.1 application: the loader forwards the *2 queries to the ICD's
     * core entry points instead of emulating them through 1.0 calls. */
    VkApplicationInfo app={.sType=VK_STRUCTURE_TYPE_APPLICATION_INFO,.pApplicationName="public-vulkan-client",.apiVersion=VK_API_VERSION_1_1};
    VkInstanceCreateInfo ii={.sType=VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO,.pApplicationInfo=&app};
    const char *unsupported="VK_GUEST_unsupported_extension";
    ii.enabledExtensionCount=1;ii.ppEnabledExtensionNames=&unsupported;
    CHECK(vkCreateInstance(&ii,NULL,&instance)==VK_ERROR_EXTENSION_NOT_PRESENT && !instance);
    ii.enabledExtensionCount=0;ii.ppEnabledExtensionNames=NULL;
    CHECK(vkCreateInstance(&ii,NULL,&instance)==VK_SUCCESS && instance);
    CHECK(vkGetInstanceProcAddr(instance,"vkGuestUnknownProcedure")==NULL);
    CHECK(vkGetInstanceProcAddr(instance,"vkEnumeratePhysicalDevices")==(PFN_vkVoidFunction)vkEnumeratePhysicalDevices);
    CHECK(vkEnumeratePhysicalDevices(instance,&count,NULL)==VK_SUCCESS && count==1);
    VkPhysicalDevice physical=VK_NULL_HANDLE;
    CHECK(vkEnumeratePhysicalDevices(instance,&count,&physical)==VK_SUCCESS && count==1 && physical);
    VkPhysicalDeviceProperties properties;vkGetPhysicalDeviceProperties(physical,&properties);
    CHECK(properties.apiVersion==VK_API_VERSION_1_1 && properties.deviceType==VK_PHYSICAL_DEVICE_TYPE_OTHER);
    printf("GUEST_VK_LOADER_DEVICE %s\n",properties.deviceName);
    VkPhysicalDeviceFeatures features;vkGetPhysicalDeviceFeatures(physical,&features);
    VkPhysicalDeviceFeatures no_features={0};CHECK(!memcmp(&features,&no_features,sizeof(features)));
    {   /* Core 1.1 queries through the loader: chained ID/Vulkan11 output plus an unknown node. */
        struct { VkBaseOutStructure base; unsigned char body[24]; } unknown={.base={.sType=(VkStructureType)1000999000}},unknown_copy;
        memset(unknown.body,0x5a,sizeof(unknown.body));
        VkPhysicalDeviceVulkan11Properties v11={.sType=VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_VULKAN_1_1_PROPERTIES};
        unknown.base.pNext=(VkBaseOutStructure *)&v11;unknown_copy=unknown;
        VkPhysicalDeviceIDProperties id={.sType=VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_ID_PROPERTIES,.pNext=&unknown};
        memset(id.deviceUUID,0xcc,VK_UUID_SIZE);v11.subgroupSize=0xcccccccc;
        VkPhysicalDeviceProperties2 p2={.sType=VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_PROPERTIES_2,.pNext=&id};
        vkGetPhysicalDeviceProperties2(physical,&p2);
        CHECK(!memcmp(&p2.properties,&properties,sizeof(properties)) && !memcmp(&unknown,&unknown_copy,sizeof(unknown)));
        CHECK(!memcmp(id.deviceUUID,"GUESTVK-EXP-DEV1",VK_UUID_SIZE) && !memcmp(id.driverUUID,"GUESTVK-EXP-DRV1",VK_UUID_SIZE) && !id.deviceLUIDValid);
        CHECK(!memcmp(v11.deviceUUID,id.deviceUUID,VK_UUID_SIZE) && v11.subgroupSize==1 && v11.maxMemoryAllocationSize==1048576);
        VkPhysicalDeviceVulkan11Features f11={.sType=VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_VULKAN_1_1_FEATURES,.multiview=VK_TRUE,.shaderDrawParameters=VK_TRUE};
        VkPhysicalDeviceFeatures2 f2={.sType=VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_FEATURES_2,.pNext=&f11};memset(&f2.features,0xcc,sizeof(f2.features));
        vkGetPhysicalDeviceFeatures2(physical,&f2);
        CHECK(!memcmp(&f2.features,&no_features,sizeof(no_features)) && !f11.multiview && !f11.shaderDrawParameters);
        VkFormat formats[2]={VK_FORMAT_R8G8B8A8_UNORM,VK_FORMAT_B8G8R8A8_UNORM};
        for(unsigned n=0;n<2;n++) {
            VkFormatProperties a;vkGetPhysicalDeviceFormatProperties(physical,formats[n],&a);
            VkFormatProperties2 b={.sType=VK_STRUCTURE_TYPE_FORMAT_PROPERTIES_2};memset(&b.formatProperties,0xcc,sizeof(b.formatProperties));
            vkGetPhysicalDeviceFormatProperties2(physical,formats[n],&b);
            CHECK(!memcmp(&a,&b.formatProperties,sizeof(a)) && (a.optimalTilingFeatures!=0)==(n==0));
        }
        VkPhysicalDeviceMemoryProperties m1;vkGetPhysicalDeviceMemoryProperties(physical,&m1);
        VkPhysicalDeviceMemoryProperties2 m2={.sType=VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_MEMORY_PROPERTIES_2};
        vkGetPhysicalDeviceMemoryProperties2(physical,&m2);CHECK(!memcmp(&m1,&m2.memoryProperties,sizeof(m1)));
        VkQueueFamilyProperties q1;count=1;vkGetPhysicalDeviceQueueFamilyProperties(physical,&count,&q1);
        VkQueueFamilyProperties2 q2={.sType=VK_STRUCTURE_TYPE_QUEUE_FAMILY_PROPERTIES_2};count=0;
        vkGetPhysicalDeviceQueueFamilyProperties2(physical,&count,NULL);CHECK(count==1);
        vkGetPhysicalDeviceQueueFamilyProperties2(physical,&count,&q2);CHECK(count==1 && !memcmp(&q1,&q2.queueFamilyProperties,sizeof(q1)));
        VkPhysicalDeviceGroupProperties group={.sType=VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_GROUP_PROPERTIES};count=0;
        CHECK(vkEnumeratePhysicalDeviceGroups(instance,&count,NULL)==VK_SUCCESS && count==1);
        CHECK(vkEnumeratePhysicalDeviceGroups(instance,&count,&group)==VK_SUCCESS && count==1 && group.physicalDeviceCount==1 && group.physicalDevices[0]==physical);
        puts("GUEST_VK_LOADER_CORE11_PASS api=1.1 properties2=1 features2=1 format2=2 memory2=1 queue2=1 groups=1");fflush(stdout);
    }
    count=0;vkGetPhysicalDeviceQueueFamilyProperties(physical,&count,NULL);CHECK(count==1);
    VkQueueFamilyProperties family;vkGetPhysicalDeviceQueueFamilyProperties(physical,&count,&family);
    CHECK(count==1 && family.queueCount==1 && family.queueFlags==(VK_QUEUE_COMPUTE_BIT|VK_QUEUE_TRANSFER_BIT));
    CHECK(vkEnumerateDeviceExtensionProperties(physical,NULL,&count,NULL)==VK_SUCCESS && count==0);
    float priority=1;
    VkDeviceQueueCreateInfo qi={.sType=VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO,.queueCount=1,.pQueuePriorities=&priority};
    VkDeviceCreateInfo di={.sType=VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO,.queueCreateInfoCount=1,.pQueueCreateInfos=&qi};
    di.enabledExtensionCount=1;di.ppEnabledExtensionNames=&unsupported;
    CHECK(vkCreateDevice(physical,&di,NULL,&device)==VK_ERROR_EXTENSION_NOT_PRESENT && !device);
    di.enabledExtensionCount=0;di.ppEnabledExtensionNames=NULL;
    CHECK(vkCreateDevice(physical,&di,NULL,&device)==VK_SUCCESS && device);
    CHECK(vkGetDeviceProcAddr(device,"vkGuestUnknownProcedure")==NULL);
    PFN_vkQueueWaitIdle queue_wait=(PFN_vkQueueWaitIdle)vkGetDeviceProcAddr(device,"vkQueueWaitIdle");
    CHECK(queue_wait!=NULL);
    VkQueue queue=VK_NULL_HANDLE;vkGetDeviceQueue(device,0,0,&queue);CHECK(queue!=VK_NULL_HANDLE);
    VkDeviceQueueInfo2 queue_info2={.sType=VK_STRUCTURE_TYPE_DEVICE_QUEUE_INFO_2};
    VkQueue queue2=VK_NULL_HANDLE;vkGetDeviceQueue2(device,&queue_info2,&queue2);CHECK(queue2==queue);
    VkFenceCreateInfo fence_info={.sType=VK_STRUCTURE_TYPE_FENCE_CREATE_INFO};
    CHECK(vkCreateFence(device,&fence_info,NULL,&fence)==VK_SUCCESS && fence && vkGetFenceStatus(device,fence)==VK_NOT_READY);
    VkSemaphoreCreateInfo semaphore_info={.sType=VK_STRUCTURE_TYPE_SEMAPHORE_CREATE_INFO};
    CHECK(vkCreateSemaphore(device,&semaphore_info,NULL,&semaphore)==VK_SUCCESS && semaphore);
    VkPipelineStageFlags wait_stage=VK_PIPELINE_STAGE_TRANSFER_BIT;
    VkPhysicalDeviceMemoryProperties memory;vkGetPhysicalDeviceMemoryProperties(physical,&memory);
    CHECK(memory.memoryTypeCount==2 && memory.memoryHeapCount==1 && memory.memoryHeaps[0].size==1048576);
    CHECK(memory.memoryTypes[1].propertyFlags==(VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT|VK_MEMORY_PROPERTY_HOST_COHERENT_BIT));
    VkFormatProperties format;vkGetPhysicalDeviceFormatProperties(physical,VK_FORMAT_R8G8B8A8_UNORM,&format);
    CHECK(!format.linearTilingFeatures && !format.bufferFeatures && format.optimalTilingFeatures==(VK_FORMAT_FEATURE_TRANSFER_SRC_BIT|VK_FORMAT_FEATURE_TRANSFER_DST_BIT));
    vkGetPhysicalDeviceFormatProperties(physical,VK_FORMAT_B8G8R8A8_UNORM,&format);
    CHECK(!format.linearTilingFeatures && !format.bufferFeatures && !format.optimalTilingFeatures);
    VkImageFormatProperties image_limits;
    VkImageUsageFlags transfer_usage=VK_IMAGE_USAGE_TRANSFER_SRC_BIT|VK_IMAGE_USAGE_TRANSFER_DST_BIT;
    CHECK(vkGetPhysicalDeviceImageFormatProperties(physical,VK_FORMAT_R8G8B8A8_UNORM,VK_IMAGE_TYPE_2D,VK_IMAGE_TILING_OPTIMAL,transfer_usage,0,&image_limits)==VK_SUCCESS);
    CHECK(image_limits.maxExtent.width==128 && image_limits.maxExtent.height==128 && image_limits.maxExtent.depth==1 &&
        image_limits.maxMipLevels==1 && image_limits.maxArrayLayers==1 && image_limits.sampleCounts==VK_SAMPLE_COUNT_1_BIT && image_limits.maxResourceSize==65536);
    CHECK(vkGetPhysicalDeviceImageFormatProperties(physical,VK_FORMAT_B8G8R8A8_UNORM,VK_IMAGE_TYPE_2D,VK_IMAGE_TILING_OPTIMAL,transfer_usage,0,&image_limits)==VK_ERROR_FORMAT_NOT_SUPPORTED);
    CHECK(image_limits.maxResourceSize==0 && image_limits.maxExtent.width==0);
    CHECK(vkGetPhysicalDeviceImageFormatProperties(physical,VK_FORMAT_R8G8B8A8_UNORM,VK_IMAGE_TYPE_3D,VK_IMAGE_TILING_OPTIMAL,transfer_usage,0,&image_limits)==VK_ERROR_FORMAT_NOT_SUPPORTED);
    CHECK(vkGetPhysicalDeviceImageFormatProperties(physical,VK_FORMAT_R8G8B8A8_UNORM,VK_IMAGE_TYPE_2D,VK_IMAGE_TILING_OPTIMAL,VK_IMAGE_USAGE_STORAGE_BIT,0,&image_limits)==VK_ERROR_FORMAT_NOT_SUPPORTED);
    count=77;vkGetPhysicalDeviceSparseImageFormatProperties(physical,VK_FORMAT_R8G8B8A8_UNORM,VK_IMAGE_TYPE_2D,VK_SAMPLE_COUNT_1_BIT,transfer_usage,VK_IMAGE_TILING_OPTIMAL,&count,NULL);
    CHECK(count==0);
    VkImageCreateInfo image_info={.sType=VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO,.imageType=VK_IMAGE_TYPE_2D,.format=VK_FORMAT_R8G8B8A8_UNORM,
        .extent={17,3,1},.mipLevels=1,.arrayLayers=1,.samples=VK_SAMPLE_COUNT_1_BIT,.tiling=VK_IMAGE_TILING_OPTIMAL,
        .usage=VK_IMAGE_USAGE_TRANSFER_SRC_BIT|VK_IMAGE_USAGE_TRANSFER_DST_BIT,.sharingMode=VK_SHARING_MODE_EXCLUSIVE};
    CHECK(vkCreateImage(device,&image_info,NULL,&image)==VK_SUCCESS && image);
    VkBufferCreateInfo buffer_info={.sType=VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO,.size=212,.usage=VK_BUFFER_USAGE_TRANSFER_DST_BIT,.sharingMode=VK_SHARING_MODE_EXCLUSIVE};
    CHECK(vkCreateBuffer(device,&buffer_info,NULL,&buffer)==VK_SUCCESS && buffer);
    VkMemoryRequirements ir,br;vkGetImageMemoryRequirements(device,image,&ir);vkGetBufferMemoryRequirements(device,buffer,&br);
    CHECK(ir.size==204 && ir.memoryTypeBits==1 && br.size==212 && br.memoryTypeBits==2);
    VkMemoryAllocateInfo allocation={.sType=VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO,.allocationSize=ir.size,.memoryTypeIndex=0};
    CHECK(vkAllocateMemory(device,&allocation,NULL,&image_memory)==VK_SUCCESS);
    allocation.allocationSize=br.size;allocation.memoryTypeIndex=1;
    CHECK(vkAllocateMemory(device,&allocation,NULL,&buffer_memory)==VK_SUCCESS);
    CHECK(vkBindImageMemory(device,image,image_memory,0)==VK_SUCCESS);
    CHECK(vkBindBufferMemory(device,buffer,buffer_memory,0)==VK_SUCCESS);
    CHECK(vkMapMemory(device,buffer_memory,0,VK_WHOLE_SIZE,0,&mapped)==VK_SUCCESS && mapped);
    memset(mapped,0xa5,212);
    VkCommandPoolCreateInfo pi={.sType=VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO,.flags=VK_COMMAND_POOL_CREATE_RESET_COMMAND_BUFFER_BIT};
    CHECK(vkCreateCommandPool(device,&pi,NULL,&pool)==VK_SUCCESS);
    VkCommandBufferAllocateInfo ca={.sType=VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO,.commandPool=pool,.level=VK_COMMAND_BUFFER_LEVEL_PRIMARY,.commandBufferCount=1};
    CHECK(vkAllocateCommandBuffers(device,&ca,&command)==VK_SUCCESS && command);
    VkCommandBufferBeginInfo begin={.sType=VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO};
    VkSubmitInfo submit={.sType=VK_STRUCTURE_TYPE_SUBMIT_INFO,.commandBufferCount=1,.pCommandBuffers=&command};
    VkImageSubresourceRange range={VK_IMAGE_ASPECT_COLOR_BIT,0,1,0,1};
    VkClearColorValue colors[2]={ {.float32={1,0,0,1}}, {.float32={0,1,0,0}} };
    unsigned char expected[2][4]={{255,0,0,255},{0,255,0,0}};
    VkBufferImageCopy copy={.imageSubresource={VK_IMAGE_ASPECT_COLOR_BIT,0,0,1},.imageExtent={17,3,1}};
    VkImageMemoryBarrier barrier={.sType=VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER,.srcQueueFamilyIndex=VK_QUEUE_FAMILY_IGNORED,
        .dstQueueFamilyIndex=VK_QUEUE_FAMILY_IGNORED,.image=image,.subresourceRange=range};
    VkBufferMemoryBarrier host={.sType=VK_STRUCTURE_TYPE_BUFFER_MEMORY_BARRIER,.srcAccessMask=VK_ACCESS_TRANSFER_WRITE_BIT,.dstAccessMask=VK_ACCESS_HOST_READ_BIT,
        .srcQueueFamilyIndex=VK_QUEUE_FAMILY_IGNORED,.dstQueueFamilyIndex=VK_QUEUE_FAMILY_IGNORED,.buffer=buffer,.size=VK_WHOLE_SIZE};
    for (unsigned round=0;round<2;round++) {
        CHECK(vkBeginCommandBuffer(command,&begin)==VK_SUCCESS);
        barrier.oldLayout=round?VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL:VK_IMAGE_LAYOUT_UNDEFINED;barrier.newLayout=VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL;
        barrier.srcAccessMask=round?VK_ACCESS_TRANSFER_READ_BIT:0;barrier.dstAccessMask=VK_ACCESS_TRANSFER_WRITE_BIT;
        vkCmdPipelineBarrier(command,round?VK_PIPELINE_STAGE_TRANSFER_BIT:VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT,VK_PIPELINE_STAGE_TRANSFER_BIT,0,0,NULL,0,NULL,1,&barrier);
        vkCmdClearColorImage(command,image,VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL,&colors[round],1,&range);
        barrier.oldLayout=VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL;barrier.newLayout=VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL;
        barrier.srcAccessMask=VK_ACCESS_TRANSFER_WRITE_BIT;barrier.dstAccessMask=VK_ACCESS_TRANSFER_READ_BIT;
        vkCmdPipelineBarrier(command,VK_PIPELINE_STAGE_TRANSFER_BIT,VK_PIPELINE_STAGE_TRANSFER_BIT,0,0,NULL,0,NULL,1,&barrier);
        vkCmdCopyImageToBuffer(command,image,VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL,buffer,1,&copy);
        vkCmdPipelineBarrier(command,VK_PIPELINE_STAGE_TRANSFER_BIT,VK_PIPELINE_STAGE_HOST_BIT,0,0,NULL,1,&host,0,NULL);
        CHECK(vkEndCommandBuffer(command)==VK_SUCCESS);
        for(unsigned p=0;p<204;p++) CHECK(((unsigned char *)mapped)[p]==(round?expected[0][p%4]:0xa5));
        /* Round 0 signals the semaphore and fence; round 1 reuses the fence and waits on the semaphore. */
        if(round) { CHECK(vkResetFences(device,1,&fence)==VK_SUCCESS && vkGetFenceStatus(device,fence)==VK_NOT_READY);
            submit.waitSemaphoreCount=1;submit.pWaitSemaphores=&semaphore;submit.pWaitDstStageMask=&wait_stage; }
        else { submit.signalSemaphoreCount=1;submit.pSignalSemaphores=&semaphore; }
        CHECK(vkQueueSubmit(queue,1,&submit,fence)==VK_SUCCESS);
        submit.waitSemaphoreCount=0;submit.pWaitSemaphores=NULL;submit.pWaitDstStageMask=NULL;submit.signalSemaphoreCount=0;submit.pSignalSemaphores=NULL;
        CHECK(vkWaitForFences(device,1,&fence,VK_TRUE,UINT64_MAX)==VK_SUCCESS && vkGetFenceStatus(device,fence)==VK_SUCCESS);
        CHECK(queue_wait(queue)==VK_SUCCESS && vkDeviceWaitIdle(device)==VK_SUCCESS);
        for(unsigned p=0;p<204;p++) CHECK(((unsigned char *)mapped)[p]==expected[round][p%4]);
        for(unsigned p=204;p<212;p++) CHECK(((unsigned char *)mapped)[p]==0xa5);
        printf("GUEST_VK_LOADER_PIXELS_PASS round=%u width=17 height=3 bytes=204 rgba=%u,%u,%u,%u\n",round,expected[round][0],expected[round][1],expected[round][2],expected[round][3]);fflush(stdout);
        CHECK(vkResetCommandBuffer(command,0)==VK_SUCCESS);
    }
    puts("GUEST_VK_LOADER_SYNC_PASS fences=1 semaphores=1 submits=2 fence_reuse=1");fflush(stdout);
    result=0;
done:
    if(device) {
        if(fence) vkDestroyFence(device,fence,NULL);
        if(semaphore) vkDestroySemaphore(device,semaphore,NULL);
        if(command) vkFreeCommandBuffers(device,pool,1,&command);
        if(pool) vkDestroyCommandPool(device,pool,NULL);
        if(mapped) vkUnmapMemory(device,buffer_memory);
        if(image) vkDestroyImage(device,image,NULL);
        if(buffer) vkDestroyBuffer(device,buffer,NULL);
        if(image_memory) vkFreeMemory(device,image_memory,NULL);
        if(buffer_memory) vkFreeMemory(device,buffer_memory,NULL);
        vkDestroyDevice(device,NULL);
    }
    if(instance) vkDestroyInstance(instance,NULL);
    printf("GUEST_VK_LOADER_EXIT status=%d checks=%u\n",result,checks);fflush(stdout);alarm(0);return result;
}
