/* Exercise independent byte and table budgets, then reuse the same device for
 * actual clear/copy work. These audit functions are test-only, not Vulkan APIs. */
static int exhaustion_test(VkInstance instance,VkDevice device,unsigned *total) {
    unsigned checks=0;
#define E(test) do {checks++;if(!(test)){fprintf(stderr,"GUEST_VK_FAIL exhaustion line=%d check=%s\n",__LINE__,#test);*total+=checks;return -1;}}while(0)
#define F(name) PFN_vk##name name=(PFN_vk##name)vk_icdGetInstanceProcAddr(instance,"vk" #name);E(name!=NULL)
    F(AllocateMemory);F(FreeMemory);F(MapMemory);F(UnmapMemory);
    VkDeviceMemory memory[32]={0},rejected=VK_NULL_HANDLE;
    VkMemoryAllocateInfo ai={.sType=VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO,.allocationSize=65536,.memoryTypeIndex=1};
    E(guest_vk_live_resources()==0&&guest_vk_allocated_bytes()==0);
    for(unsigned i=0;i<16;i++) {
        E(AllocateMemory(device,&ai,NULL,&memory[i])==VK_SUCCESS&&memory[i]);
        void *mapped=NULL;E(MapMemory(device,memory[i],0,VK_WHOLE_SIZE,0,&mapped)==VK_SUCCESS&&mapped);
        memset(mapped,0x40+i,65536);UnmapMemory(device,memory[i]);
    }
    E(guest_vk_live_resources()==16&&guest_vk_allocated_bytes()==1048576);
    ai.allocationSize=1;
    for(unsigned i=0;i<3;i++) {
        rejected=memory[0];E(AllocateMemory(device,&ai,NULL,&rejected)==VK_ERROR_OUT_OF_DEVICE_MEMORY&&!rejected);
        E(guest_vk_live_resources()==16&&guest_vk_allocated_bytes()==1048576);
    }
    VkDeviceMemory stale=memory[7];FreeMemory(device,memory[7],NULL);memory[7]=VK_NULL_HANDLE;
    E(guest_vk_live_resources()==15&&guest_vk_allocated_bytes()==983040);
    ai.allocationSize=65536;E(AllocateMemory(device,&ai,NULL,&memory[7])==VK_SUCCESS&&memory[7]&&memory[7]!=stale);
    E(guest_vk_live_resources()==16&&guest_vk_allocated_bytes()==1048576);
    for(unsigned i=0;i<16;i++) {
        void *mapped=NULL;E(MapMemory(device,memory[i],0,VK_WHOLE_SIZE,0,&mapped)==VK_SUCCESS&&mapped);
        int intact=1;for(unsigned n=0;n<65536;n++)if(((unsigned char *)mapped)[n]!=(i==7?0:0x40+i)){intact=0;break;}
        E(intact);UnmapMemory(device,memory[i]);FreeMemory(device,memory[i],NULL);memory[i]=VK_NULL_HANDLE;
    }
    E(guest_vk_live_resources()==0&&guest_vk_allocated_bytes()==0);
    ai.allocationSize=4;
    for(unsigned i=0;i<32;i++)E(AllocateMemory(device,&ai,NULL,&memory[i])==VK_SUCCESS&&memory[i]);
    E(guest_vk_live_resources()==32&&guest_vk_allocated_bytes()==128);
    for(unsigned i=0;i<3;i++) {
        rejected=memory[0];E(AllocateMemory(device,&ai,NULL,&rejected)==VK_ERROR_OUT_OF_HOST_MEMORY&&!rejected);
        E(guest_vk_live_resources()==32&&guest_vk_allocated_bytes()==128);
    }
    stale=memory[13];FreeMemory(device,memory[13],NULL);memory[13]=VK_NULL_HANDLE;
    E(guest_vk_live_resources()==31&&guest_vk_allocated_bytes()==124);
    E(AllocateMemory(device,&ai,NULL,&memory[13])==VK_SUCCESS&&memory[13]&&memory[13]!=stale);
    E(guest_vk_live_resources()==32&&guest_vk_allocated_bytes()==128);
    void *invalid=(void *)1;E(MapMemory(device,stale,0,VK_WHOLE_SIZE,0,&invalid)==VK_ERROR_MEMORY_MAP_FAILED&&!invalid);
    FreeMemory(device,stale,NULL);E(guest_vk_live_resources()==32&&guest_vk_allocated_bytes()==128);
    for(unsigned i=0;i<32;i++)FreeMemory(device,memory[i],NULL);
    E(guest_vk_live_resources()==0&&guest_vk_allocated_bytes()==0);
    puts("GUEST_VK_EXHAUSTION_PASS heap_bytes=1048576 table_entries=32 rejected=6 recovery=2 live=0 allocated_bytes=0");
    *total+=checks;return 0;
#undef E
#undef F
}
