/* Every expected pixel is compared after host queue completion; endpoint colors
 * avoid any rounding ambiguity in rgba8unorm. Device teardown owns error cleanup. */
static int clear_test(VkInstance instance,VkPhysicalDevice physical,VkDevice device,VkQueue queue,unsigned *total,int loss) {
    unsigned checks=0;
#define T(test) do {checks++;if(!(test)){fprintf(stderr,"GUEST_VK_FAIL clear line=%d check=%s\n",__LINE__,#test);*total+=checks;return -1;}}while(0)
#define D(name) PFN_vk##name name=(PFN_vk##name)vk_icdGetInstanceProcAddr(instance,"vk" #name);T(name!=NULL)
    D(CreateImage);D(DestroyImage);D(GetImageMemoryRequirements);D(CreateBuffer);D(DestroyBuffer);D(GetBufferMemoryRequirements);
    D(AllocateMemory);D(FreeMemory);D(BindImageMemory);D(BindBufferMemory);D(MapMemory);D(UnmapMemory);
    D(CreateCommandPool);D(DestroyCommandPool);D(AllocateCommandBuffers);D(FreeCommandBuffers);D(ResetCommandBuffer);
    D(BeginCommandBuffer);D(EndCommandBuffer);D(CmdPipelineBarrier);D(CmdClearColorImage);D(CmdCopyImageToBuffer);
    D(QueueSubmit);D(QueueWaitIdle);D(DeviceWaitIdle);D(GetPhysicalDeviceMemoryProperties);
    T(vk_icdGetInstanceProcAddr(instance,"vkCmdDispatch")==NULL);
    VkPhysicalDeviceMemoryProperties props;GetPhysicalDeviceMemoryProperties(physical,&props);
    T(props.memoryTypeCount==2&&props.memoryTypes[1].propertyFlags==(VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT|VK_MEMORY_PROPERTY_HOST_COHERENT_BIT));
    VkImage image=VK_NULL_HANDLE;VkBuffer buffer=VK_NULL_HANDLE;VkDeviceMemory im=VK_NULL_HANDLE,bm=VK_NULL_HANDLE;
    VkImageCreateInfo ii={.sType=VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO,.imageType=VK_IMAGE_TYPE_2D,.format=VK_FORMAT_R8G8B8A8_UNORM,
      .extent={17,3,1},.mipLevels=1,.arrayLayers=1,.samples=VK_SAMPLE_COUNT_1_BIT,.tiling=VK_IMAGE_TILING_OPTIMAL,
      .usage=VK_IMAGE_USAGE_TRANSFER_SRC_BIT|VK_IMAGE_USAGE_TRANSFER_DST_BIT,.sharingMode=VK_SHARING_MODE_EXCLUSIVE,.initialLayout=VK_IMAGE_LAYOUT_UNDEFINED};
    ii.format=VK_FORMAT_B8G8R8A8_UNORM;T(CreateImage(device,&ii,NULL,&image)==VK_ERROR_FORMAT_NOT_SUPPORTED&&!image);
    ii.format=VK_FORMAT_R8G8B8A8_UNORM;T(CreateImage(device,&ii,NULL,&image)==VK_SUCCESS&&image);
    VkBufferCreateInfo bi={.sType=VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO,.size=212,.usage=VK_BUFFER_USAGE_TRANSFER_DST_BIT,.sharingMode=VK_SHARING_MODE_EXCLUSIVE};
    T(CreateBuffer(device,&bi,NULL,&buffer)==VK_SUCCESS&&buffer);
    VkMemoryRequirements ir,br;GetImageMemoryRequirements(device,image,&ir);GetBufferMemoryRequirements(device,buffer,&br);
    T(ir.size==204&&ir.alignment==4&&ir.memoryTypeBits==1&&br.size==212&&br.memoryTypeBits==2);
    VkMemoryAllocateInfo ai={.sType=VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO,.allocationSize=ir.size,.memoryTypeIndex=0};
    T(AllocateMemory(device,&ai,NULL,&im)==VK_SUCCESS);
    ai.allocationSize=br.size;ai.memoryTypeIndex=1;T(AllocateMemory(device,&ai,NULL,&bm)==VK_SUCCESS);
    T(BindImageMemory(device,image,bm,0)==VK_ERROR_INITIALIZATION_FAILED);
    T(BindImageMemory(device,image,im,4)==VK_ERROR_INITIALIZATION_FAILED);
    T(BindImageMemory(device,image,im,0)==VK_SUCCESS);
    T(BindImageMemory(device,image,im,0)==VK_ERROR_INITIALIZATION_FAILED);
    T(BindBufferMemory(device,buffer,bm,0)==VK_SUCCESS);
    void *mapped=NULL,*invalid=NULL;
    T(MapMemory(device,im,0,VK_WHOLE_SIZE,0,&invalid)==VK_ERROR_MEMORY_MAP_FAILED&&!invalid);
    T(MapMemory(device,bm,213,1,0,&invalid)==VK_ERROR_MEMORY_MAP_FAILED&&!invalid);
    T(MapMemory(device,bm,0,VK_WHOLE_SIZE,0,&mapped)==VK_SUCCESS&&mapped);
    T(MapMemory(device,bm,0,VK_WHOLE_SIZE,0,&invalid)==VK_ERROR_MEMORY_MAP_FAILED&&!invalid);
    memset(mapped,0xa5,212);
    VkCommandPool pool=VK_NULL_HANDLE;VkCommandPoolCreateInfo pi={.sType=VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO,.flags=VK_COMMAND_POOL_CREATE_RESET_COMMAND_BUFFER_BIT};
    T(CreateCommandPool(device,&pi,NULL,&pool)==VK_SUCCESS);
    VkCommandBuffer cb=VK_NULL_HANDLE;VkCommandBufferAllocateInfo ca={.sType=VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO,.commandPool=pool,.level=VK_COMMAND_BUFFER_LEVEL_PRIMARY,.commandBufferCount=1};
    T(AllocateCommandBuffers(device,&ca,&cb)==VK_SUCCESS&&cb&&valid_loader_magic_value(cb));
    VkCommandBufferBeginInfo begin={.sType=VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO};
    VkSubmitInfo submit={.sType=VK_STRUCTURE_TYPE_SUBMIT_INFO,.commandBufferCount=1,.pCommandBuffers=&cb};
    VkImageSubresourceRange range={VK_IMAGE_ASPECT_COLOR_BIT,0,1,0,1};
    VkClearColorValue colors[2]={ {.float32={1,0,0,1}}, {.float32={0,1,0,0}} };
    unsigned char expected[2][4]={{255,0,0,255},{0,255,0,0}};
    VkBufferImageCopy copy={.imageSubresource={VK_IMAGE_ASPECT_COLOR_BIT,0,0,1},.imageExtent={17,3,1}};
    VkImageMemoryBarrier barrier={.sType=VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER,.srcQueueFamilyIndex=VK_QUEUE_FAMILY_IGNORED,
      .dstQueueFamilyIndex=VK_QUEUE_FAMILY_IGNORED,.image=image,.subresourceRange=range};
    VkBufferMemoryBarrier host={.sType=VK_STRUCTURE_TYPE_BUFFER_MEMORY_BARRIER,.srcAccessMask=VK_ACCESS_TRANSFER_WRITE_BIT,.dstAccessMask=VK_ACCESS_HOST_READ_BIT,
      .srcQueueFamilyIndex=VK_QUEUE_FAMILY_IGNORED,.dstQueueFamilyIndex=VK_QUEUE_FAMILY_IGNORED,.buffer=buffer,.size=VK_WHOLE_SIZE};
    /* Unsupported void command poisons recording, and reset recovers it. */
    T(BeginCommandBuffer(cb,&begin)==VK_SUCCESS);
    CmdClearColorImage(cb,image,VK_IMAGE_LAYOUT_GENERAL,&colors[0],1,&range);
    T(EndCommandBuffer(cb)==VK_ERROR_INITIALIZATION_FAILED);
    T(QueueSubmit(queue,1,&submit,VK_NULL_HANDLE)==VK_ERROR_INITIALIZATION_FAILED);
    T(ResetCommandBuffer(cb,0)==VK_SUCCESS);
    for(unsigned round=0;round<2;round++) {
        T(BeginCommandBuffer(cb,&begin)==VK_SUCCESS);
        barrier.oldLayout=round?VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL:VK_IMAGE_LAYOUT_UNDEFINED;
        barrier.newLayout=VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL;
        barrier.srcAccessMask=round?VK_ACCESS_TRANSFER_READ_BIT:0;barrier.dstAccessMask=VK_ACCESS_TRANSFER_WRITE_BIT;
        CmdPipelineBarrier(cb,round?VK_PIPELINE_STAGE_TRANSFER_BIT:VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT,VK_PIPELINE_STAGE_TRANSFER_BIT,0,0,NULL,0,NULL,1,&barrier);
        VkClearColorValue recorded_color=colors[round];
        CmdClearColorImage(cb,image,VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL,&recorded_color,1,&range);
        memset(&recorded_color,0,sizeof(recorded_color)); /* Must not alter recorded command. */
        barrier.oldLayout=VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL;barrier.newLayout=VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL;
        barrier.srcAccessMask=VK_ACCESS_TRANSFER_WRITE_BIT;barrier.dstAccessMask=VK_ACCESS_TRANSFER_READ_BIT;
        CmdPipelineBarrier(cb,VK_PIPELINE_STAGE_TRANSFER_BIT,VK_PIPELINE_STAGE_TRANSFER_BIT,0,0,NULL,0,NULL,1,&barrier);
        CmdCopyImageToBuffer(cb,image,VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL,buffer,1,&copy);
        CmdPipelineBarrier(cb,VK_PIPELINE_STAGE_TRANSFER_BIT,VK_PIPELINE_STAGE_HOST_BIT,0,0,NULL,1,&host,0,NULL);
        T(EndCommandBuffer(cb)==VK_SUCCESS);
        /* Recording never writes host-generated bytes into mapped storage. */
        for(unsigned p=0;p<204;p++)T(((unsigned char *)mapped)[p]==(round?expected[0][p%4]:0xa5));
        submit.signalSemaphoreCount=1;T(QueueSubmit(queue,1,&submit,VK_NULL_HANDLE)==VK_ERROR_INITIALIZATION_FAILED);submit.signalSemaphoreCount=0;
        if(loss) {
            T(QueueSubmit(queue,1,&submit,VK_NULL_HANDLE)==VK_ERROR_DEVICE_LOST);
            T(QueueWaitIdle(queue)==VK_ERROR_DEVICE_LOST);
            T(DeviceWaitIdle(device)==VK_ERROR_DEVICE_LOST);
            T(QueueSubmit(queue,1,&submit,VK_NULL_HANDLE)==VK_ERROR_DEVICE_LOST);
            T(ResetCommandBuffer(cb,0)==VK_SUCCESS);
            T(BeginCommandBuffer(cb,&begin)==VK_SUCCESS);
            CmdClearColorImage(cb,image,VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL,&colors[1],1,&range);
            T(EndCommandBuffer(cb)==VK_SUCCESS);
            T(QueueSubmit(queue,1,&submit,VK_NULL_HANDLE)==VK_ERROR_DEVICE_LOST);
            for(unsigned p=0;p<212;p++)T(((unsigned char *)mapped)[p]==0xa5);
            /* DestroyDevice deliberately owns remaining pool/image/buffer/memory cleanup. */
            T(guest_vk_live_resources()==4&&guest_vk_allocated_bytes()==416);
            puts("GUEST_VK_LOSS_PASS submit=-4 queue_idle=-4 device_idle=-4 resubmit=-4 fresh_submit=-4 unchanged_bytes=212");
            *total+=checks;return 0;
        }
        T(QueueSubmit(queue,1,&submit,VK_NULL_HANDLE)==VK_SUCCESS);
        T(QueueWaitIdle(queue)==VK_SUCCESS&&DeviceWaitIdle(device)==VK_SUCCESS);
        for(unsigned p=0;p<204;p++)T(((unsigned char *)mapped)[p]==expected[round][p%4]);
        for(unsigned p=204;p<212;p++)T(((unsigned char *)mapped)[p]==0xa5);
        printf("GUEST_VK_PIXELS_PASS round=%u width=17 height=3 bytes=204 rgba=%u,%u,%u,%u\n",round,expected[round][0],expected[round][1],expected[round][2],expected[round][3]);fflush(stdout);
        T(ResetCommandBuffer(cb,0)==VK_SUCCESS);
    }
    /* Layout mismatch is rejected before a host clear can run. */
    T(BeginCommandBuffer(cb,&begin)==VK_SUCCESS);
    barrier.oldLayout=VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL;barrier.newLayout=VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL;
    barrier.srcAccessMask=VK_ACCESS_TRANSFER_WRITE_BIT;barrier.dstAccessMask=VK_ACCESS_TRANSFER_READ_BIT;
    CmdPipelineBarrier(cb,VK_PIPELINE_STAGE_TRANSFER_BIT,VK_PIPELINE_STAGE_TRANSFER_BIT,0,0,NULL,0,NULL,1,&barrier);
    T(EndCommandBuffer(cb)==VK_SUCCESS);T(QueueSubmit(queue,1,&submit,VK_NULL_HANDLE)==VK_ERROR_INITIALIZATION_FAILED);
    T(ResetCommandBuffer(cb,0)==VK_SUCCESS);
    /* Stale recorded image handle cannot alias a later resource. */
    T(BeginCommandBuffer(cb,&begin)==VK_SUCCESS);CmdClearColorImage(cb,image,VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL,&colors[0],1,&range);T(EndCommandBuffer(cb)==VK_SUCCESS);
    DestroyImage(device,image,NULL);VkImage replacement=VK_NULL_HANDLE;
    T(CreateImage(device,&ii,NULL,&replacement)==VK_SUCCESS&&replacement!=image);
    T(QueueSubmit(queue,1,&submit,VK_NULL_HANDLE)==VK_ERROR_INITIALIZATION_FAILED);
    GetImageMemoryRequirements(device,image,&ir);T(ir.size==0);DestroyImage(device,replacement,NULL);
    FreeCommandBuffers(device,pool,1,&cb);DestroyCommandPool(device,pool,NULL);
    UnmapMemory(device,bm);T(MapMemory(device,bm,204,8,0,&mapped)==VK_SUCCESS);
    for(unsigned p=0;p<8;p++)T(((unsigned char *)mapped)[p]==0xa5);
    UnmapMemory(device,bm);DestroyBuffer(device,buffer,NULL);FreeMemory(device,im,NULL);FreeMemory(device,bm,NULL);
    T(guest_vk_live_resources()==0);
    puts("GUEST_VK_CLEAR_PASS colors=2 pixels=102 tight_rows=68 host_rows=256");*total+=checks;return 0;
#undef T
#undef D
}
