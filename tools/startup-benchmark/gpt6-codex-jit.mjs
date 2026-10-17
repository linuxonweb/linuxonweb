export function jitCaptureBounds(full) {
  if (typeof full !== 'boolean') throw Error('Full capture must be boolean');
  // Leave time for owner and service cleanup within the user's ten-minute cap.
  const observationSeconds = full ? 540 : 120;
  return { observationSeconds, ownerSeconds: observationSeconds + 40, serviceSeconds: observationSeconds + 50 };
}

export function jitObservation(packets, elapsedMs, deadlineMs, label, cpus) {
  const result = { state: 'running', jitAcceptance: false, originalBenchmarkAcceptance: false };
  if (elapsedMs >= deadlineMs) return { ...result, state: 'timeout' };
  const starts = packets.filter(packet => packet.event === 'start');
  const done = packets.filter(packet => packet.event === 'done');
  if (packets.some(packet => packet.event === 'error' || packet.label !== label) ||
      starts.length > 1 || done.length > 1 ||
      (starts.length && (packets[0] !== starts[0] || starts[0].hc !== cpus)) ||
      (packets.length && starts.length !== 1) ||
      (done.length && (packets.at(-1) !== done[0] || done[0].ok !== true || !Number.isFinite(done[0].elapsedMs) || done[0].elapsedMs < 0))) {
    return { ...result, state: 'error' };
  }
  return { ...result, state: done.length ? 'done' : 'running' };
}

export function jitCompilerLines(logs) {
  return logs.split('\n').filter(line => /^PBL(?:IC|BC|JIT)\b/.test(line));
}

export function jitPlan(arm) {
  if (!['off', 'ic', 'method'].includes(arm)) throw Error('Invalid JIT diagnostic arm');
  const filename = 'gpt6-jit.html';
  const prefs = {
    'network.http.http2.enabled': false,
    'network.http.http3.enable': false,
    'toolkit.legacyUserProfileCustomizations.stylesheets': true,
    'media.rdd-process.enabled': false,
    'media.utility-process.enabled': false,
    'media.allow-audio-non-utility': true,
    'browser.shell.checkDefaultBrowser': false,
    'devtools.console.stdout.content': true,
    'browser.aboutwelcome.enabled': false,
    'dom.max_script_run_time': 0,
    'datareporting.policy.firstRunURL': '',
    'javascript.options.portable_baseline': true,
    'webgl.disabled': true,
    'dom.webgpu.enabled': false,
    'browser.startup.page': 1,
    'browser.startup.homepage': `file:///home/admin/pblbench/${filename}`,
  };
  return {
    arm, query: arm === 'off' ? '&pblic=0&pblbc=0&pbljit=0' : `&pblic=1&pblbc=${arm === 'method' ? 1 : 0}&pbljit=1`, filename,
    preferences: Object.entries(prefs).map(([name, value]) => `user_pref(${JSON.stringify(name)},${JSON.stringify(value)});`).join('\n') + '\n',
    jitAcceptance: false,
  };
}

export function jitPackets(logs) {
  const packets = [];
  for (const line of logs.split('\n')) {
    const offset = line.indexOf('console.log: "PBLBENCH ');
    if (offset < 0) continue;
    const text = JSON.parse(line.slice(offset + 'console.log: '.length));
    packets.push(JSON.parse(text.slice('PBLBENCH '.length)));
  }
  return packets;
}

export async function seedJitBenchmark(home, fixture, plan) {
  const files = [
    [`admin/pblbench/${plan.filename}`, fixture],
    ['admin/.mozilla/firefox/http1-profile/user.js', plan.preferences],
  ];
  const pending = [];
  for (const [path, text] of files) {
    const parts = path.split('/'), name = parts.pop();
    let parent = home.root;
    for (const part of parts) {
      parent = await home.lookup(parent, part) || await home.mkdir(parent, part, { mode: 0o755, uid: 1000, gid: 1000 });
    }
    if (await home.lookup(parent, name)) throw Error('Refusing to overwrite existing benchmark/profile data');
    pending.push({ parent, name, text });
  }
  for (const { parent, name, text } of pending) {
    const file = await home.create(parent, name, 2, { mode: 0o644, uid: 1000, gid: 1000 });
    try {
      const bytes = new TextEncoder().encode(text);
      const written = await home.write(file.node, file.handle, 0n, bytes);
      if (written !== bytes.length) throw Error('Incomplete benchmark seed write');
    } finally { await home.release(file.node, file.handle); }
  }
}
