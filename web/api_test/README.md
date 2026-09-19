# HTML5 API test bench

Serve the repository over localhost and open `/web/api_test/`:

```sh
python3 -m http.server 8780
# then visit http://localhost:8780/web/api_test/
```

The page is intentionally interactive. Camera, microphone, screen capture,
clipboard, geolocation, notifications, file picking, and Web Share are only
requested after their own button is pressed. `Run safe checks` covers APIs that
do not normally prompt. A secure context (localhost or HTTPS) is required for
most device APIs.

The page is also a host-adapter checklist: media streams and screen frames map
to display/input plumbing, clipboard and files map to the mounted filesystem,
and storage, workers, networking, WebGL/WebGPU, Web Audio, and WebAssembly
exercise browser services the eventual Linux port will need.
