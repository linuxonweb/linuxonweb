#!/usr/bin/env node
// Runs serve.mjs and restarts it when a new build is published into
// web/desktop/latest-build (see publish-build.mjs) or the server code changes.
// Open pages reconnect to the new server and reload once they see the new build.
import { spawn } from 'node:child_process';
import { mkdirSync, watch } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const latest = fileURLToPath(new URL('./latest-build/', import.meta.url));
const triggers = new Set(['latest-build.json', 'serve.mjs']);
let child = null, stopping = false, restartTimer = null;

function start() {
  child = spawn(process.execPath, [fileURLToPath(new URL('./serve.mjs', import.meta.url))], { stdio: 'inherit' });
  child.on('exit', (code, signal) => {
    child = null;
    if (stopping) process.exit(0);
    // A crash or a requested restart both start a fresh server.
    if (!restartTimer) { console.log(`server exited (${signal || code}); restarting`); setTimeout(start, 1000); }
  });
}
function restart(reason) {
  clearTimeout(restartTimer);
  // Debounce: publish-build.mjs writes the stamp once, editors may write several times.
  restartTimer = setTimeout(() => {
    console.log(`restarting server: ${reason}`);
    const old = child;
    if (!old) { restartTimer = null; start(); return; }
    old.once('exit', () => { restartTimer = null; start(); });
    old.kill('SIGTERM');
  }, 500);
}

mkdirSync(latest, { recursive: true });
watch(latest, (_, name) => { if (triggers.has(String(name))) restart('new build published'); });
watch(here, (_, name) => { if (triggers.has(String(name))) restart(`${name} changed`); });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopping = true; child ? child.kill('SIGTERM') : process.exit(0); });
start();
