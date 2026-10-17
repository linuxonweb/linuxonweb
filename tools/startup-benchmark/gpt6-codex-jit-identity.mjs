import { jitRuntimePlan } from './gpt6-codex-overlays.mjs';

function validNonce(nonce) {
  if (typeof nonce !== 'string' || !/^[a-f0-9]{32}$/.test(nonce)) throw Error('Invalid probe nonce');
}

export function hostJitIdentityPlan(config, nonce) {
  if (config.jitIdentity === undefined || config.jitIdentity === false) return null;
  if (config.jitIdentity !== true || config.candidate !== true ||
      !['off', 'ic', 'method'].includes(config.jitArm) || config.trace || config.timing) {
    throw Error('Native identity requires an isolated candidate JIT diagnostic');
  }
  jitRuntimePlan(config);
  validNonce(nonce);
  return {
    nonce,
    expectedEnvironment: {
      PBLIC: config.jitArm === 'off' ? '0' : '1',
      PBLBC: config.jitArm === 'method' ? '1' : '0',
      PBLJIT: config.jitArm === 'off' ? '0' : '1',
    },
    diagnosticOnly: true,
    jitAcceptance: false,
  };
}

export function jitEnvironmentFilter(nonce) {
  if (nonce !== undefined) validNonce(nonce);
  const diagnostic = nonce === undefined ? '' : `printf "PBLJIT_ENV_FILTER_V1 {\\"nonce\\":\\"${nonce}\\",\\"bytes\\":%d,\\"records\\":%d,\\"invalid\\":%d,\\"PBLIC\\":%d,\\"PBLBC\\":%d,\\"PBLJIT\\":%d}\\n", bytes, NR, invalid, seen["PBLIC"], seen["PBLBC"], seen["PBLJIT"] > "/dev/stderr"; `;
  return `BEGIN { RS="\\0" }
{ bytes += length($0) + 1
  separator = index($0, "=")
  name = substr($0, 1, separator - 1)
  if (name == "PBLIC" || name == "PBLBC" || name == "PBLJIT") {
    value = substr($0, separator + 1)
    if (++seen[name] != 1 || value !~ /^[01]$/) invalid = 1
    values[name] = value
  }
}
END {
  if (invalid || bytes >= 65537 || seen["PBLIC"] != 1 || seen["PBLBC"] != 1 || seen["PBLJIT"] != 1) { ${diagnostic}exit 1 }
  printf "{\\"PBLIC\\":\\"%s\\",\\"PBLBC\\":\\"%s\\",\\"PBLJIT\\":\\"%s\\"}", values["PBLIC"], values["PBLBC"], values["PBLJIT"]
}`;
}

export function jitByteFilter(kind, nonce) {
  if (kind !== 'environment' && kind !== 'role') throw Error('Invalid byte filter kind');
  validNonce(nonce);
  const environment = kind === 'environment';
  const consume = environment ? `separator = index(entry, "=")
        name = substr(entry, 1, separator - 1)
        if (name == "PBLIC" || name == "PBLBC" || name == "PBLJIT") {
          value = substr(entry, separator + 1)
          if (++seen[name] != 1 || value !~ /^[01]$/) invalid = 1
          values[name] = value
        }` : `if (records == 1 && entry != "/opt/firefox/firefox") invalid = 1
        if (entry == "-contentproc" || entry == "--contentproc") invalid = 1`;
  const finish = environment ? `if (invalid || bytes >= 65537 || seen["PBLIC"] != 1 || seen["PBLBC"] != 1 || seen["PBLJIT"] != 1) {
    printf "PBLJIT_ENV_FILTER_V1 {\\"nonce\\":\\"${nonce}\\",\\"bytes\\":%d,\\"records\\":%d,\\"invalid\\":%d,\\"PBLIC\\":%d,\\"PBLBC\\":%d,\\"PBLJIT\\":%d}\\n", bytes, records, invalid, seen["PBLIC"], seen["PBLBC"], seen["PBLJIT"] > "/dev/stderr"
    exit 1
  }
  printf "{\\"PBLIC\\":\\"%s\\",\\"PBLBC\\":\\"%s\\",\\"PBLJIT\\":\\"%s\\"}", values["PBLIC"], values["PBLBC"], values["PBLJIT"]` : `if (invalid || bytes == 0 || bytes >= 8193) exit 1
  print "parent"`;
  return `{
  for (byteIndex = 1; byteIndex <= NF; byteIndex++) {
    if ($byteIndex !~ /^[0-9]+$/ || $byteIndex + 0 > 255) { invalid = 1; continue }
    bytes++
    if ($byteIndex + 0 == 0) {
      records++
      ${consume}
      entry = ""
      pending = 0
    } else {
      pending = 1
      if (length(entry) < 128) entry = entry sprintf("%c", $byteIndex + 0)
    }
  }
}
END {
  if (pending) invalid = 1
  ${finish}
}`;
}

