// Actual process acquisition only. Raw unrelated environment values never leave
// this function; lengths and hashes cover the complete bounded NUL buffers.
export const DIAGNOSTIC_ENV_KEYS = ['PBLJIT', 'PBLJIT_LOG', 'PBLJIT_OBSERVE'];
export const PROC_LIMIT = 65536;
export function currentEnvironment(Services) {
  return Object.fromEntries(DIAGNOSTIC_ENV_KEYS.map(key => {
    const exists = Services.env.exists(key), value = exists ? Services.env.get(key) : null;
    if (typeof exists !== 'boolean' || (exists && typeof value !== 'string')) throw Error('actual current environment unavailable');
    return [key, { exists, value }];
  }));
}
function nulEntries(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length > PROC_LIMIT || !bytes.length || bytes.at(-1) !== 0) throw Error('complete bounded proc NUL bytes required');
  return new TextDecoder('utf-8', { fatal:true }).decode(bytes.subarray(0,-1)).split('\0');
}
export function projectProcessBytes(cmdline, environ, current, hash) {
  const argv = nulEntries(cmdline), entries = nulEntries(environ);
  if (!argv[0]) throw Error('actual process executable required');
  const startup = Object.fromEntries(DIAGNOSTIC_ENV_KEYS.map(key => {
    const selected = entries.filter(entry => entry.startsWith(key+'='));
    if (selected.length > 1) throw Error('duplicate diagnostic environment key');
    return [key, { exists:selected.length === 1, value:selected.length ? selected[0].slice(key.length+1) : null }];
  }));
  if (DIAGNOSTIC_ENV_KEYS.some(key => JSON.stringify(startup[key]) !== JSON.stringify(current?.[key]))) throw Error('startup/current diagnostic environment mismatch');
  const diagnosticArguments = argv.filter(arg => /^--?(?:debugger|debug|jsdebugger|wait-for-jsdebugger|start-debugger-server)(?:=|$)|^-g$/.test(arg));
  const off = startup.PBLJIT_LOG.exists && startup.PBLJIT_LOG.value === '0' && startup.PBLJIT_OBSERVE.value !== '1' &&
    (!startup.PBLJIT.exists || startup.PBLJIT.value === '1') && diagnosticArguments.length === 0;
  return { kind:'actual-firefox-primary-diagnostics-v1', startup, current, commandLine:{ bytes:cmdline.length, sha256:hash(cmdline), argc:argv.length, diagnosticArguments },
    environment:{ bytes:environ.length, sha256:hash(environ) }, boundedComplete:true, primaryDiagnosticsOff:off };
}
export async function acquireProcessDiagnostics(pid, current, IOUtils, hash) {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw Error('actual verified process PID required');
  const base = '/proc/'+pid;
  const [cmdline,environ] = await Promise.all([IOUtils.read(base+'/cmdline',{maxBytes:PROC_LIMIT+1}),IOUtils.read(base+'/environ',{maxBytes:PROC_LIMIT+1})]);
  return { ...projectProcessBytes(cmdline,environ,current,hash), processID:pid };
}
