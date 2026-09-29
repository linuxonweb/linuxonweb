// Keep bounded text history without a renderer, observer or timer while closed.
export class LogHistory {
  constructor({ maxLines = 10000, maxChars = 2 * 1024 * 1024, maxLineLength = 8192 } = {}) {
    this.maxLines = maxLines;
    this.maxChars = maxChars;
    this.maxLineLength = maxLineLength;
    this.rows = [];
    this.head = 0;
    this.nextId = 0;
    this.chars = 0;
    this.sources = new Map();
  }
  get firstId() { return this.rows[this.head]?.id ?? this.nextId; }
  get length() { return this.rows.length - this.head; }
  write(value, source = 'guest') {
    let state = this.sources.get(source);
    if (!state) {
      state = { decoder: new TextDecoder(), row: null, escape: '', carriage: false };
      this.sources.set(source, state);
    }
    const text = typeof value === 'string' ? value : state.decoder.decode(value, { stream: true });
    for (const ch of text) {
      // Consume terminal formatting, including sequences split across chunks.
      if (state.escape) {
        if (state.escape === 'start') state.escape = ch === '[' ? 'csi' : ch === ']' ? 'osc' : '';
        else if (state.escape === 'csi' && ch >= '@' && ch <= '~') state.escape = '';
        else if (state.escape === 'osc') {
          if (ch === '\x07') state.escape = '';
          else if (ch === '\x1b') state.escape = 'osc-end';
        } else if (state.escape === 'osc-end') state.escape = ch === '\\' ? '' : 'osc';
        continue;
      }
      if (ch === '\x1b') { state.escape = 'start'; continue; }
      if (ch === '\r') { state.carriage = true; continue; }
      if (ch < ' ' && !['\n', '\t', '\b'].includes(ch)) continue;
      if (!state.row || state.row.id < this.firstId) {
        state.row = { id: this.nextId++, text: '' };
        this.rows.push(state.row);
      }
      if (ch === '\n') { state.row = null; state.carriage = false; continue; }
      if (state.carriage) {
        this.chars -= state.row.text.length;
        state.row.text = '';
        state.carriage = false;
      }
      if (ch === '\b') {
        const previous = state.row.text;
        state.row.text = [...previous].slice(0, -1).join('');
        this.chars -= previous.length - state.row.text.length;
      } else if (state.row.text.length < this.maxLineLength) {
        state.row.text += ch;
        this.chars += ch.length;
      }
    }
    while (this.length && (this.length > this.maxLines || this.chars > this.maxChars)) {
      this.chars -= this.rows[this.head++].text.length;
    }
    if (this.head > 1024) { this.rows = this.rows.slice(this.head); this.head = 0; }
  }
  page(end = this.nextId, count = 100) {
    end = Math.min(this.nextId, Math.max(this.firstId, end));
    const start = Math.max(this.firstId, end - count);
    return this.rows.slice(this.head + start - this.firstId, this.head + end - this.firstId);
  }
  clear() {
    this.rows = []; this.head = 0; this.nextId = 0; this.chars = 0;
    this.sources.clear();
  }
}

export function createLogViewer({ toggle, parent }) {
  const history = new LogHistory();
  let panel = null, viewport = null, list = null, summary = null, latest = null;
  let timer = null, end = 0, following = true, adjusting = false;
  const rowHeight = 18;

  function render(position = 'keep') {
    if (!panel) return;
    const oldTop = viewport.scrollTop;
    if (following) end = history.nextId;
    end = Math.min(history.nextId, Math.max(Math.min(history.firstId + 100, history.nextId), end));
    const rows = history.page(end);
    const fragment = document.createDocumentFragment();
    for (const row of rows) {
      const line = document.createElement('div');
      line.className = 'log-line';
      line.dataset.line = String(row.id);
      line.textContent = row.text || '\u00a0';
      fragment.append(line);
    }
    list.replaceChildren(fragment);
    summary.textContent = rows.length
      ? `Lines ${rows[0].id + 1}–${end} · ${history.length.toLocaleString()} retained · scroll up for older logs`
      : 'Waiting for logs';
    latest.disabled = following;
    adjusting = true;
    viewport.scrollTop = position === 'bottom' ? viewport.scrollHeight : typeof position === 'number' ? position : oldTop;
    queueMicrotask(() => { adjusting = false; });
  }
  function close() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    panel?.remove();
    panel = viewport = list = summary = latest = null;
    (toggle.querySelector('.label') ?? toggle).textContent = 'Show logs';
    toggle.setAttribute('aria-expanded', 'false');
  }
  function open() {
    if (panel) return;
    panel = document.createElement('section');
    panel.id = 'guest-logs';
    panel.className = 'terminal-card';
    panel.setAttribute('aria-label', 'Guest logs');
    const header = document.createElement('div');
    header.className = 'terminal-head';
    summary = document.createElement('span');
    latest = document.createElement('button');
    latest.type = 'button';
    latest.className = 'log-latest';
    latest.textContent = 'Latest';
    latest.addEventListener('click', () => { following = true; render('bottom'); });
    header.append(summary, latest);
    viewport = document.createElement('div');
    viewport.className = 'log-viewport';
    viewport.tabIndex = 0;
    viewport.setAttribute('aria-label', 'Logs: scroll up to load earlier lines');
    list = document.createElement('div');
    viewport.append(list);
    viewport.addEventListener('scroll', () => {
      if (adjusting) return;
      const bottom = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= 2;
      following = bottom && end === history.nextId;
      const start = Math.max(history.firstId, end - 100);
      if (viewport.scrollTop <= 2 && start > history.firstId) {
        const amount = Math.min(50, start - history.firstId);
        end -= amount;
        following = false;
        render(viewport.scrollTop + amount * rowHeight);
      } else if (bottom && end < history.nextId) {
        const amount = Math.min(50, history.nextId - end);
        end += amount;
        render(Math.max(0, viewport.scrollTop - amount * rowHeight));
      } else latest.disabled = following;
    }, { passive: true });
    panel.append(header, viewport);
    parent.append(panel);
    following = true;
    render('bottom');
    (toggle.querySelector('.label') ?? toggle).textContent = 'Hide logs';
    toggle.setAttribute('aria-expanded', 'true');
  }
  toggle.addEventListener('click', () => panel ? close() : open());
  return {
    history, open, close,
    write(value, source) {
      history.write(value, source);
      if (panel && timer === null) timer = setTimeout(() => {
        timer = null;
        render(following ? 'bottom' : 'keep');
      }, 100);
    },
    clear() { history.clear(); following = true; render('bottom'); },
  };
}
