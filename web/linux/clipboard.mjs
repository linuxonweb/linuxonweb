// Clipboard access occurs only in handlers installed on the explicit Paste control.
const MAGIC = 0x31504c43;
export const CLIPBOARD_LIMIT = 16 * 1024 * 1024;
export async function guestClipboard(vsock, operation, item, timeoutMs = 15000) {
  if (!vsock) throw new Error('Start the Linux desktop before using the clipboard.');
  let connection, timer;
  const work = async () => {
    connection = await vsock.connect(4051, { timeoutMs: 3000 });
    const data = item?.bytes ?? new Uint8Array();
    if (data.byteLength > CLIPBOARD_LIMIT) throw new Error('Clipboard content exceeds 16 MiB.');
    const header = new Uint8Array(12), view = new DataView(header.buffer);
    view.setUint32(0, MAGIC, true); header[4] = operation; header[5] = item?.kind ?? 0; view.setUint32(8, data.byteLength, true);
    await connection.write(header); if (data.length) await connection.write(data);
    const response = await connection.readExactly(12);
    if (response.length !== 12) throw new Error('Linux clipboard bridge closed before replying.');
    const info = new DataView(response.buffer, response.byteOffset, response.byteLength), size = info.getUint32(8, true);
    if (info.getUint32(0, true) !== MAGIC || response[6] || response[7] || size > CLIPBOARD_LIMIT) throw new Error('Invalid Linux clipboard reply.');
    const bytes = await connection.readExactly(size);
    if (bytes.length !== size) throw new Error('Linux clipboard transfer was incomplete.');
    if (response[4]) throw new Error(new TextDecoder().decode(bytes));
    if (![1, 2].includes(response[5])) throw new Error('Unsupported Linux clipboard format.');
    return { kind: response[5], bytes };
  };
  try {
    return await Promise.race([work(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Linux clipboard transfer timed out.')), timeoutMs); })]);
  } catch (error) {
    if (/connect|reset|refused/i.test(error.message)) throw new Error('Linux clipboard bridge is unavailable. Start X and check guest logs.');
    throw error;
  } finally { clearTimeout(timer); connection?.close(); }
}
export async function readHostClipboard(clipboard = navigator.clipboard) {
  if (!clipboard) throw new Error('This browser does not expose clipboard access. Use HTTPS or localhost.');
  if (clipboard.read) {
    const items = await clipboard.read();
    for (const item of items) if (item.types.includes('image/png')) {
      const blob = await item.getType('image/png');
      if (blob.size > CLIPBOARD_LIMIT) throw new Error('Clipboard image exceeds 16 MiB.');
      return { kind: 2, bytes: new Uint8Array(await blob.arrayBuffer()) };
    }
    for (const item of items) if (item.types.includes('text/plain')) {
      const blob = await item.getType('text/plain');
      if (blob.size > CLIPBOARD_LIMIT) throw new Error('Clipboard text exceeds 16 MiB.');
      return { kind: 1, bytes: new Uint8Array(await blob.arrayBuffer()) };
    }
    throw new Error('Host clipboard has no supported text or PNG image.');
  }
  if (!clipboard.readText) throw new Error('This browser cannot read the clipboard.');
  const bytes = new TextEncoder().encode(await clipboard.readText());
  if (bytes.length > CLIPBOARD_LIMIT) throw new Error('Clipboard text exceeds 16 MiB.');
  return { kind: 1, bytes };
}
export async function writeHostClipboard(item, clipboard = navigator.clipboard, Item = globalThis.ClipboardItem) {
  if (!clipboard) throw new Error('This browser does not expose clipboard access. Use HTTPS or localhost.');
  if (item.kind === 1 && clipboard.writeText) return clipboard.writeText(new TextDecoder().decode(item.bytes));
  if (item.kind === 2 && clipboard.write && Item) return clipboard.write([new Item({ 'image/png': new Blob([item.bytes], { type: 'image/png' }) })]);
  throw new Error(item.kind === 2 ? 'This browser cannot copy PNG images to the host clipboard.' : 'This browser cannot write clipboard text.');
}
export function clipboardPreviewText(text) {
  const characters = text.length <= 400 ? Array.from(text) : null;
  if (characters && characters.length <= 200) return text;
  return Array.from(text.slice(0, 201)).slice(0, 100).join('') + '\n…\n' + Array.from(text.slice(-201)).slice(-100).join('');
}
export function installClipboardButton({ button, notice, paste, copy }) {
  let busy = false, noticeTimer, imageUrl;
  const clearImage = () => { if (imageUrl) URL.revokeObjectURL(imageUrl); imageUrl = null; };
  const message = (value, failed = false) => {
    clearTimeout(noticeTimer); clearImage();
    const text = typeof value === 'string' ? value : value.message;
    notice.replaceChildren(document.createTextNode(text)); notice.hidden = false; notice.classList.toggle('clipboard-error', failed);
    if (failed) window.dispatchEvent(new Event('clipboard-notice-error'));
    if (value.item?.kind === 1) {
      const preview = document.createElement('pre'); preview.className = 'clipboard-text-preview';
      preview.textContent = clipboardPreviewText(new TextDecoder().decode(value.item.bytes)); notice.append(preview);
    } else if (value.item?.kind === 2) {
      const preview = document.createElement('img'); preview.className = 'clipboard-image-preview'; preview.alt = 'Copied Linux image';
      imageUrl = URL.createObjectURL(new Blob([value.item.bytes], { type: 'image/png' })); preview.src = imageUrl; notice.append(preview);
    }
    // Keep the popover below its control while fitting narrow windows.
    const anchor = button.getBoundingClientRect(), bounds = notice.getBoundingClientRect();
    notice.style.left = `${Math.max(8, Math.min(anchor.left, innerWidth - 8 - bounds.width))}px`;
    notice.style.top = `${anchor.bottom + 8}px`;
    noticeTimer = setTimeout(() => { notice.hidden = true; clearImage(); }, failed ? 8000 : copy ? 8000 : 4000);
  };
  button.addEventListener('click', async () => {
    if (busy) return;
    busy = true; button.setAttribute('aria-busy', 'true');
    try { message(await (copy || paste)()); }
    catch (error) { message(error.name === 'NotAllowedError' ? 'Clipboard permission denied. Allow clipboard access in your browser.' : error.message, true); }
    finally { busy = false; button.removeAttribute('aria-busy'); }
  });
  window.addEventListener('pagehide', clearImage);
  return { message };
}
