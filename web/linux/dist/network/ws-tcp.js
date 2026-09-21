// SPDX-License-Identifier: MIT
//
// Browser-side adapters that tunnel guest TCP (and DNS) through a WebSocket
// proxy — typically a Cloudflare Worker using `cloudflare:sockets`, or the
// local Node proxy in demo/server.mjs during development.
function join_url(base, path, query) {
    const url = new URL(path, base.endsWith("/") ? base : `${base}/`);
    for (const [key, value] of Object.entries(query)) {
        url.searchParams.set(key, value);
    }
    return url;
}
function ws_url(httpish) {
    const url = new URL(httpish);
    if (url.protocol === "http:")
        url.protocol = "ws:";
    else if (url.protocol === "https:")
        url.protocol = "wss:";
    return url;
}
/**
 * Opens one WebSocket per guest TCP session and splices the byte streams.
 * The proxy must speak the `/tcp?host=&port=` binary-frame protocol.
 */
export async function connectTcpOverWebSocket(session, options) {
    const target = join_url(options.proxyUrl, "tcp", {
        host: session.target.hostname,
        port: String(session.target.port),
    });
    const socket = new WebSocket(ws_url(target));
    socket.binaryType = "arraybuffer";
    const opened = Promise.withResolvers();
    const on_open = () => opened.resolve();
    const on_early_error = (event) => {
        opened.reject(new Error(`websocket proxy failed for ${session.target.hostname}:${session.target.port}`, { cause: event }));
    };
    socket.addEventListener("open", on_open, { once: true });
    socket.addEventListener("error", on_early_error, { once: true });
    const abort = () => {
        try {
            socket.close();
        }
        catch {
            /* ignore */
        }
    };
    session.signal.addEventListener("abort", abort, { once: true });
    options.signal?.addEventListener("abort", abort, { once: true });
    if (session.signal.aborted || options.signal?.aborted)
        abort();
    try {
        await opened.promise;
    }
    finally {
        socket.removeEventListener("error", on_early_error);
    }
    const from_socket = new ReadableStream({
        start(controller) {
            socket.addEventListener("message", (event) => {
                if (typeof event.data === "string") {
                    controller.enqueue(new TextEncoder().encode(event.data));
                    return;
                }
                controller.enqueue(new Uint8Array(event.data));
            });
            socket.addEventListener("close", () => {
                try {
                    controller.close();
                }
                catch {
                    /* ignore */
                }
            });
            socket.addEventListener("error", () => {
                controller.error(new Error("websocket proxy connection error"));
            });
        },
        cancel() {
            abort();
        },
    });
    const to_socket = new WritableStream({
        write(chunk) {
            if (socket.readyState !== WebSocket.OPEN) {
                throw new Error("websocket proxy is not open");
            }
            // Copy into a fresh ArrayBuffer-backed view for DOM typings.
            const copy = new Uint8Array(chunk.byteLength);
            copy.set(chunk);
            socket.send(copy);
        },
        close() {
            if (socket.readyState === WebSocket.OPEN)
                socket.close();
        },
        abort() {
            abort();
        },
    });
    await Promise.all([
        session.readable.pipeTo(to_socket, { signal: session.signal }).catch((error) => {
            abort();
            throw error;
        }),
        from_socket.pipeTo(session.writable, { signal: session.signal }).catch((error) => {
            abort();
            throw error;
        }),
    ]);
}
/** Resolves A records via the proxy's `/dns?name=` JSON endpoint. */
export async function resolveDnsOverProxy(hostname, options) {
    const url = join_url(options.proxyUrl, "dns", { name: hostname });
    // DNS is a plain HTTP fetch against the same origin/proxy host.
    if (url.protocol === "ws:")
        url.protocol = "http:";
    else if (url.protocol === "wss:")
        url.protocol = "https:";
    const response = await fetch(url, { signal: options.signal });
    if (!response.ok) {
        throw new Error(`dns proxy HTTP ${response.status} for ${hostname}`);
    }
    const body = (await response.json());
    if (!Array.isArray(body.addresses) || body.addresses.length === 0) {
        throw new Error(`dns proxy returned no addresses for ${hostname}`);
    }
    return body.addresses;
}
/** `createNetwork` options that tunnel every outbound flow through the proxy. */
export function wsTcpProxyNetwork(options) {
    return {
        connectTcp: (session) => connectTcpOverWebSocket(session, options),
        resolveDns: (hostname) => resolveDnsOverProxy(hostname, options),
    };
}
