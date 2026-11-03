// Read-only Android browser process memory accounting. The caller owns ADB.
// Browser totals include every tab in that browser, never just the tested guest.
const browserProcess = /^com\.brave\.browser(?::\S+)?$/;
export const ANDROID_COUNTER_SCRIPT = "cat /proc/stat /proc/meminfo; printf '\\n__LINUXONWEB_BROWSER_RSS__\\n'; ps -A -o PID,PPID,RSS,NAME | grep -F com.brave.browser";
export const ANDROID_PSS_ARGS = ['shell', 'dumpsys', 'meminfo', '-s', '--package', 'com.brave.browser'];

export function parseAndroidCounters(text, previousCpu = null) {
  const available = /^MemAvailable:\s+(\d+)/m.exec(text);
  const total = /^MemTotal:\s+(\d+)/m.exec(text);
  const cpu = /^cpu\s+(.+)$/m.exec(text);
  const marker = text.indexOf('__LINUXONWEB_BROWSER_RSS__');
  if (!available || !total || !cpu || marker < 0) throw new Error('Device CPU/RAM/RSS counters unavailable');
  // guest and guest_nice are already counted inside user/nice in /proc/stat.
  const ticks = cpu[1].trim().split(/\s+/).map(Number).slice(0, 8);
  if (ticks.length < 4 || ticks.some(value => !Number.isFinite(value))) throw new Error('Invalid device CPU counters');
  const sum = ticks.reduce((a, b) => a + b, 0), idle = ticks[3] + (ticks[4] || 0);
  const processes = [];
  for (const line of text.slice(marker).split('\n')) {
    const row = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s*$/.exec(line);
    if (row && browserProcess.test(row[4])) processes.push({ pid: Number(row[1]), parentPid: Number(row[2]), rssBytes: Number(row[3]) * 1024, name: row[4] });
  }
  if (!processes.length || !processes.some(row => row.rssBytes > 0)) throw new Error('Browser process RSS unavailable');
  const delta = previousCpu ? sum - previousCpu.sum : 0;
  return {
    availableBytes: Number(available[1]) * 1024,
    totalBytes: Number(total[1]) * 1024,
    cpuBusyPercent: delta > 0 ? 100 * (1 - (idle - previousCpu.idle) / delta) : null,
    cpuCounter: { sum, idle },
    browserRssBytes: processes.reduce((n, row) => n + row.rssBytes, 0),
    browserProcesses: processes,
    scope: 'device CPU/RAM; all com.brave.browser app processes, zygote excluded; RSS can count shared pages repeatedly',
  };
}

export function parseAndroidPss(text) {
  const processes = []; let current = null;
  for (const line of text.split('\n')) {
    const heading = /\*\* MEMINFO in pid (\d+) \[([^\]]+)\] \*\*/.exec(line);
    if (heading) current = browserProcess.test(heading[2]) ? { pid: Number(heading[1]), name: heading[2] } : null;
    const total = /TOTAL PSS:\s*(\d+)\s+TOTAL RSS:\s*(\d+)/.exec(line);
    if (current && total) {
      processes.push({ ...current, pssBytes: Number(total[1]) * 1024, rssBytes: Number(total[2]) * 1024 });
      current = null;
    }
  }
  if (!processes.length || processes.some(row => !Number.isFinite(row.pssBytes))) throw new Error('Android package PSS unavailable');
  return {
    browserPssBytes: processes.reduce((n, row) => n + row.pssBytes, 0),
    browserPssProcesses: processes,
    scope: 'all app processes returned by dumpsys meminfo --package com.brave.browser; sampled peak is a lower bound',
  };
}
