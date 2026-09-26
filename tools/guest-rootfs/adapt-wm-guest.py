#!/usr/bin/env python3
"""Reuse Aurora Files' tested NOMMU PTY path in a scratch WM build only."""
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text()
term = (path.parent / 'bin/aurora-files/term.rs').read_text()
start = term.index('#[cfg(target_arch = "wasm32")]\npub fn spawn_pty(')
end = term.index('\nimpl Tab {', start)
spawn = term[start:end].replace('pub fn spawn_pty(', 'fn spawn_guest_pty(')
start = text.index('pub(crate) fn spawn_terminal_pty(')
end = text.index('\npub(crate) fn shell_quote(', start)
wrapper = '''pub(crate) fn spawn_terminal_pty(cwd: &Path, cols: usize, rows: usize) -> AnyResult<(RawFd, libc::pid_t)> {
    spawn_guest_pty(cwd, cols, rows).ok_or_else(|| io::Error::other("could not spawn guest PTY").into())
}
'''
path.write_text(text[:start] + spawn + wrapper + text[end:])
