var Module = {
  arguments: [':11', '-screen', '0', '800x600x24', '-fbdir', '/tmp',
    '-ac', '-nolock', '-nolisten', 'unix', '-listen', 'tcp', '-pn',
    '-xkbdir', '/usr/share/X11/xkb'],
  locateFile: file => `/upstream/xvfb/${file}`,
  print: line => postMessage({ type: 'log', source: 'xorg', line }),
  printErr: line => postMessage({ type: 'log', source: 'xorg', line }),
  onRuntimeInitialized() {
    postMessage({ type: 'ready', source: 'xorg', line: 'Xvfb runtime initialized on display :11' });
    setInterval(() => {
      try {
        const frame = Module.FS.readFile('/tmp/Xvfb_screen0');
        postMessage({ type: 'frame', frame: frame.buffer }, [frame.buffer]);
      } catch {}
    }, 2000);
  }
};
importScripts('/upstream/xvfb/Xvfb.js');
