#define _POSIX_C_SOURCE 200809L
// Public Vulkan application. Experimental subset; no private ICD calls.
#include "shaders.h"
#include <math.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>
#include <vulkan/vulkan.h>
#define W 128
#define H 128
#define FRAMES 30
#define WARMUP 5
#define ITERATIONS 8192
#define CHECK(x)                                                               \
  do {                                                                         \
    if (!(x)) {                                                                \
      fprintf(stderr, "GUEST_WGPU_FAIL line=%d expression=%s\n", __LINE__,     \
              #x);                                                             \
      goto done;                                                               \
    }                                                                          \
  } while (0)
static double now(void) {
  struct timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  return t.tv_sec * 1000. + t.tv_nsec / 1000000.;
}
static void barrier(VkCommandBuffer cb, VkImage image, VkImageLayout old,
                    VkImageLayout next) {
  VkImageMemoryBarrier b = {
      .sType = VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER,
      .oldLayout = old,
      .newLayout = next,
      .image = image,
      .srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED,
      .dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED,
      .subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1}};
  VkPipelineStageFlags src = VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT,
                       dst = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT;
  if (old == VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL) {
    src = VK_PIPELINE_STAGE_TRANSFER_BIT;
    b.srcAccessMask = VK_ACCESS_TRANSFER_READ_BIT;
  }
  if (old == VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL) {
    src = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT;
    b.srcAccessMask = VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT;
  }
  b.dstAccessMask = VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT;
  if (next == VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL) {
    dst = VK_PIPELINE_STAGE_TRANSFER_BIT;
    b.dstAccessMask = VK_ACCESS_TRANSFER_READ_BIT;
  }
  vkCmdPipelineBarrier(cb, src, dst, 0, 0, NULL, 0, NULL, 1, &b);
}
static int verify(const unsigned char *p, uint32_t *hash, unsigned *checks) {
  *hash = 2166136261u;
  *checks = 0;
  unsigned failures = 0;
  for (unsigned y = 0; y < H; y++) {
    for (unsigned x = 0; x < W; x++) { // Naga adjusts Vulkan coordinates into
                                       // the WebGPU raster convention.
      float seeds[3] = {(x + .5f) / W * .5f + .25f, (y + .5f) / H * .5f + .25f,
                        .375f},
            v[3] = {.125f, .25f, .5f};
      for (unsigned i = 0; i < ITERATIONS; i++)
        for (unsigned k = 0; k < 3; k++)
          v[k] = v[k] * .9999f + seeds[k] * .0001f;
      for (unsigned k = 0; k < 4; k++) {
        unsigned char byte = p[(y * W + x) * 4 + k];
        *hash = (*hash ^ byte) * 16777619u;
        int expected = k == 3 ? 255 : (int)lroundf(v[k] * 255);
        (*checks)++;
        if (abs((int)byte - expected) > 2) {
          if (failures < 5)
            fprintf(
                stderr,
                "GUEST_WGPU_PIXEL_FAIL x=%u y=%u k=%u actual=%u expected=%d\n",
                x, y, k, byte, expected);
          failures++;
        }
      }
    }
  }
  return failures == 0;
}
int main(void) {
  int result = 1;
  VkInstance instance = 0;
  VkDevice d = 0;
  VkImage image = 0;
  VkImageView view = 0;
  VkDeviceMemory imem = 0, bmem = 0, vmem = 0;
  VkBuffer readback = 0, vertices = 0;
  VkRenderPass rp = 0;
  VkFramebuffer fb = 0;
  VkPipelineLayout layout = 0;
  VkPipeline pipeline = 0;
  VkShaderModule vs = 0, fs = 0;
  VkCommandPool pool = 0;
  VkCommandBuffer cb = 0;
  unsigned char *mapped = NULL;
  void *vmap = NULL;
  unsigned pixel_checks = 0;
  uint32_t hash = 0;
  double elapsed = 0;
  signal(SIGPIPE, SIG_IGN);
  alarm(300);
  puts("GUEST_WGPU_CONFIG width=128 height=128 warmup=5 frames=30 "
       "iterations=8192 workload=fullscreen-recurrence-v1 api=Vulkan1.0 "
       "public-loader=1");
  fflush(stdout);
  VkApplicationInfo app = {.sType = VK_STRUCTURE_TYPE_APPLICATION_INFO,
                           .pApplicationName = "wgpu-fragment-benchmark",
                           .apiVersion = VK_API_VERSION_1_0};
  VkInstanceCreateInfo ii = {.sType = VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO,
                             .pApplicationInfo = &app};
  CHECK(vkCreateInstance(&ii, 0, &instance) == VK_SUCCESS);
  VkPhysicalDevice physical;
  uint32_t count = 1;
  CHECK(vkEnumeratePhysicalDevices(instance, &count, &physical) == VK_SUCCESS &&
        count == 1);
  VkPhysicalDeviceProperties props;
  vkGetPhysicalDeviceProperties(physical, &props);
  printf("GUEST_WGPU_DEVICE name=%s api=%u driver=%u\n", props.deviceName,
         props.apiVersion, props.driverVersion);
  float priority = 1;
  VkDeviceQueueCreateInfo qi = {.sType =
                                    VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO,
                                .queueCount = 1,
                                .pQueuePriorities = &priority};
  VkDeviceCreateInfo di = {.sType = VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO,
                           .queueCreateInfoCount = 1,
                           .pQueueCreateInfos = &qi};
  CHECK(vkCreateDevice(physical, &di, 0, &d) == VK_SUCCESS);
  VkQueue queue;
  vkGetDeviceQueue(d, 0, 0, &queue);
  VkImageCreateInfo ici = {.sType = VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO,
                           .imageType = VK_IMAGE_TYPE_2D,
                           .format = VK_FORMAT_R8G8B8A8_UNORM,
                           .extent = {W, H, 1},
                           .mipLevels = 1,
                           .arrayLayers = 1,
                           .samples = VK_SAMPLE_COUNT_1_BIT,
                           .tiling = VK_IMAGE_TILING_OPTIMAL,
                           .usage = VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT |
                                    VK_IMAGE_USAGE_TRANSFER_SRC_BIT,
                           .sharingMode = VK_SHARING_MODE_EXCLUSIVE};
  CHECK(vkCreateImage(d, &ici, 0, &image) == VK_SUCCESS);
  VkMemoryRequirements mr;
  vkGetImageMemoryRequirements(d, image, &mr);
  VkMemoryAllocateInfo ai = {.sType = VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO,
                             .allocationSize = mr.size};
  CHECK(vkAllocateMemory(d, &ai, 0, &imem) == VK_SUCCESS);
  CHECK(vkBindImageMemory(d, image, imem, 0) == VK_SUCCESS);
  VkImageViewCreateInfo vi = {
      .sType = VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO,
      .image = image,
      .viewType = VK_IMAGE_VIEW_TYPE_2D,
      .format = VK_FORMAT_R8G8B8A8_UNORM,
      .subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1}};
  CHECK(vkCreateImageView(d, &vi, 0, &view) == VK_SUCCESS);
  VkBufferCreateInfo bi = {.sType = VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO,
                           .size = W * H * 4,
                           .usage = VK_BUFFER_USAGE_TRANSFER_DST_BIT,
                           .sharingMode = VK_SHARING_MODE_EXCLUSIVE};
  CHECK(vkCreateBuffer(d, &bi, 0, &readback) == VK_SUCCESS);
  vkGetBufferMemoryRequirements(d, readback, &mr);
  ai.allocationSize = mr.size;
  ai.memoryTypeIndex = 1;
  CHECK(vkAllocateMemory(d, &ai, 0, &bmem) == VK_SUCCESS);
  CHECK(vkBindBufferMemory(d, readback, bmem, 0) == VK_SUCCESS);
  CHECK(vkMapMemory(d, bmem, 0, VK_WHOLE_SIZE, 0, (void **)&mapped) ==
        VK_SUCCESS);
  float positions[6] = {-1, -1, 3, -1, -1, 3};
  bi.size = sizeof(positions);
  bi.usage = VK_BUFFER_USAGE_VERTEX_BUFFER_BIT;
  CHECK(vkCreateBuffer(d, &bi, 0, &vertices) == VK_SUCCESS);
  vkGetBufferMemoryRequirements(d, vertices, &mr);
  ai.allocationSize = mr.size;
  CHECK(vkAllocateMemory(d, &ai, 0, &vmem) == VK_SUCCESS);
  CHECK(vkBindBufferMemory(d, vertices, vmem, 0) == VK_SUCCESS);
  CHECK(vkMapMemory(d, vmem, 0, VK_WHOLE_SIZE, 0, &vmap) == VK_SUCCESS);
  memcpy(vmap, positions, sizeof(positions));
  VkAttachmentDescription attachment = {
      .format = VK_FORMAT_R8G8B8A8_UNORM,
      .samples = VK_SAMPLE_COUNT_1_BIT,
      .loadOp = VK_ATTACHMENT_LOAD_OP_CLEAR,
      .storeOp = VK_ATTACHMENT_STORE_OP_STORE,
      .stencilLoadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE,
      .stencilStoreOp = VK_ATTACHMENT_STORE_OP_DONT_CARE,
      .initialLayout = VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL,
      .finalLayout = VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL};
  VkAttachmentReference ref = {0, VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL};
  VkSubpassDescription sub = {.pipelineBindPoint =
                                  VK_PIPELINE_BIND_POINT_GRAPHICS,
                              .colorAttachmentCount = 1,
                              .pColorAttachments = &ref};
  VkRenderPassCreateInfo rpi = {.sType =
                                    VK_STRUCTURE_TYPE_RENDER_PASS_CREATE_INFO,
                                .attachmentCount = 1,
                                .pAttachments = &attachment,
                                .subpassCount = 1,
                                .pSubpasses = &sub};
  CHECK(vkCreateRenderPass(d, &rpi, 0, &rp) == VK_SUCCESS);
  VkFramebufferCreateInfo fi = {.sType =
                                    VK_STRUCTURE_TYPE_FRAMEBUFFER_CREATE_INFO,
                                .renderPass = rp,
                                .attachmentCount = 1,
                                .pAttachments = &view,
                                .width = W,
                                .height = H,
                                .layers = 1};
  CHECK(vkCreateFramebuffer(d, &fi, 0, &fb) == VK_SUCCESS);
  VkPipelineLayoutCreateInfo pli = {
      .sType = VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO};
  CHECK(vkCreatePipelineLayout(d, &pli, 0, &layout) == VK_SUCCESS);
  VkShaderModuleCreateInfo si = {
      .sType = VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO,
      .codeSize = sizeof(benchmark_vert),
      .pCode = benchmark_vert};
  CHECK(vkCreateShaderModule(d, &si, 0, &vs) == VK_SUCCESS);
  si.codeSize = sizeof(benchmark_frag);
  si.pCode = benchmark_frag;
  CHECK(vkCreateShaderModule(d, &si, 0, &fs) == VK_SUCCESS);
  VkPipelineShaderStageCreateInfo stages[2] = {
      {.sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO,
       .stage = VK_SHADER_STAGE_VERTEX_BIT,
       .module = vs,
       .pName = "main"},
      {.sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO,
       .stage = VK_SHADER_STAGE_FRAGMENT_BIT,
       .module = fs,
       .pName = "main"}};
  VkVertexInputBindingDescription binding = {0, 8, VK_VERTEX_INPUT_RATE_VERTEX};
  VkVertexInputAttributeDescription attr = {0, 0, VK_FORMAT_R32G32_SFLOAT, 0};
  VkPipelineVertexInputStateCreateInfo vin = {
      .sType = VK_STRUCTURE_TYPE_PIPELINE_VERTEX_INPUT_STATE_CREATE_INFO,
      .vertexBindingDescriptionCount = 1,
      .pVertexBindingDescriptions = &binding,
      .vertexAttributeDescriptionCount = 1,
      .pVertexAttributeDescriptions = &attr};
  VkPipelineInputAssemblyStateCreateInfo assembly = {
      .sType = VK_STRUCTURE_TYPE_PIPELINE_INPUT_ASSEMBLY_STATE_CREATE_INFO,
      .topology = VK_PRIMITIVE_TOPOLOGY_TRIANGLE_LIST};
  VkViewport vp = {0, 0, W, H, 0, 1};
  VkRect2D scissor = {{0, 0}, {W, H}};
  VkPipelineViewportStateCreateInfo viewport = {
      .sType = VK_STRUCTURE_TYPE_PIPELINE_VIEWPORT_STATE_CREATE_INFO,
      .viewportCount = 1,
      .pViewports = &vp,
      .scissorCount = 1,
      .pScissors = &scissor};
  VkPipelineRasterizationStateCreateInfo raster = {
      .sType = VK_STRUCTURE_TYPE_PIPELINE_RASTERIZATION_STATE_CREATE_INFO,
      .polygonMode = VK_POLYGON_MODE_FILL,
      .cullMode = VK_CULL_MODE_NONE,
      .frontFace = VK_FRONT_FACE_COUNTER_CLOCKWISE,
      .lineWidth = 1};
  VkPipelineMultisampleStateCreateInfo ms = {
      .sType = VK_STRUCTURE_TYPE_PIPELINE_MULTISAMPLE_STATE_CREATE_INFO,
      .rasterizationSamples = VK_SAMPLE_COUNT_1_BIT};
  VkPipelineColorBlendAttachmentState blendatt = {.colorWriteMask = 15};
  VkPipelineColorBlendStateCreateInfo blend = {
      .sType = VK_STRUCTURE_TYPE_PIPELINE_COLOR_BLEND_STATE_CREATE_INFO,
      .attachmentCount = 1,
      .pAttachments = &blendatt};
  VkGraphicsPipelineCreateInfo pi = {
      .sType = VK_STRUCTURE_TYPE_GRAPHICS_PIPELINE_CREATE_INFO,
      .stageCount = 2,
      .pStages = stages,
      .pVertexInputState = &vin,
      .pInputAssemblyState = &assembly,
      .pViewportState = &viewport,
      .pRasterizationState = &raster,
      .pMultisampleState = &ms,
      .pColorBlendState = &blend,
      .layout = layout,
      .renderPass = rp,
      .basePipelineIndex = -1};
  CHECK(vkCreateGraphicsPipelines(d, 0, 1, &pi, 0, &pipeline) == VK_SUCCESS);
  VkCommandPoolCreateInfo cpi = {
      .sType = VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO,
      .flags = VK_COMMAND_POOL_CREATE_RESET_COMMAND_BUFFER_BIT};
  CHECK(vkCreateCommandPool(d, &cpi, 0, &pool) == VK_SUCCESS);
  VkCommandBufferAllocateInfo cai = {
      .sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO,
      .commandPool = pool,
      .level = VK_COMMAND_BUFFER_LEVEL_PRIMARY,
      .commandBufferCount = 1};
  CHECK(vkAllocateCommandBuffers(d, &cai, &cb) == VK_SUCCESS);
  VkCommandBufferBeginInfo begin = {
      .sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO};
  VkSubmitInfo submit = {.sType = VK_STRUCTURE_TYPE_SUBMIT_INFO,
                         .commandBufferCount = 1,
                         .pCommandBuffers = &cb};
  VkImageLayout old = VK_IMAGE_LAYOUT_UNDEFINED;
  for (unsigned frame = 0; frame < WARMUP + FRAMES; frame++) {
    CHECK(vkResetCommandBuffer(cb, 0) == VK_SUCCESS);
    CHECK(vkBeginCommandBuffer(cb, &begin) == VK_SUCCESS);
    barrier(cb, image, old, VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL);
    VkClearValue clear = {.color = {{0, 0, 0, 1}}};
    VkRenderPassBeginInfo rb = {.sType =
                                    VK_STRUCTURE_TYPE_RENDER_PASS_BEGIN_INFO,
                                .renderPass = rp,
                                .framebuffer = fb,
                                .renderArea = {{0, 0}, {W, H}},
                                .clearValueCount = 1,
                                .pClearValues = &clear};
    vkCmdBeginRenderPass(cb, &rb, VK_SUBPASS_CONTENTS_INLINE);
    vkCmdBindPipeline(cb, VK_PIPELINE_BIND_POINT_GRAPHICS, pipeline);
    VkDeviceSize offset = 0;
    vkCmdBindVertexBuffers(cb, 0, 1, &vertices, &offset);
    vkCmdDraw(cb, 3, 1, 0, 0);
    vkCmdEndRenderPass(cb);
    barrier(cb, image, VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL,
            VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL);
    VkBufferImageCopy copy = {
        .imageSubresource = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 0, 1},
        .imageExtent = {W, H, 1}};
    vkCmdCopyImageToBuffer(cb, image, VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL,
                           readback, 1, &copy);
    VkBufferMemoryBarrier bb = {.sType =
                                    VK_STRUCTURE_TYPE_BUFFER_MEMORY_BARRIER,
                                .srcAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT,
                                .dstAccessMask = VK_ACCESS_HOST_READ_BIT,
                                .srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED,
                                .dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED,
                                .buffer = readback,
                                .size = VK_WHOLE_SIZE};
    vkCmdPipelineBarrier(cb, VK_PIPELINE_STAGE_TRANSFER_BIT,
                         VK_PIPELINE_STAGE_HOST_BIT, 0, 0, NULL, 1, &bb, 0,
                         NULL);
    CHECK(vkEndCommandBuffer(cb) == VK_SUCCESS);
    double start = now();
    CHECK(vkQueueSubmit(queue, 1, &submit, 0) == VK_SUCCESS);
    CHECK(vkQueueWaitIdle(queue) == VK_SUCCESS);
    double dt = now() - start;
    old = VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL;
    uint32_t fh = 2166136261u;
    for (unsigned i = 0; i < W * H * 4; i++)
      fh = (fh ^ mapped[i]) * 16777619u;
    if (frame == 0) {
      CHECK(verify(mapped, &hash, &pixel_checks));
      printf("GUEST_WGPU_PIXELS checks=%u failures=0 checksum=%u tolerance=2\n",
             pixel_checks, hash);
    } else
      CHECK(fh == hash);
    if (frame >= WARMUP) {
      elapsed += dt;
      printf("GUEST_WGPU_FRAME phase=measure index=%u completed_ms=%.6f "
             "checksum=%u\n",
             frame - WARMUP, dt, fh);
      fflush(stdout);
    }
  }
  printf("GUEST_WGPU_RESULT completed=%u elapsed_ms=%.6f fps=%.6f "
         "pixel_checks=%u pixel_failures=0 checksum=%u\n",
         FRAMES, elapsed, FRAMES * 1000. / elapsed, pixel_checks, hash);
  result = 0;
