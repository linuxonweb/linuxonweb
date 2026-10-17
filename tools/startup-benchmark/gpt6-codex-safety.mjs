import { patchInit } from '../nightly-jit-safety/guest-runner/contracts.mjs';

const modes = ['reference-disabled', 'reference-enabled', 'method-enabled'];
const validLabel = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);

function environment(mode) {
  if (!modes.includes(mode)) throw Error('Invalid full-safety mode');
  return {
    PBLIC: mode === 'method-enabled' ? '1' : '0',
    PBLBC: mode === 'method-enabled' ? '1' : '0',
    PBLJIT: mode === 'reference-disabled' ? '0' : '1',
    PBLJIT_OBSERVE: '1', PBLJIT_LOG: '0', PBLIC_LOG: '0', PBLBC_LOG: '0',
  };
}

export function fullSafetyPlan(config) {
  if (config.safetyArm === undefined) return null;
  const env = environment(config.safetyArm);
  if (config.candidate !== true || config.workerPool !== true || config.seconds !== 150 ||
      config.ramMiB !== 2048 || !Number.isInteger(config.cpus) || config.cpus < 1 || config.cpus > 64 ||
      !validLabel(config.safetyLabel) ||
      ['jitArm', 'jitRuntime', 'jitFull', 'jitIdentity', 'trace', 'timing'].some(key => config[key] !== undefined && config[key] !== false)) {
    throw Error('Full safety requires an isolated 150-second, 2GiB candidate session with measured CPUs');
  }
  const enabled = config.safetyArm !== 'reference-disabled';
  const preferences = {
    'javascript.options.portable_baseline': enabled,
    'network.http.http2.enabled': false,
    'network.http.http3.enable': false,
    'toolkit.legacyUserProfileCustomizations.stylesheets': true,
    'media.rdd-process.enabled': false,
    'media.utility-process.enabled': false,
    'media.allow-audio-non-utility': true,
    'devtools.chrome.enabled': true,
    'devtools.console.stdout.chrome': true,
    'devtools.console.stdout.content': true,
    'webgl.disabled': true,
    'dom.webgpu.enabled': false,
    'browser.startup.page': 0,
    'browser.startup.homepage': 'about:blank',
    'datareporting.policy.firstRunURL': '',
  };
  return {
    mode: config.safetyArm, label: config.safetyLabel, arm: enabled ? 'enabled' : 'disabled',
    portableBaseline: enabled, requestedGuestCpus: config.cpus, environment: env,
    bounds: { outerWallDeadlineSeconds: 150, scopeWallDeadlineSeconds: 30, observerLimitBytes: 2097152 },
    scopes: enabled ? ['gc-debug-coverage', 'incremental', 'slice-gc', 'interrupt'] : [],
    fixtureClaims: { compiled: 14, bailout: 7, excluded: 2, 'policy-excluded': 2 },
    expectedRows: 50,
    preferences: Object.entries(preferences).map(([name, value]) => `user_pref(${JSON.stringify(name)},${JSON.stringify(value)});`).join('\n') + '\n',
    originalPolicyCompatible: config.safetyArm !== 'method-enabled',
    policyDifference: config.safetyArm === 'method-enabled' ? 'PBLIC admits throw-only scripts; the original checker still requires policy exclusion.' : null,
    diagnosticOnly: true, fullJITAcceptance: false,
  };
}

export function fullSafetyCapture(source, plan) {
  const expected = environment(plan.mode);
  if (!validLabel(plan.label) || !plan.environment ||
      Object.keys(plan.environment).length !== Object.keys(expected).length ||
      Object.entries(expected).some(([key, value]) => plan.environment[key] !== value)) {
    throw Error('Full-safety capture plan changed');
  }
  const exports = 'export PBLJIT_OBSERVE=1 PBLJIT_LOG=0';
  const label = 'label=$(cat /home/admin/nightly-jit-safety/active-label)\n';
  if (source.split(exports).length !== 2 || source.split(label).length !== 2) {
    throw Error('Expected unique original capture anchors');
  }
  return source.replace(exports, 'export ' + Object.entries(expected).map(([key, value]) => `${key}=${value}`).join(' '))
    .replace(label, label + `[ "$label" = '${plan.label}' ] || exit 97\n`);
}

export function fullSafetyInit(source) {
  return patchInit(source);
}

export function instrumentFullSafetyInit(source, packagedInit) {
  const anchor = "  const entries = [cpioEntry('init.desktop-original', original), cpioEntry('init', wrapper),";
  if (typeof packagedInit !== 'string' || !packagedInit.startsWith('#!') || packagedInit.length > 65536 ||
      source.includes('Full-safety packaged init mismatch') || source.split(anchor).length !== 2) {
    throw Error('Expected unique private safety init overlay');
  }
  const patched = fullSafetyInit(packagedInit);
  return source.replace(anchor,
    `  if (decoder.decode(original) !== ${JSON.stringify(packagedInit)}) throw Error('Full-safety packaged init mismatch');\n` +
    `  original = encoder.encode(${JSON.stringify(patched)});\n` + anchor);
}
