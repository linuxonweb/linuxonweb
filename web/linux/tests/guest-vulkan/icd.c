/* Experimental bounded Vulkan profiles, also used through the pinned static
 * loader. No conformance, general system driver or physical GPU claim. */
#include "icd.h"
#include "../guest-gpu/guest-gpu.h"
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

struct VkPhysicalDevice_T { VK_LOADER_DATA loader; };
struct VkQueue_T { VK_LOADER_DATA loader; };
struct VkDevice_T { VK_LOADER_DATA loader; struct VkQueue_T queue; };
struct VkInstance_T {
    VK_LOADER_DATA loader;
    struct gpu_session session;
    struct VkPhysicalDevice_T physical;
    VkDevice device;
    int clear_supported, compute_supported, graphics_supported, webgl_backend, failed;
};
_Static_assert(offsetof(struct VkInstance_T, loader) == 0, "instance loader prefix");
_Static_assert(offsetof(struct VkPhysicalDevice_T, loader) == 0, "physical loader prefix");
_Static_assert(offsetof(struct VkDevice_T, loader) == 0, "device loader prefix");
_Static_assert(offsetof(struct VkQueue_T, loader) == 0, "queue loader prefix");
#ifdef __wasm32__
_Static_assert(sizeof(VkInstance) == 4, "wasm32 dispatch handle");
_Static_assert(sizeof(VkBuffer) == 8, "wasm32 nondispatch handle");
#endif
static VkInstance live;
static struct guest_vk_audit audit = {.close_status = -1};
struct guest_vk_audit guest_vk_get_audit(void) { return audit; }
static int physical_valid(VkPhysicalDevice p) { return live && p == &live->physical; }
static int device_valid(VkDevice d) { return live && d && d == live->device; }
/* The real loader passes private link/data-callback nodes down to the ICD.
 * This driver does not invoke those callbacks. Ignore only matching loader
 * nodes; retain rejection of unsupported application chains. A hard bound also
 * rejects cycles without allocating or following an unbounded list. */
static int loader_chain_only(const void *chain, VkStructureType expected) {
    const VkBaseInStructure *node = chain;
    for (unsigned depth = 0; node && depth < 8; depth++, node = node->pNext)
        if (node->sType != expected) return 0;
    return node == NULL;
}

/* HELLO can succeed only after serveGPU has obtained a device or WebGL context.
 * Preserve its observed identity verbatim; do not invent vendor/device IDs. */
