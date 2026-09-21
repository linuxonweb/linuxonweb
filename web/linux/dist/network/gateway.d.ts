import { type EthernetDevice, type MacAddress } from "../virtio/net.ts";
/** One end of a connection: transport, host, and port. */
export interface NetworkAddress {
    readonly transport: "tcp" | "udp";
    readonly hostname: string;
    readonly port: number;
}
/**
 * A TCP connection between the host and a guest. Data moves as web streams:
 * write to `writable`, read from `readable`.
 */
export interface TcpConnection {
    /** Bytes from the guest. */
    readonly readable: ReadableStream<Uint8Array>;
    /** Bytes to the guest. */
    readonly writable: WritableStream<Uint8Array>;
    /** The host side of the connection. */
    readonly localAddr: NetworkAddress;
    /** The guest side of the connection. */
    readonly remoteAddr: NetworkAddress;
    /** Resets and closes the connection. */
    close(): void;
}
/**
 * A UDP channel between the host and a guest. Each write to `writable` is
 * one datagram.
 */
export interface UdpConnection {
    /**
     * Datagrams from the guest. The queue retains at most 64 datagrams and
     * drops new arrivals while full.
     */
    readonly readable: ReadableStream<Uint8Array>;
    /** One write per datagram to the guest. */
    readonly writable: WritableStream<Uint8Array>;
    /** The host side of the channel. */
    readonly localAddr: NetworkAddress;
    /** The guest side of the channel. */
    readonly remoteAddr: NetworkAddress;
    /** Closes the channel. */
    close(): void;
}
export interface TcpConnectOptions {
    /** The guest's address on the network, e.g. `guest.network.address`. */
    hostname: string;
    port: number;
    transport?: "tcp";
    /** Aborts the pending connection and any connection it establishes. */
    signal?: AbortSignal;
}
export interface UdpConnectOptions {
    /** The guest's address on the network, e.g. `guest.network.address`. */
    hostname: string;
    port: number;
    transport: "udp";
}
/** One lazily established, supervised outbound guest TCP session. */
export interface TcpSession {
    /** The address selected by the guest connection. */
    readonly target: {
        readonly hostname: string;
        readonly port: number;
    };
    /** Bytes received from the guest. The first read starts the TCP handshake. */
    readonly readable: ReadableStream<Uint8Array>;
    /** Bytes sent to the guest. The first write or close starts the TCP handshake. */
    readonly writable: WritableStream<Uint8Array>;
    /** Aborted when the guest or network tears down the flow. */
    readonly signal: AbortSignal;
}
/**
 * The outward-facing half of a `Network`: how to reach the world beyond the
 * virtual subnet on a guest's behalf.
 */
export interface NetworkOptions {
    /**
     * Handles one TCP session whenever a guest connects outside the virtual
     * subnet. The callback starts at SYN receipt and lives for the whole
     * connection. Its first stream read, write, or writable close starts the
     * handshake; merely acquiring a reader or writer does not. Throwing before
     * first I/O rejects the pending connection, while throwing afterwards resets
     * it.
     *
     * In Node, implement it with `net.connect`. A browser has no raw TCP, so
     * there it bridges to whatever transport you control — a WebSocket proxy,
     * say.
     */
    connectTcp: (session: TcpSession) => void | PromiseLike<void>;
    /** Answers guest DNS A queries with the IPv4 addresses for `hostname`. */
    resolveDns: (hostname: string) => Promise<string[]>;
}
/**
 * A private IPv4 network, created by `createNetwork`. Guests spawned with
 * the same network can reach each other, and the host can connect to any of
 * them.
 */
export interface Network extends Disposable {
    /**
     * The gateway address, `192.0.2.1`. From inside a guest this is the host
     * endpoint: TCP connections to it reach the host's loopback through the
     * `connectTcp` adapter.
     */
    readonly gateway: string;
    /**
     * Connects from the host to a port on an attached guest. Resolves once
     * the guest accepts the connection; rejects if nothing is listening there
     * or no guest has the address. If the guest may not be listening yet,
     * retry.
     *
     * @example Reach a server running in the guest
     * ```ts
     * const server = await guest.exec(["nc", "-l", "-p", "8080"]);
     * let connection;
     * for (;;) {
     *   try {
     *     connection = await guest.network.connect({ port: 8080 });
     *     break;
     *   } catch {
     *     await new Promise((resolve) => setTimeout(resolve, 50));
     *   }
     * }
     * const writer = connection.writable.getWriter();
     * await writer.write(new TextEncoder().encode("hello from the host\n"));
     * await writer.close();
     * const reader = server.stdout.getReader();
     * console.log(new TextDecoder().decode((await reader.read()).value));
     * await server.kill();
     * ```
     */
    connect(options: TcpConnectOptions): Promise<TcpConnection>;
    connect(options: UdpConnectOptions): Promise<UdpConnection>;
    /** Closes every connection and detaches every guest. */
    close(): void;
}
/**
 * A guest's side of a `Network`, present as `guest.network` when the guest
 * was spawned with one.
 */
export interface GuestNetwork {
    /** The guest's address on the network, e.g. `"192.0.2.2"`. */
    readonly address: string;
    /** Connects to a port on this guest — `network.connect` with the address filled in. */
    connect(options: Omit<TcpConnectOptions, "hostname">): Promise<TcpConnection>;
    connect(options: Omit<UdpConnectOptions, "hostname">): Promise<UdpConnection>;
}
interface Attachment {
    readonly address: string;
    readonly ip: number;
    readonly macAddress: MacAddress;
    readonly device: EthernetDevice;
    close(): void;
}
/**
 * Creates a private IPv4 network: an Ethernet switch in this process plus a
 * userspace TCP/IP endpoint at `192.0.2.1`. Pass the result to every
 * `spawnGuest` that should be on the network; guests on the same network
 * reach each other over real TCP and UDP.
 *
 * Guest traffic beyond the subnet goes through the adapters: outbound TCP
 * is proxied with `connectTcp`, DNS is answered with `resolveDns`, and UDP
 * is delivered to the gateway only. The network is disposable — closing it
 * (or ending an `await using` scope) tears down every connection.
 *
 * @example Give guests internet access from Node
 * ```ts
 * import { createConnection } from "node:net";
 * import { resolve4 } from "node:dns/promises";
 * import { once } from "node:events";
 * import { Duplex } from "node:stream";
 *
 * const network = createNetwork({
 *   async connectTcp(session) {
 *     const socket = createConnection({ host: session.target.hostname,
 *       port: session.target.port, signal: session.signal });
 *     await once(socket, "connect");
 *     const streams = Duplex.toWeb(socket);
 *     await Promise.all([
 *       session.readable.pipeTo(streams.writable as WritableStream<Uint8Array>),
 *       (streams.readable as ReadableStream<Uint8Array>).pipeTo(session.writable),
 *     ]);
 *   },
 *   resolveDns: resolve4,
 * });
 *
 * const guest = await spawnGuest({ network });
 * // Guests can now reach whatever the host process can:
 * const process = await guest.exec(["wget", "-qO-", "http://example.com"]);
 * ```
 */
export declare function createNetwork({ connectTcp, resolveDns }: NetworkOptions): Network;
export declare function attach_guest(network: Network): {
    attachment: Attachment;
    guest_network: GuestNetwork;
};
export {};
