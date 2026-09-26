// SPDX-License-Identifier: MIT
// Bounded Linux guest PCM bridge. No shared memory escapes the worker.
import { memory_bytes } from './wasm.js';
const MAX_FRAMES = 2048;
const MAX_QUEUE_SECONDS = 0.25;
const validId = n => Number.isInteger(n) && n >= 0 && n <= 0xffffffff;
const validFormat = (frames, rate, channels) => Number.isInteger(frames) && frames > 0 && frames <= MAX_FRAMES &&
    Number.isInteger(rate) && rate >= 8000 && rate <= 96000 && (channels === 1 || channels === 2);

export function createAudioWrite(memory, post, now = Date.now) {
    const pacing = new Map();
    return (pid, stream, pointer, frames, rate, channels) => {
        pid >>>= 0; stream >>>= 0;
        if (!pid || !stream) return -22;
        const key = `${pid}:${stream}`;
        if (frames === 0) {
            pacing.delete(key);
            post({ type: 'audio_write', pid, stream, frames: 0, sentAt: now() });
            return 0;
        }
        if (!validFormat(frames, rate, channels) || (pointer & 3)) return -22;
        const bytes = memory_bytes(memory, pointer >>> 0, frames * channels * 4);
        if (!bytes) return -22;
        // Bound pending worker messages too, even if the browser main thread is
        // stalled. A producer may lead real time by at most 250 ms and 64 packets.
        const sentAt = now();
        let budget = pacing.get(key);
        if (!budget || sentAt - budget.window >= 250) {
            budget = { window: sentAt, packets: 0, until: sentAt };
            if (!pacing.has(key) && pacing.size >= 16) {
                for (const [oldKey, old] of pacing) if (old.until < sentAt) pacing.delete(oldKey);
                if (pacing.size >= 16) return 0;
            }
            pacing.set(key, budget);
        }
        const until = Math.max(sentAt, budget.until) + frames / rate * 1000;
        if (until > sentAt + 250 || budget.packets >= 64) return 0;
        budget.until = until;
        budget.packets++;
        // Copy synchronously before the guest reuses its callback buffer.
        const pcm = bytes.slice().buffer;
        post({ type: 'audio_write', pid, stream, frames, rate, channels, pcm, sentAt }, [pcm]);
        return 0;
    };
}

export function createAudioHost({ Context = globalThis.AudioContext ?? globalThis.webkitAudioContext, now = Date.now } = {}) {
    let context = null;
    let closed = false;
    const streams = new Map();
    const stoppedAt = new Map();
    const stats = { packets: 0, frames: 0, dropped: 0, stops: 0, peak: 0, available: !!Context };
    const stop = key => {
        const state = streams.get(key);
        if (!state) return;
        for (const node of state.nodes) {
            node.onended = null;
            try { node.stop(); } catch { /* already ended */ }
            node.disconnect();
        }
        streams.delete(key);
    };
    return {
        // Call synchronously from a trusted gesture, before any await.
        resume() {
            if (closed || !Context) return;
            try {
                context ??= new Context({ latencyHint: 'interactive' });
                if (context.state !== 'running') void context.resume().catch(() => {});
            } catch { stats.available = false; }
        },
        write(message) {
            if (closed) return;
            const { pid, stream, frames, rate, channels, pcm, sentAt } = message;
            if (!validId(pid) || !pid || !validId(stream) || !stream || !Number.isFinite(sentAt)) { stats.dropped++; return; }
            const key = `${pid}:${stream}`;
            if (frames === 0) {
                stop(key); stats.stops++;
                stoppedAt.set(key, sentAt);
                if (stoppedAt.size > 64) stoppedAt.delete(stoppedAt.keys().next().value);
                return;
            }
            if (!validFormat(frames, rate, channels) || !(pcm instanceof ArrayBuffer) || pcm.byteLength !== frames * channels * 4 ||
                now() - sentAt > 250 || stoppedAt.has(key) || !context || context.state !== 'running') {
                stats.dropped++; return;
            }
            let state = streams.get(key);
            if (!state) {
                if (streams.size >= 16) { stats.dropped++; return; }
                state = { next: context.currentTime, nodes: new Set() };
                streams.set(key, state);
            }
            const duration = frames / rate;
            const start = Math.max(context.currentTime + 0.04, state.next);
            if (start + duration - context.currentTime > MAX_QUEUE_SECONDS || state.nodes.size >= 64) { stats.dropped++; return; }
            const buffer = context.createBuffer(channels, frames, rate);
            const source = new Float32Array(pcm);
            for (let channel = 0; channel < channels; channel++) {
                const target = buffer.getChannelData(channel);
                for (let frame = 0; frame < frames; frame++) {
                    const value = source[frame * channels + channel];
                    target[frame] = Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
                    stats.peak = Math.max(stats.peak, Math.abs(target[frame]));
                }
            }
            const node = context.createBufferSource();
            node.buffer = buffer;
            node.connect(context.destination);
            state.nodes.add(node);
            node.onended = () => {
                node.disconnect(); state.nodes.delete(node);
                if (!state.nodes.size && streams.get(key) === state) streams.delete(key);
            };
            node.start(start);
            state.next = start + duration;
            stats.packets++; stats.frames += frames;
        },
        get stats() { return { ...stats, state: closed ? 'closed' : context?.state ?? 'idle', streams: streams.size }; },
        async close() {
            if (closed) return;
            closed = true;
            for (const key of streams.keys()) stop(key);
            stoppedAt.clear();
            if (context && context.state !== 'closed') await context.close().catch(() => {});
            context = null;
        },
    };
}
