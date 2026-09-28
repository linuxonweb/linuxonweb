#define _POSIX_C_SOURCE 200809L
#include "icd.h"
#include <signal.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>
static void deadline(int signal_number) { (void)signal_number; _exit(124); }
#define CHECK(condition) do { checks++; if (!(condition)) { fprintf(stderr, "GUEST_VK_FAIL line=%d check=%s\n", __LINE__, #condition); goto done; } } while (0)
#define LOAD(type, variable, owner, name) type variable = (type)vk_icdGetInstanceProcAddr(owner, name); CHECK(variable != NULL)
#include "clear-test.inc"
#include "exhaustion-test.inc"
/* Core 1.1 physical-device queries (guest-only; no host requests). Output
 * chains are pre-filled with garbage: recognized structures must be fully
 * rewritten, and an unknown structure must be left byte-identical. */
struct unknown_out { VkBaseOutStructure base; unsigned char body[40]; };
static int core11_test(VkInstance instance, VkPhysicalDevice physical, int clear, unsigned *total) {
    unsigned checks = 0;
#define T(test) do {checks++;if(!(test)){fprintf(stderr,"GUEST_VK_FAIL core11 line=%d check=%s\n",__LINE__,#test);*total+=checks;return -1;}}while(0)
#define D(name) PFN_vk##name name=(PFN_vk##name)vk_icdGetInstanceProcAddr(instance,"vk" #name);T(name!=NULL)
#define GARBAGE(s) memset((char *)&(s)+sizeof(VkBaseOutStructure),0xcc,sizeof(s)-sizeof(VkBaseOutStructure))
    D(GetPhysicalDeviceProperties);D(GetPhysicalDeviceFeatures);D(GetPhysicalDeviceQueueFamilyProperties);
    D(GetPhysicalDeviceMemoryProperties);D(GetPhysicalDeviceFormatProperties);D(GetPhysicalDeviceImageFormatProperties);
    D(GetPhysicalDeviceProperties2);D(GetPhysicalDeviceFeatures2);D(GetPhysicalDeviceQueueFamilyProperties2);
    D(GetPhysicalDeviceMemoryProperties2);D(GetPhysicalDeviceFormatProperties2);D(GetPhysicalDeviceImageFormatProperties2);
    D(GetPhysicalDeviceSparseImageFormatProperties2);D(EnumeratePhysicalDeviceGroups);
    D(GetPhysicalDeviceExternalBufferProperties);D(GetPhysicalDeviceExternalFenceProperties);D(GetPhysicalDeviceExternalSemaphoreProperties);
    /* No KHR aliases: the corresponding extensions are not advertised. */
    T(vk_icdGetInstanceProcAddr(instance,"vkGetPhysicalDeviceProperties2KHR")==NULL);
    T(vk_icdGetInstanceProcAddr(instance,"vkGetPhysicalDeviceFeatures2KHR")==NULL);
    T(vk_icdGetInstanceProcAddr(instance,"vkEnumeratePhysicalDeviceGroupsKHR")==NULL);
    VkPhysicalDeviceProperties base; GetPhysicalDeviceProperties(physical,&base);
    T(base.apiVersion==VK_API_VERSION_1_1);
    /* Properties2: ID -> unknown -> Vulkan11 -> Maintenance3 -> Subgroup -> PointClipping. */
    struct unknown_out unknown={.base={.sType=(VkStructureType)1000999000}},unknown_copy;
    memset(unknown.body,0x5a,sizeof(unknown.body));
    VkPhysicalDevicePointClippingProperties clipping={.sType=VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_POINT_CLIPPING_PROPERTIES};GARBAGE(clipping);
    VkPhysicalDeviceSubgroupProperties subgroup={.sType=VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_SUBGROUP_PROPERTIES,.pNext=&clipping};GARBAGE(subgroup);
    VkPhysicalDeviceMaintenance3Properties maintenance={.sType=VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_MAINTENANCE_3_PROPERTIES,.pNext=&subgroup};GARBAGE(maintenance);
    VkPhysicalDeviceVulkan11Properties v11={.sType=VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_VULKAN_1_1_PROPERTIES,.pNext=&maintenance};GARBAGE(v11);
    unknown.base.pNext=(VkBaseOutStructure *)&v11;unknown_copy=unknown;
    VkPhysicalDeviceIDProperties id={.sType=VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_ID_PROPERTIES,.pNext=&unknown};GARBAGE(id);
    VkPhysicalDeviceProperties2 p2={.sType=VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_PROPERTIES_2,.pNext=&id};
    memset(&p2.properties,0xcc,sizeof(p2.properties));
    GetPhysicalDeviceProperties2(physical,&p2);
    T(!memcmp(&p2.properties,&base,sizeof(base)));
    T(!memcmp(&unknown,&unknown_copy,sizeof(unknown))); /* unknown node untouched, chain preserved */
    T(p2.pNext==&id&&id.pNext==(void *)&unknown&&v11.pNext==&maintenance&&maintenance.pNext==&subgroup&&subgroup.pNext==&clipping&&clipping.pNext==NULL);
    static const uint8_t zero_uuid[VK_UUID_SIZE];
    T(memcmp(id.deviceUUID,zero_uuid,VK_UUID_SIZE)&&memcmp(id.driverUUID,zero_uuid,VK_UUID_SIZE)&&memcmp(id.deviceUUID,id.driverUUID,VK_UUID_SIZE));
    T(!id.deviceLUIDValid&&!id.deviceNodeMask);
    for(unsigned n=0;n<VK_LUID_SIZE;n++)T(!id.deviceLUID[n]);
    T(!memcmp(v11.deviceUUID,id.deviceUUID,VK_UUID_SIZE)&&!memcmp(v11.driverUUID,id.driverUUID,VK_UUID_SIZE)&&!v11.deviceLUIDValid);
    T(v11.subgroupSize==1&&!v11.subgroupSupportedStages&&!v11.subgroupSupportedOperations&&!v11.subgroupQuadOperationsInAllStages);
    T(subgroup.subgroupSize==1&&!subgroup.supportedStages&&!subgroup.supportedOperations&&!subgroup.quadOperationsInAllStages);
    T(!v11.maxMultiviewViewCount&&!v11.maxMultiviewInstanceIndex&&!v11.protectedNoFault&&v11.pointClippingBehavior==0);
    T(clipping.pointClippingBehavior==VK_POINT_CLIPPING_BEHAVIOR_ALL_CLIP_PLANES);
    T(maintenance.maxMemoryAllocationSize==(clear?1048576u:0u)&&v11.maxMemoryAllocationSize==maintenance.maxMemoryAllocationSize);
    T(maintenance.maxPerSetDescriptors==v11.maxPerSetDescriptors);
    /* Features2: every 1.1 feature false; base matches the 1.0 query. */
    VkPhysicalDeviceFeatures f1; GetPhysicalDeviceFeatures(physical,&f1);
    VkPhysicalDeviceMultiviewFeatures multiview={.sType=VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_MULTIVIEW_FEATURES};GARBAGE(multiview);
    struct unknown_out unknown2={.base={.sType=(VkStructureType)1000999001,.pNext=(VkBaseOutStructure *)&multiview}},unknown2_copy;
    memset(unknown2.body,0x3c,sizeof(unknown2.body));unknown2_copy=unknown2;
    VkPhysicalDeviceVulkan11Features f11={.sType=VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_VULKAN_1_1_FEATURES,.pNext=&unknown2};GARBAGE(f11);
    VkPhysicalDeviceFeatures2 f2={.sType=VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_FEATURES_2,.pNext=&f11};memset(&f2.features,0xcc,sizeof(f2.features));
    GetPhysicalDeviceFeatures2(physical,&f2);
    T(!memcmp(&f2.features,&f1,sizeof(f1))&&!memcmp(&unknown2,&unknown2_copy,sizeof(unknown2)));
    T(!f11.storageBuffer16BitAccess&&!f11.multiview&&!f11.variablePointers&&!f11.protectedMemory&&!f11.samplerYcbcrConversion&&!f11.shaderDrawParameters);
    T(!multiview.multiview&&!multiview.multiviewGeometryShader&&!multiview.multiviewTessellationShader&&f11.pNext==(void *)&unknown2);
    /* QueueFamilyProperties2 matches the 1.0 answer, preserving sType/pNext. */
    uint32_t count=0;GetPhysicalDeviceQueueFamilyProperties2(physical,&count,NULL);T(count==1);
    VkQueueFamilyProperties q1;count=1;GetPhysicalDeviceQueueFamilyProperties(physical,&count,&q1);
    VkQueueFamilyProperties2 q2={.sType=VK_STRUCTURE_TYPE_QUEUE_FAMILY_PROPERTIES_2,.pNext=&unknown};memset(&q2.queueFamilyProperties,0xcc,sizeof(q2.queueFamilyProperties));
    count=0;GetPhysicalDeviceQueueFamilyProperties2(physical,&count,&q2);T(count==0&&q2.queueFamilyProperties.queueCount==0xcccccccc);
    count=1;GetPhysicalDeviceQueueFamilyProperties2(physical,&count,&q2);
    T(count==1&&!memcmp(&q2.queueFamilyProperties,&q1,sizeof(q1))&&q2.pNext==&unknown&&!memcmp(&unknown,&unknown_copy,sizeof(unknown)));
    /* MemoryProperties2 matches the 1.0 answer. */
    VkPhysicalDeviceMemoryProperties m1;GetPhysicalDeviceMemoryProperties(physical,&m1);
    VkPhysicalDeviceMemoryProperties2 m2={.sType=VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_MEMORY_PROPERTIES_2,.pNext=&unknown};memset(&m2.memoryProperties,0xcc,sizeof(m2.memoryProperties));
    GetPhysicalDeviceMemoryProperties2(physical,&m2);T(!memcmp(&m2.memoryProperties,&m1,sizeof(m1))&&!memcmp(&unknown,&unknown_copy,sizeof(unknown)));
    /* Format properties are real for implemented usages, zero for all others, and identical through FormatProperties2. */
    static const VkFormat formats[]={VK_FORMAT_UNDEFINED,VK_FORMAT_R8G8B8A8_UNORM,VK_FORMAT_B8G8R8A8_UNORM,VK_FORMAT_R8G8B8A8_SRGB,
        VK_FORMAT_R32G32_SFLOAT,VK_FORMAT_R32G32B32_SFLOAT,VK_FORMAT_R32G32B32A32_SFLOAT,VK_FORMAT_D32_SFLOAT,VK_FORMAT_R16G16B16A16_SFLOAT,(VkFormat)1000156000};
    unsigned nonzero=0;
    for(unsigned n=0;n<sizeof(formats)/sizeof(formats[0]);n++) {
        VkFormatProperties a;memset(&a,0xcc,sizeof(a));GetPhysicalDeviceFormatProperties(physical,formats[n],&a);
        VkFormatProperties2 b={.sType=VK_STRUCTURE_TYPE_FORMAT_PROPERTIES_2,.pNext=&unknown};memset(&b.formatProperties,0xcc,sizeof(b.formatProperties));
        GetPhysicalDeviceFormatProperties2(physical,formats[n],&b);
        T(!memcmp(&a,&b.formatProperties,sizeof(a))&&!memcmp(&unknown,&unknown_copy,sizeof(unknown)));
        VkFormatFeatureFlags expected=clear&&formats[n]==VK_FORMAT_R8G8B8A8_UNORM?VK_FORMAT_FEATURE_TRANSFER_SRC_BIT|VK_FORMAT_FEATURE_TRANSFER_DST_BIT:0;
        T(a.optimalTilingFeatures==expected&&!a.linearTilingFeatures&&!a.bufferFeatures);
        nonzero+=a.optimalTilingFeatures!=0;
    }
    T(nonzero==(clear?1u:0u));
    /* ImageFormatProperties2 matches the 1.0 answer; external handles are refused. */
    VkImageUsageFlags transfer=VK_IMAGE_USAGE_TRANSFER_SRC_BIT|VK_IMAGE_USAGE_TRANSFER_DST_BIT;
    VkImageFormatProperties i1;VkResult r1=GetPhysicalDeviceImageFormatProperties(physical,VK_FORMAT_R8G8B8A8_UNORM,VK_IMAGE_TYPE_2D,VK_IMAGE_TILING_OPTIMAL,transfer,0,&i1);
    VkExternalImageFormatProperties ext_out={.sType=VK_STRUCTURE_TYPE_EXTERNAL_IMAGE_FORMAT_PROPERTIES,.pNext=&unknown};GARBAGE(ext_out);
    VkImageFormatProperties2 i2={.sType=VK_STRUCTURE_TYPE_IMAGE_FORMAT_PROPERTIES_2,.pNext=&ext_out};memset(&i2.imageFormatProperties,0xcc,sizeof(i2.imageFormatProperties));
    VkPhysicalDeviceImageFormatInfo2 info={.sType=VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_IMAGE_FORMAT_INFO_2,.format=VK_FORMAT_R8G8B8A8_UNORM,
        .type=VK_IMAGE_TYPE_2D,.tiling=VK_IMAGE_TILING_OPTIMAL,.usage=transfer};
    T(GetPhysicalDeviceImageFormatProperties2(physical,&info,&i2)==r1&&r1==(clear?VK_SUCCESS:VK_ERROR_FORMAT_NOT_SUPPORTED));
    T(!memcmp(&i2.imageFormatProperties,&i1,sizeof(i1))&&!ext_out.externalMemoryProperties.externalMemoryFeatures&&!ext_out.externalMemoryProperties.compatibleHandleTypes);
    T(!memcmp(&unknown,&unknown_copy,sizeof(unknown)));
    VkPhysicalDeviceExternalImageFormatInfo ext_in={.sType=VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_EXTERNAL_IMAGE_FORMAT_INFO,.handleType=VK_EXTERNAL_MEMORY_HANDLE_TYPE_OPAQUE_FD_BIT};
    info.pNext=&ext_in;T(GetPhysicalDeviceImageFormatProperties2(physical,&info,&i2)==VK_ERROR_FORMAT_NOT_SUPPORTED);
    info.pNext=NULL;info.format=VK_FORMAT_B8G8R8A8_UNORM;T(GetPhysicalDeviceImageFormatProperties2(physical,&info,&i2)==VK_ERROR_FORMAT_NOT_SUPPORTED);
    count=77;VkPhysicalDeviceSparseImageFormatInfo2 sparse={.sType=VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_SPARSE_IMAGE_FORMAT_INFO_2,.format=VK_FORMAT_R8G8B8A8_UNORM,
        .type=VK_IMAGE_TYPE_2D,.samples=VK_SAMPLE_COUNT_1_BIT,.usage=transfer,.tiling=VK_IMAGE_TILING_OPTIMAL};
    GetPhysicalDeviceSparseImageFormatProperties2(physical,&sparse,&count,NULL);T(count==0);
    /* One single-device group naming this physical device. */
    count=0;T(EnumeratePhysicalDeviceGroups(instance,&count,NULL)==VK_SUCCESS&&count==1);
    VkPhysicalDeviceGroupProperties group={.sType=VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_GROUP_PROPERTIES};
    count=0;T(EnumeratePhysicalDeviceGroups(instance,&count,&group)==VK_INCOMPLETE);
    count=1;T(EnumeratePhysicalDeviceGroups(instance,&count,&group)==VK_SUCCESS&&count==1&&group.physicalDeviceCount==1&&
      group.physicalDevices[0]==physical&&!group.physicalDevices[1]&&!group.subsetAllocation);
    /* No external memory, fence or semaphore handle types. */
    VkExternalBufferProperties eb={.sType=VK_STRUCTURE_TYPE_EXTERNAL_BUFFER_PROPERTIES};memset(&eb.externalMemoryProperties,0xcc,sizeof(eb.externalMemoryProperties));
    VkPhysicalDeviceExternalBufferInfo ebi={.sType=VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_EXTERNAL_BUFFER_INFO,.usage=VK_BUFFER_USAGE_TRANSFER_DST_BIT,.handleType=VK_EXTERNAL_MEMORY_HANDLE_TYPE_OPAQUE_FD_BIT};
    GetPhysicalDeviceExternalBufferProperties(physical,&ebi,&eb);
    T(!eb.externalMemoryProperties.externalMemoryFeatures&&!eb.externalMemoryProperties.compatibleHandleTypes&&!eb.externalMemoryProperties.exportFromImportedHandleTypes);
    VkExternalFenceProperties ef={.sType=VK_STRUCTURE_TYPE_EXTERNAL_FENCE_PROPERTIES,.externalFenceFeatures=7,.compatibleHandleTypes=7};
    VkPhysicalDeviceExternalFenceInfo efi={.sType=VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_EXTERNAL_FENCE_INFO,.handleType=VK_EXTERNAL_FENCE_HANDLE_TYPE_SYNC_FD_BIT};
    GetPhysicalDeviceExternalFenceProperties(physical,&efi,&ef);T(!ef.externalFenceFeatures&&!ef.compatibleHandleTypes&&!ef.exportFromImportedHandleTypes);
    VkExternalSemaphoreProperties es={.sType=VK_STRUCTURE_TYPE_EXTERNAL_SEMAPHORE_PROPERTIES,.externalSemaphoreFeatures=7,.compatibleHandleTypes=7};
    VkPhysicalDeviceExternalSemaphoreInfo esi={.sType=VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_EXTERNAL_SEMAPHORE_INFO,.handleType=VK_EXTERNAL_SEMAPHORE_HANDLE_TYPE_SYNC_FD_BIT};
    GetPhysicalDeviceExternalSemaphoreProperties(physical,&esi,&es);T(!es.externalSemaphoreFeatures&&!es.compatibleHandleTypes&&!es.exportFromImportedHandleTypes);
    printf("GUEST_VK_CORE11_QUERY_PASS api=1.1 chained=6 unknown_untouched=1 formats=%u nonzero_formats=%u\n",(unsigned)(sizeof(formats)/sizeof(formats[0])),nonzero);fflush(stdout);
    *total+=checks;return 0;
#undef GARBAGE
#undef T
#undef D
}
int main(int argc, char **argv) {
    unsigned checks = 0; int result = 1;
    int loss = argc == 2 && (!strcmp(argv[1], "--loss-transport") || !strcmp(argv[1], "--loss-device"));
    int exhaustion = argc == 2 && !strcmp(argv[1], "--exhaustion");
    int clear = loss || exhaustion || (argc == 2 && !strcmp(argv[1], "--clear"));
    int unavailable = argc == 2 && !strcmp(argv[1], "--expect-unavailable");
    VkInstance instance = VK_NULL_HANDLE; VkDevice device = VK_NULL_HANDLE;
    PFN_vkDestroyInstance destroy_instance = NULL; PFN_vkDestroyDevice destroy_device = NULL;
    struct sigaction action = {0}; action.sa_handler = deadline; sigemptyset(&action.sa_mask);
    if (sigaction(SIGALRM, &action, NULL)) return 2;
    alarm(90); signal(SIGPIPE, SIG_IGN);
    puts(clear ? "GUEST_VK_SCOPE experimental partial clear/copy profile; no conformance, dispatch, GL or hardware claim" : "GUEST_VK_SCOPE experimental lifecycle only; no rendering, loader conformance, GL or hardware claim");
    uint32_t version = 1;
    CHECK(vk_icdNegotiateLoaderICDInterfaceVersion(&version) == VK_ERROR_INCOMPATIBLE_DRIVER);
    version = 99;
    CHECK(vk_icdNegotiateLoaderICDInterfaceVersion(&version) == VK_SUCCESS && version == 2);
    CHECK(vk_icdGetInstanceProcAddr(NULL, "vkUnknownCommand") == NULL);
    CHECK(vk_icdGetInstanceProcAddr(NULL, "vkCreateDevice") == NULL);
    LOAD(PFN_vkCreateInstance, create_instance, NULL, "vkCreateInstance");
    LOAD(PFN_vkEnumerateInstanceExtensionProperties, instance_extensions, NULL, "vkEnumerateInstanceExtensionProperties");
    uint32_t count = 77;
    CHECK(instance_extensions(NULL, &count, NULL) == VK_SUCCESS && count == 0);
    /* Core 1.1: vkEnumerateInstanceVersion is a pre-instance entry point. */
    LOAD(PFN_vkEnumerateInstanceVersion, instance_version, NULL, "vkEnumerateInstanceVersion");
    uint32_t api = 0;
    CHECK(instance_version(&api) == VK_SUCCESS && api == VK_API_VERSION_1_1 && instance_version(NULL) == VK_ERROR_INITIALIZATION_FAILED);
    CHECK(vk_icdGetInstanceProcAddr(NULL, "vkGetPhysicalDeviceProperties2") == NULL);
    /* A 1.1 implementation accepts any requested apiVersion (checked on the
     * single successful creation below, which requests 1.3). Failing
     * creations here stop before the host HELLO. */
    VkApplicationInfo application = {.sType=VK_STRUCTURE_TYPE_APPLICATION_INFO, .pApplicationName="guest-vulkan-lifecycle", .apiVersion=VK_API_VERSION_1_1};
    VkInstanceCreateInfo instance_info = {.sType=VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO, .pApplicationInfo=&application};
    VkBaseInStructure misplaced = {.sType=VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO};
    application.pNext = &misplaced;
    CHECK(create_instance(&instance_info, NULL, &instance) == VK_ERROR_INITIALIZATION_FAILED && instance == VK_NULL_HANDLE);
    VkBaseInStructure unknown_in = {.sType=(VkStructureType)1000999000};
    application.pNext = &unknown_in;
    const char *extension = "VK_TEST_unsupported";
    instance_info.enabledExtensionCount = 1; instance_info.ppEnabledExtensionNames = &extension;
    CHECK(create_instance(&instance_info, NULL, &instance) == VK_ERROR_EXTENSION_NOT_PRESENT && instance == VK_NULL_HANDLE);
    instance_info.enabledExtensionCount = 0; instance_info.ppEnabledExtensionNames = NULL;
    /* CHAIN_LIMIT is 64 nodes: a 65-node chain and a cycle are rejected. */
    VkBaseInStructure instance_nodes[65];
    for (unsigned n=0;n<65;n++) instance_nodes[n]=(VkBaseInStructure){.sType=VK_STRUCTURE_TYPE_LOADER_INSTANCE_CREATE_INFO,.pNext=n<64?&instance_nodes[n+1]:NULL};
    instance_info.pNext=instance_nodes;
    CHECK(create_instance(&instance_info,NULL,&instance)==VK_ERROR_INITIALIZATION_FAILED && !instance);
    instance_nodes[0].pNext=&instance_nodes[0];
    CHECK(create_instance(&instance_info,NULL,&instance)==VK_ERROR_INITIALIZATION_FAILED && !instance);
    instance_nodes[0].pNext=&instance_nodes[1];instance_nodes[1].pNext=NULL;instance_nodes[1].sType=VK_STRUCTURE_TYPE_APPLICATION_INFO;
    CHECK(create_instance(&instance_info,NULL,&instance)==VK_ERROR_INITIALIZATION_FAILED && !instance);
    instance_nodes[1].sType=VK_STRUCTURE_TYPE_LOADER_INSTANCE_CREATE_INFO;instance_nodes[1].pNext=&unknown_in;
    application.apiVersion = VK_MAKE_API_VERSION(0, 1, 3, 0);
    VkResult created = create_instance(&instance_info, NULL, &instance);
    if (unavailable) {
        CHECK(created == VK_ERROR_INITIALIZATION_FAILED && instance == VK_NULL_HANDLE);
        struct guest_vk_audit state = guest_vk_get_audit();
        CHECK(state.instances_created == 0 && state.devices_created == 0 && !state.live_instances && !state.live_devices);
        puts("GUEST_VK_UNAVAILABLE_PASS"); result = 0; goto done;
    }
    CHECK(created == VK_SUCCESS && instance != VK_NULL_HANDLE);
    destroy_instance = (PFN_vkDestroyInstance)vk_icdGetInstanceProcAddr(instance, "vkDestroyInstance");
    CHECK(destroy_instance != NULL && valid_loader_magic_value(instance));
    LOAD(PFN_vkEnumeratePhysicalDevices, enumerate, instance, "vkEnumeratePhysicalDevices");
    VkPhysicalDevice physical = VK_NULL_HANDLE;
    count = 0; CHECK(enumerate(instance, &count, NULL) == VK_SUCCESS && count == 1);
    count = 0; CHECK(enumerate(instance, &count, &physical) == VK_INCOMPLETE && physical == VK_NULL_HANDLE);
    count = 1; CHECK(enumerate(instance, &count, &physical) == VK_SUCCESS && count == 1 && physical != VK_NULL_HANDLE);
    CHECK(valid_loader_magic_value(physical));
    LOAD(PFN_vkGetPhysicalDeviceProperties, properties, instance, "vkGetPhysicalDeviceProperties");
    VkPhysicalDeviceProperties props; properties(physical, &props);
    CHECK(props.deviceType == VK_PHYSICAL_DEVICE_TYPE_OTHER && !props.vendorID && !props.deviceID);
    printf("GUEST_VK_DEVICE_NAME %s\n", props.deviceName);
    CHECK(props.apiVersion == VK_API_VERSION_1_1);
    CHECK(core11_test(instance, physical, clear, &checks) == 0);
    LOAD(PFN_vkGetPhysicalDeviceQueueFamilyProperties, families, instance, "vkGetPhysicalDeviceQueueFamilyProperties");
    count = 0; families(physical, &count, NULL); CHECK(count == 1);
    VkQueueFamilyProperties family; count = 1; families(physical, &count, &family);
    CHECK(count == 1 && family.queueCount == 1 && family.queueFlags == (clear ? (VK_QUEUE_COMPUTE_BIT|VK_QUEUE_TRANSFER_BIT) : 0));
    LOAD(PFN_vkGetPhysicalDeviceFeatures, features, instance, "vkGetPhysicalDeviceFeatures");
    VkPhysicalDeviceFeatures enabled; features(physical, &enabled);
    CHECK(!enabled.robustBufferAccess && !enabled.geometryShader && !enabled.inheritedQueries);
    LOAD(PFN_vkEnumerateDeviceExtensionProperties, device_extensions, instance, "vkEnumerateDeviceExtensionProperties");
    count = 77; CHECK(device_extensions(physical, NULL, &count, NULL) == VK_SUCCESS && !count);
    LOAD(PFN_vkCreateDevice, create_device, instance, "vkCreateDevice");
    float priority = 1.0f;
    VkDeviceQueueCreateInfo queue_info = {.sType=VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO, .queueCount=1, .pQueuePriorities=&priority};
    VkDeviceCreateInfo device_info = {.sType=VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO, .queueCreateInfoCount=1, .pQueueCreateInfos=&queue_info, .pEnabledFeatures=&enabled};
    enabled.geometryShader = VK_TRUE;
    CHECK(create_device(physical, &device_info, NULL, &device) == VK_ERROR_FEATURE_NOT_PRESENT && device == VK_NULL_HANDLE);
    enabled.geometryShader = VK_FALSE;
    device_info.enabledExtensionCount = 1; device_info.ppEnabledExtensionNames = &extension;
    CHECK(create_device(physical, &device_info, NULL, &device) == VK_ERROR_EXTENSION_NOT_PRESENT && device == VK_NULL_HANDLE);
    device_info.enabledExtensionCount = 0; device_info.ppEnabledExtensionNames = NULL;
    /* Features2 together with pEnabledFeatures is invalid usage. */
    VkPhysicalDeviceFeatures2 features2 = {.sType=VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_FEATURES_2};
    device_info.pNext = &features2;
    CHECK(create_device(physical, &device_info, NULL, &device) == VK_ERROR_INITIALIZATION_FAILED && device == VK_NULL_HANDLE);
    device_info.pEnabledFeatures = NULL; features2.features.geometryShader = VK_TRUE;
    CHECK(create_device(physical, &device_info, NULL, &device) == VK_ERROR_FEATURE_NOT_PRESENT && device == VK_NULL_HANDLE);
    features2.features.geometryShader = VK_FALSE;
    VkPhysicalDeviceVulkan11Features features11 = {.sType=VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_VULKAN_1_1_FEATURES, .multiview=VK_TRUE};
    features2.pNext = &features11;
    CHECK(create_device(physical, &device_info, NULL, &device) == VK_ERROR_FEATURE_NOT_PRESENT && device == VK_NULL_HANDLE);
    features11.multiview = VK_FALSE;
    VkPhysicalDeviceShaderDrawParametersFeatures draw_parameters = {.sType=VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_SHADER_DRAW_PARAMETERS_FEATURES, .shaderDrawParameters=VK_TRUE};
    features11.pNext = &draw_parameters;
    CHECK(create_device(physical, &device_info, NULL, &device) == VK_ERROR_FEATURE_NOT_PRESENT && device == VK_NULL_HANDLE);
    draw_parameters.shaderDrawParameters = VK_FALSE;
    VkPhysicalDevice group_members[2] = {physical, physical};
    VkDeviceGroupDeviceCreateInfo group = {.sType=VK_STRUCTURE_TYPE_DEVICE_GROUP_DEVICE_CREATE_INFO, .physicalDeviceCount=2, .pPhysicalDevices=group_members};
    draw_parameters.pNext = &group;
    CHECK(create_device(physical, &device_info, NULL, &device) == VK_ERROR_INITIALIZATION_FAILED && device == VK_NULL_HANDLE);
    group.physicalDeviceCount = 1; group.pNext = &misplaced;
    CHECK(create_device(physical, &device_info, NULL, &device) == VK_ERROR_FEATURE_NOT_PRESENT && device == VK_NULL_HANDLE);
    group.pNext = &unknown_in; /* Final accepted chain: Features2 -> 1.1 -> draw params -> group -> unknown. */
    device_info.pNext = NULL; device_info.pEnabledFeatures = &enabled; queue_info.queueFamilyIndex = 1;
    CHECK(create_device(physical, &device_info, NULL, &device) == VK_ERROR_INITIALIZATION_FAILED && device == VK_NULL_HANDLE);
    queue_info.queueFamilyIndex = 0;
    VkBaseInStructure device_nodes[65];
    for (unsigned n=0;n<65;n++) device_nodes[n]=(VkBaseInStructure){.sType=VK_STRUCTURE_TYPE_LOADER_DEVICE_CREATE_INFO,.pNext=n<64?&device_nodes[n+1]:NULL};
    device_info.pNext=device_nodes;
    CHECK(create_device(physical,&device_info,NULL,&device)==VK_ERROR_FEATURE_NOT_PRESENT && !device);
    device_nodes[0].pNext=&device_nodes[0];
    CHECK(create_device(physical,&device_info,NULL,&device)==VK_ERROR_FEATURE_NOT_PRESENT && !device);
    device_nodes[0].pNext=&device_nodes[1];device_nodes[1].pNext=NULL;device_nodes[1].sType=VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_FEATURES_2;
    CHECK(create_device(physical,&device_info,NULL,&device)==VK_ERROR_INITIALIZATION_FAILED && !device);
    device_nodes[1].sType=VK_STRUCTURE_TYPE_LOADER_DEVICE_CREATE_INFO;device_nodes[1].pNext=(const VkBaseInStructure *)&features2;device_info.pEnabledFeatures=NULL;
    VkDeviceQueueCreateInfo misplaced_queue = queue_info; misplaced_queue.pNext = &misplaced; device_info.pQueueCreateInfos = &misplaced_queue;
    CHECK(create_device(physical,&device_info,NULL,&device)==VK_ERROR_INITIALIZATION_FAILED && !device);
    misplaced_queue.pNext = &unknown_in; /* Unknown queue-create extension structures are skipped. */
    CHECK(create_device(physical, &device_info, NULL, &device) == VK_SUCCESS && device != VK_NULL_HANDLE);
    CHECK(valid_loader_magic_value(device));
    LOAD(PFN_vkGetDeviceProcAddr, device_proc, instance, "vkGetDeviceProcAddr");
    CHECK((device_proc(device, "vkQueueSubmit") != NULL) == clear && (device_proc(device, "vkCreateImage") != NULL) == clear);
    destroy_device = (PFN_vkDestroyDevice)device_proc(device, "vkDestroyDevice");
    PFN_vkGetDeviceQueue get_queue = (PFN_vkGetDeviceQueue)device_proc(device, "vkGetDeviceQueue");
    CHECK(destroy_device != NULL && get_queue != NULL);
    VkQueue queue = VK_NULL_HANDLE; get_queue(device, 0, 0, &queue);
    CHECK(queue != VK_NULL_HANDLE && valid_loader_magic_value(queue));
    VkQueue again = VK_NULL_HANDLE; get_queue(device, 0, 0, &again); CHECK(again == queue);
    PFN_vkGetDeviceQueue2 get_queue2 = (PFN_vkGetDeviceQueue2)device_proc(device, "vkGetDeviceQueue2");
    CHECK(get_queue2 != NULL && (PFN_vkGetDeviceQueue2)vk_icdGetInstanceProcAddr(instance, "vkGetDeviceQueue2") == get_queue2);
    VkDeviceQueueInfo2 queue_info2 = {.sType=VK_STRUCTURE_TYPE_DEVICE_QUEUE_INFO_2};
    again = VK_NULL_HANDLE; get_queue2(device, &queue_info2, &again); CHECK(again == queue);
    queue_info2.flags = VK_DEVICE_QUEUE_CREATE_PROTECTED_BIT; get_queue2(device, &queue_info2, &again); CHECK(again == VK_NULL_HANDLE);
    queue_info2.flags = 0; queue_info2.queueIndex = 1; again = queue; get_queue2(device, &queue_info2, &again); CHECK(again == VK_NULL_HANDLE);
    printf("GUEST_VK_CORE11_DEVICE_PASS features2=1 vulkan11_features=1 device_group=1 unknown_skipped=1 queue2=1\n"); fflush(stdout);
    if (exhaustion) CHECK(exhaustion_test(instance,device,&checks)==0);
    if (clear) CHECK(clear_test(instance,physical,device,queue,&checks,loss)==0);
    puts("GUEST_VK_DEVICE_PASS"); fflush(stdout);
    destroy_device(device, NULL); device = VK_NULL_HANDLE;
    destroy_instance(instance, NULL); instance = VK_NULL_HANDLE;
    struct guest_vk_audit state = guest_vk_get_audit();
    CHECK(state.instances_created == 1 && state.instances_destroyed == 1 &&
          state.devices_created == 1 && state.devices_destroyed == 1 &&
          state.live_instances == 0 && state.live_devices == 0 &&
          (loss ? state.close_status != 0 : state.close_status == 0) &&
          guest_vk_live_resources() == 0 && guest_vk_allocated_bytes() == 0 && guest_vk_live_sync() == 0);
    puts("GUEST_VK_LIFETIME_PASS live_instances=0 live_devices=0"); result = 0;
done:
    if (device && destroy_device) destroy_device(device, NULL);
    if (instance && destroy_instance) destroy_instance(instance, NULL);
    printf("GUEST_VK_EXIT status=%d checks=%u\n", result, checks); fflush(stdout);
    alarm(0); return result;
}
