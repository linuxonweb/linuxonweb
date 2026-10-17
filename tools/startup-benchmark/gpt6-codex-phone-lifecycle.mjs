export async function runCleanupSteps(steps) {
  const errors = [];
  for (const [step, action] of steps) {
    try { await action(); }
    catch (error) { errors.push({ step, error: String(error) }); }
  }
  return errors;
}

export function admitPhoneLaunch(elapsedMs) {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs > 240000) {
    throw Error('Full phone observation no longer fits the bounded owner deadline');
  }
  return true;
}

export async function waitForOwnedNavigation({ read, expectedUrl, previousUrl, frameId, loaderId, timeoutMs = 10000, now = Date.now, pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)) }) {
  if (!frameId || !loaderId || !expectedUrl || !previousUrl || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw Error('Owned navigation identity missing');
  }
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    const sample = await read();
    if (!sample || sample.frameId !== frameId ||
        !['', previousUrl, expectedUrl].includes(sample.url) ||
        !['', 'about:blank', previousUrl, expectedUrl].includes(sample.frameUrl)) {
      throw Error('Owned navigation identity changed');
    }
    if (now() >= deadline) break;
    if (sample.url === expectedUrl && sample.frameUrl === expectedUrl && sample.loaderId === loaderId) return sample;
    await pause(Math.min(100, deadline - now()));
  }
  throw Error('Owned navigation deadline exceeded');
}
