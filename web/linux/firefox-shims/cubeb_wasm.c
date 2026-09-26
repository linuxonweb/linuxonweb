/* Output-only cubeb backend for the Linux Wasm browser host.
 * PCM crosses a bounded host import; timing remains in the guest audio thread.
 * No microphone, host filesystem, or additional network access is exposed. */
#include "cubeb-internal.h"
#include <errno.h>
#include <pthread.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <time.h>
#include <unistd.h>

__attribute__((import_module("linux"), import_name("audio_write")))
extern int linux_audio_write(uint32_t pid, uint32_t stream, const float *pcm,
                             uint32_t frames, uint32_t rate, uint32_t channels);

#define QUANTUM 512
struct cubeb { struct cubeb_ops const *ops; };
struct cubeb_stream {
  cubeb *context;
  void *user_ptr;
  cubeb_data_callback data;
  cubeb_state_callback state;
  cubeb_stream_params params;
  pthread_t thread;
  pthread_mutex_t lock;
  int joinable, stop;
  float volume;
  uint32_t id;
  uint64_t position, chunk_time;
  uint32_t in_flight;
};
static uint32_t next_id;
static struct cubeb_ops const wasm_ops;

static void trace(cubeb_stream *s, const char *event) {
  if (getenv("LOWLAND_AUDIO_TRACE"))
    fprintf(stderr, "[WASM_AUDIO] %u %s\n", s->id, event);
}

