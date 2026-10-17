function validPid(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1 || pid > 2147483647) throw Error('Invalid PID');
}

export function androidSnapshotScript(pid) {
  validPid(pid);
  return String.raw`export LC_ALL=C
proc_start() {
  IFS= read -r stat_line < /proc/${pid}/stat || return 1
  stat_tail=${'$'}{stat_line##*) }
  set -- $stat_tail
  [ "$#" -ge 20 ] || return 1
  shift 19
  case "$1" in ''|*[!0-9]*) return 1;; esac
  printf '%s' "$1"
}
start=$(proc_start) || exit 1
printf 'PROCESS_BEFORE ${pid} %s\n' "$start"
set -- /proc/${pid}/task/[0-9]*
[ "$#" -le 1024 ] || exit 1
printf 'BEFORE'
thread_list=''
for entry do thread_list="$thread_list ${'$'}{entry##*/}"; done
printf '%s\n' "$thread_list"
files=''
for entry do files="$files $entry/status $entry/cgroup"; done
printf 'BATCH\n'
grep -H -e '^Cpus_allowed_list:' -e '^[0-9]' -- $files 2>/dev/null
capture_status=$?
printf 'CAPTURE_STATUS %s\n' "$capture_status"
printf 'AFTER'
set -- /proc/${pid}/task/[0-9]*
[ "$#" -le 1024 ] || exit 1
thread_list=''
for entry do thread_list="$thread_list ${'$'}{entry##*/}"; done
printf '%s\n' "$thread_list"
end=$(proc_start) || exit 1
printf 'PROCESS_AFTER ${pid} %s\n' "$end"
`;
}

function tids(text, prefix, pid) {
  if (!text?.startsWith(prefix) || !/^[1-9][0-9]*(?: [1-9][0-9]*)*$/.test(text.slice(prefix.length))) {
    throw Error('Malformed thread set');
  }
  const values = text.slice(prefix.length).split(' ').map(Number);
  values.forEach(validPid);
  if (values.length > 1024 || new Set(values).size !== values.length || !values.includes(pid)) throw Error('Invalid thread set');
  return values.sort((left, right) => left - right);
}

function expandBatch(lines, pid, before, after) {
  const status = /^CAPTURE_STATUS (0|2)$/.exec(lines.at(-3));
  if (!status) throw Error('Batch read status invalid');
  const records = new Map(before.map(tid => [tid, { affinity: null, groups: [] }]));
  const path = new RegExp(`^/proc/${pid}/task/([1-9][0-9]*)/(status|cgroup):(.*)$`);
  for (const line of lines.slice(3, -3)) {
    const match = path.exec(line);
    const record = match && records.get(Number(match[1]));
    if (!record) throw Error('Unexpected batch filename or thread');
    if (match[2] === 'status') {
      if (record.affinity !== null || !/^Cpus_allowed_list:[ \t]*[0-9][0-9,-]*$/.test(match[3])) {
        throw Error('Malformed or duplicate batch affinity');
      }
      record.affinity = match[3];
    } else {
      if (!/^[0-9]+:[^:\s]*:\/\S*$/.test(match[3]) || record.groups.includes(match[3]) || record.groups.length >= 32) {
        throw Error('Malformed or duplicate batch cgroup');
      }
      record.groups.push(match[3]);
    }
  }
  const expanded = [];
  let failed = 0;
  for (const [tid, record] of records) {
    if (record.affinity !== null && record.groups.length) {
      expanded.push(`THREAD ${tid}`, record.affinity, ...record.groups, `END_THREAD ${tid}`);
    } else {
      if (status[1] !== '2' || after.includes(tid)) throw Error('Incomplete batch thread');
      expanded.push(`FAILED ${tid} ${record.affinity === null ? 'status' : 'cgroup'}`);
      failed++;
    }
  }
  if (status[1] === '2' && !failed) throw Error('Unexplained batch read error');
  return [lines[0], lines[1], ...expanded, lines.at(-2), lines.at(-1)].join('\n');
}

export function parseAndroidSnapshot(raw, pid, startTicks) {
  validPid(pid);
  if (typeof startTicks !== 'string' || !/^[0-9]+$/.test(startTicks)) throw Error('Invalid process start ticks');
  if (typeof raw !== 'string' || raw.length > 131072) throw Error('Snapshot size/type invalid');
  const lines = raw.replaceAll('\r\n', '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  if (lines[0] !== `PROCESS_BEFORE ${pid} ${startTicks}` || lines.at(-1) !== `PROCESS_AFTER ${pid} ${startTicks}`) {
    throw Error('Snapshot process identity or framing changed');
  }
  const before = tids(lines[1], 'BEFORE ', pid);
  const after = tids(lines.at(-2), 'AFTER ', pid);
  if (lines[2] === 'BATCH') return parseAndroidSnapshot(expandBatch(lines, pid, before, after), pid, startTicks);
  const seen = new Set(), failed = [], threads = [];
  let cursor = 2;
  while (cursor < lines.length - 2) {
    const header = /^(THREAD|FAILED) ([1-9][0-9]*)(?: (status|cgroup|limits))?$/.exec(lines[cursor++]);
    if (!header) throw Error('Malformed thread header');
    const tid = Number(header[2]);
    if (!before.includes(tid) || seen.has(tid)) throw Error('Unexpected or duplicate thread');
    seen.add(tid);
    if (header[1] === 'FAILED') {
      if (!header[3] || header[3] === 'limits' || after.includes(tid)) throw Error('Unreadable live thread');
      failed.push(tid);
      continue;
    }
    if (header[3]) throw Error('Malformed complete thread');
    const affinity = /^Cpus_allowed_list:[ \t]*([0-9][0-9,-]*)$/.exec(lines[cursor++]);
    if (!affinity) throw Error('Missing thread affinity');
    const groups = [];
    while (cursor < lines.length - 2 && lines[cursor] !== `END_THREAD ${tid}`) {
      if (!/^[0-9]+:[^:\s]*:\/\S*$/.test(lines[cursor])) throw Error('Malformed thread cgroup');
      groups.push(lines[cursor++]);
    }
    if (!groups.length || lines[cursor++] !== `END_THREAD ${tid}`) throw Error('Incomplete thread');
    threads.push({ affinity: affinity[1], cgroup: groups.join('\n') });
  }
  if (cursor !== lines.length - 2 || seen.size !== before.length) throw Error('Missing thread records');
  return { state: failed.length || before.join(',') !== after.join(',') ? 'retry' : 'complete',
    pid, startTicks, tids: before, afterTids: after, failedTids: failed, threads };
}

export async function captureAndroidSnapshot({ pid, startTicks, read, record, validate,
  maxAttempts = 5, now = () => performance.now(), pause = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) throw Error('Invalid snapshot attempt limit');
  const command = androidSnapshotScript(pid);
  const started = now();
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (now() - started > 2000) throw Error('Android snapshot deadline exceeded');
    let raw;
    try { raw = await read(command); } catch (error) {
      record({ attempt, transportFailure: true, status: error.status ?? null,
        raw: String(error.stdout ?? '').slice(0, 131072), stderr: String(error.stderr ?? '').slice(0, 8192) });
      throw Error('Android CPU snapshot transport failed');
    }
    record({ attempt, raw });
    if (now() - started > 2000) throw Error('Android snapshot deadline exceeded');
    const result = parseAndroidSnapshot(raw, pid, startTicks);
    if (result.threads.length) validate(result.threads);
    if (result.state === 'complete') return { ...result, raw, attempts: attempt };
    if (attempt < maxAttempts) await pause(25);
  }
  throw Error('Android snapshot retries exhausted');
}
