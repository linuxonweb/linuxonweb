# Authenticated development preview

`server.mjs` serves the progress dashboard and proxies the existing desktop server. The public `/health` route reports availability only. Desktop assets, aggregate CPU/RAM/disk statistics, round-trip WebSocket latency and plain-data messages require a signed preview session. A one-use grant exchanges for an HttpOnly Secure SameSite=Strict cookie; grant and session lifetimes are bounded. Owner API calls additionally require a separate private owner key. Messages are never treated as commands.

CPU is sampled every second. Metrics publish every two seconds. RAM and disks use decimal GB. WebSocket ping/pong measures round-trip latency, not unsynchronized one-way latency. COOP/COEP/CORP headers are applied exactly once and verified through HTTPS; the TCP bridge is authenticated. A 390px Chromium viewport check confirmed no horizontal document overflow, and a real browser confirmed crossOriginIsolated, SharedArrayBuffer and the WebSocket connection on both the dashboard and proxied desktop. This check did not boot a large Firefox guest.

Private state must stay outside the source archive. Set LINUX_PROGRESS_STATE to a private directory and supply LINUX_PROGRESS_PORT (default38080) and LINUX_PROGRESS_UPSTREAM_PORT (default3000). The owner helper reads its key locally without printing it:

```sh
node web/desktop/progress/owner.mjs PRIVATE_STATE messages
node web/desktop/progress/owner.mjs PRIVATE_STATE reply '{"text":"Status update"}'
node web/desktop/progress/owner.mjs PRIVATE_STATE progress '{"iteration":1,"score":null,"status":"Acceptance in progress"}'
node web/desktop/progress/owner.mjs PRIVATE_STATE grant '{"label":"user"}'
```

A grant is written to a private file; share only the intended user capability link. Use a separate grant for automated checks. Restarting the progress server clears in-memory sessions/grants and requires fresh links. The source download is an explicitly reviewed `src.tar.gz` placed in private state; arbitrary private state files are not served.

On the 2026-11-03 host, transient user systemd services keep the desktop server on3000 and progress proxy on38080 alive after webterm commands finish. The previous unowned nohup launch was reaped at command completion. `install-services.sh` records the equivalent persistent ownership pattern; run it only for the intended units and fresh session links. Existing unrelated services and tunnel routes must be preserved.