static uint64_t now_ns(void) {
  struct timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  return (uint64_t)t.tv_sec * 1000000000 + t.tv_nsec;
}
static void sleep_until(uint64_t deadline) {
  uint64_t now = now_ns();
  if (deadline <= now) return;
  uint64_t left = deadline - now;
  struct timespec delay = {(time_t)(left / 1000000000),
                          (long)(left % 1000000000)};
  while (nanosleep(&delay, &delay) && errno == EINTR) {}
}
static void silence_host(cubeb_stream *s) {
  linux_audio_write((uint32_t)getpid(), s->id, NULL, 0,
                    s->params.rate, s->params.channels);
}
static void *render(void *arg) {
  cubeb_stream *s = arg;
  union { float f32[QUANTUM * 2]; int16_t s16[QUANTUM * 2]; } input;
  float pcm[QUANTUM * 2];
  uint64_t deadline = now_ns();
  s->state(s, s->user_ptr, CUBEB_STATE_STARTED);
  for (;;) {
    pthread_mutex_lock(&s->lock);
    int stop = s->stop;
    float volume = s->volume;
    pthread_mutex_unlock(&s->lock);
    if (stop) break;
    long frames = s->data(s, s->user_ptr, NULL, &input, QUANTUM);
    if (frames < 0 || frames > QUANTUM) {
      s->state(s, s->user_ptr, CUBEB_STATE_ERROR);
      break;
    }
    uint32_t samples = (uint32_t)frames * s->params.channels;
    for (uint32_t i = 0; i < samples; ++i) {
      pcm[i] = volume * (s->params.format == CUBEB_SAMPLE_FLOAT32LE
                            ? input.f32[i] : input.s16[i] / 32768.0f);
    }
    if (frames) {
      if (linux_audio_write((uint32_t)getpid(), s->id, pcm, (uint32_t)frames,
                            s->params.rate, s->params.channels) < 0) {
        s->state(s, s->user_ptr, CUBEB_STATE_ERROR);
        break;
      }
      uint64_t duration = (uint64_t)frames * 1000000000 / s->params.rate;
      uint64_t now = now_ns();
      // Keep a cumulative clock so callback/transport work does not slow the
      // sample rate on every quantum. Reset only after a genuine underrun.
      if (deadline + duration < now) deadline = now;
      pthread_mutex_lock(&s->lock);
      s->chunk_time = now;
      s->in_flight = (uint32_t)frames;
      pthread_mutex_unlock(&s->lock);
      deadline += duration;
      sleep_until(deadline);
      pthread_mutex_lock(&s->lock);
      s->position += (uint32_t)frames;
      s->in_flight = 0;
      pthread_mutex_unlock(&s->lock);
    }
    if (frames < QUANTUM) {
      // Allow the host's small scheduling lead to drain before notifying Gecko.
      sleep_until(now_ns() + 50000000);
      trace(s, "drained callback begin");
      s->state(s, s->user_ptr, CUBEB_STATE_DRAINED);
      trace(s, "drained callback end");
      return NULL;
    }
  }
  silence_host(s);
  return NULL;
}
static char const *backend_id(cubeb *c) { (void)c; return "wasm-webaudio"; }
static int max_channels(cubeb *c, uint32_t *n) { (void)c; *n = 2; return CUBEB_OK; }
static int min_latency(cubeb *c, cubeb_stream_params p, uint32_t *n) {
  (void)c; (void)p; *n = QUANTUM * 2; return CUBEB_OK;
}
static int preferred_rate(cubeb *c, uint32_t *rate) {
  (void)c; *rate = 48000; return CUBEB_OK;
}
static void destroy(cubeb *c) { free(c); }
static int stream_init(cubeb *c, cubeb_stream **out, char const *name,
                       cubeb_devid input_device, cubeb_stream_params *input,
                       cubeb_devid output_device, cubeb_stream_params *params,
                       unsigned latency, cubeb_data_callback data,
                       cubeb_state_callback state, void *user) {
  (void)name; (void)input_device; (void)output_device; (void)latency;
  if (input || !params || params->channels < 1 || params->channels > 2 ||
      params->rate < 8000 || params->rate > 96000 ||
      (params->format != CUBEB_SAMPLE_FLOAT32LE &&
       params->format != CUBEB_SAMPLE_S16LE)) return CUBEB_ERROR_INVALID_FORMAT;
  cubeb_stream *s = calloc(1, sizeof(*s));
  if (!s) return CUBEB_ERROR;
  if (pthread_mutex_init(&s->lock, NULL)) { free(s); return CUBEB_ERROR; }
  s->context = c; s->user_ptr = user; s->data = data; s->state = state;
  s->params = *params; s->volume = 1.0f; s->stop = 1;
  *out = s;
  return CUBEB_OK;
}
static int stream_stop(cubeb_stream *s) {
  pthread_mutex_lock(&s->lock);
  s->stop = 1;
  pthread_mutex_unlock(&s->lock);
  if (s->joinable) {
    trace(s, "join begin");
    pthread_join(s->thread, NULL);
    trace(s, "join end");
    s->joinable = 0;
    silence_host(s);
    trace(s, "stopped callback begin");
    s->state(s, s->user_ptr, CUBEB_STATE_STOPPED);
    trace(s, "stopped callback end");
  }
  return CUBEB_OK;
}
static void stream_destroy(cubeb_stream *s) {
  stream_stop(s);
  pthread_mutex_destroy(&s->lock);
  free(s);
}
static int stream_start(cubeb_stream *s) {
  // A fresh ID for each start prevents late PCM resurrecting a paused stream.
  stream_stop(s);
  s->id = __atomic_add_fetch(&next_id, 1, __ATOMIC_RELAXED);
  pthread_mutex_lock(&s->lock);
  s->stop = 0;
  pthread_mutex_unlock(&s->lock);
  if (pthread_create(&s->thread, NULL, render, s)) return CUBEB_ERROR;
  s->joinable = 1;
  return CUBEB_OK;
}
static int position(cubeb_stream *s, uint64_t *out) {
  pthread_mutex_lock(&s->lock);
  uint64_t elapsed = (now_ns() - s->chunk_time) * s->params.rate / 1000000000;
  *out = s->position + (elapsed < s->in_flight ? elapsed : s->in_flight);
  pthread_mutex_unlock(&s->lock);
  return CUBEB_OK;
}
static int latency(cubeb_stream *s, uint32_t *out) {
  *out = QUANTUM + s->params.rate / 20;
  return CUBEB_OK;
}
static int set_volume(cubeb_stream *s, float volume) {
  if (!(volume >= 0.0f && volume <= 1.0f)) return CUBEB_ERROR_INVALID_PARAMETER;
  pthread_mutex_lock(&s->lock);
  s->volume = volume;
  pthread_mutex_unlock(&s->lock);
  return CUBEB_OK;
}
int wasm_init(cubeb **out, char const *name) {
  (void)name;
  cubeb *c = calloc(1, sizeof(*c));
  if (!c) return CUBEB_ERROR;
  c->ops = &wasm_ops;
  *out = c;
  return CUBEB_OK;
}
static struct cubeb_ops const wasm_ops = {
  .init = wasm_init, .get_backend_id = backend_id,
  .get_max_channel_count = max_channels, .get_min_latency = min_latency,
  .get_preferred_sample_rate = preferred_rate, .destroy = destroy,
  .stream_init = stream_init, .stream_destroy = stream_destroy,
  .stream_start = stream_start, .stream_stop = stream_stop,
  .stream_get_position = position, .stream_get_latency = latency,
  .stream_set_volume = set_volume,
};
