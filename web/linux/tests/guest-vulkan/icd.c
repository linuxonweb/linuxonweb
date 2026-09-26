/* Experimental direct-call Vulkan-shaped lifecycle and opt-in clear/copy
 * profile. No system loader integration, conformance or physical GPU claim. */
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
    int clear_supported, failed;
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

/* HELLO can succeed only after serveGPU has obtained a real adapter and device.
 * Preserve its observed identity verbatim; do not invent vendor/device IDs. */
static int hello(VkInstance instance) {
    char data[4096]; uint32_t n = 0;
    int status = gpu_call(&instance->session, GPU_HELLO, NULL, 0, data, sizeof(data)-1, &n);
    if (status || !n || memchr(data, '\0', n)) return -1;
    data[n] = 0;
    printf("GUEST_VK_HOST_HELLO %s\n", data); fflush(stdout);
    instance->clear_supported = strstr(data, "\"clearImage\":true") != NULL;
    return 0;
}
static void transfer_cleanup(void);
static VKAPI_ATTR VkResult VKAPI_CALL create_instance(const VkInstanceCreateInfo *info,
        const VkAllocationCallbacks *allocator, VkInstance *out) {
    if (!out) return VK_ERROR_INITIALIZATION_FAILED;
    *out = VK_NULL_HANDLE;
    if (!info || info->sType != VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO || info->pNext ||
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
    /* No invented physical PCI IDs, UUID, rendering limits or driver claims. */
}
static VKAPI_ATTR void VKAPI_CALL physical_features(VkPhysicalDevice physical, VkPhysicalDeviceFeatures *out) {
    (void)physical;
    if (out) memset(out, 0, sizeof(*out));
}
static VKAPI_ATTR void VKAPI_CALL queue_properties(VkPhysicalDevice physical, uint32_t *count, VkQueueFamilyProperties *out) {
    if (!count) return;
    if (!physical_valid(physical)) { *count = 0; return; }
    if (!out) { *count = 1; return; }
    if (!*count) return;
    memset(out, 0, sizeof(*out)); out->queueCount = 1; *count = 1;
    if (live->clear_supported) out->queueFlags = VK_QUEUE_COMPUTE_BIT | VK_QUEUE_TRANSFER_BIT;
    /* ClearColorImage requires compute/graphics. The opt-in COMPUTE flag
     * denotes only this partial command profile; dispatch remains absent.
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
    if (info->pNext || any_features(info->pEnabledFeatures)) return VK_ERROR_FEATURE_NOT_PRESENT;
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
    return live->clear_supported ? transfer_proc(name) : NULL;
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
    PROC(vkGetPhysicalDeviceMemoryProperties, memory_properties)
    PROC(vkGetPhysicalDeviceQueueFamilyProperties, queue_properties)
    PROC(vkEnumerateDeviceExtensionProperties, device_extensions)
    PROC(vkCreateDevice, create_device)
    PROC(vkGetDeviceProcAddr, device_proc)
    PROC(vkDestroyDevice, destroy_device)
    PROC(vkGetDeviceQueue, device_queue)
#undef PROC
    return live->clear_supported ? transfer_proc(name) : NULL;
}