static int hello(VkInstance instance) {
    char data[4096]; uint32_t n = 0;
    int status = gpu_call(&instance->session, GPU_HELLO, NULL, 0, data, sizeof(data)-1, &n);
    if (status || !n || memchr(data, '\0', n)) return -1;
    data[n] = 0;
    printf("GUEST_VK_HOST_HELLO %s\n", data); fflush(stdout);
    instance->clear_supported = strstr(data, "\"clearImage\":true") != NULL;
    instance->compute_supported = strstr(data, "\"computeProfile\":1") != NULL;
    instance->graphics_supported = strstr(data, "\"graphicsProfile\":1") != NULL;
    instance->webgl_backend = strstr(data, "\"backend\":\"webgl2\"") != NULL;
    if (instance->webgl_backend && (!instance->graphics_supported || instance->compute_supported || instance->clear_supported ||
        !strstr(data, "\"maxVertexStride\":252") || !strstr(data, "\"integerViewport\":true"))) return -1;
    return 0;
}
static void transfer_cleanup(void);
static VKAPI_ATTR VkResult VKAPI_CALL create_instance(const VkInstanceCreateInfo *info,
        const VkAllocationCallbacks *allocator, VkInstance *out) {
    if (!out) return VK_ERROR_INITIALIZATION_FAILED;
    *out = VK_NULL_HANDLE;
    if (!info || info->sType != VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO ||
        !loader_chain_only(info->pNext, VK_STRUCTURE_TYPE_LOADER_INSTANCE_CREATE_INFO) ||
        info->flags || allocator || live) return VK_ERROR_INITIALIZATION_FAILED;
    if (info->enabledLayerCount) return VK_ERROR_LAYER_NOT_PRESENT;
    if (info->enabledExtensionCount) return VK_ERROR_EXTENSION_NOT_PRESENT;
    if (info->pApplicationInfo) {
        const VkApplicationInfo *app = info->pApplicationInfo;
        if (app->sType != VK_STRUCTURE_TYPE_APPLICATION_INFO || app->pNext)
            return VK_ERROR_INITIALIZATION_FAILED;
        if (app->apiVersion && (VK_API_VERSION_VARIANT(app->apiVersion) ||
            VK_API_VERSION_MAJOR(app->apiVersion) != 1 || VK_API_VERSION_MINOR(app->apiVersion) != 0))
            return VK_ERROR_INCOMPATIBLE_DRIVER;
    }
    VkInstance instance = calloc(1, sizeof(*instance));
    if (!instance) return VK_ERROR_OUT_OF_HOST_MEMORY;
    instance->session.fd = -1;
    set_loader_magic_value(instance); set_loader_magic_value(&instance->physical);
    if (gpu_accept(&instance->session, 4050) || hello(instance)) {
        gpu_close(&instance->session); free(instance); return VK_ERROR_INITIALIZATION_FAILED;
    }
    live = instance; audit.instances_created++; audit.live_instances++;
    *out = instance;
    return VK_SUCCESS;
}
static VKAPI_ATTR void VKAPI_CALL destroy_device(VkDevice device, const VkAllocationCallbacks *allocator) {
    (void)allocator;
    if (!device_valid(device)) return;
    transfer_cleanup();
    live->device = NULL; free(device); audit.devices_destroyed++; audit.live_devices--;
}
static VKAPI_ATTR void VKAPI_CALL destroy_instance(VkInstance instance, const VkAllocationCallbacks *allocator) {
    (void)allocator;
    if (!live || instance != live) return;
    if (instance->device) destroy_device(instance->device, NULL);
    unsigned char reply[512]; uint32_t n = 0;
    audit.close_status = gpu_call(&instance->session, GPU_CLOSE, NULL, 0, reply, sizeof(reply), &n);
    if (!audit.close_status && n) audit.close_status = -1;
    gpu_close(&instance->session); live = NULL; free(instance);
    audit.instances_destroyed++; audit.live_instances--;
    printf("GUEST_VK_CLOSE status=%d\n", audit.close_status); fflush(stdout);
}
static VKAPI_ATTR VkResult VKAPI_CALL instance_extensions(const char *layer, uint32_t *count, VkExtensionProperties *items) {
    (void)items;
    if (layer) return VK_ERROR_LAYER_NOT_PRESENT;
    if (!count) return VK_ERROR_INITIALIZATION_FAILED;
    *count = 0; return VK_SUCCESS;
}
static VKAPI_ATTR VkResult VKAPI_CALL instance_layers(uint32_t *count, VkLayerProperties *items) {
    (void)items;
    if (!count) return VK_ERROR_INITIALIZATION_FAILED;
    *count = 0; return VK_SUCCESS;
}
static VKAPI_ATTR VkResult VKAPI_CALL physical_devices(VkInstance instance, uint32_t *count, VkPhysicalDevice *items) {
    if (!live || instance != live || !count) return VK_ERROR_INITIALIZATION_FAILED;
    if (!items) { *count = 1; return VK_SUCCESS; }
    if (!*count) return VK_INCOMPLETE;
    items[0] = &live->physical; *count = 1; return VK_SUCCESS;
}
static VKAPI_ATTR void VKAPI_CALL physical_properties(VkPhysicalDevice physical, VkPhysicalDeviceProperties *out) {
    if (!out) return;
    memset(out, 0, sizeof(*out));
    if (!physical_valid(physical)) return;
    out->apiVersion = VK_API_VERSION_1_0;
    out->deviceType = VK_PHYSICAL_DEVICE_TYPE_OTHER;
    snprintf(out->deviceName, sizeof(out->deviceName), live->clear_supported ? "EXPERIMENTAL partial clear/copy profile; NOT conformant" : "EXPERIMENTAL WebGPU lifecycle only; not conformant");
    if (live->compute_supported) {
        snprintf(out->deviceName, sizeof(out->deviceName), "EXPERIMENTAL bounded SPIR-V compute; NOT conformant");
        out->limits.maxStorageBufferRange=65536;
        out->limits.maxBoundDescriptorSets=1;
        out->limits.maxPerStageDescriptorStorageBuffers=1;
        out->limits.maxDescriptorSetStorageBuffers=1;
        out->limits.maxPerStageResources=1;
        out->limits.maxComputeSharedMemorySize=16384;
        out->limits.maxComputeWorkGroupCount[0]=out->limits.maxComputeWorkGroupCount[1]=out->limits.maxComputeWorkGroupCount[2]=1;
        out->limits.maxComputeWorkGroupInvocations=64;
        out->limits.maxComputeWorkGroupSize[0]=64;out->limits.maxComputeWorkGroupSize[1]=out->limits.maxComputeWorkGroupSize[2]=1;
        out->limits.minStorageBufferOffsetAlignment=256;out->limits.minMemoryMapAlignment=4;
        out->limits.nonCoherentAtomSize=4;out->limits.maxMemoryAllocationCount=32;
    }
    if (live->graphics_supported) {
        snprintf(out->deviceName, sizeof(out->deviceName), "EXPERIMENTAL bounded SPIR-V graphics; NOT conformant");
        out->limits.maxImageDimension2D=128;out->limits.maxImageArrayLayers=1;
        out->limits.maxFramebufferWidth=out->limits.maxFramebufferHeight=128;out->limits.maxFramebufferLayers=1;
        out->limits.maxColorAttachments=out->limits.maxFragmentOutputAttachments=1;
        out->limits.maxVertexInputBindings=out->limits.maxVertexInputAttributes=8;
        out->limits.maxVertexInputBindingStride=live->webgl_backend?252:2048;
        out->limits.maxVertexInputAttributeOffset=live->webgl_backend?244:2040;
        out->limits.maxVertexOutputComponents=out->limits.maxFragmentInputComponents=32;
        out->limits.maxViewports=1;out->limits.maxViewportDimensions[0]=out->limits.maxViewportDimensions[1]=128;
        out->limits.viewportBoundsRange[0]=0;out->limits.viewportBoundsRange[1]=128;
        out->limits.framebufferColorSampleCounts=VK_SAMPLE_COUNT_1_BIT;
        out->limits.minMemoryMapAlignment=4;out->limits.nonCoherentAtomSize=4;out->limits.maxMemoryAllocationCount=32;
    }
    /* No invented physical PCI IDs or physical acceleration claims. */
}
static VKAPI_ATTR void VKAPI_CALL physical_features(VkPhysicalDevice physical, VkPhysicalDeviceFeatures *out) {
    (void)physical;
    if (out) memset(out, 0, sizeof(*out));
}
/* Loader-required queries describe negotiated bounded usages only. Graphics
 * adds one attachment format and three vertex formats; no sampled/storage or
 * sparse image capabilities are implied. */
