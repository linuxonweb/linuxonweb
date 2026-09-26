/* Native lifecycle tests of the actual Wasm cubeb backend, with PCM captured
 * at its host boundary. This is not evidence of audible browser playback. */
#include <assert.h>
#include <math.h>
#include <stdio.h>
#include "../firefox-shims/cubeb_wasm.c"

struct capture {
  pthread_mutex_t lock;
  uint64_t frames;
  unsigned packets, clears, started, stopped, drained, errors;
  uint32_t id, previous_id, channels;
  int host_failure;
} captured = {.lock = PTHREAD_MUTEX_INITIALIZER};
struct source { cubeb_sample_format format; unsigned channels; long remaining; };

int linux_audio_write(uint32_t pid, uint32_t id, const float *pcm,
                      uint32_t frames, uint32_t rate, uint32_t channels) {
  assert(pid == (uint32_t)getpid());
  assert(id != 0 && rate == 48000);
  pthread_mutex_lock(&captured.lock);
  if (!frames) {
    assert(pcm == NULL);
    captured.clears++;
  } else {
    assert(frames <= 512 && channels == captured.channels);
    if (captured.id != id) {
      captured.previous_id = captured.id;
      captured.id = id;
    }
    for (uint32_t i = 0; i < frames * channels; i++) {
      /* Callback alternates positive/negative real PCM; volume is 0.5. */
      float expected = i % 2 ? -0.125f : 0.25f;
      assert(fabsf(pcm[i] - expected) < 0.000001f);
    }
    captured.frames += frames;
    captured.packets++;
  }
  int result = captured.host_failure ? -1 : 0;
  pthread_mutex_unlock(&captured.lock);
  return result;
}
static long data_cb(cubeb_stream *s, void *user, const void *input,
                    void *output, long requested) {
  (void)s; assert(input == NULL && requested == 512);
  struct source *src = user;
  long frames = src->remaining >= 0 && src->remaining < requested
                  ? src->remaining : requested;
  if (src->remaining >= 0) src->remaining -= frames;
  for (long i = 0; i < frames * src->channels; i++) {
    if (src->format == CUBEB_SAMPLE_FLOAT32LE)
      ((float *)output)[i] = i % 2 ? -0.25f : 0.5f;
    else ((int16_t *)output)[i] = i % 2 ? -8192 : 16384;
  }
  return frames;
}
static void state_cb(cubeb_stream *s, void *user, cubeb_state state) {
  (void)s; (void)user;
  pthread_mutex_lock(&captured.lock);
  switch (state) {
  case CUBEB_STATE_STARTED: captured.started++; break;
  case CUBEB_STATE_STOPPED: captured.stopped++; break;
  case CUBEB_STATE_DRAINED: captured.drained++; break;
  case CUBEB_STATE_ERROR: captured.errors++; break;
  default: assert(0);
  }
  pthread_mutex_unlock(&captured.lock);
}
static void nap(unsigned milliseconds) {
  struct timespec d = {milliseconds / 1000, (milliseconds % 1000) * 1000000};
  while (nanosleep(&d, &d) && errno == EINTR) {}
}
static unsigned counter(unsigned *p) {
  pthread_mutex_lock(&captured.lock);unsigned value = *p;
  pthread_mutex_unlock(&captured.lock);return value;
}
static void await_counter(unsigned *p, unsigned target) {
  for (unsigned n = 0; n < 2000 && counter(p) < target; n++) nap(1);
  assert(counter(p) >= target);
}
static void reset(unsigned channels) {
  pthread_mutex_lock(&captured.lock);
  captured.frames = 0; captured.packets = captured.clears = 0;
  captured.started = captured.stopped = captured.drained = captured.errors = 0;
  captured.id = captured.previous_id = 0; captured.channels = channels;
  captured.host_failure = 0;
  pthread_mutex_unlock(&captured.lock);
}
static cubeb_stream *make_stream(cubeb *context, struct source *source) {
  cubeb_stream_params p = {.format = source->format, .rate = 48000,
    .channels = source->channels, .layout = CUBEB_LAYOUT_UNDEFINED};
  cubeb_stream *s = NULL;
  assert(context->ops->stream_init(context, &s, "test", NULL, NULL, NULL,
         &p, 1024, data_cb, state_cb, source) == CUBEB_OK);
  assert(context->ops->stream_set_volume(s, -1) == CUBEB_ERROR_INVALID_PARAMETER);
  assert(context->ops->stream_set_volume(s, NAN) == CUBEB_ERROR_INVALID_PARAMETER);
  assert(context->ops->stream_set_volume(s, 0.5f) == CUBEB_OK);
  return s;
}
static void lifecycle(cubeb *c, cubeb_sample_format format, unsigned channels) {
  reset(channels); struct source src = {format, channels, -1};
  cubeb_stream *s = make_stream(c, &src);uint64_t last = 0, p = 0;
  assert(c->ops->stream_get_position(s, &p) == CUBEB_OK && p == 0);
  assert(c->ops->stream_start(s) == CUBEB_OK);
  await_counter(&captured.packets, 3);
  for (unsigned n = 0; n < 35; n++) {
    assert(c->ops->stream_get_position(s, &p) == CUBEB_OK && p >= last);
    last = p; nap(1);
  }
  assert(last > 0);
  assert(c->ops->stream_stop(s) == CUBEB_OK);
  unsigned packets = counter(&captured.packets);
  assert(counter(&captured.started) == 1 && counter(&captured.stopped) == 1);
  assert(counter(&captured.clears) > 0);
  c->ops->stream_get_position(s, &last);nap(30);
  c->ops->stream_get_position(s, &p);
  assert(p == last && counter(&captured.packets) == packets);
  assert(c->ops->stream_start(s) == CUBEB_OK);
  await_counter(&captured.packets, packets + 2);
  assert(c->ops->stream_stop(s) == CUBEB_OK);
  assert(captured.previous_id != 0 && captured.id != captured.previous_id);
  assert(counter(&captured.started) == 2 && counter(&captured.stopped) == 2);
  assert(counter(&captured.drained) == 0 && counter(&captured.errors) == 0);
  packets = counter(&captured.packets);c->ops->stream_destroy(s);nap(20);
  assert(counter(&captured.packets) == packets);
  printf("PASS %s %u-channel PCM, volume, position, pause/restart IDs, destroy\n",
          format == CUBEB_SAMPLE_FLOAT32LE ? "F32" : "S16", channels);
}
static void drain(cubeb *c) {
  reset(2);struct source src = {CUBEB_SAMPLE_FLOAT32LE, 2, 700};
  cubeb_stream *s = make_stream(c, &src);
  assert(c->ops->stream_start(s) == CUBEB_OK);
  await_counter(&captured.drained, 1);
  uint64_t p;c->ops->stream_get_position(s, &p);
  assert(p == 700 && captured.frames == 700 && captured.packets == 2);
  unsigned packets = counter(&captured.packets);nap(30);
  assert(counter(&captured.packets) == packets);
  c->ops->stream_destroy(s);
  assert(counter(&captured.errors) == 0);
  puts("PASS exact 700-frame drain, final position, no post-drain PCM");
}
static void host_error(cubeb *c) {
  reset(1);captured.host_failure = 1;
  struct source src = {CUBEB_SAMPLE_S16LE, 1, -1};
  cubeb_stream *s = make_stream(c, &src);
  assert(c->ops->stream_start(s) == CUBEB_OK);
  await_counter(&captured.errors, 1);c->ops->stream_stop(s);
  assert(counter(&captured.packets) == 1 && counter(&captured.drained) == 0);
  c->ops->stream_destroy(s);puts("PASS rejected host PCM reports error and stops");
}
int main(void) {
  cubeb *c = NULL;assert(wasm_init(&c, "native-test") == CUBEB_OK);
  assert(strcmp(c->ops->get_backend_id(c), "wasm-webaudio") == 0);
  for (unsigned channels = 1; channels <= 2; channels++) {
    lifecycle(c, CUBEB_SAMPLE_FLOAT32LE, channels);
    lifecycle(c, CUBEB_SAMPLE_S16LE, channels);
  }
  drain(c);host_error(c);c->ops->destroy(c);
  puts("PASS native cubeb lifecycle suite");return 0;
}
