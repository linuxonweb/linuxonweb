/* Static replacement for Mesa's src/util/u_dl.c on wasm32 Linux (no dlopen).
 *
 * Zink (zink_screen.c, zink_create_screen) does
 *     screen->loader_lib = util_dl_open(VK_LIBNAME);            // "libvulkan.so.1"
 *     util_dl_get_proc_address(lib, "vkGetInstanceProcAddr");
 *     util_dl_get_proc_address(lib, "vkGetDeviceProcAddr");
 * This object defines every symbol of u_dl.c.o (util_dl_open,
 * util_dl_get_proc_address, util_dl_get_path_from_proc, util_dl_close,
 * util_dl_error), so when it is linked ahead of libmesa_util.a the archive
 * member u_dl.c.o is never pulled in and no upstream source changes.
 *
 * "libvulkan.so.1" resolves to a built-in library whose two entry points go
 * straight to the statically linked guest ICD (vk_icdGetInstanceProcAddr),
 * bypassing the Khronos loader: Zink 26.2 needs post-231 entry points the
 * pinned static loader has no trampolines for (docs/zink-requirements-20260928.md).
 * Any other library name fails like a missing .so.
 *
 * The ICD's vkGetDeviceProcAddr is only reachable through an instance, but
 * Zink asks for it before it creates one, so the returned function is a
 * trampoline that resolves the ICD's implementation from the most recent
 * instance seen by vkGetInstanceProcAddr.
 */
#include <stdatomic.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

typedef void (*util_dl_proc)(void);
struct util_dl_library;

/* Plain C ABI of the ICD entry points (avoids pulling Vulkan headers). */
typedef void *zs_handle;            /* dispatchable handles are pointers */
typedef util_dl_proc (*zs_gipa_fn)(zs_handle instance, const char *name);
typedef util_dl_proc (*zs_gdpa_fn)(zs_handle device, const char *name);
typedef int32_t (*zs_negotiate_fn)(uint32_t *version);

#ifndef ZINK_STATIC_ICD_GIPA
#define ZINK_STATIC_ICD_GIPA vk_icdGetInstanceProcAddr
#endif
#ifndef ZINK_STATIC_ICD_NEGOTIATE
#define ZINK_STATIC_ICD_NEGOTIATE vk_icdNegotiateLoaderICDInterfaceVersion
#endif

util_dl_proc ZINK_STATIC_ICD_GIPA(zs_handle instance, const char *name);
int32_t ZINK_STATIC_ICD_NEGOTIATE(uint32_t *version) __attribute__((weak));

/* Mesa declares these with default visibility in u_dl.h. */
struct util_dl_library *util_dl_open(const char *filename);
util_dl_proc util_dl_get_proc_address(struct util_dl_library *library, const char *procname);
char *util_dl_get_path_from_proc(const void *func_proc);
void util_dl_close(struct util_dl_library *library);
const char *util_dl_error(void);

static struct { int tag; } zs_vulkan_library;
static _Atomic(zs_handle) zs_last_instance;
static _Atomic(zs_gdpa_fn) zs_icd_gdpa;
static atomic_int zs_negotiated;
static const char *zs_error = "";

static void zs_negotiate(void)
{
   if (atomic_exchange(&zs_negotiated, 1) || !ZINK_STATIC_ICD_NEGOTIATE)
      return;
   /* Interface 2 is what the guest ICD accepts without WSI; a WSI build
    * requires >= 3, so offer 5 and let the ICD lower it. */
   uint32_t version = 5;
   if (ZINK_STATIC_ICD_NEGOTIATE(&version) != 0) {
      version = 2;
      (void)ZINK_STATIC_ICD_NEGOTIATE(&version);
   }
}

static util_dl_proc zs_get_device_proc_addr(zs_handle device, const char *name);

static util_dl_proc zs_get_instance_proc_addr(zs_handle instance, const char *name)
{
   if (!name)
      return NULL;
   zs_negotiate();
   if (!strcmp(name, "vkGetInstanceProcAddr"))
      return (util_dl_proc)zs_get_instance_proc_addr;
   if (instance) {
      if (atomic_exchange(&zs_last_instance, instance) != instance)
         atomic_store(&zs_icd_gdpa, NULL);
   }
   if (!strcmp(name, "vkGetDeviceProcAddr"))
      return (util_dl_proc)zs_get_device_proc_addr;
   return ZINK_STATIC_ICD_GIPA(instance, name);
}

static util_dl_proc zs_get_device_proc_addr(zs_handle device, const char *name)
{
   zs_gdpa_fn gdpa = atomic_load(&zs_icd_gdpa);
   if (!gdpa) {
      zs_handle instance = atomic_load(&zs_last_instance);
      if (!instance)
         return NULL;
      gdpa = (zs_gdpa_fn)ZINK_STATIC_ICD_GIPA(instance, "vkGetDeviceProcAddr");
      if (!gdpa)
         return NULL;
      atomic_store(&zs_icd_gdpa, gdpa);
   }
   if (name && !strcmp(name, "vkGetDeviceProcAddr"))
      return (util_dl_proc)zs_get_device_proc_addr;
   return gdpa(device, name);
}

static int zs_is_vulkan_name(const char *filename)
{
   if (!filename)
      return 0;
   const char *base = strrchr(filename, '/');
   base = base ? base + 1 : filename;
   return !strcmp(base, "libvulkan.so.1") || !strcmp(base, "libvulkan.so");
}

struct util_dl_library *util_dl_open(const char *filename)
{
   if (zs_is_vulkan_name(filename)) {
      zs_error = "";
      return (struct util_dl_library *)&zs_vulkan_library;
   }
   zs_error = "util_dl_open: no dynamic loading in static wasm32 build";
   return NULL;
}

util_dl_proc util_dl_get_proc_address(struct util_dl_library *library, const char *procname)
{
   if (library != (struct util_dl_library *)&zs_vulkan_library || !procname) {
      zs_error = "util_dl_get_proc_address: unknown library";
      return NULL;
   }
   if (!strcmp(procname, "vkGetInstanceProcAddr"))
      return (util_dl_proc)zs_get_instance_proc_addr;
   if (!strcmp(procname, "vkGetDeviceProcAddr"))
      return (util_dl_proc)zs_get_device_proc_addr;
   /* Global (instance-less) commands, as a real libvulkan would export them. */
   return zs_get_instance_proc_addr(NULL, procname);
}

char *util_dl_get_path_from_proc(const void *func_proc)
{
   (void)func_proc;
   return NULL;
}

void util_dl_close(struct util_dl_library *library)
{
   (void)library;
}

const char *util_dl_error(void)
{
   return zs_error;
}
