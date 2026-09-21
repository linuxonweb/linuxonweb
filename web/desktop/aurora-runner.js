const channelName = new URL(location.href).searchParams.get('channel');
importScripts('/upstream/browser-posix-websocket.js');
const bridgeUrl = installArchWebPosixWebSocket(channelName);

self.addEventListener('error', event => {
  postMessage({ type: 'log', source: 'aurora-error', line: event.message || 'worker error' });
});
self.addEventListener('unhandledrejection', event => {
  postMessage({ type: 'log', source: 'aurora-error', line: String(event.reason?.message ?? event.reason) });
});

const launchPattern = /^ARCHWEB_LAUNCH:aurora-files:(\/home\/arch\/(?:Pictures|Music|Videos))$/;
function report(line, source) {
  const value = String(line);
  const launch = launchPattern.exec(value);
  if (launch) postMessage({ type: 'launch', application: 'aurora-files', path: launch[1] });
  postMessage({ type: 'log', source, line: value });
}

var Module = {
  archwebSocketBridgeUrl: bridgeUrl,
  preRun: [() => {
    ENV.HOME = "/home/arch";
    FS.mkdirTree("/home/arch/Pictures");
    FS.mkdirTree("/home/arch/Music");
    FS.mkdirTree("/home/arch/Videos");
    FS.chdir("/home/arch");
  }],
  locateFile: file => `/upstream/aurora/${({
    aurora_wm: 'aurora-wm.wasm',
    'aurora_wm.wasm': 'aurora-wm.wasm',
    aurora_files: 'aurora-files.wasm',
    'aurora_files.wasm': 'aurora-files.wasm'
  }[file] ?? file)}`,
  print: line => report(line, 'aurora'),
  printErr: line => report(line, 'aurora-error')
};
postMessage({ type: 'log', source: 'aurora', line: 'launching source-built Aurora WM artifact (sibling webos provenance d9be82f)' });
importScripts('/upstream/aurora/aurora-wm.js');
