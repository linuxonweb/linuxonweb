// Fixed test commands for the desktop guest. A click sends only the command id
// over hvc0; the guest agent maps it to the same fixed command and opens an
// Aurora terminal (aurora-files --terminal) that runs it, then stays open.
// Every binary below is present in the plain and Firefox desktop images
// (vkgears, glgears, vkmark and glmark2 come from desktop-extras.cpio).
import { createMoreMenu } from './more-menu.mjs';

const glgears = '-info -seconds 30 -readrgba';
export const TEST_COMMANDS = Object.freeze([
  { id: 'vkgears', group: 'Vulkan', label: 'Vulkan gears (guest ICD)', command: 'vkgears -info -seconds 30', gpu: true },
  { id: 'vkmark', group: 'Vulkan', label: 'vkmark benchmark', command: 'vkmark -s 500x500', gpu: true },
  { id: 'glgears-zink', group: 'OpenGL', label: 'GL gears · Zink on Vulkan', command: `MESA_LOADER_DRIVER_OVERRIDE=zink LIBGL_ALWAYS_SOFTWARE=1 GALLIUM_THREAD=0 glgears ${glgears}`, gpu: true },
  { id: 'glgears-softpipe', group: 'OpenGL', label: 'GL gears · softpipe (CPU)', command: `LIBGL_ALWAYS_SOFTWARE=1 GALLIUM_DRIVER=softpipe glgears ${glgears}` },
  { id: 'glmark2', group: 'OpenGL', label: 'glmark2 benchmark · Zink', command: 'glmark2 -s 500x500 --swap-mode immediate', gpu: true },
  { id: 'uname', group: 'System', label: 'Kernel', command: 'uname -a' },
  { id: 'nproc', group: 'System', label: 'CPU count', command: 'nproc' },
  { id: 'free', group: 'System', label: 'Memory', command: 'free -m' },
  { id: 'df', group: 'System', label: 'Disk usage', command: 'df -h' },
  { id: 'ip-addr', group: 'Network', label: 'Addresses', command: 'ip addr' },
  { id: 'curl', group: 'Network', label: 'HTTPS request', command: 'curl -sSI --max-time 25 https://www.google.com/' },
].map(Object.freeze));

const ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
for (const { id, command } of TEST_COMMANDS)
  if (!ID.test(id) || !command || /[\0\r\n]/.test(command)) throw new Error(`Invalid test command ${id}`);

export const RUN_PREFIX = 'linuxonweb-run';
/** POSIX single-quoted word: nothing inside is expanded by the guest shell. */
export function shellQuote(text) { return `'${String(text).replaceAll("'", `'\\''`)}'`; }
export function findTestCommand(id) { return TEST_COMMANDS.find(entry => entry.id === id) ?? null; }
/** The only bytes the host writes to hvc0 for a test: a known id, never command text. */
export function testCommandRequest(id) {
  if (!findTestCommand(id)) throw new Error(`Unknown test command: ${id}`);
  return new TextEncoder().encode(`${RUN_PREFIX} ${id}\n`);
}

// Desktop boots only (not console, wgpu or gputest-only boots). hvc0 is unread
// in desktop mode; the agent turns its echo off and accepts known ids only.
export function guestRunAgent(commands = TEST_COMMANDS) {
  const table = commands.map(({ id, command }) => `    ${id}) cmd=${shellQuote(command)} ;;`).join('\n');
  return `#!/bin/busybox sh
# Host test-command agent (installed by the page, see web/linux/test-commands.mjs).
nap() { sleep 0.1 2>/dev/null || sleep 1; }
i=0
while [ ! -r /proc/cmdline ] || [ ! -c /dev/hvc0 ]; do
  i=$((i + 1)); [ "$i" -lt 600 ] || exit 0; nap
done
case " $(cat /proc/cmdline) " in
  *" demo.mode=startx "*|*" demo.mode=guest "*|*" demo.mode=firefox "*) ;;
  *) exit 0 ;;
