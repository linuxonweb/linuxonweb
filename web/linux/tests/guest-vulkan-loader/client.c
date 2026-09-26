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
    struct sigaction action={0}; action.sa_handler=deadline; sigemptyset(&action.sa_mask);
    if (sigaction(SIGALRM,&action,NULL)) return 2;
    alarm(90); signal(SIGPIPE,SIG_IGN);
    puts("GUEST_VK_LOADER_SCOPE upstream static loader; partial clear/copy ICD; not conformant; no shaders, GL or physical GPU claim");
    CHECK(vkGetInstanceProcAddr(VK_NULL_HANDLE,"vkGuestUnknownProcedure")==NULL);
    CHECK(vkGetInstanceProcAddr(VK_NULL_HANDLE,"vkCreateInstance")==(PFN_vkVoidFunction)vkCreateInstance);
    uint32_t count=0;
    CHECK(vkEnumerateInstanceLayerProperties(&count,NULL)==VK_SUCCESS && count==0);
    CHECK(vkEnumerateInstanceExtensionProperties(NULL,&count,NULL)==VK_SUCCESS);
    VkApplicationInfo app={.sType=VK_STRUCTURE_TYPE_APPLICATION_INFO,.pApplicationName="public-vulkan-client",.apiVersion=VK_API_VERSION_1_0};
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
    CHECK(properties.apiVersion==VK_API_VERSION_1_0 && properties.deviceType==VK_PHYSICAL_DEVICE_TYPE_OTHER);
    printf("GUEST_VK_LOADER_DEVICE %s\n",properties.deviceName);
    VkPhysicalDeviceFeatures features;vkGetPhysicalDeviceFeatures(physical,&features);
    VkPhysicalDeviceFeatures no_features={0};CHECK(!memcmp(&features,&no_features,sizeof(features)));
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
        CHECK(vkQueueSubmit(queue,1,&submit,VK_NULL_HANDLE)==VK_SUCCESS);
        CHECK(queue_wait(queue)==VK_SUCCESS && vkDeviceWaitIdle(device)==VK_SUCCESS);
        for(unsigned p=0;p<204;p++) CHECK(((unsigned char *)mapped)[p]==expected[round][p%4]);
        for(unsigned p=204;p<212;p++) CHECK(((unsigned char *)mapped)[p]==0xa5);
        printf("GUEST_VK_LOADER_PIXELS_PASS round=%u width=17 height=3 bytes=204 rgba=%u,%u,%u,%u\n",round,expected[round][0],expected[round][1],expected[round][2],expected[round][3]);fflush(stdout);
        CHECK(vkResetCommandBuffer(command,0)==VK_SUCCESS);
    }
    result=0;
done:
    if(device) {
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