export function jitIdentityScript(nonce) {
  validNonce(nonce);
  return `#!/bin/busybox sh
export LC_ALL=C
probe_control() {
  printf 'PBLIC=0\\000PBLBC=0\\000PBLJIT=0\\000'
}
probe_readers() {
  expected_control='{"PBLIC":"0","PBLBC":"0","PBLJIT":"0"}'
  nul_reader=false
  if control=$(probe_control | /bin/busybox awk '${jitEnvironmentFilter(nonce)}' 2>/dev/null) && [ "$control" = "$expected_control" ]; then
    nul_reader=true
  fi
  if control=$(probe_control | /bin/busybox od -An -v -t u1 | /bin/busybox awk '${jitByteFilter('environment', nonce)}') && [ "$control" = "$expected_control" ]; then
    printf 'PBLJIT_ENV_READER_V1 {"nonce":"${nonce}","nulSupported":%s,"decimalSupported":true}\\n' "$nul_reader"
  else
    printf '%s\\n' 'PBLJIT_ENV_V1 {"nonce":"${nonce}","error":"filter-control-failed"}'
    return 1
  fi
}
proc_start() {
  IFS= read -r stat_line < "$1/stat" || return 1
  stat_tail=\${stat_line##*) }
  set -- $stat_tail
  [ "$#" -ge 20 ] || return 1
  shift 19
  case "$1" in ''|*[!0-9]*) return 1;; esac
  printf '%s' "$1"
}
readers_verified=false
attempt=0
while [ "$attempt" -lt 120 ]; do
  for directory in /proc/[0-9]*; do
    IFS= read -r process_name < "$directory/comm" 2>/dev/null || continue
    case "$process_name" in firefox|firefox-bin|firefox-nightly) ;; *) continue;; esac
    pid=\${directory##*/}
    start=$(proc_start "$directory") || continue
    exe=$(/bin/busybox readlink "$directory/exe" 2>/dev/null) || continue
    [ "$exe" = /opt/firefox/firefox ] || continue
    if [ "$readers_verified" = false ]; then
      probe_readers || exit 1
      readers_verified=true
    fi
    role=$(/bin/busybox head -c 8193 "$directory/cmdline" 2>/dev/null | /bin/busybox od -An -v -t u1 | /bin/busybox awk '${jitByteFilter('role', nonce)}') || continue
    [ "$role" = parent ] || continue
    exe_inode=$(/bin/busybox stat -L -c '%d:%i' "$directory/exe" 2>/dev/null) || continue
    image_inode=$(/bin/busybox stat -L -c '%d:%i' /opt/firefox/firefox 2>/dev/null) || continue
    environment=$(/bin/busybox head -c 65537 "$directory/environ" 2>/dev/null | /bin/busybox od -An -v -t u1 | /bin/busybox awk '${jitByteFilter('environment', nonce)}') || {
      printf '%s\\n' 'PBLJIT_ENV_V1 {"nonce":"${nonce}","error":"environment-unreadable-or-invalid"}'
      exit 1
    }
    end_start=$(proc_start "$directory") || continue
    exe_after=$(/bin/busybox readlink "$directory/exe" 2>/dev/null) || continue
    end_inode=$(/bin/busybox stat -L -c '%d:%i' "$directory/exe" 2>/dev/null) || continue
    [ "$start" = "$end_start" ] && [ "$exe" = "$exe_after" ] && [ "$exe_inode" = "$end_inode" ] && [ "$exe_inode" = "$image_inode" ] || continue
    case "$exe_inode" in ''|*[!0-9:]*) continue;; esac
    printf 'PBLJIT_ENV_V1 {"nonce":"${nonce}","pid":%s,"startTicks":"%s","endStartTicks":"%s","exe":"/opt/firefox/firefox","exeAfter":"/opt/firefox/firefox","exeInode":"%s","endExeInode":"%s","imageInode":"%s","role":"parent","env":%s}\\n' "$pid" "$start" "$end_start" "$exe_inode" "$end_inode" "$image_inode" "$environment"
    exit 0
  done
  attempt=$((attempt + 1))
  /bin/busybox sleep 0.5
done
printf '%s\\n' 'PBLJIT_ENV_V1 {"nonce":"${nonce}","error":"timeout"}'
exit 1
`;
}

