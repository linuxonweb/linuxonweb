/* B2a: local definitions for Vulkan items newer than the pinned v231 headers.
 * Values and layouts follow the Khronos registry (VK_KHR_maintenance5, header
 * 1.3.258+). Each block is guarded so a newer pinned header wins unchanged. */
#ifndef GUEST_VULKAN_ZINK_EXT_H
#define GUEST_VULKAN_ZINK_EXT_H
#include <vulkan/vulkan_core.h>

#ifndef VK_KHR_maintenance5
#define VK_KHR_maintenance5 1
#define VK_KHR_MAINTENANCE_5_SPEC_VERSION 1
#define VK_KHR_MAINTENANCE_5_EXTENSION_NAME "VK_KHR_maintenance5"
#define VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_MAINTENANCE_5_FEATURES_KHR ((VkStructureType)1000470000)
#define VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_MAINTENANCE_5_PROPERTIES_KHR ((VkStructureType)1000470001)
#define VK_STRUCTURE_TYPE_RENDERING_AREA_INFO_KHR ((VkStructureType)1000470003)
#define VK_STRUCTURE_TYPE_DEVICE_IMAGE_SUBRESOURCE_INFO_KHR ((VkStructureType)1000470004)
#define VK_STRUCTURE_TYPE_PIPELINE_CREATE_FLAGS_2_CREATE_INFO_KHR ((VkStructureType)1000470005)
#define VK_STRUCTURE_TYPE_BUFFER_USAGE_FLAGS_2_CREATE_INFO_KHR ((VkStructureType)1000470006)
#define VK_STRUCTURE_TYPE_SUBRESOURCE_LAYOUT_2_KHR ((VkStructureType)1000338002)
#define VK_STRUCTURE_TYPE_IMAGE_SUBRESOURCE_2_KHR ((VkStructureType)1000338003)
typedef VkFlags64 VkPipelineCreateFlags2KHR;
typedef VkFlags64 VkBufferUsageFlags2KHR;
typedef struct VkPhysicalDeviceMaintenance5FeaturesKHR {
    VkStructureType sType; void *pNext; VkBool32 maintenance5;
} VkPhysicalDeviceMaintenance5FeaturesKHR;
typedef struct VkPhysicalDeviceMaintenance5PropertiesKHR {
    VkStructureType sType; void *pNext;
    VkBool32 earlyFragmentMultisampleCoverageAfterSampleCounting;
    VkBool32 earlyFragmentSampleMaskTestBeforeSampleCounting;
    VkBool32 depthStencilSwizzleOneSupport;
    VkBool32 polygonModePointSize;
    VkBool32 nonStrictSinglePixelWideLinesUseParallelogram;
    VkBool32 nonStrictWideLinesUseParallelogram;
} VkPhysicalDeviceMaintenance5PropertiesKHR;
typedef struct VkRenderingAreaInfoKHR {
    VkStructureType sType; const void *pNext; uint32_t viewMask; uint32_t colorAttachmentCount;
    const VkFormat *pColorAttachmentFormats; VkFormat depthAttachmentFormat; VkFormat stencilAttachmentFormat;
} VkRenderingAreaInfoKHR;
typedef struct VkPipelineCreateFlags2CreateInfoKHR {
    VkStructureType sType; const void *pNext; VkPipelineCreateFlags2KHR flags;
} VkPipelineCreateFlags2CreateInfoKHR;
typedef struct VkBufferUsageFlags2CreateInfoKHR {
    VkStructureType sType; const void *pNext; VkBufferUsageFlags2KHR usage;
} VkBufferUsageFlags2CreateInfoKHR;
typedef void (VKAPI_PTR *PFN_vkGetRenderingAreaGranularityKHR)(VkDevice device,
    const VkRenderingAreaInfoKHR *pRenderingAreaInfo, VkExtent2D *pGranularity);
#endif

#endif
