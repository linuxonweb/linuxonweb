import { type DeviceTreeNode } from "./devicetree.ts";
import { type VirtioDevice } from "./virtio/core.ts";
import { type FramebufferOptions } from "./framebuffer.ts";
export type { DeviceTreeNode } from "./devicetree.ts";
export { VirtioController, type VirtioDevice, type VirtioDeviceOptions, type VirtioDriver, type Virtqueue, type VirtqueueBuffer, type VirtqueueChain, type VirtqueueHandler, } from "./virtio/core.ts";
export { blockDevice, type BlockDeviceStorage } from "./virtio/block.ts";
export { type ConsoleDevice, consoleDevice } from "./virtio/console.ts";
export { entropyDevice } from "./virtio/entropy.ts";
export { type FS, type FSAttributes, type FSCreateContext, type FSDirectoryEntry, type FSDeviceOptions, FSError, type FSErrorCode, type FSSetAttributes, type FSStat, type FSTimestamp, fileSystemDevice, } from "./virtio/fs.ts";
export { type EthernetDevice, ethernetDevice, type EthernetDeviceOptions, type EthernetNetwork, ethernetNetwork, type EthernetPort, type MacAddress, } from "./virtio/net.ts";
export { type VsockConnection, type VsockDevice, vsockDevice, } from "./virtio/vsock.ts";
export { Abs, Ev, inputDevice, type InputDevice, Key, Rel, Syn, } from "./virtio/input.ts";
export { createFramebufferHost, swizzle_bgra_to_rgba, type FramebufferCanvas, type FramebufferHost, type FramebufferOptions, } from "./framebuffer.ts";
export { attach_guest, connectTcpOverWebSocket, createNetwork, resolveDnsOverProxy, wsTcpProxyNetwork, type GuestNetwork, type Network, type NetworkAddress, type NetworkOptions, type TcpConnection, type TcpConnectOptions, type TcpSession, type UdpConnection, type UdpConnectOptions, type WsTcpProxyOptions, } from "./network/index.ts";
type MaybePromise<T> = T | PromiseLike<T>;
/** The resources and boot configuration of a Linux machine. */
export interface SpawnMachineOptions {
    /** Optional same-origin /immutable/worker-<sha256>.mjs browser bundle. */
    workerScriptURL?: string | URL;
    /** Cancels the optional verified worker bundle download before boot. */
    workerScriptSignal?: AbortSignal;
    /** Kernel command line arguments, appended after `console=hvc0`. */
    cmdline?: string;
    /** Virtual CPUs to boot, one Web Worker each. Defaults to four, capped at the host's hardware concurrency. */
    cpus?: number;
    /** The machine's virtio devices, in device tree order. */
    devices: readonly VirtioDevice[];
    /** Initial ramdisk loaded into memory and passed to the kernel. */
    initcpio?: MaybePromise<ArrayBufferView>;
    /** Recursively merged over the generated device tree before boot. */
    devicetree?: DeviceTreeNode;
    /**
     * Optional browser canvas for the wasm framebuffer (`/dev/fb0`).
     * When omitted the guest still gets a headless 1024×768×32 fb.
     */
    framebuffer?: FramebufferOptions;
    /** Enable bounded browser playback of Linux guest PCM imports. */
    audio?: boolean;
}
/**
 * A booted Linux machine: one shared WebAssembly memory, one Web Worker per
 * virtual CPU, and its virtio devices.
 */
export interface Machine extends Disposable {
    /** The machine's physical memory. */
    readonly memory: WebAssembly.Memory;
    /** Kernel output from before the console device is available. */
    readonly bootConsole: ReadableStream<Uint8Array>;
    /** Settles when closed, rejecting if the machine failed unexpectedly. */
    readonly closed: Promise<void>;
    /** Idempotently shuts down the workers and owned devices. */
    close(): void;
    resumeAudio(): void;
    readonly audioStats: Record<string, number | string | boolean> | null;
}
export declare class MachinePanicError extends Error {
    constructor();
}
/**
 * Boots the packaged kernel and resolves once it is running: the devices
 * are live and the kernel is executing from then on. What runs next is up
 * to the initramfs and kernel command line.
 *
 * In a browser the page must be cross-origin isolated, because the
 * machine's memory is shared between workers.
 *
 * @example
 * ```ts
 * const machine = await spawnMachine({
 *   cpus: Math.min(4, navigator.hardwareConcurrency),
 *   initcpio: initramfs,
 *   devices: [
 *     consoleDevice(input, output),
 *     entropyDevice(),
 *     blockDevice(disk),
 *   ],
 * });
 * ```
 */
export declare function spawnMachine(options: SpawnMachineOptions): Promise<Machine>;
