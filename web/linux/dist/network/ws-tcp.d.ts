import type { NetworkOptions, TcpSession } from "./gateway.ts";
export interface WsTcpProxyOptions {
    /**
     * Base URL of the proxy, e.g. `ws://127.0.0.1:4173` or
     * `wss://linux-tcp.example.workers.dev`. Paths `/tcp` and `/dns` are appended.
     */
    proxyUrl: string;
    /** Optional AbortSignal that tears down every in-flight session. */
    signal?: AbortSignal;
}
/**
 * Opens one WebSocket per guest TCP session and splices the byte streams.
 * The proxy must speak the `/tcp?host=&port=` binary-frame protocol.
 */
export declare function connectTcpOverWebSocket(session: TcpSession, options: WsTcpProxyOptions): Promise<void>;
/** Resolves A records via the proxy's `/dns?name=` JSON endpoint. */
export declare function resolveDnsOverProxy(hostname: string, options: WsTcpProxyOptions): Promise<string[]>;
/** `createNetwork` options that tunnel every outbound flow through the proxy. */
export declare function wsTcpProxyNetwork(options: WsTcpProxyOptions): NetworkOptions;
