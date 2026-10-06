import test from 'node:test';
import assert from 'node:assert/strict';
import { TEST_COMMANDS, RUN_PREFIX, shellQuote, findTestCommand, testCommandRequest, guestRunAgent, guestRunShell } from './test-commands.mjs';
import { cpioEntry, desktopInitOverlay } from './desktop-extras.mjs';

const text = bytes => new TextDecoder().decode(bytes);

test('test commands have unique safe ids and single-line commands', () => {
  const ids = TEST_COMMANDS.map(entry => entry.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const entry of TEST_COMMANDS) {
    assert.match(entry.id, /^[a-z0-9][a-z0-9-]{0,31}$/);
    assert.doesNotMatch(entry.command, /[\0\r\n]/);
    assert.ok(entry.label && entry.group);
  }
  assert.deepEqual([...new Set(TEST_COMMANDS.map(entry => entry.group))], ['Vulkan', 'OpenGL', 'System', 'Network']);
  assert.ok(Object.isFrozen(TEST_COMMANDS) && Object.isFrozen(TEST_COMMANDS[0]));
});

test('shellQuote keeps every byte literal', () => {
  assert.equal(shellQuote('a b'), "'a b'");
  assert.equal(shellQuote("it's $HOME `x`"), "'it'\\''s $HOME `x`'");
});

test('host request carries only a known id', () => {
  assert.equal(text(testCommandRequest('vkgears')), `${RUN_PREFIX} vkgears\n`);
  assert.equal(findTestCommand('nope'), null);
  assert.throws(() => testCommandRequest('nope'), /Unknown test command/);
  assert.throws(() => testCommandRequest('uname; reboot'), /Unknown test command/);
});

test('guest agent maps every id to its quoted command on desktop boots only', () => {
  const agent = guestRunAgent();
  assert.ok(agent.startsWith('#!/bin/busybox sh\n'));
  for (const { id, command } of TEST_COMMANDS) assert.ok(agent.includes(`    ${id}) cmd=${shellQuote(command)} ;;`), id);
  assert.match(agent, /demo\.mode=startx .*demo\.mode=guest .*demo\.mode=firefox /);
  assert.match(agent, /\*\) exit 0 ;;/);
  assert.match(agent, /exec 3<\/dev\/hvc0/);
  assert.match(agent, /SHELL=\/bin\/linuxonweb-run-shell LINUXONWEB_RUN_TICKET=\$ticket; exec \/bin\/aurora-files --terminal \/home\/admin" admin/);
});

test('run shell consumes its one-shot ticket then stays interactive', () => {
  const shell = guestRunShell();
  assert.match(shell, /unset LINUXONWEB_RUN_TICKET/);
  assert.match(shell, /rm -f "\$ticket"/);
  assert.match(shell, /\[exit status %s\]/);
  assert.ok(shell.trimEnd().endsWith('exec /bin/sh'));
});

test('desktop init overlay installs and starts the agent', () => {
  const init = cpioEntry('init', new TextEncoder().encode('#!/bin/busybox sh\necho original\n'));
  const trailer = cpioEntry('TRAILER!!!', new Uint8Array(), 0);
  const archive = new Uint8Array(init.length + trailer.length);
  archive.set(init); archive.set(trailer, init.length);
  const overlay = text(desktopInitOverlay(archive));
  assert.ok(overlay.includes('bin/linuxonweb-run-agent\0'));
  assert.ok(overlay.includes('bin/linuxonweb-run-shell\0'));
  assert.ok(overlay.includes(guestRunAgent()) && overlay.includes(guestRunShell()));
  assert.match(overlay, /\/bin\/busybox sh \/bin\/linuxonweb-run-agent &\nexec \/init\.desktop-original "\$@"/);
  assert.ok(overlay.indexOf('linuxonweb-run-shell\0') < overlay.indexOf('TRAILER!!!'));
});