export function instrumentJitIdentitySource(source, nonce) {
  validNonce(nonce);
  const launch = 'export DISPLAY=:0\\n/bin/clipboard-bridge';
  const entries = "const entries = [cpioEntry('init.desktop-original', original), cpioEntry('init', wrapper),";
  if (source.includes('jit-control-probe') || source.split(launch).length !== 2 || source.split(entries).length !== 2) {
    throw Error('Expected unique uninstrumented init anchors');
  }
  return source.replace(launch, 'export DISPLAY=:0\\n/bin/jit-control-probe &\\n/bin/clipboard-bridge')
    .replace(entries, `${entries}\n    cpioEntry('bin/jit-control-probe', encoder.encode(${JSON.stringify(jitIdentityScript(nonce))})),`);
}

export function jitIdentityObservation(logs, nonce, expectedEnvironment = { PBLIC: '0', PBLBC: '0', PBLJIT: '0' }) {
  validNonce(nonce);
  if (!expectedEnvironment || Object.keys(expectedEnvironment).sort().join(',') !== 'PBLBC,PBLIC,PBLJIT' ||
      Object.values(expectedEnvironment).some(value => value !== '0' && value !== '1')) {
    throw Error('Invalid expected JIT environment');
  }
  const result = { state: 'pending', nativeEnvironmentVerified: false, jitAcceptance: false };
  const lines = logs.split('\n').filter(line => line.startsWith('PBLJIT_ENV_V1 '));
  if (!lines.length) return result;
  const error = { ...result, state: 'error' };
  if (lines.length !== 1 || lines[0].length > 4096) return error;
  let identity;
  try { identity = JSON.parse(lines[0].slice('PBLJIT_ENV_V1 '.length)); } catch { return error; }
  if (!identity || identity.nonce !== nonce || !Number.isSafeInteger(identity.pid) || identity.pid <= 0 ||
      typeof identity.startTicks !== 'string' || !/^[0-9]+$/.test(identity.startTicks) || identity.endStartTicks !== identity.startTicks ||
      identity.exe !== '/opt/firefox/firefox' || identity.exeAfter !== identity.exe || identity.role !== 'parent' ||
      typeof identity.exeInode !== 'string' || !/^[0-9]+:[0-9]+$/.test(identity.exeInode) ||
      identity.imageInode !== identity.exeInode || identity.endExeInode !== identity.exeInode ||
      !identity.env || Object.keys(identity.env).sort().join(',') !== 'PBLBC,PBLIC,PBLJIT' ||
      Object.entries(identity.env).some(([name, value]) => value !== expectedEnvironment[name])) return error;
  return { ...result, state: 'verified', nativeEnvironmentVerified: true, identity };
}
