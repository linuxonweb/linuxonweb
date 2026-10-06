// A live common-service integration gate. The original frozen primitive
// checker remains unchanged; only its API/pixel/lifecycle predicates are used.
import { checkEgl } from '../../web/linux/tests/guest-vulkan-wgpu/check-egl.mjs';
import { browserAffinityChecks, cgroupPath, expandCpuList, parseCpuMax } from './firefox-browser-affinity.mjs';
import { guestCpuChecks } from './firefox-host-cpus.mjs';
const prefix = '/linux/gpu-runtime/v1/';
const rust = {
  'guest_vulkan_wgpu_host.js': { bytes: 121321, sha256: 'f7dbe44f135cd8f596860696901413e36f9eeea3fbc61038d6602a936dcc3f9d' },
  'guest_vulkan_wgpu_host_bg.wasm': { bytes: 4161388, sha256: '4341087d9b0fea428966ce9f27a4e9328cc0ef5cdc632bbc31cd57ccf1afe5de' },
};
const runtimeChecks = ['execution', 'exactWorkload', 'actualMesa', 'honestProfile',
  'noGuestFailures', 'completedFrames', 'depthControl', 'fullPixelReference',
  'successExit', 'actualRustOperations', 'translatorCleanup', 'nativeCleanup',
  'backendChoice', 'adapter', 'ownership', 'noExceptions'];

// Reconstruct the saved reader's result from every raw ancestor, including
// the actual affinity limit. Only the unified root may lack cpu.max.
function quotaEvidenceMatches(quota, cgroupText, cpuList) {
  const group = cgroupPath(cgroupText);
  const allowed = expandCpuList(cpuList).length;
  const segments = group.split('/').filter(Boolean);
  const paths = Array.from({ length: segments.length + 1 }, (_, count) =>
    '/' + segments.slice(0, count).join('/'));
  const ancestors = quota?.ancestors;
  if (!Array.isArray(ancestors) || !ancestors.length) return false;
  const expected = ancestors[0].cgroup === '/' ? paths : paths.slice(1);
  if (ancestors.length !== expected.length) return false;
  let minimum = Infinity;
  for (let index = 0; index < ancestors.length; index++) {
    const ancestor = ancestors[index];
    if (ancestor.cgroup !== expected[index]) return false;
    const parsed = parseCpuMax(ancestor.cpuMax);
    if (ancestor.quotaCpus !== parsed) return false;
    if (parsed !== null) minimum = Math.min(minimum, parsed);
  }
  return quota.cgroup === group && quota.allowedCpuCount === allowed &&
    quota.minimumQuotaCpus === (Number.isFinite(minimum) ? minimum : null) &&
    quota.effectiveCpus === Math.min(allowed, Math.ceil(minimum));
}

export function checkSharedRustGpu(report) {
  const original = checkEgl(report);
  const checks = Object.fromEntries(runtimeChecks.map(name => [name, original.checks[name] === true]));
  const requests = report.requests ?? [];
  checks.stableRustBytes = Object.entries(rust).every(([name, identity]) => {
    const actual = requests.filter(r => r.url === prefix + name);
    return actual.length > 0 && actual.every(r => r.bytes === identity.bytes && r.sha256 === identity.sha256);
  });
  checks.noPrivateRustRoute = !requests.some(r => /candidate\/guest_vulkan_wgpu_host/.test(r.url));
  checks.productionBridge = requests.some(r => r.url === prefix + 'bridge.mjs') &&
    requests.some(r => r.url === prefix + 'graphics-renderer.mjs');
  checks.archive = report.result?.archiveSha256 === 'a4d7447a21c53e8887b8dfcbfbd34f9340ce3bf5b267f5706d4f0b56ec97e330' &&
    requests.some(r => r.url === '/linux/tests/guest-vulkan-wgpu/candidate/initramfs.cpio' &&
      r.bytes === 60238864 && r.sha256 === report.result.archiveSha256);
  checks.servedSources = report.inputsUnchanged === true &&
    Object.keys(report.inputs ?? {}).some(source => source.endsWith('/web/linux/dist/guest-gpu-vk.js')) &&
    Object.entries(report.inputs).every(([source, pin]) => {
      const index = source.lastIndexOf('/web/linux/');
      if (index < 0) return false;
      const route = source.slice(index + '/web'.length);
      const actual = requests.filter(r => r.url === route);
      return actual.length > 0 && actual.every(r => r.sha256 === pin);
    });
  const cpu = report.result?.cpu, affinity = report.affinity;
  checks.guestCpuConfiguration = Number.isInteger(cpu?.hostNproc) && cpu.hostNproc > 0 &&
    report.result?.guest?.configuration?.cpus === cpu.hostNproc &&
    cpu.hostCores === cpu.hostNproc && cpu.expectedHostCores === cpu.hostNproc;
  try {
    checks.quotaReconstruction =
      quotaEvidenceMatches(affinity.runnerQuota, affinity.runnerCgroupObserved, affinity.runnerCpuList) &&
      quotaEvidenceMatches(affinity.browserQuota, affinity.browserCgroup, affinity.browserCpuList);
  } catch { checks.quotaReconstruction = false; }
  try {
    checks.quotaAndAffinity = affinity.hostNproc === cpu.hostNproc &&
      Object.values(browserAffinityChecks(affinity, affinity)).every(v => v === true) &&
      Object.values(guestCpuChecks(cpu, { browserHardwareConcurrency: cpu.browserHardwareConcurrencyAtBoot,
        selectedGuestCpus: cpu.selectedGuestCpus }, cpu.hostNprocObserved)).every(v => v === true) &&
      cpu.smpLines.length > 0 && cpu.smpLines.every(line => report.result.guest.bootLogs.includes(line));
  } catch { checks.quotaAndAffinity = false; }
  return { pass: Object.values(checks).every(v => v === true), checks,
    adapter: original.adapter, frameChecksums: original.frameChecksums,
    scope: 'native Mesa textured/depth pixel correctness through promoted common Rust service',
    firefoxGpuAcceptance: false, concurrencyAcceptance: false, performanceAcceptance: false, releaseAcceptance: false };
}
