/* Global var is required by non-modularized Emscripten launchers. */
var Module;

(function installFactory(scope) {
  scope.installArchWebPosixWebSocket = function installArchWebPosixWebSocket(channelName) {
    const bridgeUrl = `ws://archweb.invalid/${encodeURIComponent(channelName)}`;

    class LocalWebSocket {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;

      constructor(url, protocols) {
        if (String(url) !== bridgeUrl) throw new Error('Guest WebSocket target denied: disabled-isolated');
        this.url = String(url);
        // The Emscripten bridge polls readyState from synchronous Wasm. The
        // browser-local BroadcastChannel endpoint has no network handshake.
        this.readyState = LocalWebSocket.OPEN;
        this.binaryType = 'blob';
        this.endpoint = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
        this.channel = new BroadcastChannel(channelName);
        this.pendingFunctions = new Map();
        this.outbox = [];
        this.channel.onmessage = event => {
          const message = event.data;
          if (!message || message.scope !== 'archweb-posix') return;
          if (message.type === 'event') {
            if (message.event?.endpoint && message.event.endpoint !== this.endpoint) return;
            if (message.event?.kind === 'connection')
              globalThis.__archwebPosixConnectionPending = (globalThis.__archwebPosixConnectionPending ?? 0) + 1;
            if (message.event?.kind === 'data' && Number.isInteger(message.event.fd)) {
              const readable = globalThis.__archwebPosixReadable ??= new Map();
              readable.set(message.event.fd, (readable.get(message.event.fd) ?? 0) + 1);
            }
            globalThis.__archwebPollWaiters?.forEach(wake => wake());
            for (const thread of Object.values(globalThis.PThread?.pthreads ?? {}))
              thread?.postMessage?.({ cmd: 99, event: message.event });
            return;
          }
          if (message.endpoint !== this.endpoint) return;
          if (message.type === 'response') {
            const bytes = Uint8Array.from(message.bytes);
            if (bytes.byteLength >= 12) {
              const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
              const pending = this.pendingFunctions.get(view.getInt32(0, true));
              this.pendingFunctions.delete(view.getInt32(0, true));
              if (pending?.functionId === 7)
                globalThis.__archwebPosixConnectionPending = Math.max(0, (globalThis.__archwebPosixConnectionPending ?? 0) - 1);
              if (pending?.functionId === 11 && Number.isInteger(pending.fd) && view.getInt32(4, true) >= 0) {
                const readable = globalThis.__archwebPosixReadable;
                const remaining = readable?.get(pending.fd) ?? 0;
                if (remaining > 1) readable.set(pending.fd, remaining - 1);
                else readable?.delete(pending.fd);
                for (const thread of Object.values(globalThis.PThread?.pthreads ?? {}))
                  thread?.postMessage?.({ cmd: 100, fd: pending.fd });
              }
            }
            this.onmessage?.({ data: bytes.buffer });
          }
          else if (message.type === 'error') this.onerror?.(new Error(message.message));
        };
        this.channel.postMessage({ scope: 'archweb-posix', type: 'connect', endpoint: this.endpoint });
        queueMicrotask(() => {
          this.onopen?.({ type: 'open' });
        });
      }

      send(data) {
        const bytes = Uint8Array.from(data);
        if (bytes.byteLength >= 8) {
          const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
          this.pendingFunctions.set(view.getInt32(0, true), {
            functionId: view.getInt32(4, true),
            fd: bytes.byteLength >= 12 ? view.getInt32(8, true) : null
          });
        }
        if (this.readyState === LocalWebSocket.CONNECTING) {
          this.outbox.push(bytes);
          return;
        }
        if (this.readyState !== LocalWebSocket.OPEN) throw new Error('browser POSIX socket is not open');
        this.channel.postMessage({
          scope: 'archweb-posix', type: 'data', endpoint: this.endpoint, bytes
        });
      }

      close() {
        if (this.readyState >= LocalWebSocket.CLOSING) return;
        this.readyState = LocalWebSocket.CLOSING;
        this.channel.postMessage({ scope: 'archweb-posix', type: 'disconnect', endpoint: this.endpoint });
        this.channel.close();
        this.readyState = LocalWebSocket.CLOSED;
        this.onclose?.({ type: 'close', code: 1000, wasClean: true });
      }
    }

    scope.WebSocket = LocalWebSocket;
    return bridgeUrl;
  };
})(globalThis);