static VKAPI_ATTR void VKAPI_CALL format_properties(VkPhysicalDevice physical, VkFormat format, VkFormatProperties *out) {
    if (!out) return;
    memset(out, 0, sizeof(*out));
    if (physical_valid(physical) && live->clear_supported && format == VK_FORMAT_R8G8B8A8_UNORM)
        out->optimalTilingFeatures = VK_FORMAT_FEATURE_TRANSFER_SRC_BIT | VK_FORMAT_FEATURE_TRANSFER_DST_BIT;
    if (physical_valid(physical) && live->graphics_supported) {
        if (format == VK_FORMAT_R8G8B8A8_UNORM)
            out->optimalTilingFeatures |= VK_FORMAT_FEATURE_COLOR_ATTACHMENT_BIT | VK_FORMAT_FEATURE_TRANSFER_SRC_BIT;
        if (format == VK_FORMAT_R32G32_SFLOAT || format == VK_FORMAT_R32G32B32_SFLOAT || format == VK_FORMAT_R32G32B32A32_SFLOAT)
            out->bufferFeatures = VK_FORMAT_FEATURE_VERTEX_BUFFER_BIT;
    }
}
static VKAPI_ATTR VkResult VKAPI_CALL image_format_properties(VkPhysicalDevice physical, VkFormat format,
        VkImageType type, VkImageTiling tiling, VkImageUsageFlags usage, VkImageCreateFlags flags,
        VkImageFormatProperties *out) {
    if (!out) return VK_ERROR_FORMAT_NOT_SUPPORTED;
    memset(out, 0, sizeof(*out));
    if (!physical_valid(physical) || format != VK_FORMAT_R8G8B8A8_UNORM ||
        type != VK_IMAGE_TYPE_2D || tiling != VK_IMAGE_TILING_OPTIMAL || flags ||
        !((live->clear_supported && usage == (VK_IMAGE_USAGE_TRANSFER_SRC_BIT | VK_IMAGE_USAGE_TRANSFER_DST_BIT)) ||
          (live->graphics_supported && usage == (VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT | VK_IMAGE_USAGE_TRANSFER_SRC_BIT))))
        return VK_ERROR_FORMAT_NOT_SUPPORTED;
    out->maxExtent = (VkExtent3D){128,128,1}; out->maxMipLevels = 1; out->maxArrayLayers = 1;
    out->sampleCounts = VK_SAMPLE_COUNT_1_BIT; out->maxResourceSize = 65536;
    return VK_SUCCESS;
}
static VKAPI_ATTR void VKAPI_CALL sparse_image_format_properties(VkPhysicalDevice physical, VkFormat format,
        VkImageType type, VkSampleCountFlagBits samples, VkImageUsageFlags usage, VkImageTiling tiling,
        uint32_t *count, VkSparseImageFormatProperties *out) {
    (void)physical; (void)format; (void)type; (void)samples; (void)usage; (void)tiling; (void)out;
    if (count) *count = 0;
}
static VKAPI_ATTR void VKAPI_CALL queue_properties(VkPhysicalDevice physical, uint32_t *count, VkQueueFamilyProperties *out) {
    if (!count) return;
    if (!physical_valid(physical)) { *count = 0; return; }
    if (!out) { *count = 1; return; }
    if (!*count) return;
    memset(out, 0, sizeof(*out)); out->queueCount = 1; *count = 1;
    if (live->clear_supported || live->compute_supported) out->queueFlags = VK_QUEUE_COMPUTE_BIT | VK_QUEUE_TRANSFER_BIT;
    if (live->graphics_supported) out->queueFlags |= VK_QUEUE_GRAPHICS_BIT | VK_QUEUE_TRANSFER_BIT;
    /* ClearColorImage requires compute/graphics. The opt-in COMPUTE flag
     * denotes a partial command profile; the compute opt-in adds bounded dispatch.
     * This is explicitly incomplete and NOT a conformant Vulkan queue. */
}
static VKAPI_ATTR VkResult VKAPI_CALL device_extensions(VkPhysicalDevice physical, const char *layer,
        uint32_t *count, VkExtensionProperties *out) {
    if (!physical_valid(physical)) return VK_ERROR_INITIALIZATION_FAILED;
    return instance_extensions(layer, count, out);
}
static int any_features(const VkPhysicalDeviceFeatures *f) {
    if (!f) return 0;
#define F(name) if (f->name) return 1;
    F(robustBufferAccess) F(fullDrawIndexUint32) F(imageCubeArray) F(independentBlend)
    F(geometryShader) F(tessellationShader) F(sampleRateShading) F(dualSrcBlend)
    F(logicOp) F(multiDrawIndirect) F(drawIndirectFirstInstance) F(depthClamp)
    F(depthBiasClamp) F(fillModeNonSolid) F(depthBounds) F(wideLines) F(largePoints)
    F(alphaToOne) F(multiViewport) F(samplerAnisotropy) F(textureCompressionETC2)
    F(textureCompressionASTC_LDR) F(textureCompressionBC) F(occlusionQueryPrecise)
    F(pipelineStatisticsQuery) F(vertexPipelineStoresAndAtomics) F(fragmentStoresAndAtomics)
    F(shaderTessellationAndGeometryPointSize) F(shaderImageGatherExtended)
    F(shaderStorageImageExtendedFormats) F(shaderStorageImageMultisample)
    F(shaderStorageImageReadWithoutFormat) F(shaderStorageImageWriteWithoutFormat)
    F(shaderUniformBufferArrayDynamicIndexing) F(shaderSampledImageArrayDynamicIndexing)
    F(shaderStorageBufferArrayDynamicIndexing) F(shaderStorageImageArrayDynamicIndexing)
    F(shaderClipDistance) F(shaderCullDistance) F(shaderFloat64) F(shaderInt64) F(shaderInt16)
    F(shaderResourceResidency) F(shaderResourceMinLod) F(sparseBinding)
    F(sparseResidencyBuffer) F(sparseResidencyImage2D) F(sparseResidencyImage3D)
    F(sparseResidency2Samples) F(sparseResidency4Samples) F(sparseResidency8Samples)
    F(sparseResidency16Samples) F(sparseResidencyAliased) F(variableMultisampleRate) F(inheritedQueries)
#undef F
    return 0;
}
static VKAPI_ATTR VkResult VKAPI_CALL create_device(VkPhysicalDevice physical, const VkDeviceCreateInfo *info,
        const VkAllocationCallbacks *allocator, VkDevice *out) {
    if (!out) return VK_ERROR_INITIALIZATION_FAILED;
    *out = VK_NULL_HANDLE;
    if (!physical_valid(physical) || !info || info->sType != VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO ||
        info->flags || allocator || live->device) return VK_ERROR_INITIALIZATION_FAILED;
    if (info->enabledLayerCount) return VK_ERROR_LAYER_NOT_PRESENT;
    if (info->enabledExtensionCount) return VK_ERROR_EXTENSION_NOT_PRESENT;
    if (!loader_chain_only(info->pNext, VK_STRUCTURE_TYPE_LOADER_DEVICE_CREATE_INFO) ||
        any_features(info->pEnabledFeatures)) return VK_ERROR_FEATURE_NOT_PRESENT;
    if (info->queueCreateInfoCount != 1 || !info->pQueueCreateInfos) return VK_ERROR_INITIALIZATION_FAILED;
    const VkDeviceQueueCreateInfo *q = info->pQueueCreateInfos;
    if (q->sType != VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO || q->pNext || q->flags ||
        q->queueFamilyIndex || q->queueCount != 1 || !q->pQueuePriorities ||
        !(q->pQueuePriorities[0] >= 0.0f && q->pQueuePriorities[0] <= 1.0f))
        return VK_ERROR_INITIALIZATION_FAILED;
    VkDevice device = calloc(1, sizeof(*device));
    if (!device) return VK_ERROR_OUT_OF_HOST_MEMORY;
    if (hello(live)) { free(device); return VK_ERROR_DEVICE_LOST; }
    set_loader_magic_value(device); set_loader_magic_value(&device->queue);
    live->device = device; audit.devices_created++; audit.live_devices++;
    *out = device; return VK_SUCCESS;
}
static VKAPI_ATTR void VKAPI_CALL device_queue(VkDevice device, uint32_t family, uint32_t index, VkQueue *out) {
    if (out) *out = device_valid(device) && !family && !index ? &device->queue : VK_NULL_HANDLE;
}
#include "transfer.inc"
static VKAPI_ATTR PFN_vkVoidFunction VKAPI_CALL device_proc(VkDevice device, const char *name) {
    if (!device_valid(device) || !name) return NULL;
#define PROC(api, impl) if (!strcmp(name, #api)) return (PFN_vkVoidFunction)impl;
    PROC(vkGetDeviceProcAddr, device_proc)
    PROC(vkDestroyDevice, destroy_device)
    PROC(vkGetDeviceQueue, device_queue)
#undef PROC
    PFN_vkVoidFunction graphics = live->graphics_supported ? graphics_proc(name) : NULL;
    if (graphics) return graphics;
    PFN_vkVoidFunction compute = live->compute_supported ? compute_proc(name) : NULL;
    return compute ? compute : (live->clear_supported || live->compute_supported || live->graphics_supported) ? transfer_proc(name) : NULL;
}
VKAPI_ATTR VkResult VKAPI_CALL vk_icdNegotiateLoaderICDInterfaceVersion(uint32_t *version) {
    if (!version || *version < 2) return VK_ERROR_INCOMPATIBLE_DRIVER;
    *version = 2; return VK_SUCCESS;
}
VKAPI_ATTR PFN_vkVoidFunction VKAPI_CALL vk_icdGetInstanceProcAddr(VkInstance instance, const char *name) {
    if (!name) return NULL;
#define PROC(api, impl) if (!strcmp(name, #api)) return (PFN_vkVoidFunction)impl;
    PROC(vkGetInstanceProcAddr, vk_icdGetInstanceProcAddr)
    PROC(vkCreateInstance, create_instance)
    PROC(vkEnumerateInstanceExtensionProperties, instance_extensions)
    PROC(vkEnumerateInstanceLayerProperties, instance_layers)
    if (!live || instance != live) return NULL;
    PROC(vkDestroyInstance, destroy_instance)
    PROC(vkEnumeratePhysicalDevices, physical_devices)
    PROC(vkGetPhysicalDeviceProperties, physical_properties)
    PROC(vkGetPhysicalDeviceFeatures, physical_features)
    PROC(vkGetPhysicalDeviceFormatProperties, format_properties)
    PROC(vkGetPhysicalDeviceImageFormatProperties, image_format_properties)
    PROC(vkGetPhysicalDeviceSparseImageFormatProperties, sparse_image_format_properties)
    PROC(vkGetPhysicalDeviceMemoryProperties, memory_properties)
    PROC(vkGetPhysicalDeviceQueueFamilyProperties, queue_properties)
    PROC(vkEnumerateDeviceExtensionProperties, device_extensions)
    PROC(vkCreateDevice, create_device)
    PROC(vkGetDeviceProcAddr, device_proc)
    PROC(vkDestroyDevice, destroy_device)
    PROC(vkGetDeviceQueue, device_queue)
#undef PROC
    PFN_vkVoidFunction graphics = live->graphics_supported ? graphics_proc(name) : NULL;
    if (graphics) return graphics;
    PFN_vkVoidFunction compute = live->compute_supported ? compute_proc(name) : NULL;
    return compute ? compute : (live->clear_supported || live->compute_supported || live->graphics_supported) ? transfer_proc(name) : NULL;
}
