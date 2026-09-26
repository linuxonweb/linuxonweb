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
    VkApplicationInfo application = {.sType=VK_STRUCTURE_TYPE_APPLICATION_INFO, .pApplicationName="guest-vulkan-lifecycle", .apiVersion=VK_API_VERSION_1_1};
    VkInstanceCreateInfo instance_info = {.sType=VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO, .pApplicationInfo=&application};
    CHECK(create_instance(&instance_info, NULL, &instance) == VK_ERROR_INCOMPATIBLE_DRIVER && instance == VK_NULL_HANDLE);
    application.apiVersion = VK_API_VERSION_1_0;
    const char *extension = "VK_TEST_unsupported";
    instance_info.enabledExtensionCount = 1; instance_info.ppEnabledExtensionNames = &extension;
    CHECK(create_instance(&instance_info, NULL, &instance) == VK_ERROR_EXTENSION_NOT_PRESENT && instance == VK_NULL_HANDLE);
    instance_info.enabledExtensionCount = 0; instance_info.ppEnabledExtensionNames = NULL;
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
    VkPhysicalDeviceFeatures2 unsupported_chain = {.sType=VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_FEATURES_2};
    device_info.pNext = &unsupported_chain;
    CHECK(create_device(physical, &device_info, NULL, &device) == VK_ERROR_FEATURE_NOT_PRESENT && device == VK_NULL_HANDLE);
    device_info.pNext = NULL; queue_info.queueFamilyIndex = 1;
    CHECK(create_device(physical, &device_info, NULL, &device) == VK_ERROR_INITIALIZATION_FAILED && device == VK_NULL_HANDLE);
    queue_info.queueFamilyIndex = 0;
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
          guest_vk_live_resources() == 0 && guest_vk_allocated_bytes() == 0);
    puts("GUEST_VK_LIFETIME_PASS live_instances=0 live_devices=0"); result = 0;
done:
    if (device && destroy_device) destroy_device(device, NULL);
    if (instance && destroy_instance) destroy_instance(instance, NULL);
    printf("GUEST_VK_EXIT status=%d checks=%u\n", result, checks); fflush(stdout);
    alarm(0); return result;
}
