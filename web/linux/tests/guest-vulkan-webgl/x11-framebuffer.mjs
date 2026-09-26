// Independent observation of the displayed Linux framebuffer, never GPU replies.
export function observeX11Framebuffer(display, { onFailure, onChange }) {
  const capture = document.createElement('canvas'); capture.width = 640; capture.height = 480;
  const context = capture.getContext('2d', { willReadFrequently: true });
  const frames = []; let current, timer, mismatch, stopped = false;
  function sample() {
    if (stopped || !current || frames.some(frame => frame.round === current.round)) return;
    try {
      context.drawImage(display, 0, 0);
      const data = context.getImageData(current.x, current.y, current.width, current.height).data;
      const vertex = Math.floor(current.round / 4), fragment = Math.floor(current.round / 2) % 2;
      const triangle = [[-.8, -.7], [.2, -.6], [-.5, .6]].map(([x, y]) => [
        ((vertex ? x * .5 + .25 : x) + 1) * 73 / 2,
        ((vertex ? y * .75 - .1 : y) + 1) * 51 / 2]);
      const [[ax, ay], [bx, by], [cx, cy]] = triangle, denominator = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      let checks = 0, inside = 0, outside = 0;
      for (let y = 0; y < 51; y++) for (let x = 0; x < 73; x++) {
        const a = ((by - cy) * (x + .5 - cx) + (cx - bx) * (y + .5 - cy)) / denominator;
        const b = ((cy - ay) * (x + .5 - cx) + (ax - cx) * (y + .5 - cy)) / denominator, c = 1 - a - b;
        const minimum = Math.min(a, b, c); if (minimum > -.04 && minimum < .04) continue;
        const expected = minimum >= .04 ? [Math.round((fragment ? c : a) * 255), Math.round(b * 255), Math.round((fragment ? a : c) * 255), 255] : [0, 255, 0, 255];
        if (minimum >= .04) inside++; else outside++;
        const index = (((y * 4 + 2) * current.width) + x * 4 + 2) * 4;
        for (let channel = 0; channel < 4; channel++) {
          checks++;
          if (Math.abs(data[index + channel] - expected[channel]) > (minimum >= .04 ? 3 : 0)) {
            mismatch = { round: current.round, x, y, channel, actual: data[index + channel], expected: expected[channel] }; return;
          }
        }
      }
      if (inside < 20 || outside < 100) throw Error('insufficient independent framebuffer samples');
      let fnv = 2166136261; for (const byte of data) fnv = Math.imul(fnv ^ byte, 16777619) >>> 0;
      mismatch = undefined; frames.push({ ...current, checks, inside, outside, rgbaFNV1a: fnv.toString(16).padStart(8, '0') });
      if (current.round === 7) {
        const label = document.createElement('p'); label.textContent = 'Captured Linux framebuffer: final X11 presentation';
        const snapshot = document.createElement('canvas'); snapshot.width = capture.width; snapshot.height = capture.height;
        snapshot.id = 'x11-captured-framebuffer'; snapshot.getContext('2d').drawImage(capture, 0, 0);
        display.before(label, snapshot);
      }
      onChange(frames);
    } catch (error) { stop(); onFailure('X11 framebuffer observation: ' + error.message); }
  }
  function stop() { stopped = true; clearInterval(timer); }
  timer = setInterval(sample, 20);
  return { stop, frames, next(line) {
    const match = /^GUEST_VK_X11_FRAME round=(\d+) x=(\d+) y=(\d+) width=(\d+) height=(\d+) scale=4 verified=(\d+)$/.exec(line);
    if (!match || Number(match[1]) !== frames.length || (current && !frames.some(frame => frame.round === current.round))) {
      stop(); onFailure('X11 frame was not observed before the next round: ' + JSON.stringify(mismatch)); return;
    }
    const [, round, x, y, width, height, verified] = match.map(Number);
    if (round > 7 || x !== 20 || y !== 100 || width !== 292 || height !== 204 || verified !== (round + 1) * width * height) {
      stop(); onFailure('invalid X11 presentation geometry'); return;
    }
    current = { round, x, y, width, height, serverVerified: verified }; sample();
  } };
}
