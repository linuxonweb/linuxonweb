#ifndef GUEST_VULKAN_ICD_H
#define GUEST_VULKAN_ICD_H
#include <vulkan/vk_icd.h>
/* Test-only audit, not a Vulkan extension or production driver API. */
struct guest_vk_audit {
    unsigned instances_created, instances_destroyed, devices_created, devices_destroyed;
    unsigned live_instances, live_devices;
    int close_status;
};
struct guest_vk_audit guest_vk_get_audit(void);
unsigned guest_vk_live_resources(void);
unsigned guest_vk_live_sync(void);
VkDeviceSize guest_vk_allocated_bytes(void);
#endif
