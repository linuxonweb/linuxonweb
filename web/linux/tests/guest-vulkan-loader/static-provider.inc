/* Built-in provider for the isolated wasm-musl port. This replaces discovery,
 * not the upstream loader's instance/device chains or typed dispatch. */
    if (skipped_portability_drivers) *skipped_portability_drivers = false;
    VkResult result = loader_scanned_icd_init(inst, icd_tramp_list);
    if (result != VK_SUCCESS) return result;
    uint32_t version;
    /* Interface 3 only adds driver-owned VkSurfaceKHR objects (A6a WSI build);
     * both remain the same built-in provider. */
    if (!loader_get_icd_interface_version(vk_icdNegotiateLoaderICDInterfaceVersion, &version) || (version != 2 && version != 3)) {
        loader_scanned_icd_clear(inst, icd_tramp_list);
        return VK_ERROR_INCOMPATIBLE_DRIVER;
    }
    struct loader_scanned_icd *icd = &icd_tramp_list->scanned_list[0];
    memset(icd, 0, sizeof(*icd));
    icd->api_version = VK_API_VERSION_1_1;
    icd->interface_version = version;
    icd->GetInstanceProcAddr = vk_icdGetInstanceProcAddr;
    icd->CreateInstance = (PFN_vkCreateInstance)icd->GetInstanceProcAddr(NULL, "vkCreateInstance");
    icd->EnumerateInstanceExtensionProperties = (PFN_vkEnumerateInstanceExtensionProperties)
        icd->GetInstanceProcAddr(NULL, "vkEnumerateInstanceExtensionProperties");
    if (!icd->CreateInstance || !icd->EnumerateInstanceExtensionProperties) {
        loader_scanned_icd_clear(inst, icd_tramp_list);
        return VK_ERROR_INCOMPATIBLE_DRIVER;
    }
    const char label[] = "builtin:guest-vulkan-partial-clear-copy";
    icd->lib_name = loader_instance_heap_alloc(inst, sizeof(label), VK_SYSTEM_ALLOCATION_SCOPE_INSTANCE);
    if (!icd->lib_name) {
        loader_scanned_icd_clear(inst, icd_tramp_list);
        return VK_ERROR_OUT_OF_HOST_MEMORY;
    }
    memcpy(icd->lib_name, label, sizeof(label));
    icd_tramp_list->count = 1;
    return VK_SUCCESS;
