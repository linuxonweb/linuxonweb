// Test-only hook for the exact matched 10s warmup / 20s WebGL2 scene.
// Resource monitoring stays outside the page; no polling or screenshot occurs
// during this fixed quiet interval after navigation.
import {setTimeout as delay} from 'node:timers/promises';
const sceneSha = 'e610e6b07da7622ed0724308dd5867b93330ad2a740c515dea46bfa1b1a929c0';
export async function run({send, result, url, cpus}) {
  const input = result.inputs[new URL(url).pathname];
  if (cpus !== 3 || input?.sha256 !== sceneSha || input.bytes !== 36031)
    throw Error('Matched host scene/CPU identity differs');
  const started = performance.now();
  result.quietSceneObservation = {startedUtc:new Date().toISOString(), requestedMs:35000,
    excludes:['page polling','screenshots','tracing'], resourceMonitor:'CPU/RSS/RAM1s and PSS5s',
    note:'This outer observation delay does not change scene warmup or sample timing.'};
  await delay(35000);
  result.quietSceneObservation.finishedUtc = new Date().toISOString();
  result.quietSceneObservation.elapsedMs = performance.now() - started;
  const data = await send('Runtime.evaluate', {expression:`({done:window.gpuCheckBenchmark?.done,
    settings:window.gpuCheckBenchmark?.settings,frames:window.gpuCheckFrames,
    firstFrameEpochMs:window.gpuCheckBenchmark?.firstFrameEpochMs,
    sampleStartEpochMs:window.gpuCheckBenchmark?.sampleStartEpochMs,
    sampleEndEpochMs:window.gpuCheckBenchmark?.sampleEndEpochMs,
    cpus:navigator.hardwareConcurrency,viewport:[innerWidth,innerHeight,devicePixelRatio]})`,returnByValue:true});
  result.afterQuietScene = data.result?.value;
  if (result.afterQuietScene?.cpus !== cpus) throw Error('Host scene CPU count differs');
}
