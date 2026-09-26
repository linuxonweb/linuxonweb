const size = bytes => bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;

export function createStoragePanel(actions) {
  const panel = document.createElement('section');
  panel.className = 'storage-panel'; panel.setAttribute('aria-label', 'Browser storage');
  panel.innerHTML = `
    <div class="storage-heading"><h2>Browser storage</h2><span id="storage-protection">Checking storage…</span></div>
    <p class="storage-description">Your Linux home, Firefox profile and downloads stay in this browser. System images are cached separately.</p>
    <dl class="storage-usage"><div><dt>Home file allocation</dt><dd id="storage-home">—</dd></div><div><dt>Cached system images</dt><dd id="storage-system">—</dd></div><div><dt>Browser usage / quota estimate</dt><dd id="storage-quota">—</dd></div></dl>
    <p id="storage-version" class="storage-description"></p>
    <p id="storage-cache-warning" class="storage-error" role="status" hidden></p>
    <div class="storage-actions">
      <button class="action" data-storage="refresh">Refresh usage</button>
      <button class="action" data-storage="persist">Keep storage</button>
      <button class="action" data-storage="update">Update &amp; restart</button>
      <button class="action" data-storage="reload" hidden>Restart with update</button>
      <button class="action" data-storage="rollback" hidden>Previous system</button>
      <button class="action" data-storage="cache">Delete cached images</button>
      <button class="action danger" data-storage="delete">Delete home…</button>
    </div>
    <p id="storage-message" role="status" aria-live="polite">Saved files persist after refresh. Save work before Update &amp; restart; browser data clearing removes this home.</p>
    <dialog class="restart-dialog" aria-labelledby="delete-home-title"><h2 id="delete-home-title" class="settings-heading">Delete your Linux home?</h2><p>This stops the guest and permanently deletes all home files, downloads, Firefox history, saved settings and extensions in this browser. Cached system images are kept.</p><p class="restart-warning">This cannot be undone.</p><div class="settings-actions"><button class="action" data-storage="cancel-delete" autofocus>Cancel</button><button class="action danger" data-storage="confirm-delete">Delete home</button></div></dialog>`;
  actions.parent.append(panel);
  const message = panel.querySelector('#storage-message'), dialog = panel.querySelector('dialog');
  const button = name => panel.querySelector(`[data-storage="${name}"]`);
  let busy = false;
  const api = {
    message(text, error = false) { message.textContent = text; message.classList.toggle('storage-error', error); },
    cacheWarning(text) { const warning = panel.querySelector('#storage-cache-warning'); warning.textContent = text; warning.hidden = false; },
    async refresh() {
      const data = await actions.usage();
      panel.querySelector('#storage-home').textContent = `${size(data.home.bytes)} · ${Math.max(0, data.home.files - 1)} entries`;
      panel.querySelector('#storage-system').textContent = size(data.system.bytes);
      panel.querySelector('#storage-quota').textContent = data.estimate ? `${size(data.estimate.usage || 0)} / ${size(data.estimate.quota || 0)}` : 'Unavailable';
      panel.querySelector('#storage-protection').textContent = data.persistent ? 'Protected from automatic eviction' : 'Best effort · may be evicted';
      panel.querySelector('#storage-version').textContent = `System ${data.system.version} · Home allocation excludes metadata; browser usage includes all site storage.`;
      button('rollback').hidden = !data.system.previous;
      button('persist').hidden = Boolean(data.persistent);
    },
  };
  async function run(work) {
    if (busy) return;
    busy = true;
    for (const control of panel.querySelectorAll('button')) control.disabled = true;
    try { await work(); } catch (error) { api.message(error.message || String(error), true); }
    finally { busy = false; for (const control of panel.querySelectorAll('button')) control.disabled = false; }
  }
  button('refresh').onclick = () => run(() => api.refresh());
  button('persist').onclick = () => run(async () => {
    const kept = await actions.persist();
    api.message(kept ? 'Browser storage protection enabled. You can still delete it at any time.' : 'The browser did not grant storage protection. Files still persist, but may be evicted under storage pressure.');
    await api.refresh();
  });
  button('cache').onclick = () => run(async () => { await actions.clearCache(); api.message('Cached images deleted. Your home is unchanged. The next boot downloads system images again.'); await api.refresh(); });
  button('update').onclick = () => run(async () => {
    await actions.update(text => api.message(text));
    api.message('System images verified. Restarting with your home preserved…');
    await actions.restart();
  });
  button('reload').onclick = () => run(() => actions.restart());
  button('rollback').onclick = () => run(async () => {
    await actions.rollback(); button('reload').hidden = false;
    api.message('Previous system is ready. Save your work, then restart. Your home is preserved.');
  });
  button('delete').onclick = () => dialog.showModal();
  button('cancel-delete').onclick = () => dialog.close();
  button('confirm-delete').onclick = () => { dialog.close(); void run(() => actions.deleteHome()); };
  // Avoid racing automatic boot for the exclusive home lease.
  setTimeout(() => { if (!busy) void run(() => api.refresh()); }, 3000);
  return api;
}
