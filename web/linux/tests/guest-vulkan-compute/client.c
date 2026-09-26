/* Separate application: exclusively public Vulkan and POSIX interfaces. */
#define _POSIX_C_SOURCE 200809L
#include <vulkan/vulkan.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include "shaders.h"
static void deadline(int n){(void)n;_exit(124);}
#define CHECK(c) do{checks++;if(!(c)){fprintf(stderr,"GUEST_VK_COMPUTE_FAIL line=%d check=%s\n",__LINE__,#c);goto done;}}while(0)
static uint32_t input(unsigned i,unsigned round){return (i*7919u)^((i%5u)*0xdeadbeefu)^(round*0x13579bdu);}
static uint32_t formula(uint32_t x,unsigned round){return round?((x^85u)+17u)*5u:x*3u+7u;}
static void barrier(VkCommandBuffer cb,VkBuffer buffer,unsigned kind){
    VkBufferMemoryBarrier b={.sType=VK_STRUCTURE_TYPE_BUFFER_MEMORY_BARRIER,.buffer=buffer,.size=VK_WHOLE_SIZE,
        .srcQueueFamilyIndex=VK_QUEUE_FAMILY_IGNORED,.dstQueueFamilyIndex=VK_QUEUE_FAMILY_IGNORED};
    VkPipelineStageFlags src,dst;
    if(kind==0){src=VK_PIPELINE_STAGE_HOST_BIT;dst=VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT;b.srcAccessMask=VK_ACCESS_HOST_WRITE_BIT;b.dstAccessMask=VK_ACCESS_SHADER_READ_BIT|VK_ACCESS_SHADER_WRITE_BIT;}
    else if(kind==1){src=dst=VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT;b.srcAccessMask=VK_ACCESS_SHADER_WRITE_BIT;b.dstAccessMask=VK_ACCESS_SHADER_READ_BIT|VK_ACCESS_SHADER_WRITE_BIT;}
    else{src=VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT;dst=VK_PIPELINE_STAGE_HOST_BIT;b.srcAccessMask=VK_ACCESS_SHADER_WRITE_BIT;b.dstAccessMask=VK_ACCESS_HOST_READ_BIT;}
    vkCmdPipelineBarrier(cb,src,dst,0,0,NULL,1,&b,0,NULL);
}
int main(void){
    unsigned checks=0;int result=1;VkInstance instance=VK_NULL_HANDLE;VkDevice device=VK_NULL_HANDLE;
    VkBuffer buffer=VK_NULL_HANDLE;VkDeviceMemory memory=VK_NULL_HANDLE;VkShaderModule shader=VK_NULL_HANDLE;
    VkDescriptorSetLayout set_layout=VK_NULL_HANDLE;VkPipelineLayout layout=VK_NULL_HANDLE;VkPipeline pipeline=VK_NULL_HANDLE;
    VkDescriptorPool descriptors=VK_NULL_HANDLE;VkDescriptorSet set=VK_NULL_HANDLE;VkCommandPool pool=VK_NULL_HANDLE;VkCommandBuffer cb=VK_NULL_HANDLE;
    uint32_t *mapped=NULL,*code=NULL;
    struct sigaction action={0};action.sa_handler=deadline;sigemptyset(&action.sa_mask);if(sigaction(SIGALRM,&action,NULL))return 2;
    alarm(90);signal(SIGPIPE,SIG_IGN);
    puts("GUEST_VK_COMPUTE_SCOPE public static Khronos loader; actual application SPIR-V; bounded nonconformant compute");
    uint32_t count=0;CHECK(vkEnumerateInstanceLayerProperties(&count,NULL)==VK_SUCCESS&&count==0);
    CHECK(vkEnumerateInstanceExtensionProperties(NULL,&count,NULL)==VK_SUCCESS);
    VkApplicationInfo app={.sType=VK_STRUCTURE_TYPE_APPLICATION_INFO,.apiVersion=VK_API_VERSION_1_0,.pApplicationName="public-spirv-compute"};
    VkInstanceCreateInfo ii={.sType=VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO,.pApplicationInfo=&app};
    CHECK(vkCreateInstance(&ii,NULL,&instance)==VK_SUCCESS);
    CHECK(vkGetInstanceProcAddr(instance,"vkGuestUnknown")==NULL);
    CHECK(vkEnumeratePhysicalDevices(instance,&count,NULL)==VK_SUCCESS&&count==1);
    VkPhysicalDevice physical;CHECK(vkEnumeratePhysicalDevices(instance,&count,&physical)==VK_SUCCESS);
    VkPhysicalDeviceProperties properties;vkGetPhysicalDeviceProperties(physical,&properties);
    CHECK(properties.limits.maxComputeWorkGroupInvocations==64&&properties.limits.maxStorageBufferRange==65536);
    VkPhysicalDeviceMemoryProperties mp;vkGetPhysicalDeviceMemoryProperties(physical,&mp);
    CHECK(mp.memoryTypeCount==2&&(mp.memoryTypes[1].propertyFlags&VK_MEMORY_PROPERTY_HOST_COHERENT_BIT));
    VkQueueFamilyProperties qp;count=1;vkGetPhysicalDeviceQueueFamilyProperties(physical,&count,&qp);CHECK(qp.queueFlags&VK_QUEUE_COMPUTE_BIT);
    float priority=1;VkDeviceQueueCreateInfo qi={.sType=VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO,.queueCount=1,.pQueuePriorities=&priority};
    VkDeviceCreateInfo di={.sType=VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO,.queueCreateInfoCount=1,.pQueueCreateInfos=&qi};
    CHECK(vkCreateDevice(physical,&di,NULL,&device)==VK_SUCCESS);
    CHECK(vkGetDeviceProcAddr(device,"vkCmdDispatch")!=NULL&&vkGetDeviceProcAddr(device,"vkGuestUnknown")==NULL);
    VkQueue queue;vkGetDeviceQueue(device,0,0,&queue);CHECK(queue!=VK_NULL_HANDLE);
    VkBufferCreateInfo bi={.sType=VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO,.size=272,.usage=VK_BUFFER_USAGE_STORAGE_BUFFER_BIT,.sharingMode=VK_SHARING_MODE_EXCLUSIVE};
    CHECK(vkCreateBuffer(device,&bi,NULL,&buffer)==VK_SUCCESS);
    VkMemoryRequirements mr;vkGetBufferMemoryRequirements(device,buffer,&mr);CHECK(mr.size==272&&mr.memoryTypeBits==2);
    VkMemoryAllocateInfo ai={.sType=VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO,.allocationSize=288,.memoryTypeIndex=1};
    CHECK(vkAllocateMemory(device,&ai,NULL,&memory)==VK_SUCCESS);CHECK(vkBindBufferMemory(device,buffer,memory,0)==VK_SUCCESS);
    CHECK(vkMapMemory(device,memory,0,VK_WHOLE_SIZE,0,(void**)&mapped)==VK_SUCCESS);
    VkDescriptorSetLayoutBinding binding={.binding=0,.descriptorType=VK_DESCRIPTOR_TYPE_STORAGE_BUFFER,.descriptorCount=1,.stageFlags=VK_SHADER_STAGE_COMPUTE_BIT};
    VkDescriptorSetLayoutCreateInfo sli={.sType=VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO,.bindingCount=1,.pBindings=&binding};
    CHECK(vkCreateDescriptorSetLayout(device,&sli,NULL,&set_layout)==VK_SUCCESS);memset(&binding,0xff,sizeof(binding));
    VkPipelineLayoutCreateInfo pli={.sType=VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO,.setLayoutCount=1,.pSetLayouts=&set_layout};
    CHECK(vkCreatePipelineLayout(device,&pli,NULL,&layout)==VK_SUCCESS);
    VkDescriptorPoolSize ps={VK_DESCRIPTOR_TYPE_STORAGE_BUFFER,1};VkDescriptorPoolCreateInfo dpi={.sType=VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO,.maxSets=1,.poolSizeCount=1,.pPoolSizes=&ps};
    CHECK(vkCreateDescriptorPool(device,&dpi,NULL,&descriptors)==VK_SUCCESS);
    VkDescriptorSetAllocateInfo dai={.sType=VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO,.descriptorPool=descriptors,.descriptorSetCount=1,.pSetLayouts=&set_layout};
    CHECK(vkAllocateDescriptorSets(device,&dai,&set)==VK_SUCCESS);
    VkDescriptorBufferInfo dbi={.buffer=buffer,.range=272};VkWriteDescriptorSet write={.sType=VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET,.dstSet=set,.descriptorCount=1,.descriptorType=VK_DESCRIPTOR_TYPE_STORAGE_BUFFER,.pBufferInfo=&dbi};
    vkUpdateDescriptorSets(device,1,&write,0,NULL);memset(&dbi,0xff,sizeof(dbi));memset(&write,0xff,sizeof(write));
    VkCommandPoolCreateInfo cpi={.sType=VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO,.flags=VK_COMMAND_POOL_CREATE_RESET_COMMAND_BUFFER_BIT};
    CHECK(vkCreateCommandPool(device,&cpi,NULL,&pool)==VK_SUCCESS);
    VkCommandBufferAllocateInfo cai={.sType=VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO,.commandPool=pool,.level=VK_COMMAND_BUFFER_LEVEL_PRIMARY,.commandBufferCount=1};
    CHECK(vkAllocateCommandBuffers(device,&cai,&cb)==VK_SUCCESS);
    VkCommandBufferBeginInfo begin={.sType=VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO};VkSubmitInfo submit={.sType=VK_STRUCTURE_TYPE_SUBMIT_INFO,.commandBufferCount=1,.pCommandBuffers=&cb};
    for(unsigned round=0;round<2;round++){
        if(round){uint32_t bad[5]={0};VkShaderModuleCreateInfo malformed={.sType=VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO,.codeSize=sizeof(bad),.pCode=bad};
            CHECK(vkCreateShaderModule(device,&malformed,NULL,&shader)==VK_ERROR_INITIALIZATION_FAILED&&!shader);CHECK(vkDeviceWaitIdle(device)==VK_SUCCESS);}
        size_t length=round?sizeof(shader_b):sizeof(shader_a);code=malloc(length);CHECK(code!=NULL);memcpy(code,round?shader_b:shader_a,length);
        VkShaderModuleCreateInfo smi={.sType=VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO,.codeSize=length,.pCode=code};
        CHECK(vkCreateShaderModule(device,&smi,NULL,&shader)==VK_SUCCESS);memset(code,0,length);free(code);code=NULL;
        VkComputePipelineCreateInfo pi={.sType=VK_STRUCTURE_TYPE_COMPUTE_PIPELINE_CREATE_INFO,.layout=layout,.basePipelineIndex=-1,
            .stage={.sType=VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO,.stage=VK_SHADER_STAGE_COMPUTE_BIT,.module=shader,.pName="main"}};
        CHECK(vkCreateComputePipelines(device,VK_NULL_HANDLE,1,&pi,NULL,&pipeline)==VK_SUCCESS);
        vkDestroyShaderModule(device,shader,NULL);shader=VK_NULL_HANDLE;
        CHECK(vkResetCommandBuffer(cb,0)==VK_SUCCESS);CHECK(vkBeginCommandBuffer(cb,&begin)==VK_SUCCESS);
        /* Missing host-write barrier is rejected before any GPU side effect. */
        vkCmdBindPipeline(cb,VK_PIPELINE_BIND_POINT_COMPUTE,pipeline);vkCmdBindDescriptorSets(cb,VK_PIPELINE_BIND_POINT_COMPUTE,layout,0,1,&set,0,NULL);
        vkCmdDispatch(cb,1,1,1);barrier(cb,buffer,2);CHECK(vkEndCommandBuffer(cb)==VK_SUCCESS);
        memset(mapped,0xa5,288);CHECK(vkQueueSubmit(queue,1,&submit,VK_NULL_HANDLE)==VK_ERROR_INITIALIZATION_FAILED);
        for(unsigned i=0;i<72;i++)CHECK(mapped[i]==0xa5a5a5a5u);
        CHECK(vkResetCommandBuffer(cb,0)==VK_SUCCESS);CHECK(vkBeginCommandBuffer(cb,&begin)==VK_SUCCESS);
        barrier(cb,buffer,0);vkCmdBindPipeline(cb,VK_PIPELINE_BIND_POINT_COMPUTE,pipeline);vkCmdBindDescriptorSets(cb,VK_PIPELINE_BIND_POINT_COMPUTE,layout,0,1,&set,0,NULL);vkCmdDispatch(cb,1,1,1);
        if(round){barrier(cb,buffer,1);vkCmdDispatch(cb,1,1,1);}
        barrier(cb,buffer,2);CHECK(vkEndCommandBuffer(cb)==VK_SUCCESS);
        /* Coherent writes occur after recording, immediately before submission. */
        for(unsigned i=0;i<64;i++)mapped[i]=input(i,round);
        for(unsigned i=64;i<72;i++)mapped[i]=0xfeed0000u+i;
        CHECK(vkQueueSubmit(queue,1,&submit,VK_NULL_HANDLE)==VK_SUCCESS);CHECK(vkQueueWaitIdle(queue)==VK_SUCCESS);
        for(unsigned i=0;i<64;i++){uint32_t expected=formula(input(i,round),round);if(round)expected=formula(expected,round);CHECK(mapped[i]==expected);}
        for(unsigned i=64;i<72;i++)CHECK(mapped[i]==0xfeed0000u+i);
        printf("GUEST_VK_COMPUTE_WORDS_PASS round=%u words=64 gpu_tail=4 allocation_tail=4 dispatches=%u\n",round,round+1);fflush(stdout);
        /* Excess dispatch count with all references/bindings otherwise valid. */
        CHECK(vkResetCommandBuffer(cb,0)==VK_SUCCESS);CHECK(vkBeginCommandBuffer(cb,&begin)==VK_SUCCESS);
        barrier(cb,buffer,0);vkCmdBindPipeline(cb,VK_PIPELINE_BIND_POINT_COMPUTE,pipeline);vkCmdBindDescriptorSets(cb,VK_PIPELINE_BIND_POINT_COMPUTE,layout,0,1,&set,0,NULL);vkCmdDispatch(cb,2,1,1);
        CHECK(vkEndCommandBuffer(cb)==VK_ERROR_INITIALIZATION_FAILED);CHECK(vkResetCommandBuffer(cb,0)==VK_SUCCESS);
        /* Reference deleted after recording is rejected with mapped bytes intact. */
        CHECK(vkResetCommandBuffer(cb,0)==VK_SUCCESS);CHECK(vkBeginCommandBuffer(cb,&begin)==VK_SUCCESS);
        barrier(cb,buffer,0);vkCmdBindPipeline(cb,VK_PIPELINE_BIND_POINT_COMPUTE,pipeline);vkCmdBindDescriptorSets(cb,VK_PIPELINE_BIND_POINT_COMPUTE,layout,0,1,&set,0,NULL);vkCmdDispatch(cb,1,1,1);barrier(cb,buffer,2);
        CHECK(vkEndCommandBuffer(cb)==VK_SUCCESS);vkDestroyPipeline(device,pipeline,NULL);pipeline=VK_NULL_HANDLE;
        CHECK(vkQueueSubmit(queue,1,&submit,VK_NULL_HANDLE)==VK_ERROR_INITIALIZATION_FAILED);CHECK(vkDeviceWaitIdle(device)==VK_SUCCESS);
        for(unsigned i=0;i<64;i++){uint32_t expected=formula(input(i,round),round);if(round)expected=formula(expected,round);CHECK(mapped[i]==expected);}
        for(unsigned i=64;i<72;i++)CHECK(mapped[i]==0xfeed0000u+i);
    }
    result=0;
done:
    free(code);
    if(device){
        if(cb)vkFreeCommandBuffers(device,pool,1,&cb);
        if(pool)vkDestroyCommandPool(device,pool,NULL);
        if(pipeline)vkDestroyPipeline(device,pipeline,NULL);
        if(shader)vkDestroyShaderModule(device,shader,NULL);
        if(descriptors)vkDestroyDescriptorPool(device,descriptors,NULL);
        if(layout)vkDestroyPipelineLayout(device,layout,NULL);
        if(set_layout)vkDestroyDescriptorSetLayout(device,set_layout,NULL);
        if(mapped)vkUnmapMemory(device,memory);
        if(buffer)vkDestroyBuffer(device,buffer,NULL);
        if(memory)vkFreeMemory(device,memory,NULL);
        vkDestroyDevice(device,NULL);
    }
    if(instance)vkDestroyInstance(instance,NULL);
    printf("GUEST_VK_COMPUTE_EXIT status=%d checks=%u\n",result,checks);fflush(stdout);alarm(0);return result;
}