esac
# Do not consume recovery-shell input when package restore blocked X startup.
# Desktop command requests remain buffered until the native display is ready.
i=0
while [ ! -e /tmp/.X11-unix/X0 ]; do
  i=$((i + 1)); [ "$i" -lt 600 ] || exit 0; nap
done
exec 3</dev/hvc0 || exit 0
stty -echo <&3 2>/dev/null
n=0
while read -r word id rest <&3; do
  [ "$word" = ${RUN_PREFIX} ] || continue
  cmd=
  case "$id" in
${table}
  esac
  if [ -z "$cmd" ]; then echo "${RUN_PREFIX}: unknown test '$id'" >&2; continue; fi
  i=0
  while [ ! -e /tmp/.X11-unix/X0 ] && [ "$i" -lt 600 ]; do i=$((i + 1)); nap; done
  if [ ! -e /tmp/.X11-unix/X0 ] || [ ! -x /bin/aurora-files ]; then echo "${RUN_PREFIX}: desktop terminal unavailable for $id" >&2; continue; fi
  mkdir -p /tmp/.linuxonweb-run && chown 1000:1000 /tmp/.linuxonweb-run && chmod 0700 /tmp/.linuxonweb-run || continue
  n=$((n + 1)); ticket=/tmp/.linuxonweb-run/$n
  printf '%s\\n' "$cmd" > "$ticket" && chown 1000:1000 "$ticket" || continue
  echo "${RUN_PREFIX}: opening Aurora terminal for $id" >&2
  /bin/su -s /bin/sh -c "export HOME=/home/admin USER=admin LOGNAME=admin DISPLAY=:0 SHELL=/bin/linuxonweb-run-shell LINUXONWEB_RUN_TICKET=$ticket; exec /bin/aurora-files --terminal /home/admin" admin </dev/null >/dev/null 2>&1 &
done
`;
}

// aurora-files spawns $SHELL for every terminal tab. Only the first tab of a
// requested window finds its one-shot ticket; later tabs get a plain shell.
export function guestRunShell() {
  return `#!/bin/busybox sh
ticket=$LINUXONWEB_RUN_TICKET
unset LINUXONWEB_RUN_TICKET
export SHELL=/bin/sh
if [ -n "$ticket" ] && [ -f "$ticket" ]; then
  cmd=$(cat "$ticket"); rm -f "$ticket"
  if [ -n "$cmd" ]; then
    printf '$ %s\\n' "$cmd"
    /bin/sh -c "$cmd"
    printf '[exit status %s]\\n' "$?"
  fi
fi
exec /bin/sh
`;
}

export function installTestCommands({ toggle, menu, notice, run }) {
  let group = null, timer;
  for (const entry of TEST_COMMANDS) {
    if (entry.group !== group) {
      group = entry.group;
      const title = document.createElement('p');
      title.className = 'more-title'; title.setAttribute('role', 'presentation'); title.textContent = group;
      menu.append(title);
    }
    const item = document.createElement('button');
    item.type = 'button'; item.className = 'action test-command'; item.tabIndex = -1;
    item.setAttribute('role', 'menuitem'); item.dataset.action = 'test'; item.dataset.test = entry.id;
    const label = document.createElement('span'), code = document.createElement('code');
    label.textContent = entry.label; code.textContent = entry.command;
    item.append(label, code);
    menu.append(item);
  }
  const message = (text, failed = false) => {
    clearTimeout(timer);
    notice.textContent = text; notice.hidden = false; notice.classList.toggle('clipboard-error', failed);
    const anchor = toggle.getBoundingClientRect(), bounds = notice.getBoundingClientRect();
    notice.style.left = `${Math.max(8, Math.min(anchor.left, innerWidth - 8 - bounds.width))}px`;
    notice.style.top = `${anchor.bottom + 8}px`;
    timer = setTimeout(() => { notice.hidden = true; }, failed ? 8000 : 5000);
  };
  return createMoreMenu({ toggle, menu, action: async item => {
    const entry = findTestCommand(item.dataset.test);
    try { message(await run(entry)); } catch (error) { message(error.message, true); }
  } });
}
