/* Static FFVPX registration for the Linux Wasm guest (no dlopen).
 * Keep Gecko's existing version and required-symbol validation in Link(). */
#ifndef LOWLAND_FFVPX_STATIC_H
#define LOWLAND_FFVPX_STATIC_H
#include <stdio.h>

extern "C" {
#include "libavcodec/avcodec.h"
#include "libavutil/imgutils.h"
#include "libavutil/opt.h"
#include "libavutil/tx.h"
}

#define LOWLAND_AV_SYMBOL(name) {#name, reinterpret_cast<PRFuncPtr>(name)}
static const PRStaticLinkTable kLowlandAVCodec[] = {
    LOWLAND_AV_SYMBOL(avcodec_version),
    LOWLAND_AV_SYMBOL(avcodec_alloc_context3),
    LOWLAND_AV_SYMBOL(avcodec_close),
    LOWLAND_AV_SYMBOL(avcodec_find_decoder),
    LOWLAND_AV_SYMBOL(avcodec_find_decoder_by_name),
    LOWLAND_AV_SYMBOL(avcodec_find_encoder),
    LOWLAND_AV_SYMBOL(avcodec_find_encoder_by_name),
    LOWLAND_AV_SYMBOL(avcodec_flush_buffers),
    LOWLAND_AV_SYMBOL(avcodec_open2),
    LOWLAND_AV_SYMBOL(av_parser_init),
    LOWLAND_AV_SYMBOL(av_parser_close),
    LOWLAND_AV_SYMBOL(av_parser_parse2),
    LOWLAND_AV_SYMBOL(avcodec_align_dimensions),
    LOWLAND_AV_SYMBOL(avcodec_send_packet),
    LOWLAND_AV_SYMBOL(avcodec_receive_packet),
    LOWLAND_AV_SYMBOL(avcodec_send_frame),
    LOWLAND_AV_SYMBOL(avcodec_receive_frame),
    LOWLAND_AV_SYMBOL(avcodec_default_get_buffer2),
    LOWLAND_AV_SYMBOL(av_init_packet),
    LOWLAND_AV_SYMBOL(av_packet_alloc),
    LOWLAND_AV_SYMBOL(av_packet_unref),
    LOWLAND_AV_SYMBOL(av_packet_free),
    LOWLAND_AV_SYMBOL(avcodec_descriptor_get),
    LOWLAND_AV_SYMBOL(av_codec_iterate),
    LOWLAND_AV_SYMBOL(av_codec_is_decoder),
    LOWLAND_AV_SYMBOL(avcodec_get_name),
    {nullptr, nullptr},
};
static const PRStaticLinkTable kLowlandAVUtil[] = {
    LOWLAND_AV_SYMBOL(av_log_set_level),
    LOWLAND_AV_SYMBOL(av_malloc),
    LOWLAND_AV_SYMBOL(av_freep),
    LOWLAND_AV_SYMBOL(av_frame_alloc),
    LOWLAND_AV_SYMBOL(av_frame_free),
    LOWLAND_AV_SYMBOL(av_frame_unref),
    LOWLAND_AV_SYMBOL(av_frame_get_buffer),
    LOWLAND_AV_SYMBOL(av_frame_make_writable),
    LOWLAND_AV_SYMBOL(av_image_check_size),
    LOWLAND_AV_SYMBOL(av_image_get_buffer_size),
    LOWLAND_AV_SYMBOL(av_channel_layout_default),
    LOWLAND_AV_SYMBOL(av_channel_layout_from_mask),
    LOWLAND_AV_SYMBOL(av_channel_layout_copy),
    LOWLAND_AV_SYMBOL(av_buffer_get_opaque),
    LOWLAND_AV_SYMBOL(av_buffer_create),
    LOWLAND_AV_SYMBOL(av_buffer_ref),
    LOWLAND_AV_SYMBOL(av_buffer_unref),
    LOWLAND_AV_SYMBOL(av_strerror),
    LOWLAND_AV_SYMBOL(av_get_sample_fmt_name),
    LOWLAND_AV_SYMBOL(av_dict_set),
    LOWLAND_AV_SYMBOL(av_dict_free),
    LOWLAND_AV_SYMBOL(av_opt_set),
    LOWLAND_AV_SYMBOL(av_opt_set_double),
    LOWLAND_AV_SYMBOL(av_opt_set_int),
    LOWLAND_AV_SYMBOL(av_tx_init),
    LOWLAND_AV_SYMBOL(av_tx_uninit),
    {nullptr, nullptr},
};
#undef LOWLAND_AV_SYMBOL
#endif
