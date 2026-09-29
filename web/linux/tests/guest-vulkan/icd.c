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
    int clear_supported, compute_supported, graphics_supported, uniform_supported, webgl_backend, failed;
    uint32_t device_extensions_enabled; /* Bit per device_extension_table index. */
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
 * This driver does not invoke those callbacks. Create-info chains accept the
 * caller-handled structure types; any other core-1.0 structure type (at most
 * LOADER_DEVICE_CREATE_INFO) is a misplaced application structure and is
 * rejected. Later core or extension structures this 1.1 profile does not
 * implement are skipped without being read beyond their header, as the
 * specification requires. A hard bound rejects cycles without allocating. */
#define CHAIN_LIMIT 64
static int chain_valid(const void *chain, const VkStructureType *handled, unsigned count) {
    const VkBaseInStructure *node = chain;
    for (unsigned depth = 0; node && depth < CHAIN_LIMIT; depth++, node = node->pNext) {
        unsigned i = 0;
        while (i < count && node->sType != handled[i]) i++;
        if (i == count && (uint32_t)node->sType <= (uint32_t)VK_STRUCTURE_TYPE_LOADER_DEVICE_CREATE_INFO) return 0;
    }
    return node == NULL;
}
static const void *chain_find(const void *chain, VkStructureType type) {
    const VkBaseInStructure *node = chain;
    for (unsigned depth = 0; node && depth < CHAIN_LIMIT; depth++, node = node->pNext)
        if (node->sType == type) return node;
    return NULL;
}
/* Output chains: clear only the body of recognized structures, preserving the
 * caller's sType/pNext; unknown structures are never written. */
static void zero_body(void *node, size_t size) {
    memset((char *)node + sizeof(VkBaseOutStructure), 0, size - sizeof(VkBaseOutStructure));
}
/* Extension tables. Later packets enable names one at a time by adding an
 * entry; the NULL sentinel keeps the current tables empty. Enabled device
 * extensions are recorded as a bit per table index. */
