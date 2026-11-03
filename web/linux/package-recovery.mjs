const failure = 'apk-persist: RESTORE FAILED; desktop startup stopped';
/** Match only native startup output, including marker split across chunks. */
export function createPackageRecoveryWatch(onFailure) {
  let active = false, tail = '';
  return {
    start() { active = true; tail = ''; },
    write(text, source) {
      if (!active || source !== 'guest') return;
      const observed = tail + String(text);
      tail = observed.slice(-512);
      if (observed.includes(failure)) { active = false; tail = ''; onFailure(); }
      else if (observed.includes('display: starting Xfbdev')) { active = false; tail = ''; }
    },
    stop() { active = false; tail = ''; },
  };
}
