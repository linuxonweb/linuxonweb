// Strict dynamic CPU contract for every future NSS cold/update/warm boot.
import { readHostNproc, selectHostCpus, saveGuestCpuEvidence } from '../guest-rootfs/firefox-host-cpus.mjs';
export { readHostNproc };
export function selectNssHostCpus(browserHardwareConcurrency, hostNproc = readHostNproc()) {
  if (browserHardwareConcurrency !== hostNproc || hostNproc > 64) throw Error('exact host CPU count cannot be selected');
  return selectHostCpus(hostNproc, browserHardwareConcurrency);
}
export async function saveNssBootEvidence(cpu, startupLogs, state, out, label) {
  if (cpu.hostNproc !== cpu.browserHardwareConcurrency || cpu.requestedGuestCpus !== cpu.hostNproc) throw Error('exact host-count selection required');
  return saveGuestCpuEvidence(cpu, startupLogs, state, out, label, readHostNproc());
}
