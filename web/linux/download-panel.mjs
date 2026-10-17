// Bottom-of-display panel: one row per package download with its size and bar.
// It appears when a download starts and hides HIDE_AFTER_MS after every
// download in the batch has finished or failed.
import { onDownloadProgress } from './download-progress.mjs';

export const HIDE_AFTER_MS = 5000;
const mib = bytes => `${(bytes / 1048576).toFixed(1)} MB`;

export function installDownloadPanel(container, { hideAfter = HIDE_AFTER_MS } = {}) {
  const panel = document.createElement('div');
  panel.className = 'download-panel';
  panel.hidden = true;
  panel.setAttribute('role', 'status');
  panel.setAttribute('aria-live', 'polite');
  container.append(panel);
  const items = new Map();
  let hideTimer = null;
  const finished = () => [...items.values()].every(item => item.state !== 'downloading');

  function row(item) {
    const element = document.createElement('div');
    element.className = 'download-row';
    element.dataset.state = item.state;
    const name = document.createElement('span');
    name.className = 'download-name';
    name.textContent = item.label;
    const bar = document.createElement('progress');
    bar.max = item.total || 1;
    bar.value = item.state === 'done' ? bar.max : Math.min(item.loaded, bar.max);
    const size = document.createElement('span');
    size.className = 'download-size';
    size.textContent = item.state === 'error'
      ? `failed: ${item.error}`
      : item.state === 'done' ? `${mib(item.total)} · done` : `${mib(item.loaded)} / ${mib(item.total)}`;
    element.append(name, bar, size);
    return element;
  }

  function render() {
    panel.replaceChildren(...[...items.values()].map(row));
  }

  onDownloadProgress(event => {
    // A new package in the same batch cancels the pending hide and keeps earlier rows.
    clearTimeout(hideTimer);
    hideTimer = null;
    items.set(event.id, event);
    panel.hidden = false;
    render();
    if (finished()) hideTimer = setTimeout(() => { panel.hidden = true; items.clear(); hideTimer = null; }, hideAfter);
  });
  return { panel, items };
}
