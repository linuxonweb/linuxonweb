/* IOUtils is parent-process-only in this exact Nightly. Content invokes only
 * these finite operations on files owned by its exact fixture URI. */
Components.utils.importGlobalProperties(['IOUtils']);
export class NightlyJitSafetyParent extends JSWindowActorParent {
  async receiveMessage(message) {
    if (message.name !== 'NightlyJitSafety:IO') throw Error('unknown owned actor message');
    const { label, method, path, value } = message.data;
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(label)) throw Error('owned fixture label required');
    const base = '/home/admin/nightly-jit-safety/' + label + '/';
    if (this.manager.documentURI.spec !== 'file://' + base + label + '.html') throw Error('actor document differs');
    if ((method === 'read' || method === 'exists') && path === base + 'observer.stderr') {
      if (method === 'exists') return IOUtils.exists(path);
      const bytes = await IOUtils.read(path, { maxBytes:2097153 });
      if (bytes.length > 2097152) throw Error('observer stderr exceeds 2MiB');
      return bytes;
    }
    const name = path.startsWith(base) ? path.slice(base.length) : '';
    const match = /^(gc-debug-coverage|incremental|slice-gc|interrupt)-(console\.txt|result\.json)$/.exec(name);
    if (!match) throw Error('unowned IO path');
    if (method === 'writeUTF8' && match[2] === 'console.txt' && typeof value === 'string' && value.length <= 131072) return IOUtils.writeUTF8(path, value);
    if (method === 'writeJSON' && match[2] === 'result.json' && value?.kind === 'actual-firefox-jit-gate-operation' && value.label === label && value.scope === match[1] && JSON.stringify(value).length <= 131072) return IOUtils.writeJSON(path, value);
    throw Error('unowned IO operation');
  }
}