done:
  if (d) {
    vkDeviceWaitIdle(d);
    if (cb)
      vkFreeCommandBuffers(d, pool, 1, &cb);
    if (pool)
      vkDestroyCommandPool(d, pool, 0);
    if (pipeline)
      vkDestroyPipeline(d, pipeline, 0);
    if (layout)
      vkDestroyPipelineLayout(d, layout, 0);
    if (vs)
      vkDestroyShaderModule(d, vs, 0);
    if (fs)
      vkDestroyShaderModule(d, fs, 0);
    if (fb)
      vkDestroyFramebuffer(d, fb, 0);
    if (rp)
      vkDestroyRenderPass(d, rp, 0);
    if (vmap)
      vkUnmapMemory(d, vmem);
    if (mapped)
      vkUnmapMemory(d, bmem);
    if (vertices)
      vkDestroyBuffer(d, vertices, 0);
    if (readback)
      vkDestroyBuffer(d, readback, 0);
    if (view)
      vkDestroyImageView(d, view, 0);
    if (image)
      vkDestroyImage(d, image, 0);
    if (vmem)
      vkFreeMemory(d, vmem, 0);
    if (bmem)
      vkFreeMemory(d, bmem, 0);
    if (imem)
      vkFreeMemory(d, imem, 0);
    vkDestroyDevice(d, 0);
  }
  if (instance)
    vkDestroyInstance(instance, 0);
  printf("GUEST_WGPU_EXIT status=%d\n", result);
  fflush(stdout);
  alarm(0);
  return result;
}