struct extension_entry { const char *name; uint32_t version; };
static const struct extension_entry instance_extension_table[] = { {NULL, 0} };
static const struct extension_entry device_extension_table[] = { {NULL, 0} };
static VkResult enumerate_extensions(const struct extension_entry *table, uint32_t *count, VkExtensionProperties *out) {
    uint32_t total = 0;
    while (table[total].name) total++;
    if (!out) { *count = total; return VK_SUCCESS; }
    uint32_t written = *count < total ? *count : total;
    for (uint32_t i = 0; i < written; i++) {
        memset(&out[i], 0, sizeof(out[i]));
        snprintf(out[i].extensionName, sizeof(out[i].extensionName), "%s", table[i].name);
        out[i].specVersion = table[i].version;
    }
    *count = written;
    return written < total ? VK_INCOMPLETE : VK_SUCCESS;
}
static int extensions_supported(const struct extension_entry *table, uint32_t count, const char *const *names, uint32_t *mask) {
    if (count && !names) return 0;
    for (uint32_t i = 0; i < count; i++) {
        uint32_t n = 0;
        if (!names[i]) return 0;
        while (table[n].name && strcmp(table[n].name, names[i])) n++;
        if (!table[n].name || n >= 32) return 0;
        if (mask) *mask |= 1u << n;
    }
    return 1;
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
    /* Opt-in A3 uniform-buffer profile; absent from the older host profiles. */
    instance->uniform_supported = instance->graphics_supported && strstr(data, "\"uniformProfile\":1") &&
        strstr(data, "\"maxUniformRange\":16384") && strstr(data, "\"uniformOffsetAlignment\":256");
    return 0;
}
static void transfer_cleanup(void);
static VKAPI_ATTR VkResult VKAPI_CALL create_instance(const VkInstanceCreateInfo *info,
        const VkAllocationCallbacks *allocator, VkInstance *out) {
    if (!out) return VK_ERROR_INITIALIZATION_FAILED;
    *out = VK_NULL_HANDLE;
    static const VkStructureType instance_chain[] = { VK_STRUCTURE_TYPE_LOADER_INSTANCE_CREATE_INFO };
    if (!info || info->sType != VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO ||
        !chain_valid(info->pNext, instance_chain, 1) ||
        info->flags || allocator || live) return VK_ERROR_INITIALIZATION_FAILED;
    if (info->enabledLayerCount) return VK_ERROR_LAYER_NOT_PRESENT;
    if (!extensions_supported(instance_extension_table, info->enabledExtensionCount, info->ppEnabledExtensionNames, NULL))
        return VK_ERROR_EXTENSION_NOT_PRESENT;
    /* A 1.1 implementation must accept every requested apiVersion; the
     * effective instance/device version is the reported 1.1. */
    if (info->pApplicationInfo) {
        const VkApplicationInfo *app = info->pApplicationInfo;
        if (app->sType != VK_STRUCTURE_TYPE_APPLICATION_INFO || !chain_valid(app->pNext, NULL, 0))
            return VK_ERROR_INITIALIZATION_FAILED;
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
    if (layer) return VK_ERROR_LAYER_NOT_PRESENT;
    if (!count) return VK_ERROR_INITIALIZATION_FAILED;
    return enumerate_extensions(instance_extension_table, count, items);
}
static VKAPI_ATTR VkResult VKAPI_CALL instance_version(uint32_t *version) {
    if (!version) return VK_ERROR_INITIALIZATION_FAILED;
    *version = VK_API_VERSION_1_1; return VK_SUCCESS;
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
    out->apiVersion = VK_API_VERSION_1_1;
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
    if (live->uniform_supported) {
        out->limits.maxBoundDescriptorSets=4;
        out->limits.maxUniformBufferRange=16384;
        out->limits.minUniformBufferOffsetAlignment=256;
        out->limits.maxPerStageDescriptorUniformBuffers=8;
        out->limits.maxDescriptorSetUniformBuffers=8;
        out->limits.maxPerStageResources=8;
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
    if (layer) return VK_ERROR_LAYER_NOT_PRESENT;
    if (!count) return VK_ERROR_INITIALIZATION_FAILED;
    return enumerate_extensions(device_extension_table, count, out);
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
/* Device creation accepts the core 1.1 feature structures with every feature
 * false (FEATURE_NOT_PRESENT otherwise), and a single-device group naming this
 * physical device. Features2 together with pEnabledFeatures is invalid. */
static int any_bool(const void *node, size_t size) {
    const VkBool32 *flag = (const VkBool32 *)((const char *)node + sizeof(VkBaseInStructure));
    for (size_t i = 0; i < (size - sizeof(VkBaseInStructure)) / sizeof(VkBool32); i++) if (flag[i]) return 1;
    return 0;
}
static VkResult device_chain(VkPhysicalDevice physical, const VkDeviceCreateInfo *info) {
    static const VkStructureType handled[] = { VK_STRUCTURE_TYPE_LOADER_DEVICE_CREATE_INFO,
        VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_FEATURES_2, VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_VULKAN_1_1_FEATURES,
        VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_16BIT_STORAGE_FEATURES, VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_MULTIVIEW_FEATURES,
        VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_VARIABLE_POINTERS_FEATURES, VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_PROTECTED_MEMORY_FEATURES,
        VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_SAMPLER_YCBCR_CONVERSION_FEATURES, VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_SHADER_DRAW_PARAMETERS_FEATURES,
        VK_STRUCTURE_TYPE_DEVICE_GROUP_DEVICE_CREATE_INFO };
    if (!chain_valid(info->pNext, handled, sizeof(handled) / sizeof(handled[0]))) return VK_ERROR_FEATURE_NOT_PRESENT;
    if (any_features(info->pEnabledFeatures)) return VK_ERROR_FEATURE_NOT_PRESENT;
    const VkBaseInStructure *node = info->pNext;
    for (unsigned depth = 0; node && depth < CHAIN_LIMIT; depth++, node = node->pNext) switch (node->sType) {
    case VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_FEATURES_2:
        if (info->pEnabledFeatures) return VK_ERROR_INITIALIZATION_FAILED;
        if (any_features(&((const VkPhysicalDeviceFeatures2 *)node)->features)) return VK_ERROR_FEATURE_NOT_PRESENT;
        break;
#define FEATURES(stype, type) case stype: if (any_bool(node, sizeof(type))) return VK_ERROR_FEATURE_NOT_PRESENT; break;
    FEATURES(VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_VULKAN_1_1_FEATURES, VkPhysicalDeviceVulkan11Features)
    FEATURES(VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_16BIT_STORAGE_FEATURES, VkPhysicalDevice16BitStorageFeatures)
    FEATURES(VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_MULTIVIEW_FEATURES, VkPhysicalDeviceMultiviewFeatures)
    FEATURES(VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_VARIABLE_POINTERS_FEATURES, VkPhysicalDeviceVariablePointersFeatures)
    FEATURES(VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_PROTECTED_MEMORY_FEATURES, VkPhysicalDeviceProtectedMemoryFeatures)
    FEATURES(VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_SAMPLER_YCBCR_CONVERSION_FEATURES, VkPhysicalDeviceSamplerYcbcrConversionFeatures)
    FEATURES(VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_SHADER_DRAW_PARAMETERS_FEATURES, VkPhysicalDeviceShaderDrawParametersFeatures)
#undef FEATURES
    case VK_STRUCTURE_TYPE_DEVICE_GROUP_DEVICE_CREATE_INFO: {
        const VkDeviceGroupDeviceCreateInfo *group = (const VkDeviceGroupDeviceCreateInfo *)node;
        if (group->physicalDeviceCount > 1 || (group->physicalDeviceCount == 1 &&
            (!group->pPhysicalDevices || group->pPhysicalDevices[0] != physical))) return VK_ERROR_INITIALIZATION_FAILED;
        break;
    }
    default: break;
    }
    return VK_SUCCESS;
}
static VKAPI_ATTR VkResult VKAPI_CALL create_device(VkPhysicalDevice physical, const VkDeviceCreateInfo *info,
        const VkAllocationCallbacks *allocator, VkDevice *out) {
    if (!out) return VK_ERROR_INITIALIZATION_FAILED;
    *out = VK_NULL_HANDLE;
    if (!physical_valid(physical) || !info || info->sType != VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO ||
        info->flags || allocator || live->device) return VK_ERROR_INITIALIZATION_FAILED;
    if (info->enabledLayerCount) return VK_ERROR_LAYER_NOT_PRESENT;
    uint32_t enabled_extensions = 0;
    if (!extensions_supported(device_extension_table, info->enabledExtensionCount, info->ppEnabledExtensionNames, &enabled_extensions))
        return VK_ERROR_EXTENSION_NOT_PRESENT;
    VkResult chain = device_chain(physical, info);
    if (chain != VK_SUCCESS) return chain;
    if (info->queueCreateInfoCount != 1 || !info->pQueueCreateInfos) return VK_ERROR_INITIALIZATION_FAILED;
    const VkDeviceQueueCreateInfo *q = info->pQueueCreateInfos;
    if (q->sType != VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO || !chain_valid(q->pNext, NULL, 0) || q->flags ||
        q->queueFamilyIndex || q->queueCount != 1 || !q->pQueuePriorities ||
        !(q->pQueuePriorities[0] >= 0.0f && q->pQueuePriorities[0] <= 1.0f))
        return VK_ERROR_INITIALIZATION_FAILED;
    VkDevice device = calloc(1, sizeof(*device));
    if (!device) return VK_ERROR_OUT_OF_HOST_MEMORY;
    if (hello(live)) { free(device); return VK_ERROR_DEVICE_LOST; }
    set_loader_magic_value(device); set_loader_magic_value(&device->queue);
    live->device = device; live->device_extensions_enabled = enabled_extensions;
    audit.devices_created++; audit.live_devices++;
    *out = device; return VK_SUCCESS;
}
static VKAPI_ATTR void VKAPI_CALL device_queue(VkDevice device, uint32_t family, uint32_t index, VkQueue *out) {
    if (out) *out = device_valid(device) && !family && !index ? &device->queue : VK_NULL_HANDLE;
}
#include "transfer.inc"
/* Core 1.1 physical-device queries. Base structures reuse the 1.0 answers;
 * recognized 1.1 structures in output chains are filled with this profile's
 * honest (mostly unsupported) values; unrecognized structures are skipped. */
static const uint8_t device_uuid[VK_UUID_SIZE] = {'G','U','E','S','T','V','K','-','E','X','P','-','D','E','V','1'};
static const uint8_t driver_uuid[VK_UUID_SIZE] = {'G','U','E','S','T','V','K','-','E','X','P','-','D','R','V','1'};
static int profile_any(void) { return live->clear_supported || live->compute_supported || live->graphics_supported; }
static VKAPI_ATTR void VKAPI_CALL physical_properties2(VkPhysicalDevice physical, VkPhysicalDeviceProperties2 *out) {
    if (!out) return;
    physical_properties(physical, &out->properties);
    if (!physical_valid(physical)) return;
    uint32_t descriptors = live->uniform_supported ? 4 : live->compute_supported ? 1 : 0;
    VkDeviceSize allocation = profile_any() ? 1024 * 1024 : 0;
    VkBaseOutStructure *node = out->pNext;
    for (unsigned depth = 0; node && depth < CHAIN_LIMIT; depth++, node = node->pNext) switch (node->sType) {
    case VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_ID_PROPERTIES: {
        VkPhysicalDeviceIDProperties *p = (VkPhysicalDeviceIDProperties *)node; zero_body(p, sizeof(*p));
        memcpy(p->deviceUUID, device_uuid, VK_UUID_SIZE); memcpy(p->driverUUID, driver_uuid, VK_UUID_SIZE); break;
    }
    case VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_MAINTENANCE_3_PROPERTIES: {
        VkPhysicalDeviceMaintenance3Properties *p = (VkPhysicalDeviceMaintenance3Properties *)node; zero_body(p, sizeof(*p));
        p->maxPerSetDescriptors = descriptors; p->maxMemoryAllocationSize = allocation; break;
    }
    case VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_SUBGROUP_PROPERTIES: {
        VkPhysicalDeviceSubgroupProperties *p = (VkPhysicalDeviceSubgroupProperties *)node; zero_body(p, sizeof(*p));
        p->subgroupSize = 1; break; /* No subgroup stages/operations are claimed. */
    }
    case VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_POINT_CLIPPING_PROPERTIES:
        zero_body(node, sizeof(VkPhysicalDevicePointClippingProperties)); break;
    case VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_MULTIVIEW_PROPERTIES:
        zero_body(node, sizeof(VkPhysicalDeviceMultiviewProperties)); break;
    case VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_PROTECTED_MEMORY_PROPERTIES:
        zero_body(node, sizeof(VkPhysicalDeviceProtectedMemoryProperties)); break;
    case VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_VULKAN_1_1_PROPERTIES: {
        VkPhysicalDeviceVulkan11Properties *p = (VkPhysicalDeviceVulkan11Properties *)node; zero_body(p, sizeof(*p));
        memcpy(p->deviceUUID, device_uuid, VK_UUID_SIZE); memcpy(p->driverUUID, driver_uuid, VK_UUID_SIZE);
        p->subgroupSize = 1; p->maxPerSetDescriptors = descriptors; p->maxMemoryAllocationSize = allocation; break;
    }
    default: break;
    }
}
static VKAPI_ATTR void VKAPI_CALL physical_features2(VkPhysicalDevice physical, VkPhysicalDeviceFeatures2 *out) {
    if (!out) return;
    physical_features(physical, &out->features);
    VkBaseOutStructure *node = out->pNext;
    for (unsigned depth = 0; node && depth < CHAIN_LIMIT; depth++, node = node->pNext) switch (node->sType) {
#define FEATURES(stype, type) case stype: zero_body(node, sizeof(type)); break;
    FEATURES(VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_VULKAN_1_1_FEATURES, VkPhysicalDeviceVulkan11Features)
    FEATURES(VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_16BIT_STORAGE_FEATURES, VkPhysicalDevice16BitStorageFeatures)
    FEATURES(VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_MULTIVIEW_FEATURES, VkPhysicalDeviceMultiviewFeatures)
    FEATURES(VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_VARIABLE_POINTERS_FEATURES, VkPhysicalDeviceVariablePointersFeatures)
    FEATURES(VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_PROTECTED_MEMORY_FEATURES, VkPhysicalDeviceProtectedMemoryFeatures)
    FEATURES(VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_SAMPLER_YCBCR_CONVERSION_FEATURES, VkPhysicalDeviceSamplerYcbcrConversionFeatures)
    FEATURES(VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_SHADER_DRAW_PARAMETERS_FEATURES, VkPhysicalDeviceShaderDrawParametersFeatures)
#undef FEATURES
    default: break;
    }
}
static VKAPI_ATTR void VKAPI_CALL queue_properties2(VkPhysicalDevice physical, uint32_t *count, VkQueueFamilyProperties2 *out) {
    if (!count) return;
    if (!out) { queue_properties(physical, count, NULL); return; }
    if (*count) queue_properties(physical, count, &out->queueFamilyProperties);
}
static VKAPI_ATTR void VKAPI_CALL memory_properties2(VkPhysicalDevice physical, VkPhysicalDeviceMemoryProperties2 *out) {
    if (out) memory_properties(physical, &out->memoryProperties);
}
static VKAPI_ATTR void VKAPI_CALL format_properties2(VkPhysicalDevice physical, VkFormat format, VkFormatProperties2 *out) {
    if (out) format_properties(physical, format, &out->formatProperties);
}
static VKAPI_ATTR VkResult VKAPI_CALL image_format_properties2(VkPhysicalDevice physical,
        const VkPhysicalDeviceImageFormatInfo2 *info, VkImageFormatProperties2 *out) {
    if (!out) return VK_ERROR_FORMAT_NOT_SUPPORTED;
    memset(&out->imageFormatProperties, 0, sizeof(out->imageFormatProperties));
    VkBaseOutStructure *node = out->pNext;
    for (unsigned depth = 0; node && depth < CHAIN_LIMIT; depth++, node = node->pNext) {
        if (node->sType == VK_STRUCTURE_TYPE_EXTERNAL_IMAGE_FORMAT_PROPERTIES) zero_body(node, sizeof(VkExternalImageFormatProperties));
        if (node->sType == VK_STRUCTURE_TYPE_SAMPLER_YCBCR_CONVERSION_IMAGE_FORMAT_PROPERTIES)
            zero_body(node, sizeof(VkSamplerYcbcrConversionImageFormatProperties));
    }
    if (!info || info->sType != VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_IMAGE_FORMAT_INFO_2) return VK_ERROR_FORMAT_NOT_SUPPORTED;
    const VkPhysicalDeviceExternalImageFormatInfo *external = chain_find(info->pNext, VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_EXTERNAL_IMAGE_FORMAT_INFO);
    if (external && external->handleType) return VK_ERROR_FORMAT_NOT_SUPPORTED; /* No external memory. */
    return image_format_properties(physical, info->format, info->type, info->tiling, info->usage, info->flags, &out->imageFormatProperties);
}
static VKAPI_ATTR void VKAPI_CALL sparse_image_format_properties2(VkPhysicalDevice physical,
        const VkPhysicalDeviceSparseImageFormatInfo2 *info, uint32_t *count, VkSparseImageFormatProperties2 *out) {
    (void)physical; (void)info; (void)out;
    if (count) *count = 0;
}
static VKAPI_ATTR VkResult VKAPI_CALL physical_device_groups(VkInstance instance, uint32_t *count, VkPhysicalDeviceGroupProperties *out) {
    if (!live || instance != live || !count) return VK_ERROR_INITIALIZATION_FAILED;
    if (!out) { *count = 1; return VK_SUCCESS; }
    if (!*count) return VK_INCOMPLETE;
    memset(out->physicalDevices, 0, sizeof(out->physicalDevices));
    out->physicalDeviceCount = 1; out->physicalDevices[0] = &live->physical; out->subsetAllocation = VK_FALSE;
    *count = 1; return VK_SUCCESS;
}
/* No external memory, fence or semaphore handle types are supported. */
static VKAPI_ATTR void VKAPI_CALL external_buffer_properties(VkPhysicalDevice physical,
        const VkPhysicalDeviceExternalBufferInfo *info, VkExternalBufferProperties *out) {
    (void)physical; (void)info;
    if (out) memset(&out->externalMemoryProperties, 0, sizeof(out->externalMemoryProperties));
}
static VKAPI_ATTR void VKAPI_CALL external_fence_properties(VkPhysicalDevice physical,
        const VkPhysicalDeviceExternalFenceInfo *info, VkExternalFenceProperties *out) {
    (void)physical; (void)info;
    if (out) { out->exportFromImportedHandleTypes = 0; out->compatibleHandleTypes = 0; out->externalFenceFeatures = 0; }
}
static VKAPI_ATTR void VKAPI_CALL external_semaphore_properties(VkPhysicalDevice physical,
        const VkPhysicalDeviceExternalSemaphoreInfo *info, VkExternalSemaphoreProperties *out) {
    (void)physical; (void)info;
    if (out) { out->exportFromImportedHandleTypes = 0; out->compatibleHandleTypes = 0; out->externalSemaphoreFeatures = 0; }
}
static VKAPI_ATTR void VKAPI_CALL device_queue2(VkDevice device, const VkDeviceQueueInfo2 *info, VkQueue *out) {
    if (!out) return;
    *out = device_valid(device) && info && info->sType == VK_STRUCTURE_TYPE_DEVICE_QUEUE_INFO_2 && !info->flags &&
        !info->queueFamilyIndex && !info->queueIndex ? &device->queue : VK_NULL_HANDLE;
}
static VKAPI_ATTR PFN_vkVoidFunction VKAPI_CALL device_proc(VkDevice device, const char *name) {
    if (!device_valid(device) || !name) return NULL;
#define PROC(api, impl) if (!strcmp(name, #api)) return (PFN_vkVoidFunction)impl;
    PROC(vkGetDeviceProcAddr, device_proc)
    PROC(vkDestroyDevice, destroy_device)
    PROC(vkGetDeviceQueue, device_queue)
    PROC(vkGetDeviceQueue2, device_queue2)
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
    PROC(vkEnumerateInstanceVersion, instance_version)
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
    PROC(vkGetDeviceQueue2, device_queue2)
    /* Core 1.1 instance/physical-device entry points. KHR aliases are not
     * returned: the corresponding extensions are not advertised. */
    PROC(vkEnumeratePhysicalDeviceGroups, physical_device_groups)
    PROC(vkGetPhysicalDeviceProperties2, physical_properties2)
    PROC(vkGetPhysicalDeviceFeatures2, physical_features2)
    PROC(vkGetPhysicalDeviceQueueFamilyProperties2, queue_properties2)
    PROC(vkGetPhysicalDeviceMemoryProperties2, memory_properties2)
    PROC(vkGetPhysicalDeviceFormatProperties2, format_properties2)
    PROC(vkGetPhysicalDeviceImageFormatProperties2, image_format_properties2)
    PROC(vkGetPhysicalDeviceSparseImageFormatProperties2, sparse_image_format_properties2)
    PROC(vkGetPhysicalDeviceExternalBufferProperties, external_buffer_properties)
    PROC(vkGetPhysicalDeviceExternalFenceProperties, external_fence_properties)
    PROC(vkGetPhysicalDeviceExternalSemaphoreProperties, external_semaphore_properties)
#undef PROC
    PFN_vkVoidFunction graphics = live->graphics_supported ? graphics_proc(name) : NULL;
    if (graphics) return graphics;
    PFN_vkVoidFunction compute = live->compute_supported ? compute_proc(name) : NULL;
    return compute ? compute : (live->clear_supported || live->compute_supported || live->graphics_supported) ? transfer_proc(name) : NULL;
}
